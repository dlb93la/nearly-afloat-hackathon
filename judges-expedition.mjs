import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Account, actions, baseEncode, encodeTransaction, JsonRpcProvider, KeyPair, SignedTransaction } from 'near-api-js';
import { lockAgentFile, readAgentFile, writeAgentFile } from './agent-journal.mjs';
import { rpcReadPool, rpcView } from './near-rpc-reads.mjs';

const gas = 100_000_000_000_000n;
const methods = ['restart_judges_voyage', 'advance_judges_voyage'];
const actorMethods = ['contribute', 'bid', 'equip_voyage_award'];
const digest = bytes => baseEncode(createHash('sha256').update(bytes).digest());

export function loadJudgesExpedition(env = process.env, dependencies = {}) {
  if (!env.AFLOAT_JUDGES_CONFIG) return null;
  const config = JSON.parse(env.AFLOAT_JUDGES_CONFIG);
  const { contract, token, operator, crews } = config;
  if (![contract, token, operator?.id, ...(crews ?? []).map(c => c.id)].every(id => /^[a-z0-9.-]+\.testnet$/.test(id)) ||
      !operator?.key || crews?.length !== 2 || crews.some(c => !c.key) ||
      contract === token || [contract, token].some(id => [env.BARREL_NEAR_CONTRACT, env.BARREL_GOLD_CONTRACT].includes(id)) ||
      new Set([operator.id, ...crews.map(c => c.id)]).size !== 3) throw new Error('Isolated judges testnet configuration required');
  const rpc = dependencies.provider ?? new JsonRpcProvider({ url: env.AFLOAT_JUDGES_RPC ?? 'https://test.rpc.fastnear.com' }, { retries: 2, wait: 200 });
  const reads = rpcReadPool(rpc);
  const identities = [operator, ...crews];
  const signers = identities.map(id => new Account(id.id, rpc, id.key));
  const scope = { contract, token, accounts: identities.map(c => c.id),
    keys: identities.map(c => KeyPair.fromString(c.key).getPublicKey().toString()) };
  const path = resolve(env.AFLOAT_JUDGES_JOURNAL ?? resolve(env.BARREL_DATA_DIR ?? 'data', 'judges-expedition.json'));
  const fresh = () => ({ version: 1, scope, pending: null, history: [] });
  let journal;
  let verified;
  let busy = false;
  let cache;
  let snapshotPending;
  let snapshotGeneration = 0;
  const view = (method, args = {}, contractId = contract, blockQuery = { finality: 'final' }) =>
    rpcView(rpc, contractId, method, args, { blockQuery });
  function checkJournal(value) {
    if (value.version !== 1 || JSON.stringify(value.scope) !== JSON.stringify(scope)) throw new Error('Judges journal scope mismatch');
    return value;
  }
  async function verify() {
    verified ??= (async () => {
      if ((await reads.read(contract, 'node-status', () => rpc.sendJsonRpc('status', []))).chain_id !== 'testnet') throw new Error('Judges rehearsal requires testnet');
      for (let i = 0; i < identities.length; i++) {
        const access = await reads.read(contract, 'verify-key:' + identities[i].id,
          () => rpc.viewAccessKey({ accountId: identities[i].id, publicKey: scope.keys[i], blockQuery: { finality: 'final' } }));
        const p = access.permission?.FunctionCall, expected = i === 0 ? methods : actorMethods;
        if (!p || p.receiver_id !== contract || p.method_names.length !== expected.length || expected.some(m => !p.method_names.includes(m)) ||
            p.allowance == null || BigInt(p.allowance) <= 0n || BigInt(p.allowance) > 10n ** 24n) {
          throw new Error('Judges runtime requires restricted, gas-bounded keys');
        }
      }
      const gold = await view('gold_config');
      if (gold?.token !== token || await view('judges_rehearsal') !== true) throw new Error('Wrong judges contract or GOLD token');
      journal = checkJournal(await readAgentFile(path, fresh()));
    })().catch(error => { verified = null; throw error; });
    await verified;
  }
  async function readState() {
    await verify();
    const block = await reads.read(contract, 'final-block', () => rpc.viewBlock({ finality: 'final' }));
    const at = { blockId: block.header.hash };
    const [campaign, ...accounts] = await Promise.all([view('campaign', {}, contract, at),
      ...crews.map(c => view('account', { player: c.id }, contract, at))]);
    return { available: true, shared: true, network: 'testnet', contract, token, campaign,
      crews: accounts.map((account, i) => ({ name: i === 0 ? 'Cork Crew' : 'Parrot Crew', id: crews[i].id, ...account })),
      block: block.header.height,
      pending: journal?.pending ? { id: journal.pending.id, hash: journal.pending.hash } : null,
      receipts: (journal?.history ?? []).slice(-15).map(({ id, hash, success, action }) => ({ id, hash, success, action })) };
  }
  async function snapshot(force = false) {
    if (force) {
      cache = null;
      snapshotPending = null;
      snapshotGeneration++;
      reads.invalidate(contract);
    }
    if (!force && cache && Date.now() - cache.at < 4000) return cache.value;
    if (snapshotPending) return snapshotPending;
    const generation = snapshotGeneration;
    const request = readState().then(value => {
      if (generation === snapshotGeneration) cache = { at: Date.now(), value };
      return value;
    }).finally(() => { if (snapshotPending === request) snapshotPending = null; });
    snapshotPending = request;
    return request;
  }
  async function finish(result) {
    const pending = journal.pending;
    if (result.transaction?.hash !== pending.hash || result.final_execution_status !== 'FINAL' ||
        !(result.status?.SuccessValue != null || result.status?.Failure != null)) throw new Error('Confirmation pending; retry the same action');
    const success = typeof result.status.SuccessValue === 'string';
    const record = { id: pending.id, hash: pending.hash, account: pending.account, action: pending.action, success };
    journal.history.push(record);
    journal.history = journal.history.slice(-200);
    journal.pending = null;
    await writeAgentFile(path, journal);
    cache = null;
    snapshotGeneration++;
    snapshotPending = null;
    reads.invalidate(contract);
    if (!success) throw new Error('The testnet rejected this action. Refresh the current stage.');
    return record;
  }
  async function recover() {
    const p = journal.pending;
    try {
      const outcome = await reads.read(contract, 'transaction:' + p.hash,
        () => rpc.viewTransactionStatus({ txHash: p.hash, accountId: p.account, waitUntil: 'NONE' }));
      return await finish(outcome);
    } catch (error) {
      if (error.name !== 'UnknownTransactionError' && !/UNKNOWN_TRANSACTION|doesn't exist|does not exist/i.test(error.message)) throw error;
      const signed = SignedTransaction.decode(Buffer.from(p.signed, 'base64'));
      if (digest(encodeTransaction(signed.transaction)) !== p.hash || signed.transaction.signerId !== p.account ||
          signed.transaction.receiverId !== contract) throw new Error('Judges pending transaction mismatch');
      return finish(await rpc.sendTransactionUntil(signed, 'FINAL').catch(error => { throw reads.failure(error); }));
    }
  }
  async function act(input) {
    if (!input || !/^[a-f0-9-]{36}$/i.test(input.id ?? '') || !['fund', 'bid', 'advance', 'equip', 'restart'].includes(input.action) ||
        !Number.isSafeInteger(input.campaignId) || input.campaignId < 0) throw new Error('Invalid rehearsal action');
    if (busy) throw new Error('Another judge is confirming an action. Please retry shortly.');
    busy = true;
    let release;
    try {
      await verify();
      release = await lockAgentFile(path);
      if (!release) throw new Error('Another judge is confirming an action. Please retry shortly.');
      journal = checkJournal(await readAgentFile(path, fresh()));
      const known = journal.history.find(record => record.id === input.id);
      if (known) return { receipt: known, state: await snapshot(true) };
      if (journal.pending) {
        const pendingId = journal.pending.id;
        const receipt = await recover();
        if (pendingId === input.id) return { receipt, state: await snapshot(true) };
        throw new Error('Previous action confirmed. Refresh before the next action.');
      }
      const state = await snapshot(true), c = state.campaign;
      if (c.id !== input.campaignId) throw new Error('This rehearsal has already moved on. Refresh.');
      let signer = 0;
      let calls;
      const call = (method, args) => actions.functionCall(method, args, gas, 0n);
      if (input.action === 'advance') {
        if (!['funding', 'sailing', 'auction'].includes(input.expectedStatus)) throw new Error('Invalid stage');
        calls = [call('advance_judges_voyage', { campaign_id: c.id, expected_status: input.expectedStatus })];
      } else if (input.action === 'restart') {
        if (c.status !== 'settled' || input.expectedStatus !== 'settled') throw new Error('Finish the current rehearsal first');
        calls = [call('restart_judges_voyage', { campaign_id: c.id })];
      } else {
        if (![0, 1].includes(input.crew)) throw new Error('Choose a demo crew');
        const crew = state.crews[input.crew];
        signer = input.crew + 1;
        if (input.action === 'fund') {
          if (c.status !== 'funding' || crew.contribution !== 0) throw new Error('This crew already funded or funding is closed');
          const amount = Math.min(input.crew === 0 ? 2000 : 1000, crew.max_contribution);
          if (amount < 1) throw new Error('Funding target already reached');
          calls = [call('contribute', { amount, nonce: crew.contribution_nonce + 1, campaign_id: c.id })];
        } else if (input.action === 'bid') {
          if (c.status !== 'auction' || !Number.isSafeInteger(input.amount) || input.amount < c.minimum_bid || input.amount > 10000) {
            throw new Error('Bid must meet the current minimum, up to 100 demo GOLD');
          }
          const reserved = c.highest_bidder === crew.id ? c.highest_bid : 0;
          if (input.amount - reserved > crew.balance) throw new Error('Not enough demo GOLD in this crew');
          calls = [call('bid', { amount: input.amount, campaign_id: c.id })];
        } else {
          if (!crew.awards?.includes(c.item_type)) throw new Error('Only the winning demo crew owns this treasure');
          calls = [call('equip_voyage_award', { equipped: true, item: c.item_type })];
        }
      }
      const signed = await signers[signer].createSignedTransaction({ receiverId: contract, actions: calls });
      const hash = digest(encodeTransaction(signed.transaction));
      journal.pending = { id: input.id, action: input.action, account: identities[signer].id, hash,
        signed: Buffer.from(signed.encode()).toString('base64') };
      await writeAgentFile(path, journal); // Durable before broadcast; retries reuse these exact bytes.
      const receipt = await finish(await rpc.sendTransactionUntil(signed, 'FINAL').catch(error => { throw reads.failure(error); }));
      return { receipt, state: await snapshot(true) };
    } finally { if (release) await release(); busy = false; }
  }
  return { snapshot, act };
}
