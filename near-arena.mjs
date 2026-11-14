import { randomBytes } from 'node:crypto';
import { Account, getTransactionLastResult, JsonRpcProvider } from 'near-api-js';
import { verifyMessage } from 'near-api-js/nep413';
import { cosmeticFor } from './shared/cosmetics.mjs';
import { RIGS } from './shared/rigs.mjs';
import { EconomyError } from './economy.mjs';
import { rpcReadPool, rpcView } from './near-rpc-reads.mjs';

const ACCOUNT = /^(?:[a-z0-9]+(?:[-_.][a-z0-9]+)*\.testnet|[a-f0-9]{64})$/;
const CHALLENGE_MS = 120_000;

export function nearRoundId() {
  return String(randomBytes(8).readBigUInt64BE() || 1n);
}

export function loadNearArena(env = process.env) {
  const { BARREL_NEAR_CONTRACT: contract, BARREL_NEAR_REFEREE: referee, BARREL_NEAR_KEY: key } = env;
  if (!contract && !referee && !key) return null;
  if (!ACCOUNT.test(contract ?? '') || !ACCOUNT.test(referee ?? '') || !key) {
    throw new Error('Configure BARREL_NEAR_CONTRACT, BARREL_NEAR_REFEREE and BARREL_NEAR_KEY for testnet.');
  }
  const provider = new JsonRpcProvider({ url: env.BARREL_NEAR_RPC || 'https://test.rpc.fastnear.com' },
    { retries: 2, wait: 200, backoff: 2 });
  const sessions = env.BARREL_NEAR_SESSIONS === '1';
  const hasWorkshop = env.BARREL_NEAR_WORKSHOP === '1';
  const hasStarter = env.BARREL_NEAR_STARTER === '1';
  if (hasStarter && !hasWorkshop) throw new Error('BARREL_NEAR_STARTER requires BARREL_NEAR_WORKSHOP.');
  const hasVoyage = env.BARREL_NEAR_VOYAGE === '1';
  const hasCollection = env.BARREL_NEAR_COLLECTION === '1';
  const receiptNetwork = env.BARREL_NEAR_SOCIAL_SANDBOX === '1' || ['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.BARREL_NEAR_RPC || 'https://test.rpc.fastnear.com').hostname)
    ? 'sandbox' : 'testnet';
  if (hasCollection && !hasWorkshop) throw new Error('BARREL_NEAR_COLLECTION requires BARREL_NEAR_WORKSHOP.');
  const signer = new Account(referee, provider, key);
  const reads = rpcReadPool(provider);
  const view = (method, args = {}) => rpcView(provider, contract, method, args,
    { ttl: method === 'collection_quotes' ? 2000 : method === 'gold_config' ? 60000 : 0 });
  let writer = Promise.resolve();

  function serialized(task) {
    const work = writer.then(task);
    writer = work.catch(() => {});
    return work;
  }

  async function change(methodName, args) {
    const response = await signer.callFunctionRaw({
      contractId: contract, methodName, args, gas: (hasCollection ? 100n : 35n) * 1_000_000_000_000n, deposit: 0n, waitUntil: 'FINAL',
    }).catch(error => { throw reads.failure(error); });
    reads.invalidate(contract);
    return { round: getTransactionLastResult(response), hash: response.transaction?.hash };
  }

  function challenge() {
    return { nonce: randomBytes(32).toString('hex'), message: 'Connect this NEAR testnet account to NEARly Afloat.',
      recipient: contract, expiresAt: Date.now() + CHALLENGE_MS };
  }

  function ensureAccount(account) {
    return serialized(async () => {
      if (await view('registered', { player: account })) return;
      try { await change('grant_test_gold', { player: account }); }
      catch (error) {
        if (!await view('registered', { player: account })) throw error;
      }
    });
  }

  async function authenticate(challengeData, proof) {
    if (!challengeData || challengeData.expiresAt <= Date.now() || typeof proof.accountId !== 'string'
      || proof.accountId.length > 64 || !ACCOUNT.test(proof.accountId)
      || typeof proof.publicKey !== 'string' || typeof proof.signature !== 'string') {
      throw new EconomyError('Connect your NEAR testnet wallet again.');
    }
    const { accountId, publicKey, signature } = proof;
    try {
      await verifyMessage({
        signerAccountId: accountId, signerPublicKey: publicKey, signature: Buffer.from(signature, 'base64'),
        payload: { message: challengeData.message, recipient: challengeData.recipient, nonce: Buffer.from(challengeData.nonce, 'hex') },
        provider,
      });
    } catch {
      throw new EconomyError('The wallet signature could not be verified.');
    }
    await ensureAccount(accountId);
    return accountId;
  }

  const round = id => view('round', { round_id: id });
  const consent = (player, id) => view('entry_consent', { player, round_id: id });
  const entrySession = (player, scope) => view('entry_session', { player, scope });
  const balance = player => view('balance', { player });
  async function goldWallet(player) {
    checkAccount(player);
    const config = await view('gold_config').catch(error => {
      if (String(error).includes('MethodNotFound')) return null;
      throw error;
    });
    if (!config) return null;
    const token = config.token;
    const block = await reads.read(contract, 'final-block', () => provider.viewBlock({ finality: 'final' }));
    const read = (contractId, method, args = {}) => rpcView(provider, contractId, method, args,
      { blockQuery: { blockId: block.header.hash } });
    const tokenView = (method, args) => read(token, method, args);
    const [inGame, inWallet, storage, bounds, unitPrice, inventory] = await Promise.all([
      read(contract, 'balance', { player }), tokenView('ft_balance_of', { account_id: player }),
      tokenView('storage_balance_of', { account_id: player }), tokenView('storage_balance_bounds'),
      tokenView('sale_quote', { amount: '1' }), tokenView('sale_inventory'),
    ]);
    return { arena: contract, token, inGame, inWallet, registered: Boolean(storage), storage: bounds.min,
      unitPrice, inventory, network: receiptNetwork };
  }

  function checkAccount(account) {
    if (typeof account !== 'string' || account.length > 64 || !ACCOUNT.test(account)) {
      throw new EconomyError('Select a NEAR testnet account.');
    }
  }

  async function transactionReceipt(account, hash, methods) {
    checkAccount(account);
    let status;
    let chestItem;
    if (typeof hash === 'string' && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash)) {
      status = 'pending';
      try {
        const tx = await reads.read(contract, JSON.stringify(['tx', account, hash]),
          () => provider.sendJsonRpc('tx', { tx_hash: hash, sender_account_id: account, wait_until: 'NONE' }));
        if (tx.final_execution_status === 'FINAL' && tx.transaction?.signer_id === account
          && tx.transaction.receiver_id === contract
          && tx.transaction.actions?.some(action => methods.includes(action.FunctionCall?.method_name))) {
          status = tx.status?.Failure ? 'failed'
            : typeof tx.status?.SuccessValue === 'string' ? 'finalized' : 'pending';
          if (status === 'finalized') {
            for (const { outcome } of tx.receipts_outcome ?? []) {
              if (outcome?.executor_id !== contract) continue;
              for (const line of outcome.logs ?? []) {
                if (!line.startsWith('EVENT_JSON:')) continue;
                let event;
                try { event = JSON.parse(line.slice('EVENT_JSON:'.length)); } catch { continue; }
                if (event.standard !== 'nearly_afloat' || event.event !== 'collection_action') continue;
                const draw = event.data?.find(entry => entry.player === account && entry.action === 'open_chest');
                const item = cosmeticFor(draw?.item);
                if (item && !item.expeditionOnly) chestItem = item.id;
              }
            }
          }
        }
      } catch {
        // A wallet can return the hash before this RPC node sees the transaction.
      }
    }
    return { status, chestItem };
  }

  async function transactionStatus(account, hash, methods) {
    return (await transactionReceipt(account, hash, methods)).status;
  }

  async function workshop(account, hash) {
    checkAccount(account);
    const receipt = await transactionReceipt(account, hash, ['workshop_action', 'collection_action', 'equip_voyage_award']);
    if (receipt.status === 'finalized') reads.invalidate(contract);
    const [workshop, collection, voyage, quotes] = await Promise.all([view('workshop', { player: account }),
      hasCollection ? view('collection', { player: account }) : null,
      hasVoyage && hasCollection ? view('account', { player: account }) : null,
      hasCollection ? view('collection_quotes') : []]);
    const award = cosmeticFor(voyage?.award);
    if (collection) {
      for (const id of voyage?.awards ?? (voyage?.award ? [voyage.award] : [])) {
        if (cosmeticFor(id)?.expeditionOnly) collection.owned[id] = Math.max(1, collection.owned[id] ?? 0);
      }
    }
    if (collection && award?.expeditionOnly) {
      collection.award = { id: award.id, equipped: voyage.award_equipped };
      if (voyage.award_equipped) collection.equipped[award.slot] = award.id;
    }
    return { workshop, collection, quotes, receiptNetwork,
      receiptUrl: receiptNetwork === 'testnet' && receipt.status === 'finalized' ? 'https://testnet.nearblocks.io/txns/' + hash : null,
      transactionStatus: receipt.status,
      ...(receipt.status === 'finalized' ? { transactionHash: hash, chestItem: receipt.chestItem } : {}) };
  }

  async function withReservedRigs(id, players, receipt) {
    if (!hasWorkshop) return receipt;
    const [rigs, awards, collections] = await Promise.all([
      view('round_rigs', { round_id: id }),
      hasVoyage ? Promise.all(players.map(async player => {
        const account = await view('account', { player });
        return [player, account.award_equipped ? account.award : null];
      })).then(Object.fromEntries) : null,
      hasCollection ? Promise.all(players.map(async player => {
        const collection = await view('collection', { player });
        return [player, collection.equipped];
      })).then(Object.fromEntries) : null,
    ]);
    if (!rigs || players.some(player => !Object.hasOwn(RIGS, rigs[player]))) {
      throw new Error('NEAR did not confirm the reserved loadout.');
    }
    return { ...receipt, rigs, awards, collections };
  }

  function reserve(id, players, slots, session) {
    return serialized(async () => {
      try {
        const receipt = await change('reserve_round', { round_id: id, players, slots, ...(session ? { session } : {}) });
        return await withReservedRigs(id, players, receipt);
      } catch (error) {
        const saved = await round(id);
        if (saved?.status === 'reserved' && saved.bots === slots - players.length
          && JSON.stringify(saved.players) === JSON.stringify(players)) return withReservedRigs(id, players, { round: saved });
        throw error;
      }
    });
  }

  const firstBrawlReward = player => view('first_brawl_reward', { player });
  function grantFirstBrawl(player, rig) {
    return serialized(async () => {
      if (await firstBrawlReward(player) !== rig) {
        try { await change('grant_first_brawl', { player, rig }); }
        catch (error) {
          if (await firstBrawlReward(player) !== rig) throw error;
        }
      }
      if (await firstBrawlReward(player) !== rig) throw new Error('Starter reward is not finalized.');
      return (await workshop(player)).workshop;
    });
  }

  function finish(id, intent) {
    return serialized(async () => {
      const saved = await round(id);
      if (!saved || saved.status !== 'reserved') return { round: saved };
      return intent.action === 'settle'
        ? change('settle_round', { round_id: id, winner: intent.winner })
        : change('cancel_round', { round_id: id });
    });
  }

  return { contract, receiptNetwork, sessions, hasWorkshop, hasStarter, hasCollection, workshop, transactionStatus, logbook: player => view('logbook', { player }), firstBrawlReward, grantFirstBrawl, ensureAccount, challenge, authenticate, balance, goldWallet, consent, entrySession, round, reserve, finish };
}
