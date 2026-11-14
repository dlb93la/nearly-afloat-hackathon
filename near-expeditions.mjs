import { randomBytes } from 'node:crypto';
import { Account, JsonRpcProvider } from 'near-api-js';
import { verifyMessage } from 'near-api-js/nep413';
import { EconomyError } from './economy.mjs';
import { cosmeticFor } from './shared/cosmetics.mjs';
import { EXPEDITION_FEE_PERCENT, EXPEDITION_ITEM } from './shared/expeditions.mjs';
import { rpcReadPool, rpcView } from './near-rpc-reads.mjs';

const testnetAccount = /^(?:[a-z0-9]+(?:[-_.][a-z0-9]+)*\.testnet|[a-f0-9]{64})$/;
const isAccount = value => typeof value === 'string' && value.length <= 64 && testnetAccount.test(value);

export function loadNearExpeditions(env = process.env, arena = null) {
  const unified = env.BARREL_NEAR_VOYAGE === '1';
  if (unified && !arena?.hasWorkshop) throw new Error('The shared NEAR voyage needs BARREL_NEAR_WORKSHOP=1.');
  const contract = unified ? arena.contract : env.BARREL_EXPEDITIONS_CONTRACT;
  const operator = env.BARREL_EXPEDITIONS_OPERATOR;
  const key = env.BARREL_EXPEDITIONS_KEY;
  if (!contract && !operator && !key) return null;
  if (!isAccount(contract) || Boolean(operator) !== Boolean(key) || (operator && !isAccount(operator))) {
    throw new Error('Configure the Expeditions testnet contract and optional operator key.');
  }
  const provider = new JsonRpcProvider({ url: (!unified && env.BARREL_EXPEDITIONS_RPC) || env.BARREL_NEAR_RPC || 'https://test.rpc.fastnear.com' },
    { retries: 2, wait: 200, backoff: 2 });
  const signer = operator && new Account(operator, provider, key);
  const receiptNetwork = env.BARREL_NEAR_SOCIAL_SANDBOX === '1' || ['localhost', '127.0.0.1', '[::1]'].includes(new URL((!unified && env.BARREL_EXPEDITIONS_RPC) || env.BARREL_NEAR_RPC || 'https://test.rpc.fastnear.com').hostname)
    ? 'sandbox' : 'testnet';
  const reads = rpcReadPool(provider);
  const view = (method, args = {}) => rpcView(provider, contract, method, args,
    { ttl: method === 'campaign' ? 2000 : 0 });
  let writer = Promise.resolve();
  let settlement = null;

  function serialize(action) {
    const work = writer.then(action);
    writer = work.catch(() => {});
    return work;
  }

  async function change(methodName, args = {}) {
    const result = await signer.callFunctionRaw({
      contractId: contract, methodName, args,
      gas: 100_000_000_000_000n, deposit: 0n, waitUntil: 'FINAL',
    }).catch(error => { throw reads.failure(error); });
    reads.invalidate(contract);
    return result;
  }

  function challenge(account) {
    if (!isAccount(account)) throw new EconomyError('Choose a valid NEAR testnet wallet.');
    return {
      nonce: randomBytes(32).toString('hex'), recipient: contract, account,
      message: 'Connect this NEAR testnet account to Expeditions in NEARly Afloat.',
      expiresAt: Date.now() + 120_000,
    };
  }

  async function authenticate(proof, signed) {
    if (!proof || proof.expiresAt <= Date.now() || proof.account !== signed.accountId
        || typeof signed.publicKey !== 'string' || typeof signed.signature !== 'string') {
      throw new EconomyError('Connect your NEAR testnet wallet again.');
    }
    const { accountId, publicKey, signature } = signed;
    try {
      await verifyMessage({
        signerAccountId: accountId, signerPublicKey: publicKey, signature: Buffer.from(signature, 'base64'),
        payload: { message: proof.message, recipient: contract, nonce: Buffer.from(proof.nonce, 'hex') },
        provider,
      });
    } catch {
      throw new EconomyError('The wallet signature could not be verified.');
    }
    if (unified) await arena.ensureAccount(accountId);
    if (signer && !unified) {
      await serialize(async () => {
        if ((await view('account', { player: accountId })).registered) return;
        try { await change('grant_test_gold', { player: accountId }); }
        catch (error) {
          if (!(await view('account', { player: accountId })).registered) throw error;
        }
      });
    }
    return accountId;
  }

  async function read(account, { fresh = false } = {}) {
    if (fresh) reads.invalidate(contract);
    const [campaign, player] = await Promise.all([
      view('campaign'), account ? view('account', { player: account }) : null,
    ]);
    const currentSettlement = ['settled', 'refunded', 'unsold'].includes(campaign.status) && settlement?.id === campaign.id
      ? settlement?.hash ?? null : null;
    return {
      account,
      managedFinalization: Boolean(unified && signer),
      settlementHash: currentSettlement,
      receiptNetwork,
      receiptUrl: receiptNetwork === 'testnet' && currentSettlement ? 'https://testnet.nearblocks.io/txns/' + currentSettlement : null,
      awardEquipped: player?.award_equipped === true && (!unified || player?.award === campaign.item_type),
      awardCounts: player?.award_counts ?? {},
      awardEditions: player?.award_editions ?? [],
      gold: player?.balance ?? null,
      nonce: player?.contribution_nonce ?? 0,
      registered: Boolean(player?.registered),
      campaign: {
        id: contract + '/' + (campaign.id ?? 0), campaignId: campaign.id ?? 0, status: campaign.status, target: campaign.target, funded: campaign.funded,
        supporters: campaign.contributor_count, minSupporters: campaign.min_supporters, itemType: campaign.item_type,
        myOwnedUnits: player?.award_counts?.[campaign.item_type] ?? ((player?.awards ?? [player?.award]).includes(campaign.item_type) ? 1 : 0),
        fundingEndsAt: campaign.funding_ends_at, departedAt: campaign.sails_at, arrivalAt: campaign.auction_starts_at,
        auctionEndsAt: campaign.auction_ends_at, highestBid: campaign.highest_bid, nextBid: campaign.minimum_bid,
        feePercent: EXPEDITION_FEE_PERCENT, needsAdvance: campaign.needs_advance,
        minimumContribution: player?.min_contribution ?? 100, maxContribution: player?.max_contribution ?? 0,
        myContribution: player?.contribution ?? 0, myPayout: player?.payout ?? 0, myRefund: player?.refund ?? 0,
        isHighestBidder: Boolean(campaign.status === 'auction' && account && account === campaign.highest_bidder),
        won: Boolean(campaign.status === 'settled' && account && account === campaign.winner
          && (unified ? (player?.awards ?? [player?.award]).includes(campaign.item_type) && cosmeticFor(campaign.item_type)?.expeditionOnly
            : player?.award === EXPEDITION_ITEM)),
        sale: campaign.status === 'settled' ? { price: campaign.sale, fee: campaign.fee, distributed: campaign.net } : null,
      },
    };
  }

  function advanceIfDue() {
    return serialize(async () => {
      const campaign = await view('campaign');
      if (!campaign.needs_advance) return;
      const result = await change('advance', unified ? { campaign_id: campaign.id } : {});
      if (result.status?.Failure) throw new Error('NEAR Expeditions could not finalize the voyage.');
      settlement = { id: campaign.id, hash: result.transaction?.hash ?? null };
    });
  }

  return { contract, unified, challenge, authenticate, read, advanceIfDue: signer ? advanceIfDue : null };
}
