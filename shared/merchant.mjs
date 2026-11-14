import { ITEMS } from './cosmetics.mjs';
import { STOCK_RIGS, rigFor } from './rigs.mjs';

export const MERCHANT_RESTOCK_MS = 600_000;
export const MERCHANT_RETRY_MS = 60_000;
export const MERCHANT_TREASURY_RESERVE = 2_000;

const BUYBACKS = [
  { itemType: 'iron', prices: [420, 380, 340, 300] },
  { itemType: 'cork', prices: [310, 280, 250, 220] },
];

export function merchantOrder(merchant) {
  const cycle = merchant?.cycle ?? 0;
  const { itemType, prices } = BUYBACKS[cycle % BUYBACKS.length];
  const received = merchant?.received ?? 0;
  const order = itemType + '-buyback';
  return {
    order: cycle ? order + '-' + cycle : order,
    itemType,
    price: prices[received] ?? 0,
    remaining: prices.length - received,
    budget: merchant?.budget ?? prices.reduce((sum, price) => sum + price, 0),
    received,
    restockAt: merchant?.restockAt ?? null,
    arrivedAt: merchant?.arrivedAt ?? null,
    waitingForFunds: Boolean(merchant?.waitingForFunds),
  };
}

export function merchantRestockDue(merchant, now) {
  return Boolean(merchant && merchantOrder(merchant).remaining === 0 &&
    (merchant.restockAt == null || merchant.restockAt <= now));
}

export function advanceMerchant(state, now) {
  const merchant = state.merchant;
  if (!merchantRestockDue(merchant, now)) return;
  if (merchant.restockAt == null) {
    // A completed order saved before replenishment was introduced starts its first wait.
    merchant.restockAt = now + MERCHANT_RESTOCK_MS;
    return;
  }
  const cycle = (merchant.cycle ?? 0) + 1;
  const { budget } = merchantOrder({ cycle });
  if (state.treasury < budget + MERCHANT_TREASURY_RESERVE) {
    merchant.restockAt = now + MERCHANT_RETRY_MS;
    merchant.waitingForFunds = true;
    return;
  }
  state.treasury -= budget;
  state.merchant = { cycle, budget, received: 0, arrivedAt: now };
}

const TRADE_TYPES = [...STOCK_RIGS, ...Object.values(ITEMS)
  .filter(item => item.price && item.slot !== 'home' && item.slot !== 'chest').map(item => item.id)];
const demandAt = (index, cycle) => (index * 7 + cycle * 3) % 11;

export function dockQuote(type, now, markup = 0, missing = 0) {
  const index = TRADE_TYPES.indexOf(type);
  if (index < 0) return null;
  const cycle = Math.floor(now / MERCHANT_RESTOCK_MS);
  const base = ITEMS[type]?.price ?? rigFor(type).price;
  const prices = demand => ({
    bid: Math.round(base * (.36 + demand * .022)),
    ask: base + markup - (demand <= 3 ? Math.round(base * (4 - demand) * .05) : 0),
  });
  const demand = demandAt(index, cycle);
  const current = prices(demand);
  const previous = prices(demandAt(index, cycle + 10));
  const wanted = missing > 0 && cycle % 7 !== 0 && cycle % 7 !== 4;
  const normalBid = current.bid;
  const bid = normalBid + (wanted ? Math.max(1, Math.round(base * (.10 + .015 * missing))) : 0);
  return {
    ...current, bid, normalBid, wanted, order: 'dock-' + cycle, nextAt: (cycle + 1) * MERCHANT_RESTOCK_MS,
    discount: base + markup - current.ask,
    bidDelta: normalBid - previous.bid, askDelta: current.ask - previous.ask,
  };
}
