import { randomUUID } from 'node:crypto';
import { EXPEDITION_ITEM } from './cosmetics.mjs';

export { EXPEDITION_ITEM };
export const EXPEDITION_FEE_PERCENT = 5;
const MIN_SUPPORTERS = 2;
const ACTION_ID = /^[a-f0-9-]{36}$/;
const DEFAULT_RULES = Object.freeze({
  target: 3_000,
  minimumContribution: 100,
  fundingMs: 300_000,
  sailingMs: 8_000,
  auctionMs: 60_000,
  minimumBid: 100,
  bidIncrement: 100,
});

export function expeditionRules(overrides) {
  const rules = Object.fromEntries(Object.entries(DEFAULT_RULES)
    .map(([key, fallback]) => [key, overrides?.[key] ?? fallback]));
  if (Object.values(rules).some(value => !Number.isSafeInteger(value) || value < 1)
      || rules.target < rules.minimumContribution * MIN_SUPPORTERS) {
    throw new TypeError('Invalid expedition rules.');
  }
  return rules;
}

export function createExpedition(rules, now) {
  return {
    id: randomUUID(),
    status: 'funding',
    rules,
    itemType: EXPEDITION_ITEM,
    openedAt: now,
    fundingEndsAt: null,
    departedAt: null,
    arrivalAt: null,
    auctionEndsAt: null,
    funded: 0,
    contributions: {},
    payouts: {},
    actions: {},
    bid: null,
    sale: null,
  };
}

function deadlineOf(campaign) {
  if (campaign.status === 'funding') return campaign.fundingEndsAt;
  if (campaign.status === 'sailing') return campaign.arrivalAt;
  if (campaign.status === 'auction') return campaign.auctionEndsAt;
  return null;
}

export function expeditionDue(campaign, now) {
  const deadline = campaign ? deadlineOf(campaign) : null;
  return deadline !== null && deadline <= now;
}

function maxContribution(campaign, accountId) {
  const { funded, rules, contributions } = campaign;
  const supportersAfterContribution = Object.keys(contributions).length
    + (contributions[accountId] ? 0 : 1);
  const quorumReserve = Math.max(0, MIN_SUPPORTERS - supportersAfterContribution) * rules.minimumContribution;
  return Math.max(0, rules.target - funded - quorumReserve);
}

function minimumContribution(campaign) {
  return Math.min(campaign.rules.minimumContribution, campaign.rules.target - campaign.funded);
}

function nextBidOf(campaign) {
  return campaign.bid ? campaign.bid.amount + campaign.rules.bidIncrement : campaign.rules.minimumBid;
}

export function expeditionSnapshot(campaign, accountId) {
  if (!campaign) return null;
  const { id, itemType, status, funded, contributions, openedAt, fundingEndsAt,
    departedAt, arrivalAt, auctionEndsAt, bid, payouts, sale, rules } = campaign;
  const isHighestBidder = hasReservedExpeditionSlot(campaign, accountId);
  const myContribution = contributions[accountId] ?? 0;
  return {
    id, itemType, status, funded, openedAt, fundingEndsAt, departedAt, arrivalAt, auctionEndsAt,
    target: rules.target,
    deadline: deadlineOf(campaign),
    supporters: Object.keys(contributions).length,
    minSupporters: MIN_SUPPORTERS,
    minimumContribution: minimumContribution(campaign),
    maxContribution: status === 'funding' ? maxContribution(campaign, accountId) : 0,
    minimumBid: rules.minimumBid,
    bidIncrement: rules.bidIncrement,
    highestBid: bid?.amount ?? 0,
    nextBid: status === 'auction' ? nextBidOf(campaign) : 0,
    feePercent: EXPEDITION_FEE_PERCENT,
    myContribution,
    myPayout: payouts[accountId] ?? 0,
    myRefund: status === 'refunded' ? myContribution : 0,
    myBid: isHighestBidder ? bid.amount : 0,
    isHighestBidder,
    won: status === 'settled' && bid.accountId === accountId,
    sale,
  };
}

function distributeProceeds(state, campaign, amount) {
  const total = BigInt(campaign.funded);
  const shares = Object.entries(campaign.contributions).map(([accountId, contribution]) => {
    const weighted = BigInt(amount) * BigInt(contribution);
    return { accountId, paid: Number(weighted / total), remainder: weighted % total };
  });
  // Assign remaining cents by largest fraction. Stable sorting breaks ties in contribution order.
  shares.sort((left, right) => Number(right.remainder - left.remainder));
  const remaining = amount - shares.reduce((sum, share) => sum + share.paid, 0);
  for (const [index, share] of shares.entries()) {
    const paid = share.paid + Number(index < remaining);
    campaign.payouts[share.accountId] = paid;
    state.accounts[share.accountId].gold += paid;
  }
}

