import test from 'node:test';
import assert from 'node:assert/strict';
import { NearSocialActionError, requiresGameSessionRenewal, setNearSocialAccount, signNearWorkshop } from '../src/near-wallet.js';

test('renewal is offered only for explicit rejected session actions, never ambiguous failures', () => {
  for (const message of ['Sign in again to authorize your game session.', 'Sign in again to continue.',
    'Sign in again to renew your game session.', 'This exceeds your remaining session limit.']) {
    assert.equal(requiresGameSessionRenewal(new NearSocialActionError(message)), true);
    assert.equal(requiresGameSessionRenewal(new Error(message)), false);
  }
  assert.equal(requiresGameSessionRenewal(new DOMException('Response timed out', 'TimeoutError')), false);
  assert.equal(requiresGameSessionRenewal(new NearSocialActionError('Could not submit the game action.')), false);
});

test('a rejected purchase exposes renewal without replaying the financial request', async t => {
  const account = 'e'.repeat(64);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return Response.json({ message: 'Sign in again to continue.' }, { status: 400 });
  });
  setNearSocialAccount(account, 'arena.testnet', true);
  t.after(() => setNearSocialAccount(null));
  await assert.rejects(signNearWorkshop('arena.testnet', account, { action: 'buy', rig: 'cork', expected_price: 620 }), error => {
    assert.equal(requiresGameSessionRenewal(error), true);
    return true;
  });
  assert.equal(requests, 1);
});
