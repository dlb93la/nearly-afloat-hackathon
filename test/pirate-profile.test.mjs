import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEconomy } from '../economy.mjs';

test('pirate identity survives a server restart and stays attached to the signed-in account', () => {
  const directory = mkdtempSync(join(tmpdir(), 'afloat-profile-'));
  const path = join(directory, 'profiles.sqlite');
  let economy = openEconomy(path);
  try {
    const original = economy.pirateProfile('first.testnet');
    assert.equal(original.named, false);
    assert.ok(original.name.length <= 20);
    assert.deepEqual(economy.pirateProfile('first.testnet'), original);
    assert.equal(economy.pirateProfile('first.testnet', '  Captain   Pearl  ').name, 'Captain Pearl');
    const other = economy.pirateProfile('second.testnet');
    assert.equal(economy.pirateProfile('second.testnet', '').name, other.name);
    economy.rememberPirateMatch('first.testnet');
    economy.rememberPirateMatch('first.testnet');
    economy.close();
    economy = openEconomy(path);
    assert.deepEqual(economy.pirateProfile('first.testnet'), { name: 'Captain Pearl', named: true });
    assert.equal(economy.pirateProfile('second.testnet').named, true);
    assert.equal(economy.pirateProfile('second.testnet').name, other.name);
    assert.equal(economy.hasPirateMatch('first.testnet'), true);
    assert.equal(economy.hasPirateMatch('second.testnet'), false);
    const profile = economy.findAccount(economy.createAccount());
    economy.completeFirstBrawl(profile);
    economy.useStarterAccount(profile, 'first.testnet');
    assert.equal(economy.wallet(profile).firstBrawl.status, 'ready');
    economy.useStarterAccount(profile, 'second.testnet');
    assert.equal(economy.wallet(profile).firstBrawl, null, 'a second login does not inherit another account’s pending starter');
    economy.completeFirstBrawl(profile);
    assert.equal(economy.wallet(profile).firstBrawl.status, 'ready');
  } finally {
    economy.close();
    rmSync(directory, { recursive: true });
  }
});
