import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTrapTrial } from '../shared/trap-lab.mjs';
import { createMatch, readMatch, stepMatch } from '../shared/simulation.mjs';
import { krakenPoint } from '../shared/arena-hazards.mjs';
import { ANCHOR_LENGTH, blockWithCrane, CRANE_REACH, stepAnchor, turnCrane } from '../shared/experimental-traps.mjs';

test('the lab repeats real single-lane impacts and keeps intensity settings within its own match', () => {
  function impact(scale) {
    const match = createTrapTrial('broadside', { scale });
    for (let i = 0; i < 250; i++) {
      stepMatch(match, 1 / 30);
      const hit = match.events.find(event => event.type === 'hazard-hit' && event.playerId === 'target-0');
      if (hit) return hit.force;
    }
    assert.fail('The controlled target was never hit');
  }
  const baseline = impact(1);
  assert.ok(baseline > 0);
  assert.equal(impact(1), baseline);
  assert.ok(Math.abs(impact(1.5) - baseline * 1.5) < .00001);
  assert.equal(createTrapTrial('broadside').hazard.lanes.length, 1);
  assert.equal(createTrapTrial('broadside', { fleet: true }).hazard.lanes.length, 3);
});

test('lab presets adjust only the selected trial timings, footprint and cargo', () => {
  const normal = createTrapTrial('broadside', { fleet: true }).hazard;
  const { hazard } = createTrapTrial('broadside', { count: 2, heading: 90, warning: 2, reach: 1.3 });
  assert.equal(hazard.lanes.length, 2);
  assert.ok(Math.abs((hazard.fireAt - hazard.warnAt) - 2 * (normal.fireAt - normal.warnAt)) < 1e-8);
  assert.ok(Math.abs(hazard.lanes[0].width - normal.lanes[0].width * 1.3) < 1e-8);
  assert.ok(hazard.lanes[0].dz > .9);
  const cargo = createTrapTrial('crate-drop', { count: 1, fuse: 4, offset: 1 });
  while (cargo.elapsed <= cargo.hazard.fireAt) stepMatch(cargo, 1 / 30);
  assert.equal(cargo.groundedCrates.length, 1);
  assert.ok(Math.abs(cargo.groundedCrates[0].blastAt - cargo.groundedCrates[0].fireAt - 4) < 1e-8);
  const crane = createTrapTrial('crate', { count: 1, approachSpeed: 0 }).placedTrap;
  assert.equal(crane.crates.length, 1);
  assert.equal(crane.crates[0].turnRate, 0);
  assert.equal(createTrapTrial('seesaw', { tilt: .13 }).placedTrap.tiltX, .13);
});

test('the kraken rises near its base, strikes the deck, then lifts its catch', () => {
  const { hazard } = createTrapTrial('kraken');
  const base = krakenPoint(hazard, hazard.warnAt, 0);
  const tip = krakenPoint(hazard, hazard.warnAt, hazard.reach * 2);
  const before = krakenPoint(hazard, hazard.fireAt - .17, hazard.reach);
  const hit = krakenPoint(hazard, hazard.fireAt, hazard.reach);
  const after = krakenPoint(hazard, hazard.strikeEnd + .18, hazard.reach);
  assert.ok(tip.y > base.y + 8);
  assert.ok(Math.hypot(tip.x - base.x, tip.z - base.z) < 2.5);
  assert.ok(Math.abs(krakenPoint(hazard, hazard.fireAt - .0001, hazard.reach).x - hit.x) < .001);
  assert.ok(before.y > hit.y + 1);
  assert.ok(Math.abs(hit.y - .62) < .00001);
  assert.ok(after.y > hit.y + 1);
});

test('a resting anchor transfers a barrel impact to the target across it', () => {
  for (const direction of [1, -1]) {
    const match = createTrapTrial('anchor');
    assert.equal(match.placedTrap.anchors.length, 5);
    assert.ok(match.placedTrap.anchors.every(anchor => anchor.vx === 0 && anchor.vz === 0));
    for (const player of match.players.slice(0, 2)) {
      player.x *= direction;
      player.vx *= direction;
    }
    while (match.elapsed < .85) stepMatch(match, 1 / 30);
    const launch = match.events.find(event => event.type === 'anchor-launch');
    const hit = match.events.find(event => event.type === 'hazard-hit');
    assert.equal(launch.playerId, 'target-0');
    assert.equal(hit.playerId, 'target-1');
    assert.equal(Math.sign(hit.nx), direction);
    assert.ok(hit.force > 0);
    assert.ok(match.players[0].alive);
    assert.ok(match.players[0].vx * direction >= 0);
  }
});

