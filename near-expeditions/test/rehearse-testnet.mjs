import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { Account, JsonRpcProvider, KeyPair } from 'near-api-js';
import { EXPEDITION_ITEM } from '../../shared/cosmetics.mjs';

const roleNames = ['SUPPORTER_A', 'SUPPORTER_B', 'BIDDER_A', 'BIDDER_B'];
const prefix = 'BARREL_EXPEDITIONS_REHEARSAL_';
const testnetAccount = /^(?:[a-z0-9]+(?:[-_.][a-z0-9]+)*\.testnet|[a-f0-9]{64})$/;
const isTestnetAccount = value => typeof value === 'string' && value.length <= 64 && testnetAccount.test(value);
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);
const terminal = new Set(['refunded', 'unsold', 'settled']);
const firstBid = 20_000;
const winningBid = 200_000;

function readConfig() {
  const { values: { execute, scenario } } = parseArgs({
    options: { execute: { type: 'boolean', default: false }, scenario: { type: 'string', default: 'settlement' } },
  });
  assert.ok(['settlement', 'refund'].includes(scenario), 'Choose --scenario=settlement or --scenario=refund.');
  const contract = process.env.BARREL_EXPEDITIONS_CONTRACT;
  const roles = roleNames.map(name => ({ name, id: process.env[prefix + name] }));
  assert.ok(isTestnetAccount(contract), 'Set BARREL_EXPEDITIONS_CONTRACT to the dedicated testnet contract account.');
  assert.notEqual(contract, process.env.BARREL_NEAR_CONTRACT, 'Use a separate account from the arena contract.');
  assert.ok(roles.every(role => isTestnetAccount(role.id)) && new Set([contract, ...roles.map(role => role.id)]).size === 5,
    'Set distinct testnet accounts with ' + roleNames.map(name => prefix + name).join(', ') + '.');
  const rpc = new URL(process.env.BARREL_EXPEDITIONS_RPC || 'https://test.rpc.fastnear.com');
  assert.ok(rpc.protocol === 'https:' || (rpc.protocol === 'http:' && loopback.has(rpc.hostname)),
    'Use HTTPS for remote NEAR RPC.');
  if (execute) {
    for (const role of roles) {
      try { role.key = KeyPair.fromString(process.env[prefix + role.name + '_KEY']); }
      catch { assert.fail('Provide a valid testnet key via ' + prefix + role.name + '_KEY.'); }
    }
  }
  return { execute, scenario, contract, roles, rpc };
}

