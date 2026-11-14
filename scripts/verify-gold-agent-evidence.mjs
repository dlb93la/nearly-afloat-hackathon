// Public read-only verification. This command never creates an account or signs a transaction.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { baseEncode, JsonRpcProvider } from 'near-api-js';

const proof = JSON.parse(await readFile(new URL('../docs/evidence/agent-gold-testnet.json', import.meta.url), 'utf8'));
assert.equal(proof.network, 'testnet');
assert.ok(proof.backing?.token);
const rpc = new JsonRpcProvider({ url: process.env.AFLOAT_AGENT_RPC || 'https://near-testnet.drpc.org' },
  { retries: 5, wait: 350, backoff: 1.7 });
assert.equal((await rpc.sendJsonRpc('status', [])).chain_id, 'testnet');
const hash = bytes => baseEncode(createHash('sha256').update(bytes).digest());
const localBuildChecked = process.argv.includes('--check-local-build');
if (localBuildChecked) {
  const arenaWasm = await readFile(new URL('../near-arena/target/wasm32-unknown-unknown/release/barrel_bay_arena.wasm', import.meta.url));
  const tokenWasm = await readFile(new URL('../near-gold/target/wasm32-unknown-unknown/release/nearly_afloat_gold.wasm', import.meta.url));
  assert.equal(hash(arenaWasm), proof.codeHash, 'Build differs from the recorded Arena');
  assert.equal(hash(tokenWasm), proof.backing.tokenCodeHash, 'Build differs from the recorded GOLD');
}
const block = await rpc.viewBlock({ finality: 'final' });
const blockQuery = { blockId: block.header.hash };
const view = (contractId, method, args = {}) => rpc.callFunction({ contractId, method, args, blockQuery });
const [arena, token] = await Promise.all([proof.contract, proof.backing.token].map(accountId =>
  rpc.viewAccount({ accountId, blockQuery })));
assert.equal(arena.code_hash, proof.codeHash);
assert.equal(token.code_hash, proof.backing.tokenCodeHash);
const config = await view(proof.contract, 'gold_config');
assert.equal(config.token, proof.backing.token);
const [vault, supply, pools, balance, policy] = await Promise.all([
  view(config.token, 'ft_balance_of', { account_id: proof.contract }),
  view(config.token, 'ft_total_supply'),
  view(proof.contract, 'pools'),
  view(proof.contract, 'balance', { player: proof.agent }),
  view(proof.contract, 'agent_policy', { agent: proof.agent }),
]);
assert.equal(vault, proof.backing.vault);
assert.equal(supply, '1000000');
assert.equal(balance, proof.backing.agentBalance);
assert.deepEqual(pools, [proof.backing.treasury, proof.backing.botBank]);
const permission = proof.permission.permission.FunctionCall;
assert.equal(permission.receiver_id, proof.contract);
assert.deepEqual(permission.method_names, ['agent_trade']);
assert.ok(BigInt(permission.allowance) > 0n && BigInt(permission.allowance) <= 250_000_000_000_000_000_000_000n);
assert.ok(!policy.enabled || policy.expires_at <= Math.floor(Number(block.header.timestamp_nanosec) / 1e6), 'Proof policy must be closed');
assert.equal(policy.nonce, 3, 'Exactly one concurrent proposal should have executed');
assert.equal(policy.revenue, proof.revenue);
assert.equal(proof.net, proof.revenue - proof.cost);
assert.equal(BigInt(vault), BigInt(pools[0] + pools[1] + balance + proof.backing.playerBalance));
const evidence = [];
let delegatedPublicKey;
for (const [action, trade] of [['buy', proof.buy], ['sell', proof.release]]) {
  const receipt = await rpc.viewTransactionStatus({ txHash: trade.hash, accountId: proof.agent, waitUntil: 'FINAL' });
  assert.equal(receipt.final_execution_status, 'FINAL');
  assert.equal(typeof receipt.status?.SuccessValue, 'string');
  assert.equal(receipt.transaction.signer_id, proof.agent);
  delegatedPublicKey ??= receipt.transaction.public_key;
  assert.equal(receipt.transaction.public_key, delegatedPublicKey);
  assert.equal(receipt.transaction.receiver_id, proof.contract);
  assert.equal(receipt.transaction.actions.length, 1);
  const call = receipt.transaction.actions[0].FunctionCall;
  assert.equal(call.method_name, 'agent_trade');
  assert.equal(String(call.deposit), '0');
  const args = JSON.parse(Buffer.from(call.args, 'base64').toString('utf8'));
  assert.deepEqual(args, { action, item: trade.item, expected_price: trade.expected_price, nonce: trade.nonce });
  const returned = JSON.parse(Buffer.from(receipt.status.SuccessValue, 'base64').toString('utf8'));
  assert.equal(returned.nonce, trade.nonce);
  assert.equal(returned.spent, proof.cost);
  assert.equal(returned.revenue, action === 'buy' ? 0 : proof.revenue);
  evidence.push({ action, hash: trade.hash, price: args.expected_price, status: 'FINAL_SUCCESS' });
}
await assert.rejects(rpc.viewAccessKey({ accountId: proof.agent, publicKey: delegatedPublicKey, blockQuery }),
  /AccessKey.*does not exist|access key.*does not exist|AccessKeyNotFound/i, 'The proof key must be removed');
for (const rejected of proof.receipts.filter(item => item.layer === 'contract')) {
  const receipt = await rpc.viewTransactionStatus({ txHash: rejected.hash, accountId: proof.agent, waitUntil: 'FINAL' });
  assert.equal(receipt.final_execution_status, 'FINAL');
  assert.ok(receipt.status?.Failure, rejected.label + ' was not rejected');
  assert.deepEqual(receipt.status, rejected.outcome);
  evidence.push({ action: rejected.label, hash: rejected.hash, status: 'FINAL_REJECTED' });
}
assert.equal(proof.lostAcknowledgementRecovered, true);
assert.equal(proof.concurrentExecutions, 1);
for (const label of ['replay', 'budget bypass', 'forbidden item', 'self escalation', 'bypass wrapper',
  'wrong receiver', 'withdraw vault backing', 'transfer GOLD tokens', 'revoked policy', 'expired policy',
  'gas allowance exhausted', 'removed key']) {
  assert.ok(proof.receipts.some(item => item.label === label), 'Missing proof case ' + label);
}
const report = {
  checkedAt: new Date().toISOString(), block: block.header.height, network: 'testnet',
  contract: proof.contract, token: config.token, delegatedPublicKey, supply, vault, localBuildChecked,
  cost: proof.cost, revenue: proof.revenue, net: proof.net, policy, receipts: evidence,
  scope: 'Reads final receipts, deployed code hashes against recorded proof, and current token backing. Local source build identity is checked only with --check-local-build. Protocol refusals, recovery and concurrency are exercised by the signed rehearsal. This does not establish profitability or jury acceptance.',
};
await mkdir(new URL('../output/', import.meta.url), { recursive: true });
await writeFile(new URL('../output/agent-gold-readonly.json', import.meta.url), JSON.stringify(report, null, 2));
console.log('PASS GOLD agent proof: final trades and rejections, deployed code, closed policy and finite token backing.');
console.log(JSON.stringify({ block: report.block, cost: proof.cost, revenue: proof.revenue, net: proof.net }));
