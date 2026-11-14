import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDrill, createMatch, MAX_PLAYERS, readMatch, stepMatch, TICK_RATE } from '../shared/simulation.mjs';
import { ARENA_TILE, POWDER_REACH, arenaHazardCue, hazardTiming, holeMargin, holeCoversTile, hazardPush, hazardPosition,
  krakenCatches, krakenPoint, placeArenaHazard, rollingExitAt } from '../shared/arena-hazards.mjs';
import { ARENA_MAPS } from '../shared/arena-maps.mjs';
import { bayDarkness } from '../shared/world-lighting.mjs';

const step = 1 / TICK_RATE;

test('automatic lighting cycles in the bay and is fixed for every client in a round', () => {
  const cycle = 8 * 60 * 1000;
  assert.equal(bayDarkness(0), 0);
  assert.ok(Math.abs(bayDarkness(cycle / 4) - .5) < 1e-8);
  assert.equal(bayDarkness(cycle / 2), 1);
  assert.equal(bayDarkness(cycle), 0);
  const roster = [{ id: 'one', slot: 0 }, { id: 'two', slot: 1 }];
  const rounds = Array.from({ length: 40 }, (_, i) => createMatch(roster, i));
  assert.ok(rounds.some(round => round.night) && rounds.some(round => !round.night));
  const night = rounds.find(round => round.night);
  assert.equal(readMatch(night).night, true);
  night.phase = 'playing';
  night.elapsed = 10.35;
  night.hazardPlan = [];
  stepMatch(night, step);
  assert.ok(night.radius + .24 < Math.hypot(8, 3) * ARENA_TILE);
  assert.ok(night.radius > Math.hypot(4, 1) * ARENA_TILE);
  assert.equal(readMatch(night).night, true);
});

test('the tide adds gradual pressure as competitors fall and preserves the opening', () => {
  const roster = Array.from({ length: MAX_PLAYERS }, (_, slot) => ({ id: 'p' + slot, slot }));
  const rounds = [8, 5, 2, 2].map((alive, index) => {
    const match = createMatch(roster, 'pressure');
    match.phase = 'playing';
    match.placedTrap = null;
    match.hazardPlan = [];
    if (index === 3) match.adaptiveTide = false;
    match.players.forEach((player, slot) => {
      player.alive = slot < alive;
      player.x *= .43;
      player.z *= .43;
    });
    return match;
  });
  for (let tick = 0; tick < 24 * TICK_RATE; tick++) {
    for (const round of rounds) {
      const previousRadius = round.radius;
      stepMatch(round, step);
      assert.ok(round.radius <= previousRadius);
      assert.ok(previousRadius - round.radius < .025);
    }
    if (tick < 10 * TICK_RATE) assert.ok(rounds.every(round => round.radius === rounds[0].radius));
  }
  const [full, five, duel, fixed] = rounds;
  assert.equal(full.radius, fixed.radius);
  assert.ok(full.radius - five.radius >= .49);
  assert.ok(five.radius - duel.radius >= 1.49);
  assert.equal(createMatch(roster, 'pressure', null, { inaugural: true }).adaptiveTide, false);
});

function impact(rig) {
  const drill = createDrill([{ id: 'player', slot: 0, rig }, { id: 'target', slot: 1 }], 'head-on');
  for (let i = 0; i < 90 && !drill.drill.done; i++) stepMatch(drill, step);
  return readMatch(drill).drill.impact;
}

test('iron sends the oak target farther while taking less recoil', () => {
  const oak = impact('oak');
  const iron = impact('iron');
  assert.ok(iron.ownRecoil < oak.ownRecoil);
  assert.ok(iron.dummyRecoil > oak.dummyRecoil);
  assert.ok(iron.ownRecoil > 0);
});