async function rehearse({ execute, scenario, contract, roles, rpc }) {
  const provider = new JsonRpcProvider({ url: rpc.href }, { retries: 2, wait: 200, backoff: 2 });
  assert.equal((await provider.sendJsonRpc('status', [])).chain_id, 'testnet', 'The RPC must report NEAR testnet.');
  const view = (method, args = {}) => provider.callFunction({
    contractId: contract, method, args, blockQuery: { finality: 'final' },
  });
  const campaign = () => view('campaign');
  const account = role => view('account', { player: role.id });
  const [initial, wallets] = await Promise.all([campaign(), Promise.all(roles.map(account))]);
  assert.equal(initial.item_type, EXPEDITION_ITEM, 'The contract must use the Expeditions cargo.');
  assert.deepEqual([initial.status, initial.funded, initial.target, initial.contributor_count, initial.treasury, initial.needs_advance],
    ['funding', 0, 30_000, 0, 0, false], 'Use a fresh testnet voyage.');
  const [supporterA, supporterB, bidderA, bidderB] = roles;
  const pledges = [6_000, 24_000];
  const requiredGold = [...pledges, firstBid, winningBid];
  for (const [index, role] of roles.entries()) {
    role.start = wallets[index];
    assert.ok(role.start.registered && role.start.balance >= requiredGold[index],
      'Pre-fund test gold for ' + role.name + '.');
    assert.equal(role.start.contribution_nonce, 0, 'The rehearsal requires unused contribution nonces.');
  }
  const log = (event, data = {}) => console.log(JSON.stringify({ event, ...data }));
  log('preflight', { scenario, network: 'testnet', contract, campaign: initial.status,
    fundingEndsAt: initial.funding_ends_at,
    players: roles.map(role => ({ role: role.name, balance: role.start.balance })) });
  if (!execute) return;

  await Promise.all(roles.map(async role => {
    const publicKey = role.key.getPublicKey();
    role.signer = new Account(role.id, provider, role.key.toString());
    const { permission } = await role.signer.getAccessKey(publicKey);
    const method = role.name.startsWith('SUPPORTER') ? 'contribute' : 'bid';
    const limited = permission?.FunctionCall;
    const allowed = name => limited?.receiver_id === contract
      && (!limited.method_names.length || limited.method_names.includes(name));
    assert.ok(permission === 'FullAccess' || (allowed(method) && (role !== bidderB || allowed('advance'))),
      'The key cannot sign all required actions for ' + role.name + '.');
  }));

  async function write(role, methodName, args) {
    const outcome = await role.signer.callFunctionRaw({
      contractId: contract, methodName, args, gas: 100_000_000_000_000n, deposit: 0n, waitUntil: 'FINAL',
    });
    const hash = outcome.transaction?.hash;
    assert.ok(hash, 'No transaction hash returned for ' + methodName + '.');
    log('transaction', { role: role.name, method: methodName, hash });
    assert.ok(typeof outcome.status?.SuccessValue === 'string', 'The transaction failed. Inspect ' + hash + '.');
  }

  async function waitForCampaign(predicate, expectedAt) {
    const timeoutAt = Math.max(Date.now(), expectedAt) + 90_000;
    while (Date.now() < timeoutAt) {
      const current = await campaign();
      if (predicate(current)) return current;
      assert.ok(!terminal.has(current.status), 'The campaign closed as ' + current.status + '.');
      await delay(Math.max(1_000, Math.min(5_000, expectedAt - Date.now())));
    }
    assert.fail('The campaign did not reach the expected state before the deadline.');
  }

  async function closeCampaign(status, deadline) {
    const due = await waitForCampaign(current => current.status === status || current.needs_advance, deadline);
    if (due.status !== status) await write(bidderB, 'advance', {});
    else log('already-finalized', { status });
    const result = await campaign();
    assert.equal(result.status, status);
    return result;
  }

  await write(supporterA, 'contribute', { amount: pledges[0], nonce: 1 });
  const reserved = await account(supporterA);
  assert.equal(reserved.balance, supporterA.start.balance - pledges[0]);
  assert.equal(reserved.contribution, pledges[0]);
  assert.equal((await campaign()).funded, pledges[0]);

  if (scenario === 'refund') {
    const canceled = await closeCampaign('refunded', initial.funding_ends_at);
    const supporter = await account(supporterA);
    assert.equal(canceled.treasury, initial.treasury);
    assert.deepEqual([supporter.balance, supporter.refund, supporter.payout, supporter.award],
      [supporterA.start.balance, pledges[0], 0, null]);
    log('verified-refund', { returned: supporter.refund, balance: supporter.balance });
    return;
  }

  await write(supporterB, 'contribute', { amount: pledges[1], nonce: 1 });
  const funded = await campaign();
  assert.deepEqual([funded.funded, funded.contributor_count, funded.treasury], [initial.target, 2, initial.target]);
  await waitForCampaign(current => current.status === 'auction' && !current.needs_advance, funded.auction_starts_at);
  await write(bidderA, 'bid', { amount: firstBid });
  assert.equal((await account(bidderA)).balance, bidderA.start.balance - firstBid);
  assert.equal((await campaign()).highest_bidder, bidderA.id);
  await write(bidderB, 'bid', { amount: winningBid });
  assert.equal((await account(bidderA)).balance, bidderA.start.balance);
  assert.equal((await account(bidderB)).balance, bidderB.start.balance - winningBid);
  log('verified-outbid', { returned: firstBid });

  const result = await closeCampaign('settled', funded.auction_ends_at);
  const final = await Promise.all(roles.map(account));
  const fee = Math.ceil(winningBid * 5 / 100);
  const net = winningBid - fee;
  const payouts = pledges.map(amount => net * amount / initial.target);
  assert.deepEqual([result.winner, result.sale, result.fee, result.net, result.treasury],
    [bidderB.id, winningBid, fee, net, initial.target + fee]);
  assert.deepEqual(final.map(wallet => wallet.payout), [...payouts, 0, 0]);
  assert.deepEqual(final.map(wallet => wallet.award), [null, null, null, EXPEDITION_ITEM]);
  assert.deepEqual(final.map(wallet => wallet.balance),
    [supporterA.start.balance - pledges[0] + payouts[0], supporterB.start.balance - pledges[1] + payouts[1],
      bidderA.start.balance, bidderB.start.balance - winningBid]);
  log('verified-settlement', { sale: result.sale, fee: result.fee, proceeds: result.net,
    payouts: final.slice(0, 2).map(wallet => wallet.payout), award: final[3].award });
}

try {
  await rehearse(readConfig());
} catch (error) {
  const message = String(error.message).replace(/ed25519:[1-9A-HJ-NP-Za-km-z]+/g, '[key]');
  console.error(error instanceof assert.AssertionError ? message : 'Rehearsal stopped (' + error.name + '). ' + message.slice(0, 300));
  process.exitCode = 1;
}
