import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openEconomy } from '../economy.mjs';
import { RIG_USES } from '../shared/rigs.mjs';

test('the first brawl unlocks one bound choice and immediately equips it', t => {
  const economy = openEconomy(':memory:');
  t.after(() => economy.close());
  const id = economy.findAccount(economy.createAccount());
  const initial = economy.wallet(id);
  assert.equal(initial.firstBrawl, null);
  assert.throws(() => economy.claimFirstBrawl(id, 'iron'), /Finish a quick brawl/);
  assert.equal(economy.completeFirstBrawl(id), true);
  assert.throws(() => economy.claimFirstBrawl(id, 'shield'), /Choose a starter barrel/);
  economy.claimFirstBrawl(id, 'cork');
  const wallet = economy.wallet(id);
  assert.deepEqual(wallet.firstBrawl, { status: 'claimed', rig: 'cork' });
  assert.equal(economy.rig(id), 'cork');
  assert.equal(wallet.gold, initial.gold);
  const [item] = wallet.workshop.inventory;
  assert.equal(item.uses, RIG_USES);
  assert.equal(item.starter, true);
  assert.throws(() => economy.workshopAction(id, { type: 'gear-list', id: item.id, price: 500 }), /stays with you/);
  assert.equal(economy.completeFirstBrawl(id), false);
  economy.claimFirstBrawl(id, 'cork');
  assert.throws(() => economy.claimFirstBrawl(id, 'iron'), /Finish a quick brawl/);
  assert.deepEqual(economy.wallet(id), wallet);
});

test('a pending NEAR starter remains tied to the original wallet and selection', t => {
  const economy = openEconomy(':memory:');
  t.after(() => economy.close());
  const id = economy.findAccount(economy.createAccount());
  const wallet = 'pirate.testnet';
  const contract = 'arena.testnet';
  assert.throws(() => economy.prepareNearFirstBrawl(id, wallet, 'iron', contract), /Finish a quick brawl/);
  economy.completeFirstBrawl(id);
  economy.prepareNearFirstBrawl(id, wallet, 'iron', contract);
  assert.throws(() => economy.claimFirstBrawl(id, 'iron'), /Finish a quick brawl/);
  assert.throws(() => economy.prepareNearFirstBrawl(id, wallet, 'cork', contract), /same wallet and barrel/);
  assert.throws(() => economy.completeNearFirstBrawl(id, 'another.testnet', 'iron', contract), /claim changed/);
  economy.prepareNearFirstBrawl(id, wallet, 'iron', contract);
  economy.completeNearFirstBrawl(id, wallet, 'iron', contract);
  economy.completeNearFirstBrawl(id, wallet, 'iron', contract);
  assert.equal(economy.wallet(id).firstBrawl.status, 'claimed');
  assert.equal(economy.wallet(id).workshop.inventory.length, 0);
});

test('a confirmed chain starter restores the introduction marker without granting local items or gold', t => {
  const economy = openEconomy(':memory:');
  t.after(() => economy.close());
  const id = economy.findAccount(economy.createAccount());
  const before = economy.wallet(id);
  economy.restoreNearFirstBrawl(id, 'pirate.testnet', 'iron', 'arena.testnet');
  const after = economy.wallet(id);
  assert.deepEqual(after.firstBrawl, { status: 'claimed', wallet: 'pirate.testnet', rig: 'iron', contract: 'arena.testnet' });
  assert.equal(after.gold, before.gold);
  assert.deepEqual(after.workshop.inventory, before.workshop.inventory);
  assert.equal(economy.completeFirstBrawl(id), false);
  assert.throws(() => economy.restoreNearFirstBrawl(id, 'other.testnet', 'iron', 'arena.testnet'), /another account/);
  assert.deepEqual(economy.wallet(id), after);
});
