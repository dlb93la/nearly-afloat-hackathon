import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openEconomy } from '../economy.mjs';

test('opening an older ledger refunds unsettled entries once and preserves settled payouts', t => {
  const directory = mkdtempSync(join(tmpdir(), 'nearly-afloat-ledger-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'economy.sqlite');
  const economy = openEconomy(filename);
  const account = economy.findAccount(economy.createAccount());
  const initial = economy.wallet(account);
  economy.close();

  const db = new DatabaseSync(filename);
  const state = JSON.parse(db.prepare('SELECT state FROM economy WHERE id = 1').get().state);
  state.accounts[account].gold -= 200;
  state.accounts[account].activeTide = 'pending';
  state.treasury -= 300;
  state.tideRaces = {
    pending: { accountId: account, status: 'reserved' },
    settled: { accountId: account, status: 'won' },
  };
  db.prepare('UPDATE economy SET state = ? WHERE id = 1').run(JSON.stringify(state));
  db.close();

  for (let reopen = 0; reopen < 2; reopen++) {
    const migrated = openEconomy(filename);
    try {
      const wallet = migrated.wallet(account);
      assert.equal(wallet.gold, initial.gold);
      assert.equal(wallet.treasury, initial.treasury);
    } finally {
      migrated.close();
    }
  }
});

test('confirmed receipt links survive reopening without duplicating or crossing wallets', t => {
  const directory = mkdtempSync(join(tmpdir(), 'nearly-afloat-receipts-'));
  const filename = join(directory, 'economy.sqlite');
  const hash = '1'.repeat(44);
  const ledger = openEconomy(filename, () => 1_000);
  ledger.rememberNearReceipt('arena.testnet', ['alice.testnet'], hash, 'Workshop receipt');
  ledger.rememberNearReceipt('arena.testnet', ['alice.testnet'], hash, 'Workshop receipt');
  ledger.close();

  const reopened = openEconomy(filename);
  t.after(() => {
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  });
  assert.deepEqual(reopened.nearReceipts('arena.testnet', 'alice.testnet'), [
    { hash, label: 'Workshop receipt', at: 1_000 },
  ]);
  assert.deepEqual(reopened.nearReceipts('arena.testnet', 'bob.testnet'), []);
  assert.deepEqual(reopened.nearReceipts('other.testnet', 'alice.testnet'), []);
});
