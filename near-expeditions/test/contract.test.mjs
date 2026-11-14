import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const wasm = new WebAssembly.Module(readFileSync(new URL(
  '../target/wasm32-unknown-unknown/release/barrel_bay_expeditions.wasm', import.meta.url,
)));
const contract = 'expeditions.testnet';
const operator = 'operator.testnet';
const alice = 'alice.testnet';
const bob = 'bob.testnet';
const carol = 'carol.testnet';
const diana = 'diana.testnet';
const item = 'pet-expedition-parrot';

// Exercise the compiled exports with an independent storage transaction per call.
function fixture() {
  let storage = new Map();
  let now = 1_000;

  function call(method, args = {}, account = operator) {
    const transaction = new Map(storage);
    const registers = new Map();
    let output;
    let instance;
    const memory = () => new Uint8Array(instance.exports.memory.buffer);
    const read = (length, pointer) => length === -1n ? registers.get(pointer)
      : memory().slice(Number(pointer), Number(pointer + length));
    const key = (length, pointer) => Buffer.from(read(length, pointer)).toString('hex');
    const readStorage = (length, pointer, register) => {
      const value = transaction.get(key(length, pointer));
      if (!value) return 0n;
      registers.set(register, value);
      return 1n;
    };
    instance = new WebAssembly.Instance(wasm, { env: {
      value_return(length, pointer) { output = Buffer.from(read(length, pointer)).toString(); },
      current_account_id(register) { registers.set(register, Buffer.from(contract)); },
      predecessor_account_id(register) { registers.set(register, Buffer.from(account)); },
      attached_deposit(pointer) { memory().fill(0, Number(pointer), Number(pointer) + 16); },
      block_timestamp() { return BigInt(now) * 1_000_000n; },
      input(register) { registers.set(register, Buffer.from(JSON.stringify(args))); },
      register_len(register) { return registers.has(register) ? BigInt(registers.get(register).length) : -1n; },
      read_register(register, pointer) { memory().set(registers.get(register), Number(pointer)); },
      storage_has_key(length, pointer) { return transaction.has(key(length, pointer)) ? 1n : 0n; },
      storage_read: readStorage,
      storage_write(length, pointer, valueLength, valuePointer, register) {
        const replaced = readStorage(length, pointer, register);
        transaction.set(key(length, pointer), read(valueLength, valuePointer));
        return replaced;
      },
      storage_remove(length, pointer, register) {
        const removed = readStorage(length, pointer, register);
        transaction.delete(key(length, pointer));
        return removed;
      },
    } });
    instance.exports[method]();
    storage = transaction;
    return output === undefined ? undefined : JSON.parse(output);
  }

  const config = { operator, funding_ms: 20_000, sailing_ms: 2_000, auction_ms: 1_000, item_type: item };
  assert.throws(() => call('new', config, alice));
  call('new', config, contract);
  for (const player of [alice, bob, carol, diana]) call('grant_test_gold', { player });
  return {
    call, advanceTime: ms => { now += ms; },
    account: player => call('account', { player }),
    contribute: (player, amount, nonce = 1) => call('contribute', { amount, nonce }, player),
    bid: (player, amount) => call('bid', { amount }, player),
  };
}

