import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Account, actions, getTransactionLastResult, JsonRpcProvider, KeyPair } from 'near-api-js';
import { GenesisAccount, Sandbox } from 'near-sandbox';
import { verifyGameClaim } from './game-bridge.mjs';

const item = 'pet-expedition-parrot';
const gas = 100_000_000_000_000n;
const testNear = 30_000_000_000_000_000_000_000_000n;
const wasm = await readFile(new URL('../target/wasm32-unknown-unknown/release/barrel_bay_expeditions.wasm', import.meta.url));

function signer(name) {
  const id = name + '.testnet';
  const key = KeyPair.fromRandom('ed25519');
  return { id, key, genesis: new GenesisAccount(id, key.getPublicKey().toString(), key.toString(), testNear) };
}

async function waitFor(read, ready, description) {
  const deadline = Date.now() + 35_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (ready(value)) return value;
    await delay(250);
  }
  throw new Error('Sandbox timed out waiting for ' + description);
}

test('signed NEAR Sandbox transactions settle the expedition, deliver the game award and refund failed funding',
  { timeout: 125_000 }, async t => {
    const [sale, refund, operator, first, second, outbid, winner] = [
      'expeditions', 'expeditions-refund', 'expeditions-operator', 'first', 'second', 'outbid', 'winner',
    ].map(signer);
    const sandbox = await Sandbox.start({ version: '2.14.0', config: {
      additionalAccounts: [sale, refund, operator, first, second, outbid, winner].map(player => player.genesis),
    } });
    t.after(() => sandbox.tearDown());
    const rpc = sandbox.rpcUrl;
    assert.equal(new URL(rpc).hostname, '127.0.0.1');
    const provider = new JsonRpcProvider({ url: rpc }, { retries: 2, wait: 200 });
    const { chain_id: chain } = await provider.sendJsonRpc('status', []);
    assert.ok(chain && !['mainnet', 'testnet'].includes(chain), 'Use a private sandbox chain');
    const account = player => new Account(player.id, provider, player.key.toString());
    const receipts = {};

    function record(result, label) {
      assert.ok(result.status?.SuccessValue !== undefined, label + ': ' + JSON.stringify(result.status));
      assert.ok(result.transaction?.hash, label + ': missing transaction hash');
      receipts[label] = result.transaction.hash;
      return getTransactionLastResult(result);
    }

    async function deploy(contract, config, label) {
      return record(await account(contract).signAndSendTransaction({
        receiverId: contract.id,
        actions: [actions.deployContract(wasm), actions.functionCall('new', {
          operator: operator.id, sailing_ms: 3_000, auction_ms: 12_000, item_type: item, ...config,
        }, gas, 0n)],
        waitUntil: 'FINAL',
      }), label);
    }

    async function call(player, contract, method, args, label) {
      return record(await account(player).callFunctionRaw({
        contractId: contract.id, methodName: method, args, gas, deposit: 0n, waitUntil: 'FINAL',
      }), label);
    }

    const view = (contract, method, args = {}) => provider.callFunction({
      contractId: contract.id, method, args, blockQuery: { finality: 'final' },
    });
    const campaign = contract => view(contract, 'campaign');
    const balance = (contract, player) => view(contract, 'account', { player: player.id });

    await deploy(sale, { funding_ms: 60_000 }, 'sale_init');
    for (const player of [first, second, outbid, winner]) {
      const granted = await call(operator, sale, 'grant_test_gold', { player: player.id }, 'grant_' + player.id);
      assert.equal(granted.balance, 300_000);
    }
    const pledge = await call(first, sale, 'contribute', { amount: 6_000, nonce: 1 }, 'first_pledge');
    assert.deepEqual([pledge.status, pledge.funded, pledge.treasury], ['funding', 6_000, 0]);
    const departure = await call(second, sale, 'contribute', { amount: 24_000, nonce: 1 }, 'second_pledge');
    assert.deepEqual([departure.status, departure.contributor_count, departure.treasury], ['sailing', 2, 30_000]);
    await waitFor(() => campaign(sale), value => value.status === 'auction', 'auction opening');
    await call(outbid, sale, 'bid', { amount: 20_000 }, 'opening_bid');
    assert.equal((await balance(sale, outbid)).balance, 280_000);
    await call(winner, sale, 'bid', { amount: 200_000 }, 'winning_bid');
    assert.equal((await balance(sale, outbid)).balance, 300_000);
    assert.equal((await balance(sale, winner)).award, null);
    await waitFor(() => campaign(sale), value => value.needs_advance, 'auction close');
    const receipt = await call(operator, sale, 'advance', {}, 'settlement');
    assert.deepEqual([receipt.status, receipt.winner, receipt.sale, receipt.fee, receipt.net, receipt.treasury],
      ['settled', winner.id, 200_000, 10_000, 190_000, 40_000]);
    const [firstResult, secondResult, winnerResult, outbidResult] = await Promise.all(
      [first, second, winner, outbid].map(player => balance(sale, player)));
    assert.deepEqual([firstResult.payout, secondResult.payout], [38_000, 152_000]);
    assert.deepEqual([winnerResult.award, winnerResult.balance, outbidResult.award, outbidResult.balance],
      [item, 100_000, null, 300_000]);
    assert.deepEqual(await call(outbid, sale, 'advance', {}, 'settlement_retry'), receipt);
    t.diagnostic('Sale receipt ' + JSON.stringify(receipts));

    await verifyGameClaim({ rpc, contract: sale.id, winner, outbid });
    t.diagnostic('Game server verified the signed winner, granted and equipped the cargo once, and rejected the outbid account.');

    await deploy(refund, { funding_ms: 14_000 }, 'refund_init');
    await call(operator, refund, 'grant_test_gold', { player: first.id }, 'refund_grant');
    await call(first, refund, 'contribute', { amount: 6_000, nonce: 1 }, 'refundable_pledge');
    assert.equal((await balance(refund, first)).balance, 294_000);
    await waitFor(() => campaign(refund), value => value.needs_advance, 'funding deadline');
    const cancelled = await call(second, refund, 'advance', {}, 'refund');
    assert.deepEqual([cancelled.status, cancelled.treasury, cancelled.sale], ['refunded', 0, 0]);
    const repaid = await balance(refund, first);
    assert.deepEqual([repaid.balance, repaid.refund, repaid.payout, repaid.award], [300_000, 6_000, 0, null]);
    assert.deepEqual(await call(first, refund, 'advance', {}, 'refund_retry'), cancelled);
    t.diagnostic('Refund receipt ' + JSON.stringify(Object.fromEntries(Object.entries(receipts)
      .filter(([label]) => label.startsWith('refund')))));
  });