export function awardExpeditionCargo(state, accountId, order) {
  const gear = state.gear ??= {};
  let itemId;
  do { itemId = randomUUID(); } while (Object.hasOwn(gear, itemId));
  gear[itemId] = { id: itemId, owner: accountId, type: EXPEDITION_ITEM, order };
  return itemId;
}

export function advanceExpedition(state, now) {
  const campaign = state.expedition;
  if (!expeditionDue(campaign, now)) return;
  if (campaign.status === 'funding') {
    for (const [accountId, amount] of Object.entries(campaign.contributions)) {
      state.accounts[accountId].gold += amount;
    }
    campaign.status = 'refunded';
    return;
  }
  if (campaign.status === 'sailing') {
    campaign.status = 'auction';
    campaign.auctionEndsAt = now + campaign.rules.auctionMs;
    return;
  }

  const bid = campaign.bid;
  if (!bid) {
    campaign.status = 'unsold';
    return;
  }
  awardExpeditionCargo(state, bid.accountId, 'expedition:' + campaign.id);
  const price = bid.amount;
  const fee = Number((BigInt(price) * BigInt(EXPEDITION_FEE_PERCENT) + 99n) / 100n);
  const distributed = price - fee;
  state.treasury += fee;
  distributeProceeds(state, campaign, distributed);
  campaign.sale = { price, fee, distributed };
  campaign.status = 'settled';
}

function contribute(state, campaign, accountId, amount, now, requireRule) {
  requireRule(campaign.status === 'funding', 'This voyage has closed funding.');
  const limit = maxContribution(campaign, accountId);
  requireRule(amount >= minimumContribution(campaign) && amount <= limit,
    'Choose an amount within the current funding limit.');
  const account = state.accounts[accountId];
  requireRule(account.gold >= amount, 'You need more local test gold.');

  account.gold -= amount;
  campaign.contributions[accountId] = (campaign.contributions[accountId] ?? 0) + amount;
  campaign.funded += amount;
  campaign.fundingEndsAt ??= now + campaign.rules.fundingMs;
  if (campaign.funded === campaign.rules.target) {
    campaign.status = 'sailing';
    campaign.departedAt = now;
    campaign.arrivalAt = now + campaign.rules.sailingMs;
    state.treasury += campaign.funded;
  }
}

function bidOnCargo(state, campaign, accountId, amount, requireRule, hasInventoryRoom) {
  requireRule(campaign.status === 'auction', 'This cargo is outside its auction window.');
  requireRule(amount >= nextBidOf(campaign), 'The minimum bid changed. Review the latest bid.');
  const previous = campaign.bid;
  const ownBid = previous?.accountId === accountId;
  requireRule(ownBid || hasInventoryRoom(state, accountId), 'Make room in your inventory before bidding.');
  const account = state.accounts[accountId];
  const debit = ownBid ? amount - previous.amount : amount;
  requireRule(account.gold >= debit, 'You need more local test gold.');

  if (previous && !ownBid) state.accounts[previous.accountId].gold += previous.amount;
  account.gold -= debit;
  campaign.bid = { accountId, amount };
}

export function applyExpeditionAction(state, accountId, action, now, requireRule, hasInventoryRoom) {
  const campaign = state.expedition;
  const { type, campaignId, actionId, amount } = action ?? {};
  requireRule(state.accounts[accountId], 'Open your local profile first.');
  requireRule(campaign && campaign.id === campaignId, 'Open Expeditions to review the current voyage.');
  requireRule((type === 'expedition-contribute' || type === 'expedition-bid')
    && typeof actionId === 'string' && ACTION_ID.test(actionId)
    && Number.isSafeInteger(amount) && amount > 0, 'Choose a valid expedition amount.');

  const recorded = campaign.actions[actionId];
  if (recorded) {
    requireRule(recorded.accountId === accountId && recorded.type === type && recorded.amount === amount,
      'That expedition request has already been used.');
    return expeditionSnapshot(campaign, accountId);
  }

  if (type === 'expedition-contribute') contribute(state, campaign, accountId, amount, now, requireRule);
  else bidOnCargo(state, campaign, accountId, amount, requireRule, hasInventoryRoom);
  campaign.actions[actionId] = { accountId, type, amount };
  return expeditionSnapshot(campaign, accountId);
}

export function hasReservedExpeditionSlot(campaign, accountId) {
  return campaign?.status === 'auction' && Boolean(campaign.bid && campaign.bid.accountId === accountId);
}
