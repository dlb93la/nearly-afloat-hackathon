import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { Account, KeyPair } from 'near-api-js';
import { signMessage } from 'near-api-js/nep413';
import { loadNearExpeditions } from '../near-expeditions.mjs';
import { EXPEDITION_ITEM } from '../shared/cosmetics.mjs';

test('NEAR Expeditions verifies wallet proof and maps final cargo entitlement', async t => {
  const contract = 'expeditions.testnet';
  const winner = 'collector.testnet';
  const key = KeyPair.fromRandom('ed25519');
  const campaign = {
    status: 'auction', target: 30_000, funded: 30_000, contributor_count: 2, min_supporters: 2,
    item_type: EXPEDITION_ITEM, funding_ends_at: 1_000, sails_at: 900, auction_starts_at: 2_000,
    auction_ends_at: 3_000, highest_bid: 20_000, highest_bidder: winner, minimum_bid: 20_100,
    winner: null, sale: 0, fee: 0, net: 0, needs_advance: false,
  };
  const player = {
    registered: true, balance: 79_000, contribution_nonce: 1, contribution: 1_000,
    payout: 0, refund: 0, min_contribution: 0, max_contribution: 0, award: null,
  };
  const rpc = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const { id, method, params } = JSON.parse(body);
    let result;
    if (method === 'query' && params.request_type === 'view_access_key'
        && params.account_id === winner && params.public_key === key.getPublicKey().toString()) {
      result = { nonce: 1, permission: 'FullAccess' };
    } else if (method === 'query' && params.request_type === 'call_function'
        && params.account_id === contract && params.finality === 'final') {
      const args = JSON.parse(Buffer.from(params.args_base64, 'base64').toString());
      const value = params.method_name === 'campaign' ? campaign
        : params.method_name === 'account' && args.player === winner ? player : null;
      if (value) result = { result: [...Buffer.from(JSON.stringify(value))], logs: [] };
    }
    const outcome = result ? { result } : { error: { code: -32602, message: 'Unexpected fixture query' } };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id, ...outcome }));
  });
  rpc.listen(0, '127.0.0.1');
  await once(rpc, 'listening');
  t.after(() => new Promise(resolve => rpc.close(resolve)));
  const rpcUrl = 'http://127.0.0.1:' + rpc.address().port;
  const bridge = loadNearExpeditions({ BARREL_EXPEDITIONS_CONTRACT: contract, BARREL_EXPEDITIONS_RPC: rpcUrl });
  assert.equal(bridge.contract, contract);

  const proof = bridge.challenge(winner);
  const signed = await signMessage({
    signerAccount: new Account(winner, rpcUrl, key.toString()),
    payload: { message: proof.message, recipient: proof.recipient, nonce: Buffer.from(proof.nonce, 'hex') },
  });
  const walletReply = { accountId: signed.accountId, publicKey: signed.publicKey.toString(),
    signature: Buffer.from(signed.signature).toString('base64') };
  assert.equal(await bridge.authenticate(proof, walletReply), winner);
  await assert.rejects(bridge.authenticate(bridge.challenge(winner), walletReply), /signature could not be verified/);
  await assert.rejects(bridge.authenticate({ ...proof, expiresAt: 0 }, walletReply), /Connect your NEAR testnet wallet again/);

  const live = await bridge.read(winner);
  assert.equal(live.account, winner);
  assert.equal(live.gold, 79_000);
  assert.equal(live.nonce, 1);
  assert.equal(live.registered, true);
  assert.equal(live.campaign.arrivalAt, 2_000);
  assert.equal(live.campaign.highestBid, 20_000);
  assert.equal(live.campaign.nextBid, 20_100);
  assert.equal(live.campaign.isHighestBidder, true);
  assert.equal(live.campaign.won, false);
  assert.equal(live.campaign.sale, null);

  campaign.winner = winner;
  player.award = EXPEDITION_ITEM;
  assert.equal((await bridge.read(winner)).campaign.won, false);
  Object.assign(campaign, { status: 'settled', sale: 20_000, fee: 1_000, net: 19_000 });
  player.award = 'pet-crab-0';
  assert.equal((await bridge.read(winner)).campaign.won, false);
  player.award = EXPEDITION_ITEM;
  player.payout = 633;
  // A finalized transaction explicitly bypasses the short public campaign cache.
  const settled = await bridge.read(winner, { fresh: true });
  assert.equal(settled.campaign.won, true);
  assert.equal(settled.campaign.myPayout, 633);
  assert.deepEqual(settled.campaign.sale, { price: 20_000, fee: 1_000, distributed: 19_000 });
  assert.equal((await bridge.read(null)).campaign.won, false);
});
