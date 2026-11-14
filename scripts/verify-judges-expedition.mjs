import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JsonRpcProvider } from 'near-api-js';
const proof = JSON.parse(await readFile(new URL('../docs/evidence/judges-expedition-2026-11-14.json', import.meta.url), 'utf8'));
const rpc = new JsonRpcProvider({ url: 'https://test.rpc.fastnear.com' }, { retries: 2, wait: 200 });
assert.equal((await rpc.sendJsonRpc('status', [])).chain_id, 'testnet');
assert.notEqual(proof.contract, proof.normalGameContract); assert.notEqual(proof.token, proof.normalGameToken);
const view = (method, args = {}, contractId = proof.contract) => rpc.callFunction({ contractId, method, args, blockQuery: { finality: 'final' } });
assert.equal((await rpc.viewAccount({ accountId: proof.contract, blockQuery: { finality: 'final' } })).code_hash, proof.codeHash);
assert.equal((await view('gold_config')).token, proof.token); assert.equal(await view('judges_rehearsal'), true);
const history = await view('campaign_history', { before: proof.campaign.id + 1, limit: 1 });
assert.equal(history[0].id, proof.campaign.id);
for (const [name, value] of Object.entries({ status: 'settled', sale: 8000, fee: 400, net: 7600 })) assert.equal(history[0][name], value);
for (const crew of proof.crews) {
  const current = await view('campaign_participation', { campaign_id: proof.campaign.id, player: crew.id });
  assert.equal(current.payout, crew.payout); assert.equal(current.contribution, crew.contribution);
}
for (const r of proof.receipts) {
  const raw = await fetch('https://test.rpc.fastnear.com', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: r.hash, method: 'tx', params: { tx_hash: r.hash, sender_account_id: proof.contract, wait_until: 'NONE' } }), signal: AbortSignal.timeout(15000) }).then(r => r.json());
  // Transaction lookup is by hash; the sender hint does not determine who signed.
  assert.ok(raw.result, 'Receipt unavailable: ' + r.hash);
  assert.equal(raw.result.final_execution_status, 'FINAL'); assert.equal(typeof raw.result.status?.SuccessValue, 'string');
  assert.equal(raw.result.transaction.receiver_id, proof.contract);
}
const winner = await view('account', { player: proof.campaign.winner });
assert.ok(winner.award_editions.some(e => e.campaign_id === proof.campaign.id && e.item_type === proof.campaign.item_type));
assert.ok(BigInt(await view('ft_balance_of', { account_id: proof.contract }, proof.token)) > 0n);
console.log('PASS isolated manual testnet voyage: receipts, 80 GOLD sale, 5% fee, 50.67/25.33 shares and persistent prize ownership.');
