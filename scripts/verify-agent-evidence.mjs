// Read-only public proof verification. No signer, private key or transaction send.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { JsonRpcProvider, baseEncode } from 'near-api-js';

const proof = JSON.parse(await readFile(new URL('../docs/evidence/agent-testnet.json', import.meta.url), 'utf8'));
const rpc = new JsonRpcProvider({ url: 'https://test.rpc.fastnear.com' });
assert.equal((await rpc.sendJsonRpc('status', [])).chain_id, 'testnet');
const wasm = await readFile(new URL('../near-arena/target/wasm32-unknown-unknown/release/barrel_bay_arena.wasm', import.meta.url));
const codeHash = baseEncode(createHash('sha256').update(wasm).digest());
const deployed = await rpc.viewAccount({ accountId: proof.contract, blockQuery: { finality: 'final' } });
assert.equal(codeHash, proof.codeHash, 'Local WASM differs from the recorded proof');
assert.equal(deployed.code_hash, proof.codeHash, 'Current deployed code differs from the recorded proof');
const transactions = [];
for (const [action, entry] of [['buy', proof.buy], ['sell', proof.release]]) {
  const result = await rpc.viewTransactionStatus({ txHash: entry.hash, accountId: proof.agent, waitUntil: 'FINAL' });
  assert.equal(result.final_execution_status, 'FINAL');
  assert.equal(typeof result.status?.SuccessValue, 'string', 'Trade was not successful');
  assert.equal(result.transaction.hash, entry.hash);
  assert.equal(result.transaction.signer_id, proof.agent);
  assert.equal(result.transaction.receiver_id, proof.contract);
  assert.equal(result.transaction.actions.length, 1);
  const call = result.transaction.actions[0].FunctionCall;
  assert.equal(call?.method_name, 'agent_trade');
  assert.equal(String(call.deposit), '0');
  const args = JSON.parse(Buffer.from(call.args, 'base64').toString('utf8'));
  assert.equal(args.action, action);
  assert.equal(args.item, entry.item);
  assert.equal(args.expected_price, entry.expected_price);
  assert.equal(args.nonce, entry.nonce);
  const returned = JSON.parse(Buffer.from(result.status.SuccessValue, 'base64').toString('utf8'));
  assert.equal(returned.nonce, args.nonce);
  assert.equal(returned.spent, proof.cost);
  assert.equal(returned.revenue, action === 'buy' ? 0 : proof.revenue);
  transactions.push({ hash: entry.hash, blockHash: result.transaction_outcome.block_hash,
    signer: result.transaction.signer_id, receiver: result.transaction.receiver_id, method: call.method_name,
    deposit: call.deposit, args, returnedPolicy: returned, status: 'FINAL_SUCCESS' });
}
const policy = await rpc.callFunction({ contractId: proof.contract, method: 'agent_policy', args: { agent: proof.agent }, blockQuery: { finality: 'final' } });
assert.equal(policy.spent, proof.cost);
assert.equal(policy.revenue, proof.revenue);
assert.equal(policy.nonce, 2);
assert.equal(policy.enabled, false);
const report = { checkedAt: new Date().toISOString(), network: 'testnet', contract: proof.contract, agent: proof.agent,
  codeHash, policy, transactions, scope: 'Positive trades and current code/policy only. Does not verify rejected attacks, autonomy, recovery, product benefit or track eligibility.' };
await mkdir(new URL('../output/', import.meta.url), { recursive: true });
await writeFile(new URL('../output/agent-evidence-verification.json', import.meta.url), JSON.stringify(report, null, 2));
console.log('PASS: two finalized trades, exact arguments/returns, deployed WASM and revoked policy.');
console.log(report.scope);
