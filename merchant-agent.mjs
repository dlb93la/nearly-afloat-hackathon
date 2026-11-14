import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Account, actions, baseEncode, encodeTransaction, JsonRpcProvider, KeyPair, SignedTransaction } from 'near-api-js';
import { decideMerchantTrade } from './shared/merchant-agent.mjs';
import { lockAgentFile, readAgentFile, writeAgentFile } from './agent-journal.mjs';

const allowanceLimit = 250_000_000_000_000_000_000_000n;

export async function loadMerchantAgent(env = process.env, dependencies = {}) {
  const { AFLOAT_AGENT_ACCOUNT: account, AFLOAT_AGENT_CONTRACT: contract, AFLOAT_AGENT_KEY: key } = env;
  if (!account && !contract && !key) return null;
  if (![account, contract].every(id => typeof id === 'string' && /^[a-z0-9.-]+\.testnet$/.test(id)) || !key) {
    throw new Error('Dedicated testnet agent configuration required');
  }
  const rpc = dependencies.provider ?? new JsonRpcProvider({ url: env.AFLOAT_AGENT_RPC ?? 'https://test.rpc.fastnear.com' });
  const chain = (await rpc.sendJsonRpc('status', [])).chain_id;
  if (chain !== 'testnet' && !(new URL(env.AFLOAT_AGENT_RPC ?? '').hostname === '127.0.0.1' && chain !== 'mainnet')) {
    throw new Error('Agent requires testnet or a private loopback Sandbox');
  }
  const signer = new Account(account, rpc, key);
  const publicKey = KeyPair.fromString(key).getPublicKey().toString();
  const access = await rpc.viewAccessKey({ accountId: account, publicKey, blockQuery: { finality: 'final' } });
  const permission = access.permission?.FunctionCall;
  if (!permission || permission.receiver_id !== contract || permission.method_names?.length !== 1 ||
      permission.method_names[0] !== 'agent_trade' || permission.allowance == null ||
      BigInt(permission.allowance) <= 0n || BigInt(permission.allowance) > allowanceLimit) {
    throw new Error('Agent key must allow only agent_trade with bounded gas');
  }
  const scope = { chain, account, contract, publicKey };
  const scopeHash = createHash('sha256').update(JSON.stringify(scope)).digest('hex').slice(0, 16);
  const journalPath = resolve(env.AFLOAT_AGENT_JOURNAL ?? 'data/merchant-agent-' + scopeHash + '.json');
  const fresh = () => ({ version: 1, scope, pending: null, history: [], last: null, lastTrade: null });
  let journal = await readAgentFile(journalPath, fresh());
  let busy = false;

  function validateJournal(value) {
    if (value.version !== 1 || JSON.stringify(value.scope) !== JSON.stringify(scope) || !Array.isArray(value.history)) {
      throw new Error('Agent journal belongs to another chain, account or key');
    }
    return value;
  }
  validateJournal(journal);

  async function snapshot() {
    const block = await rpc.viewBlock({ finality: 'final' });
    const blockQuery = { blockId: block.header.hash };
    const view = (method, args = {}) => rpc.callFunction({ contractId: contract, method, args, blockQuery });
    const [policy, quotes, collection, balance] = await Promise.all([
      view('agent_policy', { agent: account }), view('collection_quotes'),
      view('collection', { player: account }), view('balance', { player: account }),
    ]);
    return { account, contract, policy, quotes, owned: collection.owned, balance,
      blockHash: block.header.hash, blockHeight: block.header.height,
      last: journal.last, lastTrade: journal.lastTrade, unresolved: journal.pending?.hash ?? null };
  }

  async function save() { await writeAgentFile(journalPath, journal); }

  async function finish(result) {
    const operation = journal.pending;
    if (result.transaction?.hash !== operation.hash || result.final_execution_status !== 'FINAL' ||
        !(result.status?.SuccessValue != null || result.status?.Failure != null)) {
      throw new Error('Agent receipt is not final');
    }
    const success = typeof result.status.SuccessValue === 'string';
    journal.last = { ...operation.decision, at: Date.now(), hash: operation.hash,
      network: chain === 'testnet' ? 'testnet' : 'private-sandbox', status: success ? 'confirmed' : 'rejected' };
    if (success) journal.lastTrade = journal.last;
    journal.history.push({ ...operation, signed: undefined, result });
    journal.history = journal.history.slice(-100);
    journal.pending = null;
    await save();
    return journal.last;
  }

  async function submitPending() {
    const pending = journal.pending;
    let outcome;
    try {
      outcome = await rpc.viewTransactionStatus({ txHash: pending.hash, accountId: account, waitUntil: 'NONE' });
    } catch (error) {
      if (error.name !== 'UnknownTransactionError' && !/UNKNOWN_TRANSACTION|doesn't exist|does not exist/i.test(error.message)) {
        throw error;
      }
      // Rebroadcast the same bytes and hash. Never create another proposal while unresolved.
      const signed = SignedTransaction.decode(Buffer.from(pending.signed, 'base64'));
      const hash = baseEncode(createHash('sha256').update(encodeTransaction(signed.transaction)).digest());
      if (hash !== pending.hash || signed.transaction.signerId !== account || signed.transaction.receiverId !== contract) {
        throw new Error('Agent journal transaction mismatch');
      }
      outcome = await (dependencies.send ?? ((tx) => rpc.sendTransactionUntil(tx, 'FINAL')))(signed);
    }
    return finish(outcome);
  }

  async function tick() {
    if (busy) return null;
    busy = true;
    let release;
    try {
      release = await lockAgentFile(journalPath);
      if (!release) return { action: 'wait', reason: 'Another worker owns this journal' };
      journal = validateJournal(await readAgentFile(journalPath, fresh()));
      if (journal.pending) return await submitPending();
      const state = await snapshot();
      const decision = decideMerchantTrade(state);
      if (decision.action === 'wait') {
        journal.last = { ...decision, at: Date.now() };
        await save();
        return journal.last;
      }
      const { reason, ...args } = decision;
      const signed = await signer.createSignedTransaction({ receiverId: contract,
        actions: [actions.functionCall('agent_trade', args, 100_000_000_000_000n, 0n)] });
      const hash = baseEncode(createHash('sha256').update(encodeTransaction(signed.transaction)).digest());
      journal.pending = { hash, signed: Buffer.from(signed.encode()).toString('base64'), decision, before: state, at: Date.now() };
      await save();
      const result = await (dependencies.send ?? ((tx) => rpc.sendTransactionUntil(tx, 'FINAL')))(signed);
      return await finish(result);
    } finally {
      if (release) await release();
      busy = false;
    }
  }
  return { snapshot, tick };
}
