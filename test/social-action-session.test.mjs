import test from 'node:test';
import assert from 'node:assert/strict';
import { Account, KeyPair, createTransaction } from 'near-api-js';
import { loadNearSocialActions, SOCIAL_GOLD_LIMIT } from '../near-social-actions.mjs';

test('social sessions cover 10,000 GOLD, keep signing past 150 actions, and never replay a request', async t => {
  const key = KeyPair.fromRandom('ed25519');
  let signed = 0;
  let broadcasts = 0;
  t.mock.method(Account.prototype, 'createSignedTransaction', async function ({ receiverId, actions }) {
    return { transaction: createTransaction(this.accountId, key.getPublicKey(), receiverId,
      BigInt(++signed), actions, new Uint8Array(32)) };
  });
  const actions = loadNearSocialActions({ BARREL_NEAR_SOCIAL_SPONSOR: 'sponsor.testnet',
    BARREL_NEAR_SOCIAL_SPONSOR_KEY: key.toString() }, 'arena.testnet', {
    provider: { async sendTransactionUntil() {
      broadcasts++;
      return { status: { SuccessValue: '' }, transaction: { hash: 'confirmed-' + broadcasts } };
    } }, sponsor: {},
  });
  assert.equal(SOCIAL_GOLD_LIMIT, 10_000 * 100);
  const session = { key, remaining: SOCIAL_GOLD_LIMIT, operations: new Map(), queue: Promise.resolve() };
  for (let i = 0; i < 155; i++) await actions.submit('player.testnet', session,
    'collection_action', { action: 'equip', item: 'seat-red' }, 'equip-' + i, () => true);
  const args = { amount: 20_000, campaign_id: 7 }; // A 200 GOLD bid exceeds the former 100 GOLD ceiling.
  const first = await actions.submit('player.testnet', session, 'bid', args, 'bid-once', () => true);
  assert.equal(session.remaining, SOCIAL_GOLD_LIMIT - 20_000);
  assert.equal(await actions.submit('player.testnet', session, 'bid', args, 'bid-once', () => true), first);
  assert.equal(broadcasts, 156);
  await assert.rejects(actions.submit('player.testnet', session, 'bid', { amount: SOCIAL_GOLD_LIMIT },
    'too-large', () => true), /remaining session limit/);
  assert.equal(broadcasts, 156, 'over-budget bids are rejected before signing or broadcasting');
});
