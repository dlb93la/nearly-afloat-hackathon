import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openEconomy } from '../economy.mjs';
import { certifiedRoute, createFortRun, FORT_COLUMNS, FORT_ENTRY, FORT_PRESETS, stepFortRun, trapPhase } from '../shared/live-vault.mjs';

test('all practice forts admit an oak run and the two puzzles require their mechanics', () => {
  for (const { label, map } of Object.values(FORT_PRESETS)) assert.ok(certifiedRoute(map), label);
  const { rookery, lock } = FORT_PRESETS;
  assert.equal(certifiedRoute({ ...rookery.map, pieces: rookery.map.pieces.filter(piece => piece.kind !== 'parrot') }), null);
  assert.equal(certifiedRoute({ ...lock.map, pieces: lock.map.pieces.filter(piece => piece.kind !== 'plate') }), null);
  const { map } = FORT_PRESETS.dock;
  assert.equal(certifiedRoute({ ...map, pieces: [{ cell: FORT_ENTRY - 2 * FORT_COLUMNS, kind: 'cannon' }] }), null);
});

test('the same layout keeps its route while each seed changes trap timing', () => {
  const { map } = FORT_PRESETS.dock;
  const cell = map.pieces.find(piece => piece.kind === 'cannon').cell;
  const timings = new Set();
  for (const seed of [1, 2, 3, 4]) {
    const run = createFortRun(map, 'oak', null, seed);
    assert.deepEqual(run.map, map);
    timings.add(trapPhase(1, cell, run.seed));
  }
  assert.equal(timings.size, 4);
});

test('steering an oak barrel is continuous and falling costs a heart', () => {
  const run = createFortRun(FORT_PRESETS.dock.map);
  const initial = run.player.x;
  for (let tick = 0; tick < 15; tick++) stepFortRun(run, 1 / 30, { x: 1, z: 0 });
  assert.ok(run.player.x > initial + 1 && run.player.vx > 0);
  const next = run.player.x;
  stepFortRun(run, 1 / 30, { x: 0, z: 0 });
  assert.ok(run.player.x > next);
  for (let tick = 0; tick < 120 && run.hearts === 3; tick++) stepFortRun(run, 1 / 30, { x: 0, z: 1 });
  assert.equal(run.hearts, 2);
  assert.equal(run.checkpoint, FORT_ENTRY);
});

test('live treasure is reserved and pays only once through server settlement', t => {
  const ledger = openEconomy(':memory:');
  t.after(ledger.close);
  const owner = ledger.findAccount(ledger.createAccount());
  const raider = ledger.findAccount(ledger.createAccount());
  const vault = ledger.wallet(owner).vault;
  const draft = { version: vault.version, defense: FORT_PRESETS.lock.map, gold: 700 };
  assert.throws(() => ledger.saveVault(owner, { ...draft, defense: { ...draft.defense, chest: FORT_ENTRY } }), /safe route/);
  ledger.saveVault(owner, draft);
  ledger.startRaid(raider, vault.code, true);
  const { id } = ledger.wallet(raider).raid;
  assert.equal(ledger.wallet(raider).gold, 9900);
  assert.equal(ledger.wallet(owner).vault.locked, true);
  assert.throws(() => ledger.finishRaid(raider, id, [22, 17, 12, 7, 2]), /server decides/);
  assert.equal(ledger.settleLiveRaid(raider, id, true, 1), 'won');
  assert.equal(ledger.settleLiveRaid(raider, id, true, 1), 'won');
  assert.equal(ledger.wallet(raider).gold, 10600);
  assert.equal(ledger.wallet(owner).vault.gold, 0);
  assert.equal(ledger.wallet(owner).vault.locked, false);
});
