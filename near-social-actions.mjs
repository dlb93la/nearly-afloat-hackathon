import { createHash } from 'node:crypto';
import { Account, actions, baseEncode, encodeTransaction, JsonRpcProvider, KeyPair, KeyType, PublicKey,
  Signature, SignedTransaction } from 'near-api-js';
import { AccountDoesNotExistError, InvalidTransactionError, NotEnoughBalanceError } from 'near-api-js/rpc-errors';
import { ARENA_ENTRY } from './shared/arena-entry.mjs';
import { COSMETIC_CHEST_PRICE, cosmeticFor } from './shared/cosmetics.mjs';

const FAST_AUTH = 'fast-auth.testnet';
const TEST_ACCOUNT = /^(?:[a-z0-9]+(?:[-_.][a-z0-9]+)*\.testnet|[a-f0-9]{64})$/;
const METHODS = ['authorize_entry', 'revoke_entry', 'authorize_session', 'revoke_session',
  'workshop_action', 'collection_action', 'contribute', 'bid', 'advance', 'equip_voyage_award'];
const TGAS = 1_000_000_000_000n;
const KEY_ALLOWANCE = 250_000_000_000_000_000_000_000n;
const INITIAL_GAS = 300_000_000_000_000_000_000_000n;
// Gold amounts are stored in hundredths: 1,000,000 units = 10,000 GOLD.
export const SOCIAL_GOLD_LIMIT = 1_000_000;
// Browser consent and MPC signing can outlive the default 100-block Sandbox window.
export const SOCIAL_PREVIEW_GENESIS = { epoch_length: 6_000, transaction_validity_period: 12_000 };

const hash = bytes => createHash('sha256').update(bytes).digest();
const gasFor = method => (METHODS.indexOf(method) < 4 ? 30n : 100n) * TGAS;

function amount(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('The amount must match a current offer.');
  return value;
}

export function socialGoldCost(method, args) {
  if (!METHODS.includes(method) || !args || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('This action is outside your game session.');
  }
  if (method === 'authorize_entry') return ARENA_ENTRY;
  if (method === 'authorize_session') {
    if (!Number.isInteger(args.entries) || args.entries < 1 || args.entries > 3) throw new Error('Invalid room pass.');
    return args.entries * ARENA_ENTRY;
  }
  if (method === 'contribute' || method === 'bid') return amount(args.amount);
  if (method === 'workshop_action') {
    if (args.action === 'buy' || (args.action === 'repair' && args.use_scrap !== true)) return amount(args.expected_price);
  }
  if (method === 'collection_action') {
    if (args.action === 'open_chest') return args.expected_price == null ? COSMETIC_CHEST_PRICE : amount(args.expected_price);
    if (args.action === 'buy') {
      const item = cosmeticFor(args.item);
      if (!item) throw new Error('Unknown item.');
      if (item.price) return amount(args.expected_price);
    }
  }
  return 0;
}

function mpcSignature(result) {
  const decoded = JSON.parse(Buffer.from(result?.status?.SuccessValue ?? '', 'base64').toString('utf8'));
  const signature = decoded?.signature;
  if (!Array.isArray(signature) || signature.length !== 64 ||
      signature.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error('NEAR Auth did not return an Ed25519 signature.');
  }
  return Uint8Array.from(signature);
}