test('final tide always leaves exactly one winner with mixed equipment', () => {
  const roster = Array.from({ length: MAX_PLAYERS }, (_, slot) => ({
    id: 'test-' + slot,
    slot,
    bot: true,
    rig: ['oak', 'iron', 'cork'][slot % 3],
  }));
  for (let seed = 1; seed <= 24; seed++) {
    const match = createMatch(roster, seed);
    for (let tick = 0; tick < 57 * TICK_RATE && match.phase !== 'results'; tick++) stepMatch(match, step);
    const result = readMatch(match);
    assert.equal(result.phase, 'results');
    assert.deepEqual(result.players.filter(player => player.alive).map(player => player.id), [result.winnerId]);
    assert.equal(result.players.find(player => player.rank === 1).id, result.winnerId);
  }
});

const twoBarrels = [{ id: 'player', slot: 0 }, { id: 'rival', slot: 1 }];

test('round plans vary and reserve separate time windows for each warning and hazard', () => {
  const sequences = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    const match = createMatch(twoBarrels, seed);
    const replay = createMatch(twoBarrels, seed, match);
    if (match.hazardPlan.length) assert.notEqual(replay.hazardPlan[0].kind, match.hazardPlan[0].kind);
    else assert.equal(match.placedTrap?.kind, 'seesaw');
    assert.notEqual(replay.tideSchedule, match.tideSchedule);
    assert.deepEqual(createMatch(twoBarrels, seed).hazardPlan, match.hazardPlan);
    sequences.add(match.hazardPlan.map(card => card.kind).join('/'));
    let last = 0;
    for (const card of match.hazardPlan) {
      assert.ok(card.start > last);
      assert.ok(card.warnAt > card.start && card.fireAt - card.warnAt >= .8 && card.fireAt - card.warnAt <= 1.1);
      assert.ok(card.exit < 42);
      assert.equal(arenaHazardCue(card, card.start), null);
      assert.ok(arenaHazardCue(card, card.warnAt));
      assert.equal(arenaHazardCue(card, card.end), null);
      last = card.exit;
    }
  }
  assert.ok(sequences.size >= 6);
});

test('broadside and flock leave a dodge window and only affect their sweep lane', () => {
  const lane = { x: 0, z: 0, dx: 1, dz: 0, width: .78, reach: 10, fireAt: 6, end: 7 };
  for (const kind of ['broadside', 'parrots']) {
    const hazard = { ...lane, kind };
    assert.equal(hazardPush(hazard, 5.99, 5.95, { x: 0, z: 0 }), null);
    assert.equal(hazardPush(hazard, 6.52, 6.48, { x: 0, z: 1.6 }), null);
    assert.ok(hazardPush(hazard, 6.52, 6.48, { x: 0, z: .4 }).x > 0);
  }
});

test('fleets and flocks cross from three separated directions with individual warnings', () => {
  for (const kind of ['broadside', 'parrots']) {
    const hazard = placeArenaHazard({ kind, start: 2, warnAt: 4, fireAt: 5 }, 8, () => .5);
    const [first, second, third] = hazard.lanes;
    assert.equal(hazard.lanes.length, 3);
    for (const [a, b] of [[first, second], [second, third], [third, first]]) {
      assert.ok(a.dx * b.dx + a.dz * b.dz < -.25);
    }
    assert.ok(second.fireAt - first.fireAt >= .5 && third.fireAt - second.fireAt >= .5);
    for (const lane of hazard.lanes) {
      assert.equal(lane.fireAt - lane.warnAt, 1);
      const passing = (lane.fireAt + lane.end) / 2;
      assert.ok(hazardPush(lane, passing + .02, passing - .02, { x: 0, z: 0 }));
    }
  }
});

