import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { baseEncode, encodeTransaction, KeyPair } from 'near-api-js';
import { loadJudgesExpedition } from '../judges-expedition.mjs';

test('judges rehearsal refuses the live token/contract and enforces delegated key scope', async () => {
  assert.equal(loadJudgesExpedition({}), null);
  const identity = id => ({ id, key: KeyPair.fromRandom('ed25519').toString() });
  const c = { contract: 'judges.testnet', token: 'demo-gold.testnet', operator: identity('operator.testnet'), crews: [identity('a.testnet'), identity('b.testnet')] };
  for (const id of [c.contract, c.token]) for (const name of ['BARREL_NEAR_CONTRACT', 'BARREL_GOLD_CONTRACT']) {
    assert.throws(() => loadJudgesExpedition({ AFLOAT_JUDGES_CONFIG: JSON.stringify(c), [name]: id }), /Isolated/);
  }
  const j = loadJudgesExpedition({ AFLOAT_JUDGES_CONFIG: JSON.stringify(c) }, { provider: {
    sendJsonRpc: async () => ({ chain_id: 'testnet' }), viewAccessKey: async () => ({ permission: 'FullAccess' }),
  } });
  await assert.rejects(j.snapshot(), /restricted/);
});

test('lost judges confirmation recovers the same signed transaction across restart and replay', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'afloat-judges-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const identity = id => ({ id, key: KeyPair.fromRandom('ed25519').toString() });
  const c = { contract: 'judges.testnet', token: 'demo-gold.testnet', operator: identity('operator.testnet'), crews: [identity('a.testnet'), identity('b.testnet')] };
  const env = { AFLOAT_JUDGES_CONFIG: JSON.stringify(c), AFLOAT_JUDGES_JOURNAL: join(dir, 'journal.json') };
  const campaign = { id: 0, status: 'funding', minimum_bid: 100 };
  const account = { balance: 10000, contribution: 0, max_contribution: 2900, contribution_nonce: 0 };
  let sendCount = 0, confirmed, lose = true;
  const provider = {
    sendJsonRpc: async () => ({ chain_id: 'testnet' }),
    viewAccessKey: async ({ accountId }) => ({ nonce: 1n, permission: { FunctionCall: { receiver_id: c.contract, allowance: String(10n ** 24n),
      method_names: accountId === c.operator.id ? ['restart_judges_voyage', 'advance_judges_voyage'] : ['contribute', 'bid', 'equip_voyage_award'] } } }),
    viewBlock: async () => ({ header: { hash: baseEncode(Buffer.alloc(32, 2)), height: 100 } }),
    callFunction: async ({ method }) => method === 'gold_config' ? { token: c.token } : method === 'judges_rehearsal' ? true : method === 'campaign' ? { ...campaign } : { ...account },
    sendTransactionUntil: async signed => {
      sendCount++;
      const hash = baseEncode(createHash('sha256').update(encodeTransaction(signed.transaction)).digest());
      confirmed = { transaction: { hash }, final_execution_status: 'FINAL', status: { SuccessValue: '' } };
      account.balance -= 2000; account.contribution = 2000; account.contribution_nonce++;
      if (lose) { lose = false; throw new Error('Network reply lost'); }
      return confirmed;
    },
    viewTransactionStatus: async () => confirmed,
  };
  let j = loadJudgesExpedition(env, { provider });
  const q = { id: randomUUID(), action: 'fund', campaignId: 0, crew: 0 };
  await assert.rejects(j.act(q), /reply lost/);
  const journal = JSON.parse(await readFile(env.AFLOAT_JUDGES_JOURNAL, 'utf8'));
  assert.equal(journal.pending.id, q.id);
  assert.equal(journal.pending.hash, confirmed.transaction.hash, 'signed intent persisted before broadcast');
  j = loadJudgesExpedition(env, { provider });
  const recovered = await j.act(q);
  assert.equal(recovered.receipt.hash, confirmed.transaction.hash);
  assert.equal((await j.act(q)).receipt.hash, recovered.receipt.hash);
  assert.equal(sendCount, 1, 'lost reply, process restart and repeated click must not spend again');
  assert.equal(account.balance, 8000);
  assert.equal(JSON.parse(await readFile(env.AFLOAT_JUDGES_JOURNAL, 'utf8')).pending, null);
  await assert.rejects(j.act({ id: randomUUID(), action: 'bid', campaignId: 0, crew: 0, amount: 1000000 }), /Bid must/);
});
