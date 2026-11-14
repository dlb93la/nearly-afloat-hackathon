import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Account, actions, baseEncode, getTransactionLastResult, JsonRpcProvider, KeyPair } from 'near-api-js';

// Explicitly invoked testnet rehearsal. The signer file stays local.
const local = process.argv.includes('--sandbox');
const signerFile = process.argv.slice(2).find(argument => !argument.startsWith('--'));
assert.ok(local || signerFile, 'Pass a local testnet rehearsal signer JSON file or --sandbox.');
const sandboxAccounts = ['treasury', 'first', 'second'].map(name => {
  const key = KeyPair.fromRandom('ed25519');
  return { id: name + '.testnet', key: key.toString(), publicKey: key.getPublicKey().toString() };
});
const [localSponsor, localAlice, localBob] = sandboxAccounts;
const config = local ? { ...localSponsor, alice: localAlice, bob: localBob } : JSON.parse(await readFile(signerFile, 'utf8'));
const backedGold = process.argv.includes('--gold');
const sandbox = local ? await (async () => {
  const { Sandbox, GenesisAccount } = await import('near-sandbox');
  return Sandbox.start({ version: '2.14.0', config: { additionalAccounts: sandboxAccounts.map(account =>
    new GenesisAccount(account.id, account.publicKey, account.key, 30n * 10n ** 24n)) } });
})() : null;
try {
  const rpc = new JsonRpcProvider({ url: sandbox?.rpcUrl ?? process.env.BARREL_NEAR_RPC ?? 'https://test.rpc.fastnear.com' });
  const network = local ? 'sandbox' : 'testnet';
  const chainId = (await rpc.sendJsonRpc('status', [])).chain_id;
  if (local) assert.ok(!['mainnet', 'testnet'].includes(chainId));
  else assert.equal(chainId, network);
  for (const identity of [config, config.alice, config.bob]) assert.match(identity.id, /^[a-z0-9.-]+\.testnet$/);
  const sponsor = new Account(config.id, rpc, config.key);
  const alice = new Account(config.alice.id, rpc, config.alice.key);
  const bob = new Account(config.bob.id, rpc, config.bob.key);
  const contract = `r-${randomBytes(4).toString('hex')}.${config.id}`;
  assert.ok(contract.length <= 64);
  const contractKey = KeyPair.fromRandom('ed25519');
  const referee = new Account(contract, rpc, contractKey.toString());
  const wasm = await readFile(new URL('../near-arena/target/wasm32-unknown-unknown/release/barrel_bay_arena.wasm', import.meta.url));
  const goldWasm = backedGold ? await readFile(new URL('../near-gold/target/wasm32-unknown-unknown/release/nearly_afloat_gold.wasm', import.meta.url)) : null;
  const gold = contract.replace(/^r-/, 'g-');
  const codeHash = baseEncode(createHash('sha256').update(wasm).digest());
  const tokenCodeHash = goldWasm && baseEncode(createHash('sha256').update(goldWasm).digest());
  const protocol = await rpc.sendJsonRpc('EXPERIMENTAL_protocol_config', { finality: 'final' });
  const funding = (BigInt(wasm.byteLength) + 50_000n) * BigInt(protocol.runtime_config.storage_amount_per_byte) + 200_000_000_000_000_000_000_000n;
  const goldFunding = goldWasm ? (BigInt(goldWasm.byteLength) + 50_000n) * BigInt(protocol.runtime_config.storage_amount_per_byte) + 200_000_000_000_000_000_000_000n : 0n;
  assert.ok((await sponsor.getState()).balance.available > funding + goldFunding, 'Insufficient testnet funds for rehearsal');
  const gas = 100_000_000_000_000n;
  const first = config.alice.id;
  const second = config.bob.id;
  const evidence = new URL(`../output/near-rehearsal-${contract}.jsonl`, import.meta.url);
  await mkdir(new URL('../output/', import.meta.url), { recursive: true });
  if (!local) await writeFile(new URL(`../data/rehearsal-${contract}.env`, import.meta.url),
    `BARREL_NEAR_CONTRACT=${contract}\nBARREL_NEAR_DEPLOY_KEY=${contractKey}\n`, { flag: 'wx', mode: 0o600 });
  async function record(label, result) {
    const hash = result.transaction?.hash;
    await appendFile(evidence, JSON.stringify({ label, network, contract, codeHash, ...(backedGold ? { token: gold, tokenCodeHash } : {}),
      hash, success: typeof result.status?.SuccessValue === 'string' }) + '\n');
    assert.equal(typeof result.status?.SuccessValue, 'string', label + ' failed: ' + JSON.stringify(result.status));
    return getTransactionLastResult(result);
  }
  const call = async (wallet, methodName, args = {}, deposit = 0n, contractId = contract) =>
    record(methodName, await wallet.callFunctionRaw({ contractId, methodName, args, gas, deposit, waitUntil: 'FINAL' }));
  const view = (method, args = {}, contractId = contract) =>
    rpc.callFunction({ contractId, method, args, blockQuery: { finality: 'final' } });
  const goldView = (method, args) => view(method, args, gold);
  const goldCall = (wallet, method, args, deposit) => call(wallet, method, args, deposit, gold);
  const walletGold = account_id => goldView('ft_balance_of', { account_id }).then(BigInt);
  const supplyCents = '1000000';
  async function waitFor(predicate) {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (await predicate()) return;
      await delay(1000);
    }
    assert.fail('Timed out waiting for campaign phase.');
  }

  await record('create isolated contract', await sponsor.signAndSendTransaction({ receiverId: contract, actions: [
    actions.createAccount(), actions.transfer(funding), actions.addFullAccessKey(contractKey.getPublicKey()),
    actions.deployContract(wasm),
  ], waitUntil: 'FINAL' }));
  assert.equal((await referee.getState()).codeHash, codeHash);
  if (backedGold) {
    const goldKey = KeyPair.fromRandom('ed25519');
    const token = new Account(gold, rpc, goldKey.toString());
    await record('create isolated GOLD contract', await sponsor.signAndSendTransaction({ receiverId: gold, actions: [
      actions.createAccount(), actions.transfer(goldFunding), actions.addFullAccessKey(goldKey.getPublicKey()),
      actions.deployContract(goldWasm),
    ], waitUntil: 'FINAL' }));
    assert.equal((await token.getState()).codeHash, tokenCodeHash);
    if (!local) await writeFile(new URL(`../data/rehearsal-${gold}.env`, import.meta.url),
      `BARREL_GOLD_CONTRACT=${gold}\nBARREL_GOLD_DEPLOY_KEY=${goldKey}\n`, { flag: 'wx', mode: 0o600 });
    await goldCall(token, 'new', { treasury: config.id, supply: supplyCents, sale_inventory: '100000',
      yocto_per_cent: '1000000000000000000' });
    const storage = BigInt((await goldView('storage_balance_bounds')).min);
    for (const account_id of [contract, first]) {
      await goldCall(sponsor, 'storage_deposit', { account_id, registration_only: true }, storage);
    }
    await call(referee, 'new_with_gold', { referee: contract, token: gold, funder: config.id });
    for (const [msg, amount] of [['treasury', '50000'], ['bot_bank', '30000']]) {
      assert.equal(await goldCall(sponsor, 'ft_transfer_call', { receiver_id: contract, amount, msg }, 1n), amount);
    }
    const amount = '1600';
    const quote = BigInt(await goldView('sale_quote', { amount }));
    await goldCall(alice, 'buy', { amount }, quote);
    assert.equal(await walletGold(first), 1600n);
    await call(referee, 'grant_test_gold', { player: second });
    assert.equal(await call(bob, 'withdraw_gold', { amount: '500' }, 1n), false);
    assert.equal(await view('balance', { player: second }), 10_000);
    await goldCall(sponsor, 'storage_deposit', { account_id: second, registration_only: true }, storage);
    await goldCall(alice, 'ft_transfer', { receiver_id: second, amount: '600' }, 1n);
    assert.equal(await walletGold(second), 600n);
    await appendFile(evidence, JSON.stringify({ token: gold, arena: contract, supplyCents, quote: quote.toString() }) + '\n');
  } else await call(referee, 'new', { referee: contract });
  console.log('Current WASM deployed on isolated', network, 'contract:', contract);
  for (const player of (backedGold ? [first] : [first, second])) await call(referee, 'grant_test_gold', { player });
  if (backedGold) {
    const deposit = { receiver_id: contract, amount: '1000' };
    assert.equal(await goldCall(alice, 'ft_transfer_call', { ...deposit, msg: 'unknown' }, 1n), '0');
    assert.equal(await walletGold(first), 1000n);
    assert.equal(await goldCall(alice, 'ft_transfer_call', { ...deposit, msg: 'deposit' }, 1n), '1000');
    assert.equal(await view('balance', { player: first }), 11_000);
    await call(referee, 'grant_gold_reward', { player: first, reward_id: '1', amount: '200' });
    await call(referee, 'grant_gold_reward', { player: first, reward_id: '1', amount: '200' });
    assert.equal(await view('balance', { player: first }), 11_200);
    await assert.rejects(() => alice.callFunctionRaw({ contractId: contract, methodName: 'ft_on_transfer',
      args: { sender_id: first, amount: '100000', msg: 'deposit' }, gas, deposit: 0n, waitUntil: 'FINAL',
    }).then(result => {
      if (result.status?.Failure) throw Error(JSON.stringify(result.status.Failure));
    }), /Unrecognized GOLD contract/);
    assert.equal(await view('balance', { player: first }), 11_200);
  }
  const supply = await view('collection_quotes');
  assert.ok(supply.every(q => q.count === q.stock_limit && q.commercial_supply === q.stock_limit && q.circulating === 0));
  assert.ok(supply.some(q => q.rarity === 'legendary' && q.stock_limit === 1));
  const legendary = supply.find(q => q.rarity === 'legendary');
  await call(alice, 'collection_action', { action: 'buy', item: legendary.item, expected_price: legendary.buy });
  const missing = (await view('collection_quotes')).find(q => q.item === legendary.item);
  assert.equal(missing.count, 0); assert.equal(missing.circulating, 1);
  await call(alice, 'collection_action', { action: 'sell', item: missing.item, expected_price: missing.sell });
  assert.equal((await view('collection_quotes')).find(q => q.item === missing.item).count, 1);
  const chest_price = await view('chest_price');
  const beforeChest = await view('balance', { player: first });
  await call(alice, 'collection_action', { action: 'open_chest', expected_price: chest_price });
  assert.equal(await view('balance', { player: first }), beforeChest - chest_price);
  await appendFile(evidence, JSON.stringify({ label: 'closed rarity supply and weighted chest verified', contract, codeHash, chest_price, success: true }) + '\n');
  await call(referee, 'grant_first_brawl', { player: first, rig: 'iron' });
  const seat = (await view('collection_quotes')).find(item => item.item === 'seat-red');
  await call(alice, 'collection_action', { action: 'buy', item: seat.item, expected_price: seat.buy });
  await call(alice, 'collection_action', { action: 'equip', item: seat.item });
  assert.equal((await view('collection', { player: first })).equipped.seat, seat.item);
  const rig = (await view('workshop', { player: second })).stock.find(item => item.rig === 'cork');
  await call(bob, 'workshop_action', { action: 'buy', rig: rig.rig, expected_price: rig.buy });
  await call(bob, 'workshop_action', { action: 'equip', rig: rig.rig });
  await call(alice, 'authorize_session', { scope: '10', entries: 2 });
  for (const round_id of ['101', '102']) {
    await call(bob, 'authorize_entry', { round_id });
    await call(referee, 'reserve_round', { round_id, slots: 6, players: [first, second], session: { scope: '10', players: [first] } });
    assert.deepEqual(await view('round_rigs', { round_id }), { [first]: 'iron', [second]: rig.rig });
    if (round_id === '101') await call(referee, 'settle_round', { round_id, winner: second });
    else await call(referee, 'cancel_round', { round_id });
  }
  assert.equal((await view('workshop', { player: second })).items[0].uses, 2);
  assert.equal((await view('logbook', { player: second })).at(-1).gold_delta, 200);
  console.log('Shop, Cottage, Arena pass, wear, settlement and refund verified.');

  const item_type = 'ornament-expedition-astrolabe';
  const windows = { funding_ms: 180_000, sailing_ms: 1000, auction_ms: 35_000, item_type };
  const voyage = await call(referee, 'new_voyage', windows);
  const campaign_id = voyage.id;
  await call(alice, 'contribute', { amount: 600, nonce: 1, campaign_id });
  await call(bob, 'contribute', { amount: 2400, nonce: 1, campaign_id });
  await waitFor(async () => (await view('campaign')).status === 'auction');
  const beforeBid = await view('balance', { player: first });
  await call(alice, 'bid', { amount: 200, campaign_id });
  await call(bob, 'bid', { amount: 2000, campaign_id });
  assert.equal(await view('balance', { player: first }), beforeBid);
  await waitFor(async () => (await view('campaign')).needs_advance);
  assert.equal((await call(alice, 'advance', { campaign_id })).net, 1900);
  assert.equal((await view('account', { player: first })).payout, 380);
  assert.equal((await view('account', { player: second })).payout, 1520);
  await call(bob, 'equip_voyage_award', { equipped: true, item: item_type });
  assert.equal((await view('account', { player: second })).award_counts[item_type], 1);
  assert.equal((await view('account', { player: second })).award_editions[0].campaign_id, campaign_id);
  const refundVoyage = await call(referee, 'new_voyage', { ...windows, funding_ms: 15_000, item_type: 'pet-expedition-parrot' });
  assert.equal((await view('campaign_history'))[0].item_type, item_type);
  assert.equal((await view('account', { player: second })).award, item_type);
  const beforeRefund = await view('balance', { player: first });
  await call(alice, 'contribute', { amount: 100, nonce: 2, campaign_id: refundVoyage.id });
  await waitFor(async () => (await view('campaign')).needs_advance);
  assert.equal((await call(alice, 'advance', { campaign_id: refundVoyage.id })).status, 'refunded');
  assert.equal(await view('balance', { player: first }), beforeRefund);
  if (backedGold) {
    const withdrawal = '1520';
    const before = await view('balance', { player: second });
    assert.equal(await call(bob, 'withdraw_gold', { amount: withdrawal }, 1n), true);
    assert.equal(await walletGold(second), 2120n);
    assert.equal(await view('balance', { player: second }), before - Number(withdrawal));
    const reserves = await view('pools');
    assert.equal(await walletGold(contract), BigInt(reserves[0] + reserves[1] + before - Number(withdrawal) + beforeRefund));
    assert.equal(await goldView('ft_total_supply'), supplyCents);
  }
  await appendFile(evidence, JSON.stringify({ label: 'rehearsal verified', contract, codeHash, network, success: true }) + '\n');
  console.log('Expeditions sale, payout, award, rotation and funding refund verified.', evidence.pathname);
} finally {
  await sandbox?.tearDown();
}