test('each salvo can hit the same barrel once, even across multiple lanes', () => {
  const match = createMatch(twoBarrels, 1, null, { inaugural: true });
  match.phase = 'playing';
  match.hazardPlan = [];
  const plan = { kind: 'broadside', start: 0, warnAt: .1, fireAt: .2, end: 2.64, exit: 5.74 };
  match.hazard = placeArenaHazard(plan, 9, () => .5);
  const barrel = match.players[0];
  const hitIds = new Set();
  for (let tick = 0; tick < 85; tick++) {
    Object.assign(barrel, { x: 0, z: 0, vx: 0, vz: 0 });
    Object.assign(match.players[1], { x: 6, z: 4, vx: 0, vz: 0 });
    stepMatch(match, step);
    for (const event of match.events) {
      if (event.type === 'hazard-hit' && event.playerId === barrel.id) hitIds.add(event.id);
    }
  }
  assert.equal(match.hazardStruck.size, 3);
  assert.ok(match.hazard.lanes.every(lane => match.hazardStruck.has(lane.slot + '/player')));
  assert.equal(hitIds.size, 3);
});

test('rematches visit all three maps before reshuffling and never repeat the last map', () => {
  let previous;
  for (let rotation = 0; rotation < 4; rotation++) {
    const visited = new Set();
    for (const _ of Object.keys(ARENA_MAPS)) {
      const match = createMatch(twoBarrels, rotation, previous);
      const { arenaMap } = readMatch(match);
      assert.notEqual(arenaMap, previous?.arenaMap);
      visited.add(arenaMap);
      previous = match;
    }
    assert.deepEqual([...visited].sort(), Object.keys(ARENA_MAPS).sort());
  }
});

test('direct hits from cannons and parrots shove but allow recovery from mid-deck', () => {
  for (const kind of ['broadside', 'parrots']) {
    const match = createMatch(twoBarrels);
    match.phase = 'playing';
    match.hazardPlan = [];
    match.hazard = { kind, x: 0, z: 0, dx: 1, dz: 0, reach: 10, width: .78, fireAt: .05, end: .83 };
    Object.assign(match.players[0], { x: .24, z: 0 });
    Object.assign(match.players[1], { x: -5, z: 4 });
    let hit;
    for (let tick = 0; tick < 30 && !hit; tick++) {
      stepMatch(match, step);
      hit = match.events.find(event => event.type === 'hazard-hit');
    }
    assert.equal(hit?.playerId, 'player');
    const player = match.players[0];
    assert.ok(Math.hypot(player.vx, player.vz) > 7 && Math.hypot(player.vx, player.vz) < 12);
    const inputs = new Map([['player', { x: -hit.nx, z: -hit.nz }]]);
    for (let tick = 0; tick < 26; tick++) stepMatch(match, step, inputs);
    assert.ok(player.alive && player.vx * hit.nx + player.vz * hit.nz < 0);
    assert.equal(match.falls.length, 0);
  }
});

test('powder opens one tile immediately and randomly damages other boards within four by four', () => {
  const match = createMatch(twoBarrels);
  const powder = { ...placeArenaHazard(hazardTiming('powder', 0), 9, () => .5), x: 0, z: 0 };
  Object.assign(match, { phase: 'playing', hazardPlan: [], placedTrap: null, hazard: powder, elapsed: powder.fireAt - step / 2 });
  const [inner, outer] = match.players;
  Object.assign(inner, { x: .2, z: .2 });
  Object.assign(outer, { x: -POWDER_REACH + .1, z: 0 });
  stepMatch(match, step);
  assert.ok(inner.powderHop && Math.hypot(inner.powderHop.x - inner.x, inner.powderHop.z - inner.z) > 2);
  const [impact, ...damaged] = match.holes;
  assert.equal(impact.fireAt, powder.fireAt);
  assert.equal(holeCoversTile(impact, 0, 0), true);
  assert.equal(holeCoversTile(impact, ARENA_TILE, 0), false);
  assert.ok(damaged.length >= 4 && damaged.length <= 7);
  assert.ok(damaged.every(tile => tile.fireAt > match.elapsed && holeMargin(tile, tile.x, tile.z, match.elapsed) === Infinity));
  for (const axis of ['x', 'z']) {
    const coords = match.holes.map(tile => tile[axis]);
    assert.ok(Math.max(...coords) - Math.min(...coords) <= 3 * ARENA_TILE + 1e-8);
  }
  assert.ok(outer.vx < -3 && outer.vx > -4);
  for (let i = 0; i < 18; i++) stepMatch(match, step);
  assert.equal(inner.powderHop, null);
  assert.ok(inner.alive && outer.alive);
  assert.ok(match.holes.every(tile => holeMargin(tile, inner.x, inner.z, Infinity) > 0));
  assert.equal(holeMargin(damaged[0], damaged[0].x, damaged[0].z, damaged[0].fireAt), -ARENA_TILE / 2);
});

