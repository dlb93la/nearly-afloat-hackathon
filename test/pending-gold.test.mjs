import assert from 'node:assert/strict';
import test from 'node:test';
import { availableGold, goldActionPending, holdGold } from '../src/pending-gold.js';

test('a pending expense reduces available GOLD once across the shop, wallet and voyage', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = new EventTarget();
  try {
    assert.equal(holdGold('pirate', 1000, 2000), null);
    const release = holdGold('pirate', 8000, 2000);
    assert.equal(goldActionPending(), true);
    assert.equal(availableGold('pirate', 8000), 6000);
    assert.equal(availableGold('pirate', 6000), 6000, 'final balance is never debited twice');
    assert.equal(availableGold('pirate', 5500), 5500, 'respect a lower balance from the chain');
    assert.equal(availableGold('another-pirate', 8000), 8000);
    assert.equal(holdGold('pirate', 6000, 1000), null, 'another menu waits for the current transaction');
    release();
    assert.equal(goldActionPending(), false);
    assert.equal(availableGold('pirate', 8000), 8000, 'a rejection releases the hold');
  } finally {
    await Promise.resolve();
    globalThis.window = originalWindow;
  }
});
