import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openEconomy } from '../economy.mjs';

test('a backup code restores the same inventory once without overwriting an existing profile', t => {
  const economy = openEconomy(':memory:');
  t.after(() => economy.close());
  const token = economy.createAccount();
  const owner = economy.findAccount(token);
  const fresh = economy.findAccount(economy.createAccount());
  const occupied = economy.findAccount(economy.createAccount());
  economy.completeFirstBrawl(owner);
  economy.claimFirstBrawl(owner, 'iron');
  economy.completeFirstBrawl(occupied);

  const superseded = economy.issueProgressCode(owner);
  const code = economy.issueProgressCode(owner);
  assert.throws(() => economy.restoreProgress(superseded, fresh), /invalid or has already been used/);
  assert.throws(() => economy.restoreProgress(code, occupied), /fresh browser profile/);
  const restoredToken = economy.restoreProgress(code, fresh);
  assert.notEqual(restoredToken, token);
  assert.equal(economy.findAccount(restoredToken), owner);
  assert.equal(economy.findAccount(token), owner);
  assert.equal(economy.wallet(owner).rig, 'iron');
  assert.equal(economy.wallet(owner).workshop.inventory.length, 1);
  assert.throws(() => economy.restoreProgress(code, fresh), /invalid or has already been used/);
});