test('rolling cargo stops striking after its trajectory reaches the deck edge', () => {
  const lane = placeArenaHazard(hazardTiming('barrel-roll', 0), 9, () => .45).lanes[0];
  lane.fallAt = rollingExitAt(lane, 9);
  const edge = hazardPosition(lane, lane.fallAt);
  assert.ok(Math.abs(Math.hypot(edge.x, edge.z) - 9) < 1e-8);
  assert.ok(lane.fallAt < lane.end);
  assert.equal(hazardPush(lane, lane.fallAt + .04, lane.fallAt + .02, edge), null);
});

test('a central hole can eliminate barrels while keeping one winner on simultaneous falls', () => {
  const match = createMatch(twoBarrels);
  match.phase = 'playing';
  match.hazardPlan = [];
  match.hazard = { kind: 'collapse', x: 0, z: 0, width: 1.43, fireAt: .05, end: 3 };
  match.players[0].x = -.67;
  match.players[1].x = .67;
  match.players[0].z = match.players[1].z = 0;
  stepMatch(match, step);
  assert.ok(match.players.every(player => player.alive));
  stepMatch(match, step);
  assert.equal(match.phase, 'results');
  assert.equal(match.players.filter(player => player.alive).length, 1);
  assert.equal(match.falls[0].hazard, 'collapse');
});

test('shuffled drills pick a different trial and keep the dock free of hazards', () => {
  const first = createDrill(twoBarrels, 'shuffle', 17);
  const second = createDrill(twoBarrels, 'shuffle', 17, first.drill.trial);
  assert.notEqual(second.drill.trial, first.drill.trial);
  for (let tick = 0; tick < 160; tick++) stepMatch(second, step);
  assert.equal(readMatch(second).hazard, null);
  assert.equal(readMatch(second).arenaMap, 'harbor');
  assert.equal(second.radius, 9);
});

test('a collapsed section remains unsafe after the warning sequence ends', () => {
  const match = createMatch(twoBarrels);
  match.phase = 'playing';
  match.hazardPlan = [];
  match.hazard = { kind: 'collapse', x: 3.12, z: 0, width: .92, fireAt: .05, end: .4, exit: .4 };
  for (let i = 0; i < 20; i++) stepMatch(match, step);
  assert.equal(match.hazard, null);
  assert.equal(readMatch(match).holes.length, 1);
  Object.assign(match.players[0], { x: 3.12, z: 0, vx: 0, vz: 0 });
  stepMatch(match, step);
  assert.equal(match.winnerId, 'rival');
  assert.equal(match.falls[0].hazard, 'collapse');
});

function krakenMatch(positions) {
  const match = createMatch(positions.map((_, slot) => ({ id: 'crew-' + slot, slot })));
  match.phase = 'playing';
  match.hazardPlan = [];
  const rolls = [0, .5];
  match.hazard = placeArenaHazard({ kind: 'kraken', start: 0, warnAt: .1, fireAt: .2, end: .98, exit: 1.46 }, 9,
    () => rolls.shift());
  for (const [index, [x, z]] of positions.entries()) Object.assign(match.players[index], { x, z });
  return match;
}