test('an independent, permissionless settlement charges the winning bid and issues one award', () => {
  const { call, account, advanceTime, contribute, bid } = fixture();
  assert.equal(call('campaign').min_supporters, 2);
  assert.equal(account(alice).max_contribution, 29_900);
  assert.throws(() => contribute(alice, 30_000));
  assert.equal(account(alice).balance, 300_000);
  assert.equal(contribute(alice, 6_000).funded, 6_000);
  assert.equal(call('campaign').treasury, 0);
  assert.equal(contribute(alice, 6_000).funded, 6_000);
  assert.throws(() => contribute(alice, 7_000));
  assert.throws(() => contribute(alice, 24_000, 2));
  const departure = contribute(bob, 24_000);
  assert.deepEqual([departure.status, departure.treasury], ['sailing', 30_000]);
  assert.equal(account(alice).max_contribution, 0);
  assert.throws(() => bid(carol, 200));
  advanceTime(2_000);
  assert.equal(call('campaign').status, 'auction');

  assert.equal(bid(carol, 20_000).highest_bid, 20_000);
  assert.equal(account(carol).balance, 280_000);
  assert.throws(() => bid(diana, 20_099));
  assert.throws(() => bid(diana, 300_001));
  assert.equal(account(carol).balance, 280_000);
  assert.equal(bid(diana, 199_900).highest_bid, 199_900);
  assert.equal(account(carol).balance, 300_000);
  assert.equal(bid(diana, 200_000).minimum_bid, 200_100);
  assert.equal(bid(diana, 200_000).highest_bid, 200_000);
  assert.equal(account(diana).balance, 100_000);
  assert.equal(account(diana).award, null);
  assert.equal(call('advance', {}, carol).status, 'auction');

  advanceTime(1_000);
  assert.equal(call('campaign').needs_advance, true);
  assert.throws(() => bid(carol, 200_100));
  const receipt = call('advance', {}, carol);
  assert.deepEqual(
    [receipt.status, receipt.winner, receipt.sale, receipt.fee, receipt.net, receipt.treasury, receipt.needs_advance],
    ['settled', diana, 200_000, 10_000, 190_000, 40_000, false],
  );
  assert.deepEqual([account(alice).payout, account(bob).payout], [38_000, 152_000]);
  assert.deepEqual([account(alice).balance, account(bob).balance], [332_000, 428_000]);
  assert.equal(account(diana).award, item);
  assert.equal(account(carol).award, null);
  assert.deepEqual(call('advance', {}, alice), receipt);
  assert.equal(call('grant_test_gold', { player: alice }).balance, 332_000);
  assert.throws(() => call('grant_test_gold', { player: 'guest.testnet' }, alice));
});

test('failed funding and an unsold voyage close once with different outcomes', () => {
  const funding = fixture();
  funding.contribute(alice, 500);
  funding.contribute(bob, 3_000);
  funding.advanceTime(20_000);
  assert.equal(funding.call('campaign').needs_advance, true);
  assert.throws(() => funding.contribute(carol, 26_500));
  assert.equal(funding.call('advance', {}, diana).status, 'refunded');
  assert.equal(funding.call('advance', {}, diana).status, 'refunded');
  assert.equal(funding.call('campaign').treasury, 0);
  assert.equal(funding.account(alice).balance, 300_000);
  assert.equal(funding.account(bob).balance, 300_000);
  assert.deepEqual([funding.account(alice).refund, funding.account(bob).refund], [500, 3_000]);

  const voyage = fixture();
  voyage.contribute(alice, 15_000);
  voyage.contribute(bob, 15_000);
  voyage.advanceTime(3_000);
  const receipt = voyage.call('advance', {}, carol);
  assert.deepEqual([receipt.status, receipt.winner, receipt.sale, receipt.net], ['unsold', null, 0, 0]);
  assert.equal(receipt.treasury, 30_000);
  assert.deepEqual(voyage.call('advance', {}, diana), receipt);
  assert.equal(voyage.account(alice).balance, 285_000);
  assert.equal(voyage.account(alice).refund, 0);
  assert.equal(voyage.account(alice).award, null);
});

test('settlement distributes every cent and breaks equal remainders by contribution order', () => {
  const { call, account, advanceTime, contribute, bid } = fixture();
  for (const player of [bob, carol, alice]) contribute(player, 10_000);
  advanceTime(2_000);
  bid(diana, 103);
  advanceTime(1_000);
  assert.equal(call('advance').net, 97);
  assert.deepEqual([account(alice).payout, account(bob).payout, account(carol).payout], [32, 33, 32]);
});