export function loadNearSocialActions(env, contract, dependencies = {}) {
  const sponsorId = env.BARREL_NEAR_SOCIAL_SPONSOR;
  const sponsorKey = env.BARREL_NEAR_SOCIAL_SPONSOR_KEY;
  if (!sponsorId && !sponsorKey) return null;
  if (!TEST_ACCOUNT.test(sponsorId ?? '') || !sponsorKey || !TEST_ACCOUNT.test(contract)) {
    throw new Error('Configure a dedicated NEAR testnet sponsor account and key.');
  }
  const authProvider = new JsonRpcProvider({ url: 'https://test.rpc.fastnear.com' }, { retries: 2, wait: 200 });
  const local = env.BARREL_NEAR_SOCIAL_SANDBOX === '1';
  const sandboxRpc = local ? new URL(env.BARREL_NEAR_RPC) : null;
  if (local && (sandboxRpc.protocol !== 'http:' || sandboxRpc.hostname !== '127.0.0.1' ||
      !TEST_ACCOUNT.test(env.BARREL_NEAR_SOCIAL_SANDBOX_ACCOUNT ?? '') || !env.BARREL_NEAR_SOCIAL_SANDBOX_KEY)) {
    throw new Error('Use a loopback NEAR Sandbox and a sandbox-only sponsor key.');
  }
  const provider = dependencies.provider ?? (local ? new JsonRpcProvider({ url: sandboxRpc.href }) : authProvider);
  const sponsor = dependencies.sponsor ?? new Account(sponsorId, authProvider, sponsorKey);
  const fundingSponsor = local ? new Account(env.BARREL_NEAR_SOCIAL_SANDBOX_ACCOUNT, provider,
    env.BARREL_NEAR_SOCIAL_SANDBOX_KEY) : sponsor;
  let sponsorQueue = Promise.resolve();
  let verifiedLocal;

  function withSponsor(task) {
    const run = sponsorQueue.then(task);
    sponsorQueue = run.catch(() => {});
    return run;
  }

  async function fund(account) {
    return withSponsor(async () => {
      if (local) {
        verifiedLocal ??= provider.sendJsonRpc('status', []).then(({ chain_id }) => {
          if (!chain_id || ['mainnet', 'testnet'].includes(chain_id)) throw new Error('Expected a private NEAR Sandbox.');
        });
        await verifiedLocal;
      }
      try { await provider.viewAccount({ accountId: account, blockQuery: { finality: 'final' } }); }
      catch (error) {
        if (!(error instanceof AccountDoesNotExistError)) throw error;
        await fundingSponsor.signAndSendTransaction({ receiverId: account, actions: [actions.transfer(INITIAL_GAS)], waitUntil: 'FINAL' });
      }
    });
  }

  async function prepare(account) {
    await fund(account);
    const owner = PublicKey.fromString('ed25519:' + baseEncode(Buffer.from(account, 'hex')));
    const key = KeyPair.fromRandom('ed25519');
    const transaction = await new Account(account, provider).createTransaction({ receiverId: account, publicKey: owner,
      actions: [actions.addFunctionCallAccessKey(key.getPublicKey(), contract, METHODS, KEY_ALLOWANCE)] });
    return { key, owner, transaction, encoded: encodeTransaction(transaction) };
  }

  async function authorize(prepared, accessToken, guardId) {
    if (typeof accessToken !== 'string' || accessToken.length > 7168) throw new Error('Invalid NEAR Auth authorization.');
    const result = await withSponsor(() => sponsor.callFunctionRaw({ contractId: FAST_AUTH, methodName: 'sign',
      args: { guard_id: guardId, verify_payload: accessToken, sign_payload: [...prepared.encoded], algorithm: 'eddsa' },
      gas: 300n * TGAS, deposit: 1n, waitUntil: 'FINAL' }));
    return install(prepared, mpcSignature(result));
  }

  async function install(prepared, data) {
    if (!prepared.owner.verify(hash(prepared.encoded), data)) throw new Error('NEAR Auth approved a different key.');
    const outcome = await provider.sendTransactionUntil(new SignedTransaction({ transaction: prepared.transaction,
      signature: new Signature({ keyType: KeyType.ED25519, data }) }), 'FINAL');
    if (typeof outcome?.status?.SuccessValue !== 'string') throw new Error('Could not activate the session key.');
    return { key: prepared.key, remaining: SOCIAL_GOLD_LIMIT, queue: Promise.resolve(), operations: new Map() };
  }

  async function authorizeSignature(prepared, signature) {
    if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{128}$/.test(signature)) {
      throw new Error('Invalid embedded-wallet signature.');
    }
    return install(prepared, Uint8Array.from(Buffer.from(signature.slice(2), 'hex')));
  }

  function submit(account, session, method, args, requestId, active) {
    const known = session.operations.get(requestId);
    if (known) return known;
    const operation = session.queue.then(async () => {
      if (!active()) throw new Error('Sign in again to continue.');
      const cost = socialGoldCost(method, args);
      if (cost > session.remaining) throw new Error('This exceeds your remaining session limit.');
      const signer = new Account(account, provider, session.key.toString());
      const signed = await signer.createSignedTransaction({ receiverId: contract,
        actions: [actions.functionCall(method, args, gasFor(method), 0n)] });
      if (!active()) throw new Error('Sign in again to continue.');
      session.remaining -= cost;
      const txHash = baseEncode(hash(encodeTransaction(signed.transaction)));
      try {
        // The browser checks final receipts for these actions after receiving the hash.
        // Room authorization still needs final state before it can be consumed.
        const waitUntil = METHODS.indexOf(method) < 4 ? 'FINAL' : 'EXECUTED';
        const outcome = await provider.sendTransactionUntil(signed, waitUntil);
        if (outcome?.status?.Failure) session.remaining += cost;
        return outcome;
      } catch (error) {
        dependencies.onSubmitError?.(error);
        if (error instanceof InvalidTransactionError || error instanceof NotEnoughBalanceError) {
          session.remaining += cost;
          return { status: { Failure: true } };
        }
        return { transaction: { hash: txHash } };
      }
    });
    session.operations.set(requestId, operation);
    session.queue = operation.catch(() => {});
    return operation;
  }

  return { prepare, authorize, authorizeSignature, submit };
}