test('the kraken slams the entire lane, lifts its passengers and carries them out', () => {
  const match = krakenMatch([[-5, -.3], [.5, .4], [5, -.15], [0, 1.75]]);
  for (let tick = 0; tick < 6; tick++) stepMatch(match, step);
  assert.ok(match.players.every(player => !player.grab));
  while (match.elapsed < match.hazard.strikeEnd) stepMatch(match, step);
  const caught = readMatch(match).players.filter(player => player.grab);
  assert.deepEqual(caught.map(player => player.id), ['crew-0', 'crew-1', 'crew-2']);
  assert.equal(new Set(caught.map(player => player.grab.at)).size, 1);
  const steerAway = new Map(caught.map(player => [player.id, { x: 1, z: 1 }]));
  stepMatch(match, .1, steerAway);
  for (const player of match.players.filter(player => player.grab)) {
    const pose = krakenPoint(match.hazard, match.elapsed, player.grab.along, player.grab.cross);
    assert.ok(pose.y > .62);
    assert.ok(Math.abs(player.x - pose.x) < .00001 && Math.abs(player.z - pose.z) < .00001);
  }
  for (let tick = 0; tick < 45; tick++) stepMatch(match, step, steerAway);
  assert.equal(match.winnerId, 'crew-3');
  assert.equal(match.falls.length, 3);
  assert.deepEqual(match.falls.map(fall => fall.playerId).sort(), caught.map(player => player.id).sort());
  for (const fall of match.falls) {
    assert.equal(fall.hazard, 'kraken');
    assert.ok(fall.x < -9);
  }
});

test('crossing the laid arm before it lifts is a hit even when its tip has passed', () => {
  const { hazard } = krakenMatch([[-2, 0], [3, 0]]);
  const time = hazard.strikeEnd - .02;
  assert.ok(krakenCatches(hazard, time, time - .01, { x: -4, z: .3 }));
  assert.equal(krakenCatches(hazard, time, time - .01, { x: -4, z: 1.8 }), false);
  assert.equal(krakenCatches(hazard, hazard.end, hazard.end - .01, { x: -4, z: 0 }), false);
});

test('a sweep catching the entire remaining field still yields exactly one winner', () => {
  const match = krakenMatch([[-2, 0], [3, 0]]);
  for (let tick = 0; tick < 50; tick++) stepMatch(match, step);
  assert.equal(match.hazardStruck.size, 2);
  assert.ok(match.winnerId);
  assert.equal(match.players.find(player => player.id === match.winnerId).grab, null);
  assert.deepEqual(match.players.filter(player => player.alive).map(player => player.rank), [1]);
});

test('inaugural practice drops anchors to open holes and normal seesaws get incoming cargo', () => {
  const roster = [{ id: 'new', slot: 0 }, { id: 'bot', slot: 1, bot: true }];
  const opening = createMatch(roster, 20, null, { inaugural: true });
  assert.equal(readMatch(opening).inaugural, true);
  assert.equal(opening.placedTrap, null);
  assert.equal(opening.arenaMap, 'harbor');
  assert.deepEqual(opening.hazardPlan.map(hazard => hazard.kind), ['anchor-drop', 'anchor-drop']);
  const seesaw = Array.from({ length: 40 }, (_, seed) => createMatch(roster, seed))
    .find(match => match.placedTrap?.kind === 'seesaw');
  assert.ok(seesaw);
  assert.equal(seesaw.placedTrap.anchors, undefined);
  assert.equal(seesaw.placedTrap.crates, undefined);
  assert.deepEqual(seesaw.hazardPlan.map(hazard => hazard.kind).sort(), ['anchor-drop', 'crate-drop']);
});

