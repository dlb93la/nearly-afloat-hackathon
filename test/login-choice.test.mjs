import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveLoginChoice } from '../shared/login-choice.mjs';

test('explicit sign-out offers a new provider instead of restoring the cached user', async () => {
  const actions = [];
  const user = await resolveLoginChoice({ user: { id: 'old-user' }, chooseAccount: true, oauthReturned: false,
    logout: async id => actions.push(['logout', id]), clearChoice: () => actions.push(['clear']) });
  assert.equal(user, null);
  assert.deepEqual(actions, [['logout', 'old-user'], ['clear']]);
});
test('fresh OAuth identity and normal session resume remain available', async () => {
  const user = { id: 'chosen-user' };
  const forbidden = () => assert.fail('Must not log out a fresh choice or normal resume');
  for (const options of [{ chooseAccount: false, oauthReturned: false }, { chooseAccount: true, oauthReturned: true }]) {
    assert.equal(await resolveLoginChoice({ user, ...options, logout: forbidden, clearChoice: forbidden }), user);
  }
});
test('failed provider logout preserves the choice request for retry', async () => {
  await assert.rejects(resolveLoginChoice({ user: { id: 'old-user' }, chooseAccount: true, oauthReturned: false,
    logout: async () => { throw new Error('Unavailable'); }, clearChoice: () => assert.fail('Must preserve retry') }));
});
