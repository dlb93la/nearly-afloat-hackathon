// Explicit testnet deployment. Full-access keys remain in ignored local data;
// the server receives only restricted function-call keys for demo accounts.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Account, actions, baseEncode, JsonRpcProvider, KeyPair } from 'near-api-js';

assert.ok(process.argv.includes('--confirm-testnet'), 'Pass --confirm-testnet for an isolated deployment');
const signerFile = process.argv.slice(2).find(arg => !arg.startsWith('--'));
const sponsorConfig = JSON.parse(await readFile(signerFile, 'utf8'));
assert.match(sponsorConfig.id, /^[a-z0-9.-]+\.testnet$/);
const rpc = new JsonRpcProvider({ url: 'https://test.rpc.fastnear.com' });
assert.equal((await rpc.sendJsonRpc('status', [])).chain_id, 'testnet');
const sponsor = new Account(sponsorConfig.id, rpc, sponsorConfig.key);
const tag = randomBytes(4).toString('hex');
const key = () => KeyPair.fromRandom('ed25519');
const ids = ['j', 't', 'c', 'p'].map(prefix => `${prefix}-${tag}.${sponsorConfig.id}`);
assert.ok(ids.every(id => id.length <= 64));
const roots = ids.map(id => ({ id, key: key().toString() }));
const [arena, token, first, second] = roots;
const wasm = await readFile(new URL('../output/judges-rust-target/wasm32-unknown-unknown/release/barrel_bay_arena.wasm', import.meta.url));
const goldWasm = await readFile(new URL('../near-gold/target/wasm32-unknown-unknown/release/nearly_afloat_gold.wasm', import.meta.url));
const hash = data => baseEncode(createHash('sha256').update(data).digest());
const protocol = await rpc.sendJsonRpc('EXPERIMENTAL_protocol_config', { finality: 'final' });
const storageRate = BigInt(protocol.runtime_config.storage_amount_per_byte);
const native = 300_000_000_000_000_000_000_000n;
const deposits = [wasm.length, goldWasm.length, 0, 0].map(size => (BigInt(size) + 50000n) * storageRate + native);
const available = (await sponsor.getState()).balance.available;
assert.ok(available > deposits.reduce((sum, v) => sum + v, 0n), 'Insufficient isolated testnet deployment balance');
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
const privatePath = new URL(`../data/judges-expedition-${tag}.json`, import.meta.url);
const delegated = [arena, first, second].map(root => ({ id: root.id, key: key().toString() }));
const config = { contract: arena.id, token: token.id, operator: delegated[0], crews: delegated.slice(1) };
await writeFile(privatePath, JSON.stringify({ roots, config, sponsor: sponsorConfig.id }, null, 2), { flag: 'wx', mode: 0o600 });
const proof = { network: 'testnet', contract: arena.id, token: token.id, crews: [first.id, second.id],
  timing: 'manual_no_expiry', codeHash: hash(wasm), tokenCodeHash: hash(goldWasm), receipts: [] };
const wallets = roots.map(root => new Account(root.id, rpc, root.key));
const gas = 100_000_000_000_000n;
async function record(label, transaction) {
  const result = await transaction;
  assert.equal(typeof result.status?.SuccessValue, 'string', label + ' failed');
  proof.receipts.push({ label, hash: result.transaction.hash });
  await mkdir(new URL('../output/', import.meta.url), { recursive: true });
  await writeFile(new URL('../output/judges-expedition-setup.json', import.meta.url), JSON.stringify(proof, null, 2));
  console.log(label, result.transaction.hash);
}
for (let i = 0; i < roots.length; i++) {
  const root = roots[i], pair = KeyPair.fromString(root.key);
  const calls = [actions.createAccount(), actions.transfer(deposits[i]), actions.addFullAccessKey(pair.getPublicKey())];
  if (i < 2) calls.push(actions.deployContract(i === 0 ? wasm : goldWasm));
  await record('create ' + root.id, sponsor.signAndSendTransaction({ receiverId: root.id, actions: calls, waitUntil: 'FINAL' }));
}
const call = (wallet, contractId, methodName, args, deposit = 0n) => wallet.callFunctionRaw({ contractId, methodName, args, gas, deposit, waitUntil: 'FINAL' });
await record('initialize isolated vault', call(wallets[0], arena.id, 'new_with_gold', { referee: arena.id, token: token.id, funder: sponsorConfig.id }));
await record('initialize demo GOLD', call(wallets[1], token.id, 'new', { treasury: sponsorConfig.id, supply: '1000000', sale_inventory: '100000',
  yocto_per_cent: '1000000000000000000' }));
const storage = BigInt((await rpc.callFunction({ contractId: token.id, method: 'storage_balance_bounds', args: {} })).min);
await record('register isolated vault', call(sponsor, token.id, 'storage_deposit', { account_id: arena.id, registration_only: true }, storage));
await record('fund isolated reserve 8000 demo GOLD', call(sponsor, token.id, 'ft_transfer_call', { receiver_id: arena.id, amount: '800000', msg: 'treasury' }, 1n));
for (const actor of [first, second]) await record('register demo crew', call(wallets[0], arena.id, 'grant_test_gold', { player: actor.id }));
await record('open manual rehearsal', call(wallets[0], arena.id, 'open_judges_voyage', {}));
for (let i = 0; i < delegated.length; i++) {
  const actor = delegated[i];
  const wallet = i === 0 ? wallets[0] : wallets[i + 1];
  const allowed = i === 0 ? ['restart_judges_voyage', 'advance_judges_voyage'] : ['contribute', 'bid', 'equip_voyage_award'];
  await record('delegate demo methods', wallet.signAndSendTransaction({ receiverId: actor.id, actions: [
    actions.addFunctionCallAccessKey(KeyPair.fromString(actor.key).getPublicKey(), arena.id, allowed, 10n ** 24n),
  ], waitUntil: 'FINAL' }));
}
await writeFile(new URL('../data/judges-runtime.json', import.meta.url), JSON.stringify(config), { mode: 0o600 });
console.log('Isolated rehearsal ready. Runtime configuration saved in ignored data/judges-runtime.json.');