test('cargo impacts open anchor holes, arm mini powder barrels and sweep along the rolling lane', () => {
  const anchor = placeArenaHazard(hazardTiming('anchor-drop', 2), 8, () => .25);
  assert.equal(holeMargin(anchor, anchor.x, anchor.z, anchor.fireAt - .02), Infinity);
  assert.ok(holeMargin(anchor, anchor.x, anchor.z, anchor.fireAt) < 0);
  const rollers = placeArenaHazard(hazardTiming('barrel-roll', 2), 8, () => .25);
  assert.equal(rollers.lanes.length, 3);
  const lane = rollers.lanes[1];
  const centerCrossing = lane.fireAt + (lane.end - lane.fireAt) * lane.startReach / (lane.reach + lane.startReach);
  const push = hazardPush(lane, centerCrossing + .03, centerCrossing - .03, { x: lane.x, z: lane.z });
  assert.ok(push && push.x * lane.dx + push.z * lane.dz > 10);

  const drops = placeArenaHazard(hazardTiming('crate-drop', 2), 8, () => .25).drops;
  assert.equal(drops.length, 4);
  assert.equal(new Set(drops.map(drop => Math.atan2(drop.dz, drop.dx).toFixed(2))).size, 4);
  assert.equal(new Set(drops.map(drop => drop.x.toFixed(2) + '/' + drop.z.toFixed(2))).size, 4);

  const match = createMatch([{ id: 'under', slot: 0 }, { id: 'outside', slot: 1 }, { id: 'far', slot: 2 }], 7);
  const drop = { ...hazardTiming('crate-drop', 0), x: 0, z: 0, width: .71 };
  Object.assign(match, { phase: 'playing', elapsed: drop.fireAt - step / 2,
    hazard: drop, hazardPlan: [], placedTrap: null });
  Object.assign(match.players[0], { x: 0, z: 0 });
  Object.assign(match.players[1], { x: 3.5, z: 0 });
  Object.assign(match.players[2], { x: -3, z: 0 });
  stepMatch(match, step);
  assert.ok(match.players.every(player => player.alive));
  assert.equal(match.groundedCrates.length, 1);
  const directHit = match.players[0];
  assert.ok(match.events.some(event => event.type === 'hazard-hit' && event.playerId === directHit.id
    && event.kind === 'crate-drop' && event.force > 5));
  for (let i = 0; i < 18; i++) stepMatch(match, step);
  assert.ok(directHit.alive && !directHit.powderHop);
  assert.ok(Math.hypot(directHit.x, directHit.z) > 1.2);
  const barrel = match.groundedCrates[0];
  assert.equal(barrel.blastAt - drop.fireAt, 2);
  match.elapsed = barrel.blastAt - .06;
  Object.assign(match.players[0], { x: -1.15, z: 0, vx: 0, vz: 0 });
  Object.assign(match.players[1], { x: 1.82, z: 0, vx: 0, vz: 0 });
  Object.assign(match.players[2], { x: -4.5, z: 0, vx: 0, vz: 0 });
  stepMatch(match, step);
  assert.equal(match.holes.length, 0);
  stepMatch(match, step);
  assert.equal(match.hazard, null);
  assert.equal(barrel.exploded, true);
  assert.equal(match.holes.length, 1);
  assert.equal(holeCoversTile(match.holes[0], ARENA_TILE, 0), false);
  assert.ok(match.players[1].vx > 2.5 && match.players[1].vx < 4);
  assert.ok(match.players[0].vx < -4);
  assert.equal(match.players[2].vx, 0);
});

test('opponents facing a grounded crate steer around it instead of staying pinned', () => {
  const roster = [{ id: 'one', slot: 0, bot: true }, { id: 'two', slot: 1, bot: true }];
  const match = createMatch(roster, 10);
  Object.assign(match, { phase: 'playing', hazardPlan: [], placedTrap: null,
    groundedCrates: [{ x: 0, z: 0, fireAt: 0 }] });
  for (const [index, player] of match.players.entries()) {
    Object.assign(player, { x: index ? 1.24 : -1.24, z: 0, vx: 0, vz: 0 });
  }
  for (let frame = 0; frame < 36; frame++) stepMatch(match, step);
  assert.ok(match.players.every(player => player.alive && Math.abs(player.z) > 1.5));
  assert.equal(match.groundedCrates[0].lostAt, undefined);
});
