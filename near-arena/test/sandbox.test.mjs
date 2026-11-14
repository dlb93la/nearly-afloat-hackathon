import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { Account, actions, getTransactionLastResult, JsonRpcProvider, KeyPair, keyToImplicitAddress } from 'near-api-js';
import { GenesisAccount, Sandbox } from 'near-sandbox';
import { loadNearExpeditions } from '../../near-expeditions.mjs';
import { loadNearSocialActions, SOCIAL_GOLD_LIMIT, SOCIAL_PREVIEW_GENESIS } from '../../near-social-actions.mjs';

const gas = 100_000_000_000_000n;
const wasm = await readFile(new URL('../target/wasm32-unknown-unknown/release/barrel_bay_arena.wasm', import.meta.url));

test('signed transactions complete both tracks on the shared ledger', { timeout: 180_000 }, async t => {
  const signers = ['arena', 'alice', 'bob'].map(name => {
    const id = name + '.testnet';
    const key = KeyPair.fromRandom('ed25519');
    return { id, key, genesis: new GenesisAccount(id, key.getPublicKey().toString(), key.toString(), 30n * 10n ** 24n) };
  });
  const sandbox = await Sandbox.start({ version: '2.14.0', config: { additionalGenesis: SOCIAL_PREVIEW_GENESIS,
    additionalAccounts: signers.map(signer => signer.genesis) } });
  t.after(() => sandbox.tearDown());
  const rpc = new JsonRpcProvider({ url: sandbox.rpcUrl });
  assert.equal(new URL(sandbox.rpcUrl).hostname, '127.0.0.1');
  assert.ok(!['mainnet', 'testnet'].includes((await rpc.sendJsonRpc('status', [])).chain_id));
  const [referee, alice, bob] = signers.map(signer => new Account(signer.id, rpc, signer.key.toString()));
  const [contract, first, second] = signers.map(signer => signer.id);
  const record = result => {
    assert.equal(typeof result.status?.SuccessValue, 'string', JSON.stringify({ status: result.status,
      logs: result.receipts_outcome?.flatMap(receipt => receipt.outcome.logs) }));
    assert.ok(result.transaction.hash);
    return getTransactionLastResult(result);
  };
  const call = async (wallet, methodName, args = {}) => record(await wallet.callFunctionRaw({
    contractId: contract, methodName, args, gas, deposit: 0n, waitUntil: 'FINAL',
  }));
  const view = (method, args = {}) => rpc.callFunction({ contractId: contract, method, args, blockQuery: { finality: 'final' } });
  const wait = async predicate => {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (await predicate()) return;
      await delay(250);
    }
    assert.fail('The voyage did not advance within 30 seconds');
  };

  record(await referee.signAndSendTransaction({
    receiverId: contract,
    actions: [actions.deployContract(wasm), actions.functionCall('new', { referee: contract }, gas, 0n)],
    waitUntil: 'FINAL',
  }));
  for (const player of [first, second]) await call(referee, 'grant_test_gold', { player });
  await call(referee, 'grant_first_brawl', { player: first, rig: 'iron' });
  const seatQuote = (await view('collection_quotes')).find(item => item.item === 'seat-red').buy;
  await call(alice, 'collection_action', { action: 'buy', item: 'seat-red', expected_price: seatQuote });
  await call(alice, 'collection_action', { action: 'equip', item: 'seat-red' });
  const chestPrice = await view('chest_price');
  await call(alice, 'collection_action', { action: 'open_chest', expected_price: chestPrice });
  const collection = await view('collection', { player: first });
  assert.equal(collection.equipped.seat, 'seat-red');
  assert.equal(Object.values(collection.owned).reduce((total, count) => total + count, 0), 2);
  assert.equal(await view('balance', { player: first }), 10_000 - seatQuote - chestPrice);

  const operatorKey = KeyPair.fromRandom('ed25519');
  await referee.addFunctionCallAccessKey({ publicKey: operatorKey.getPublicKey(), contractId: contract,
    methodNames: ['advance'], allowance: 250_000_000_000_000_000_000_000n });
  const bridge = loadNearExpeditions({ BARREL_NEAR_VOYAGE: '1', BARREL_NEAR_RPC: sandbox.rpcUrl,
    BARREL_EXPEDITIONS_OPERATOR: contract, BARREL_EXPEDITIONS_KEY: operatorKey.toString() }, { contract, hasWorkshop: true });
  const voyage = await call(referee, 'new_voyage', { funding_ms: 60_000, sailing_ms: 1_000, auction_ms: 15_000 });
  await call(alice, 'contribute', { amount: 600, nonce: 1 });
  await call(bob, 'contribute', { amount: 2_400, nonce: 1 });
  await wait(async () => (await view('campaign')).status === 'auction');
  await call(alice, 'bid', { amount: 200 });
  await call(bob, 'bid', { amount: 2_000 });
  assert.equal(await view('balance', { player: first }), 10_000 - seatQuote - chestPrice - 600);
  await wait(async () => (await view('campaign')).needs_advance);
  await bridge.advanceIfDue();
  const firstResult = await bridge.read(first);
  assert.equal(firstResult.campaign.id, contract + '/' + voyage.id);
  assert.equal(firstResult.campaign.sale.distributed, 1_900);
  assert.equal(firstResult.campaign.myPayout, 380);
  assert.equal((await bridge.read(second)).campaign.myPayout, 1_520);
  assert.ok(firstResult.settlementHash);
  await bridge.advanceIfDue();
  assert.equal((await bridge.read(first)).settlementHash, firstResult.settlementHash);
  assert.equal((await call(bob, 'equip_voyage_award', { equipped: true })).award_equipped, true);
  const refundVoyage = await call(referee, 'new_voyage', { funding_ms: 8_000, sailing_ms: 1_000, auction_ms: 15_000,
    item_type: 'ornament-expedition-astrolabe' });
  const balanceBeforeRefund = (await bridge.read(first)).gold;
  await call(alice, 'contribute', { amount: 200, nonce: 2, campaign_id: refundVoyage.id });
  await wait(async () => (await view('campaign')).needs_advance);
  await bridge.advanceIfDue();
  const refund = await bridge.read(first);
  assert.equal(refund.campaign.status, 'refunded');
  assert.equal(refund.campaign.myRefund, 200);
  assert.equal(refund.gold, balanceBeforeRefund);
  assert.ok(refund.settlementHash && refund.settlementHash !== firstResult.settlementHash);
  assert.equal((await view('campaign_history'))[0].id, voyage.id);
  assert.ok((await bridge.read(second)).awardCounts['pet-expedition-parrot']);
  const workshop = await view('workshop', { player: second });
  const price = workshop.stock.find(item => item.rig === 'anchor').buy;
  await call(bob, 'workshop_action', { action: 'buy', rig: 'anchor', expected_price: price });
  await call(bob, 'workshop_action', { action: 'equip', rig: 'anchor' });

  await call(alice, 'authorize_session', { scope: '10', entries: 2 });
  for (const round_id of ['101', '102']) {
    await call(bob, 'authorize_entry', { round_id });
    await call(referee, 'reserve_round', { round_id, slots: 6, players: [first, second],
      session: { scope: '10', players: [first] } });
    assert.deepEqual(await view('round_rigs', { round_id }), { [first]: 'iron', [second]: 'anchor' });
    if (round_id === '101') await call(referee, 'settle_round', { round_id, winner: second });
    else await call(referee, 'cancel_round', { round_id });
  }
  assert.equal((await view('workshop', { player: second })).items[0].uses, 2);
  const journal = await view('logbook', { player: second });
  assert.equal(journal.at(-1).event, 'arena_refunded');
  assert.equal(journal.at(-1).gold_delta, 200);

  const owner = KeyPair.fromRandom('ed25519');
  const social = keyToImplicitAddress(owner.getPublicKey());
  const sponsored = loadNearSocialActions({ BARREL_NEAR_SOCIAL_SPONSOR: contract,
    BARREL_NEAR_SOCIAL_SPONSOR_KEY: signers[0].key.toString() }, contract, {
    provider: rpc,
    onSubmitError: error => t.diagnostic(`${error.name}: ${error.message}`),
    sponsor: {
      signAndSendTransaction: args => referee.signAndSendTransaction(args),
      async callFunctionRaw({ args }) {
        const digest = createHash('sha256').update(Uint8Array.from(args.sign_payload)).digest();
        const signature = [...owner.sign(digest).signature];
        return { status: { SuccessValue: Buffer.from(JSON.stringify({ signature })).toString('base64') } };
      },
    },
  });
  const enrollment = await sponsored.prepare(social);
  await rpc.sendJsonRpc('sandbox_fast_forward', { delta_height: 130 });
  const signing = await sponsored.authorize(enrollment, 'simulated-mpc-approval', 'test-guard');
  assert.equal((await new Account(social, rpc).getAccessKey(signing.key.getPublicKey())).permission.FunctionCall.receiver_id, contract);
  await call(referee, 'grant_test_gold', { player: social });
  await call(referee, 'grant_first_brawl', { player: social, rig: 'iron' });
  let active = true;
  const run = (method, args, id) => sponsored.submit(social, signing, method, args, id, () => active);
  const quote = (await view('workshop', { player: social })).stock.find(item => item.rig === 'cork').buy;
  const buy = await run('workshop_action', { action: 'buy', rig: 'cork', expected_price: quote }, 'buy');
  record(buy);
  assert.equal((await run('workshop_action', { action: 'buy', rig: 'cork', expected_price: quote }, 'buy')).transaction.hash, buy.transaction.hash);
  record(await run('workshop_action', { action: 'equip', rig: 'cork' }, 'equip'));
  record(await run('authorize_entry', { round_id: '103' }, 'entry'));
  await call(referee, 'reserve_round', { round_id: '103', slots: 6, players: [social] });
  await call(referee, 'settle_round', { round_id: '103', winner: social });
  assert.equal((await view('workshop', { player: social })).items.find(item => item.rig === 'cork').uses, 2);
  const beforeCancel = await view('balance', { player: social });
  record(await run('authorize_entry', { round_id: '104' }, 'entry-for-cancel'));
  await call(referee, 'reserve_round', { round_id: '104', slots: 6, players: [social] });
  await call(referee, 'cancel_round', { round_id: '104' });
  assert.equal(await view('balance', { player: social }), beforeCancel);
  assert.equal((await view('workshop', { player: social })).items.find(item => item.rig === 'cork').uses, 2);
  assert.equal(signing.remaining, SOCIAL_GOLD_LIMIT - quote - 400);
  await assert.rejects(run('bid', { amount: signing.remaining + 1 }, 'over-budget'), /remaining session limit/);
  active = false;
  await assert.rejects(run('authorize_entry', { round_id: '105' }, 'logout'), /Sign in again/);

  // The embedded signer installs the same restricted key directly, without FastAuth/MPC consent.
  const embeddedEnrollment = await sponsored.prepare(social);
  const embeddedHash = createHash('sha256').update(embeddedEnrollment.encoded).digest();
  const embeddedSignature = '0x' + Buffer.from(owner.sign(embeddedHash).signature).toString('hex');
  const wrongOwner = KeyPair.fromRandom('ed25519');
  await assert.rejects(sponsored.authorizeSignature(embeddedEnrollment,
    '0x' + Buffer.from(wrongOwner.sign(embeddedHash).signature).toString('hex')), /different key/);
  const embeddedSigning = await sponsored.authorizeSignature(embeddedEnrollment, embeddedSignature);
  const embeddedPermission = (await new Account(social, rpc).getAccessKey(embeddedSigning.key.getPublicKey())).permission.FunctionCall;
  assert.equal(embeddedPermission.receiver_id, contract);
  assert.ok(embeddedPermission.method_names.includes('workshop_action'));
  assert.ok(!embeddedPermission.method_names.includes('grant_test_gold'));
  record(await sponsored.submit(social, embeddedSigning, 'workshop_action', { action: 'equip', rig: 'cork' }, 'embedded-equip', () => true));
});