test('the anchor accumulates impulses and keeps swinging on a fixed chain as energy decays', () => {
  const { anchors: [anchor] } = createTrapTrial('anchor').placedTrap;
  const dt = 1 / 120;
  const collide = speed => stepAnchor(anchor, [{
    alive: true, x: anchor.x + anchor.dx - .85, z: 0, vx: speed, vz: 0, profile: { mass: 1 },
  }], dt, 1);
  collide(4);
  const initialSpeed = anchor.vx;
  collide(9);
  assert.ok(anchor.vx > initialSpeed);
  const energy = () => .5 * Math.hypot(anchor.vx, anchor.vy, anchor.vz) ** 2 + 16 * (anchor.dy + ANCHOR_LENGTH);
  const initialEnergy = energy();
  let reversals = 0;
  for (let i = 0; i < 1000; i++) {
    const before = anchor.vx;
    stepAnchor(anchor, [], dt, 1);
    if (before * anchor.vx < 0) reversals++;
  }
  assert.ok(reversals >= 3);
  assert.ok(energy() < initialEnergy * .2);
  assert.ok(Math.abs(Math.hypot(anchor.dx, anchor.dy, anchor.dz) - ANCHOR_LENGTH) < 1e-9);
});

test('a crate crushes underneath, shoves nearby targets and blocks until it lifts', () => {
  const center = createTrapTrial('crate');
  assert.equal(center.placedTrap.crates.length, 7);
  while (center.elapsed < 2.3) stepMatch(center, 1 / 30);
  assert.equal(center.players[0].alive, false);
  assert.equal(center.falls[0].cause, 'crushed');

  const match = createTrapTrial('crate', { offset: 2 });
  const crate = match.placedTrap.crates[0];
  const { fireAt, end } = crate;
  while (match.elapsed < fireAt + .1) stepMatch(match, 1 / 30);
  const player = match.players[0];
  const hit = match.events.find(event => event.type === 'hazard-hit' && event.playerId === player.id);
  const dropZ = crate.z;
  assert.ok(hit.force > 0 && hit.force < 4);
  assert.ok(player.alive && player.vz > 0);
  const steer = new Map([[player.id, { x: 0, z: -1 }]]);
  while (match.elapsed < end - .55) stepMatch(match, 1 / 30, steer);
  assert.ok(player.z - dropZ >= 1.14);
  while (match.elapsed < end + .25) stepMatch(match, 1 / 30, steer);
  assert.ok(player.z - dropZ < 1);
});

test('crane heads carry their loads around solid posts and hold the marked drop point', () => {
  const [crate] = createTrapTrial('crate').placedTrap.crates;
  const startX = crate.x;
  const warning = crate.fireAt - .95;
  turnCrane(crate, 0, warning);
  assert.notEqual(crate.x, startX);
  assert.ok(Math.abs(Math.hypot(crate.x - crate.postX, crate.z - crate.postZ) - CRANE_REACH) < 1e-9);
  const dropX = crate.x;
  turnCrane(crate, warning, crate.end);
  assert.equal(crate.x, dropX);
  turnCrane(crate, crate.end, crate.end + .3);
  assert.notEqual(crate.x, dropX);

  const player = { x: crate.postX + .4, z: crate.postZ, vx: -5, vz: 2 };
  blockWithCrane(crate, player);
  assert.ok(player.x > crate.postX + .8);
  assert.equal(player.vx, 0);
  assert.equal(player.vz, 2);
});

test('loading one side increases the seesaw tilt and rolls the riders downhill', () => {
  const balanced = createTrapTrial('seesaw');
  const loaded = createTrapTrial('seesaw', { multiple: true });
  for (let i = 0; i < 30; i++) {
    stepMatch(balanced, 1 / 30);
    stepMatch(loaded, 1 / 30);
  }
  assert.ok(loaded.placedTrap.tiltX > balanced.placedTrap.tiltX + .1);
  assert.ok(loaded.placedTrap.tiltZ > .1);
  assert.ok(loaded.players[0].x > 3.4 && loaded.players[0].z > 2.3);
});

test('the seesaw is the only round installation and keeps rocking without being replaced', () => {
  const roster = [{ id: 'a', slot: 0 }, { id: 'b', slot: 1 }];
  const rounds = new Map();
  for (let seed = 0; seed < 100 && rounds.size < 2; seed++) {
    const match = createMatch(roster, seed);
    const kind = match.placedTrap?.kind ?? null;
    if (!rounds.has(kind)) rounds.set(kind, match);
  }
  assert.deepEqual(new Set(rounds.keys()), new Set([null, 'seesaw']));
  for (const [kind, match] of rounds) {
    assert.equal(readMatch(match).phase, 'countdown');
    assert.equal(readMatch(match).placedTrap?.kind ?? null, kind);
    const installation = match.placedTrap;
    match.hazardPlan = [];
    const tilts = [];
    for (let tick = 0; tick < 210; tick++) {
      Object.assign(match.players[0], { x: -2.9, z: -2, vx: 0, vz: 0 });
      Object.assign(match.players[1], { x: 2.9, z: 2, vx: 0, vz: 0 });
      stepMatch(match, 1 / 30);
      if (installation && match.phase === 'playing') tilts.push(installation.tiltX);
    }
    assert.equal(match.placedTrap, installation);
    if (kind) {
      assert.equal(installation.fireAt, 0);
      assert.ok(tilts[0] > .03);
      assert.ok(tilts.length > 30);
      assert.ok(Math.max(...tilts) > .02 && Math.min(...tilts) < -.02);
      match.elapsed = 32;
      const before = installation.tiltZ;
      stepMatch(match, 1 / 30);
      assert.notEqual(installation.tiltZ, before);
    }
  }
});
