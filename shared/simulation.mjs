import { DEFAULT_RIG, RIGS, rigFor } from './rigs.mjs';
import { LOOT_POOL } from './cosmetics.mjs';
import { arenaHazardPlan, blastTiles, CARGO_HAZARDS, crateOnDeck, DROP_BARREL_RADIUS, MINI_BLAST_REACH, MINI_FUSE_SECONDS, hazardTiming, evadeArenaHazard, hazardPush, holeMargin,
  hazardPosition, krakenCatches, krakenPoint, placeArenaHazard, powderFlightHeight, powderPush, rollingExitAt } from './arena-hazards.mjs';
import { ARENA_MAPS } from './arena-maps.mjs';
import { BARREL_COLLIDER_RADIUS, blockCircle } from './contact-geometry.mjs';
import { blockWithCrane, blockWithCrate, createRoundTrap, CRATE_HALF, CRATE_SHOCK, stepAnchor, turnCrane,
  updateSeesaw } from './experimental-traps.mjs';

const PIRATE_LOOKS = LOOT_POOL.filter(id => id.startsWith('pirate-'));
const PET_LOOKS = LOOT_POOL.filter(id => id.startsWith('pet-'));

export const MAX_PLAYERS = 8;
export const TICK_RATE = 30;
export const ARENA_RADIUS = 9;
export const MATCH_SECONDS = 50;
export const EMOTE_COOLDOWN_MS = 1_400;

const COUNTDOWN = 3;
const TIDE_PRESSURE_START = 11;
const TIDE_PRESSURE_RATE = .17;
const TIDE_PRESSURE_FLOOR = 3.4;
const BARREL_RADIUS = BARREL_COLLIDER_RADIUS;
const DRIVE_SPEED = 7.3;
const IMPACT_SPEED = 18;
const DRIVE = 15;
const CONTACT = BARREL_RADIUS * 2;
const FALL_MARGIN = .22;
const KO_WINDOW = 2.25;
const DRILL_SAMPLE_SECONDS = .8;
const DRILL_STARTS = new Map([
  ['free', [[-3.6, 0, 0], [0, 0, 0]]],
  ['head-on', [[-2.8, 0, DRIVE_SPEED], [2.8, 0, -DRIVE_SPEED]]],
  ['glancing', [[-4, -.72, DRIVE_SPEED], [0, 0, 0]]],
  ['edge', [[4.4, 0, DRIVE_SPEED], [8.05, 0, 0]]],
]);
const EVENT_AGE = Math.ceil(TICK_RATE * .65);
const EMOTE_COOLDOWN_TICKS = Math.ceil(TICK_RATE * EMOTE_COOLDOWN_MS / 1_000);
const EMOTES = ['wave', 'cheer', 'shrug'];
const STILL = { x: 0, z: 0 };
const TIDES = [
  [[0, ARENA_RADIUS], [9, ARENA_RADIUS], [19, 7.75], [31, 6.1], [43, 3.6], [MATCH_SECONDS, .30]],
  [[0, ARENA_RADIUS], [5, ARENA_RADIUS], [14, 7.9], [23, 7.9], [29, 6], [37, 5.8], [MATCH_SECONDS, .30]],
  [[0, ARENA_RADIUS], [11, ARENA_RADIUS], [21, 7.1], [27, 7.1], [34, 5.4], [44, 3.7], [MATCH_SECONDS, .30]],
];
const BOT_STYLES = [
  { margin: 1.05, lookAhead: .34, retreat: .84, lead: .24, wobble: .15 },
  { margin: .53, lookAhead: .22, retreat: .56, lead: .20, wobble: .23 },
  { margin: .76, lookAhead: .28, retreat: .72, lead: .12, wobble: .58 },
  { margin: .87, lookAhead: .29, retreat: .72, lead: .28, wobble: .26 },
];
const BOT_TRIAL_STYLES = new Map([
  ['bold', { margin: .39, lookAhead: .19, retreat: .32, lead: .34, wobble: .12 }],
  ['cautious', { margin: 1.32, lookAhead: .41, retreat: 1.08, lead: .15, wobble: .13 }],
  ['chaotic', { margin: .72, lookAhead: .27, retreat: .58, lead: .16, wobble: .82 }],
]);

function hashSeed(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  }
  return hash >>> 0;
}

function random(match) {
  let value = match.randomState;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  match.randomState = value >>> 0;
  return match.randomState / 4294967296;
}

function tideAt(seconds, schedule) {
  for (let index = 1; index < schedule.length; index++) {
    const [end, nextRadius] = schedule[index];
    if (seconds >= end) continue;
    const [start, before] = schedule[index - 1];
    const progress = (seconds - start) / (end - start);
    if (before === nextRadius) {
      return { radius: before, nextRadius: schedule[index + 1][1], shrinkIn: end - seconds };
    }
    return { radius: before + (nextRadius - before) * progress, nextRadius, shrinkIn: 0 };
  }
  const radius = schedule.at(-1)[1];
  return { radius, nextRadius: radius, shrinkIn: 0 };
}

function pressurizedRadius(radius, pressure) {
  return Math.max(Math.min(radius, TIDE_PRESSURE_FLOOR), radius - pressure);
}

function updateTide(match, alive, dt) {
  const tide = tideAt(match.elapsed, match.tideSchedule);
  // Keep the opening intact, including the first row of night torches.
  const target = !match.adaptiveTide || match.elapsed < TIDE_PRESSURE_START || alive >= 6
    ? 0 : alive === 5 ? .5 : alive === 4 ? 1 : alive === 3 ? 1.5 : 2;
  const addedPressure = Math.max(0, Math.min(target - match.tidePressure, TIDE_PRESSURE_RATE * dt));
  match.tidePressure += addedPressure;
  const radius = pressurizedRadius(tide.radius, match.tidePressure);
  const nextRadius = pressurizedRadius(tide.nextRadius, match.tidePressure);
  const shrinkIn = addedPressure > 0 && radius < match.radius ? 0 : tide.shrinkIn;
  Object.assign(match, { radius, nextRadius, shrinkIn });
}

export function createMatch(roster, seed = 1, previousMatch = null, { inaugural = false, botStyle } = {}) {
  if (roster.length < 2 || roster.length > MAX_PLAYERS) {
    throw new RangeError('A match needs two to eight competitors.');
  }
  const arenaRandom = { randomState: hashSeed(seed + '/arena') || 1 };
  const placedRandom = { randomState: hashSeed(seed + '/placed-trap') || 1 };
  const placedTrap = inaugural ? null : createRoundTrap(() => random(placedRandom));
  const night = !inaugural && (hashSeed(seed + '/lighting') >>> 8) % 2 === 1;
  const tideOptions = TIDES.filter(schedule => schedule !== (previousMatch?.baseTide ?? previousMatch?.tideSchedule));
  const baseTide = tideOptions[Math.floor(random(arenaRandom) * tideOptions.length)];
  const tideSchedule = night
    ? [[0, ARENA_RADIUS], [8.8, ARENA_RADIUS], [10.4, 8.58], ...baseTide.filter(([time]) => time > 12)]
    : baseTide;
  const maps = Object.keys(ARENA_MAPS);
  const recentMaps = (previousMatch?.mapHistory?.length ?? 0) < maps.length ? previousMatch?.mapHistory ?? [] : [];
  const mapOptions = maps.filter(id => id !== previousMatch?.arenaMap && !recentMaps.includes(id));
  const arenaMap = inaugural ? 'harbor' : mapOptions[hashSeed(seed + '/map') % mapOptions.length];
  const match = {
    phase: 'countdown', countdown: COUNTDOWN, elapsed: 0, tick: 0,
    winnerId: null, decider: null, duelAt: null,
    randomState: hashSeed(seed) || 1,
    eventSequence: hashSeed(seed) * 1_000_000,
    events: [], falls: [], firstFallTick: null,
    inaugural, night, arenaMap, mapHistory: [...recentMaps, arenaMap],
    arenaRandom, tideSchedule, baseTide, adaptiveTide: !inaugural, tidePressure: 0, hazard: null, holes: [], groundedCrates: [], hazardIndex: 0, hazardStruck: new Set(),
    placedTrap,
    hazardPlan: inaugural ? [hazardTiming('anchor-drop', 4), hazardTiming('anchor-drop', 13, 1)]
      : arenaHazardPlan(() => random(arenaRandom), previousMatch?.hazardPlan?.[0]?.kind,
        placedTrap ? CARGO_HAZARDS.filter(kind => kind !== 'barrel-roll') : undefined),
    ...tideAt(0, tideSchedule),
  };
  const offset = random(match) * Math.PI * 2;
  match.players = [...roster].sort((a, b) => a.slot - b.slot).map((entry, index) => {
    const angle = offset + index * Math.PI * 2 / roster.length;
    const x = Math.sin(angle) * 6.1;
    const z = Math.cos(angle) * 6.1;
    const revengeId = previousMatch?.players.find((player) => player.id === entry.id)?.eliminatedBy ?? null;
    const brain = entry.bot ? {
      style: BOT_TRIAL_STYLES.get(botStyle) ?? BOT_STYLES[hashSeed(entry.id) % BOT_STYLES.length], sway: random(match) * Math.PI * 2,
      targetId: null, retargetAt: 0, retreatUntil: 0, retreatX: 0, retreatZ: 0,
      orbitTarget: null, orbitAngle: 0, orbitTurn: 0, resetUntil: 0, chargeUntil: 0,
      hazardSeen: new WeakMap(), awareness: hashSeed(seed + "/awareness/" + entry.id),
      bypass: null,
    } : null;
    const rig = Object.hasOwn(RIGS, entry.rig) ? entry.rig : DEFAULT_RIG;
    const costume = hashSeed(seed + '/costume/' + entry.id);
    const appearance = entry.bot ? {
      pirate: PIRATE_LOOKS[costume % PIRATE_LOOKS.length],
      pet: costume % 3 === 0 ? PET_LOOKS[Math.floor(costume / 3) % PET_LOOKS.length] : null,
    } : entry.appearance;
    return {
      id: entry.id, name: entry.name, slot: entry.slot, bot: Boolean(entry.bot), rig, appearance, profile: rigFor(rig),
      x, z, vx: 0, vz: 0, angle: Math.atan2(-x, -z), alive: true, rank: null,
      brain, revengeId, priority: hashSeed(seed + '/' + entry.id),
      knock: null, eliminatedBy: null, recoilUntil: 0, nextEmoteTick: 0,
    };
  });
  return match;
}

function placeDrillBarrels(match, launch) {
  const starts = DRILL_STARTS.get(match.drill.trial);
  for (const [index, player] of match.players.entries()) {
    const [x, z, vx] = starts[index];
    Object.assign(player, { x, z, vx: launch ? vx : 0, vz: 0, angle: index ? -Math.PI / 2 : Math.PI / 2, recoilUntil: 0 });
  }
}

export function createDrill(roster, scenario, seed = 1, previousTrial = null) {
  if (roster.length !== 2 || (scenario !== 'shuffle' && !DRILL_STARTS.has(scenario))) return null;
  const trials = ['head-on', 'glancing', 'edge'].filter(trial => trial !== previousTrial);
  const trial = scenario === 'shuffle' ? trials[hashSeed(seed + '/trial') % trials.length] : scenario;
  const match = createMatch(roster);
  match.arenaMap = 'harbor';
  match.arenaStyle = roster[0].appearance?.arena ?? null;
  match.phase = 'playing';
  match.nextRadius = ARENA_RADIUS;
  match.shrinkIn = 0;
  match.drill = { scenario, trial, impact: null, reset: 0, done: false };
  placeDrillBarrels(match, true);
  return match;
}

function unit(x, z) {
  const length = Math.hypot(x, z);
  const divisor = Math.max(1, length);
  return { x: x / divisor, z: z / divisor };
}

function humanInput(input) {
  if (!input || !Number.isFinite(input.x) || !Number.isFinite(input.z)) return STILL;
  return unit(input.x, input.z);
}

function botTargets(match, active) {
  const bots = active.filter((player) => player.bot);
  const byId = new Map(active.map((player) => [player.id, player]));
  const targets = new Map();
  const counts = new Map();
  const assign = (bot, target) => {
    targets.set(bot.id, target);
    counts.set(target.id, (counts.get(target.id) ?? 0) + 1);
  };
  for (const bot of bots) {
    const target = byId.get(bot.brain.targetId);
    if (target && match.elapsed < bot.brain.retargetAt) assign(bot, target);
  }
  // A grudge gets first pick when a target has room for another attacker.
  bots.sort((a, b) => Number(byId.has(b.revengeId)) - Number(byId.has(a.revengeId)));
  for (const bot of bots) {
    if (targets.has(bot.id)) continue;
    let choice;
    let best = Infinity;
    for (const rival of active) {
      const attackers = counts.get(rival.id) ?? 0;
      if (rival === bot || attackers >= 2) continue;
      const range = Math.hypot(rival.x - bot.x, rival.z - bot.z);
      const revenge = rival.id === bot.revengeId;
      const score = range + attackers * 3.2 - (revenge ? 12 : 0) + random(match) * .5;
      if (score < best) {
        best = score;
        choice = rival;
      }
    }
    bot.brain.targetId = choice?.id ?? null;
    if (!choice) continue;
    bot.brain.retargetAt = match.elapsed + .9 + random(match) * .48;
    assign(bot, choice);
  }
  return targets;
}

function retreat(bot, x, z, elapsed) {
  if (!bot.brain) return;
  bot.brain.retreatX = x;
  bot.brain.retreatZ = z;
  bot.brain.retreatUntil = elapsed + bot.brain.style.retreat;
}

function outwardSpeed(player, distance = Math.hypot(player.x, player.z)) {
  return distance > .001 ? (player.x * player.vx + player.z * player.vz) / distance : 0;
}

function botDodge(match, bot, hazard) {
  if (!hazard || match.elapsed < hazard.warnAt) return null;
  const { brain } = bot;
  let reactsAt = brain.hazardSeen.get(hazard);
  if (reactsAt === undefined) {
    const state = { randomState: hashSeed(brain.awareness + '/' + hazard.kind + '/' + hazard.fireAt) || 1 };
    const misses = random(state) < .27;
    const delay = misses ? (hazard.kind === 'collapse' ? 1.55 : Infinity) : .24 + random(state) * .84;
    reactsAt = hazard.warnAt + delay;
    brain.hazardSeen.set(hazard, reactsAt);
  }
  return match.elapsed >= reactsAt ? evadeArenaHazard(hazard, match.elapsed, bot) : null;
}

function trackOrbit(match, bot, target) {
  const { brain } = bot;
  if (!target || match.elapsed < brain.chargeUntil) return;
  const angle = Math.atan2(bot.z - target.z, bot.x - target.x);
  if (brain.orbitTarget !== target.id) {
    brain.orbitTarget = target.id;
    brain.orbitAngle = angle;
    brain.orbitTurn = 0;
    return;
  }
  const turn = angle - brain.orbitAngle;
  brain.orbitAngle = angle;
  brain.orbitTurn = brain.orbitTurn * .994 + Math.atan2(Math.sin(turn), Math.cos(turn));
  if (Math.abs(brain.orbitTurn) < 4.1) return;
  brain.orbitTurn = 0;
  brain.resetUntil = match.elapsed + .42;
  brain.chargeUntil = brain.resetUntil + 1.15;
}

function desiredBotInput(match, bot, target, active) {
  const { brain } = bot;
  const { style } = brain;
  const distance = Math.hypot(bot.x, bot.z);
  const nx = bot.x / Math.max(.001, distance);
  const nz = bot.z / Math.max(.001, distance);
  const outward = outwardSpeed(bot, distance);
  const reckless = match.duelAt !== null && match.elapsed - match.duelAt > 1.5
    && bot.priority < target?.priority;
  const margin = Math.min(reckless ? .18 : style.margin, match.radius * .28);
  const lookAhead = reckless ? .12 : style.lookAhead;
  // Budget room for an ordinary turn, including the extra travel after a hit.
  const outwardPace = Math.max(0, outward);
  const escapeTravel = outwardPace * lookAhead + outwardPace ** 2 / (reckless ? 105 : 67);
  if (distance + escapeTravel > match.radius - margin) {
    return unit(-nx * 2 - bot.vx * .09, -nz * 2 - bot.vz * .09);
  }
  for (const hazard of match.hazard?.lanes ?? [match.hazard]) {
    const dodge = botDodge(match, bot, hazard);
    if (dodge) return unit(dodge.x, dodge.z);
  }
  for (const hole of match.holes) {
    const escape = botDodge(match, bot, hole);
    if (escape) return unit(escape.x, escape.z);
  }

  trackOrbit(match, bot, target);
  if (match.elapsed < brain.resetUntil) return unit(-nx - bot.vx * .23, -nz - bot.vz * .23);
  const charging = match.elapsed < brain.chargeUntil;
  if (!charging && match.elapsed >= brain.retreatUntil) {
    for (const rival of active) {
      if (rival === bot) continue;
      const dx = rival.x - bot.x;
      const dz = rival.z - bot.z;
      const range = Math.hypot(dx, dz);
      if (range >= CONTACT + .36) continue;
      const away = range > .001 ? { x: -dx / range, z: -dz / range } : { x: bot.slot % 2 ? 1 : -1, z: 0 };
      const closing = (rival.vx - bot.vx) * away.x + (rival.vz - bot.vz) * away.z;
      if (closing < 2.1) {
        retreat(bot, away.x, away.z, match.elapsed);
        brain.retreatUntil += .18;
        break;
      }
    }
  }
  if (!charging && match.elapsed < brain.retreatUntil) {
    let { retreatX: x, retreatZ: z } = brain;
    const towardEdge = x * nx + z * nz;
    if (towardEdge > 0 && distance > match.radius * .55) {
      const side = Math.sign(nx * z - nz * x) || (bot.slot % 2 ? 1 : -1);
      x -= nx * (towardEdge + .32) + nz * side * .56;
      z -= nz * (towardEdge + .32) - nx * side * .56;
    }
    return unit(x * 2 - bot.vx * .09, z * 2 - bot.vz * .09);
  }
  if (!target) return unit(-nx - bot.vx * .16, -nz - bot.vz * .16);

  const range = Math.hypot(target.x - bot.x, target.z - bot.z);
  const lead = Math.min(charging ? .12 : style.lead, range / 13);
  const damping = charging ? .27 : .11;
  const dx = target.x + target.vx * lead - bot.x - bot.vx * damping;
  const dz = target.z + target.vz * lead - bot.z - bot.vz * damping;
  const wobble = charging ? 0 : Math.sin(match.elapsed * 4.1 + brain.sway) * style.wobble;
  return unit(dx - dz * wobble, dz + dx * wobble);
}

function solidInPath(solid, bot, input, ahead) {
  const x = solid.x - bot.x, z = solid.z - bot.z;
  const along = Math.max(0, Math.min(ahead, x * input.x + z * input.z));
  return Math.hypot(x - input.x * along, z - input.z * along) < DROP_BARREL_RADIUS + BARREL_RADIUS + .08;
}

function botInput(match, bot, target, active) {
  const input = desiredBotInput(match, bot, target, active);
  const ahead = 1.8 + Math.min(1.4, Math.hypot(bot.vx, bot.vz) * .22);
  let obstacle = null, nearest = Infinity;
  // These boxes have already landed and are visible to everyone. Do not inspect
  // future drops or change the delayed/imperfect reactions to birds and shots.
  for (const crate of match.groundedCrates) {
    if (crate.lostAt != null || !solidInPath(crate, bot, input, ahead)) continue;
    const distance = Math.hypot(bot.x - crate.x, bot.z - crate.z);
    if (distance < nearest) { obstacle = crate; nearest = distance; }
  }
  if (!obstacle) { bot.brain.bypass = null; return input; }
  const x = bot.x - obstacle.x, z = bot.z - obstacle.z;
  const normal = unit(x || (z ? 0 : 1), z);
  if (input.x * normal.x + input.z * normal.z > .08) {
    bot.brain.bypass = null;
    return input;
  }
  let bypass = bot.brain.bypass;
  if (bypass?.solid !== obstacle || match.elapsed >= bypass.until) {
    let side = bot.slot % 2 ? 1 : -1;
    const score = sign => {
      const dx = -normal.z * sign + normal.x * .18;
      const dz = normal.x * sign + normal.z * .18;
      const margin = deckMargin(match, { x: bot.x + dx * 1.7, z: bot.z + dz * 1.7 });
      return Math.min(1.5, margin) * 1.8 + dx * input.x + dz * input.z;
    };
    if (score(-side) > score(side) + .16) side = -side;
    bypass = bot.brain.bypass = { solid: obstacle, side, until: match.elapsed + 1.7 };
  }
  // Commit to one side rather than alternating every target/retreat update.
  // The tangent bends naturally around a rounded corner; a small outward term
  // gives steering/inertia room to clear the solid without bypassing its collider.
  return unit(-normal.z * bypass.side + normal.x * .30 - bot.vx * .10,
    normal.x * bypass.side + normal.z * .30 - bot.vz * .10);
}

function capVelocity(player, cap) {
  const speed = Math.hypot(player.vx, player.vz);
  if (speed <= cap) return;
  player.vx *= cap / speed;
  player.vz *= cap / speed;
}

export function moveBarrel(player, input, dt, elapsed) {
  const pushing = Math.hypot(input.x, input.z) > .05;
  const grip = pushing ? .54 : 1.18;
  const drag = Math.exp(-grip * dt);
  const previousSpeed = Math.hypot(player.vx, player.vz);
  const profile = player.profile;
  const opposition = previousSpeed ? Math.max(0, -(input.x * player.vx + input.z * player.vz) / previousSpeed) : 0;
  const recovery = elapsed < player.recoilUntil ? 1 - opposition * .70 : 1;
  const drive = DRIVE * profile.drive * (1 + opposition * .36) * recovery;
  let steerX = input.x;
  let steerZ = input.z;
  if (profile.turn !== 1 && previousSpeed > .2) {
    const projection = (input.x * player.vx + input.z * player.vz) / previousSpeed ** 2;
    const adjustment = (1 - profile.turn) * Math.min(1, previousSpeed / DRIVE_SPEED);
    steerX -= (steerX - player.vx * projection) * adjustment;
    steerZ -= (steerZ - player.vz * projection) * adjustment;
  }
  player.vx = player.vx * drag + steerX * drive * dt;
  player.vz = player.vz * drag + steerZ * drive * dt;
  capVelocity(player, Math.max(DRIVE_SPEED * profile.speed, previousSpeed * drag));
  player.x += player.vx * dt;
  player.z += player.vz * dt;

  if (Math.hypot(player.vx, player.vz) > .28) {
    const heading = Math.atan2(player.vx, player.vz);
    const difference = Math.atan2(Math.sin(heading - player.angle), Math.cos(heading - player.angle));
    player.angle += difference * Math.min(1, dt * 17);
  }
}

function emit(match, event) {
  const entry = { ...event, id: ++match.eventSequence, tick: match.tick };
  match.events.push(entry);
  return entry;
}

function restingControls(active, steering) {
  const controls = active.map((player) => ({ ...steering.get(player.id) }));
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const distance = Math.hypot(dx, dz);
      if (distance > CONTACT + .055 || distance < .001) continue;
      const nx = dx / distance;
      const nz = dz / distance;
      const closing = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
      if (Math.abs(closing) > .85) continue;
      const inputA = controls[i];
      const inputB = controls[j];
      const pushA = Math.max(0, inputA.x * nx + inputA.z * nz);
      const pushB = Math.min(0, inputB.x * nx + inputB.z * nz);
      // In a resting contact, keep lateral and retreat inputs free.
      inputA.x -= nx * pushA;
      inputA.z -= nz * pushA;
      inputB.x -= nx * pushB;
      inputB.z -= nz * pushB;
    }
  }
  return controls;
}

function noteKnock(match, player, attacker, approach, outwardGain, elapsed) {
  if (outwardGain < .6) return;
  if (player.knock?.tick !== match.tick) player.knock = { tick: match.tick, at: elapsed, forces: new Map() };
  const { forces } = player.knock;
  const id = approach >= .8 ? attacker.id : null;
  forces.set(id, Math.max(forces.get(id) ?? 0, outwardGain));
}

function creditedAttacker(player, elapsed) {
  if (!player.knock || elapsed - player.knock.at > KO_WINDOW) return null;
  const [strongest, second] = [...player.knock.forces].sort((a, b) => b[1] - a[1]);
  return second && second[1] >= strongest[1] * .85 ? null : strongest[0];
}

function sampleDrill(match) {
  const { drill } = match;
  const { impact } = drill;
  if (impact?.measuring) {
    const [own, dummy] = match.players;
    const ownTravel = (impact.ownX - own.x) * impact.nx + (impact.ownZ - own.z) * impact.nz;
    const dummyTravel = (dummy.x - impact.dummyX) * impact.nx + (dummy.z - impact.dummyZ) * impact.nz;
    impact.ownRecoil = Math.max(impact.ownRecoil, ownTravel / CONTACT);
    impact.dummyRecoil = Math.max(impact.dummyRecoil, dummyTravel / CONTACT);
    if (match.elapsed - impact.at >= DRILL_SAMPLE_SECONDS - 1e-8) impact.measuring = false;
  }

  const overboard = match.players.filter((player) => Math.hypot(player.x, player.z) > ARENA_RADIUS + FALL_MARGIN);
  if (overboard.length) {
    for (const player of overboard) emit(match, { type: 'fall', x: player.x, z: player.z, playerId: player.id });
    placeDrillBarrels(match, false);
    drill.reset++;
    if (impact) impact.measuring = false;
  }
  drill.done = drill.scenario !== 'free' && (overboard.length > 0 || (impact ? !impact.measuring : match.elapsed >= 3));
}

function collide(match, a, b, elapsed) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const distance = Math.hypot(dx, dz);
  const overlap = CONTACT - distance;
  if (overlap <= 0) return;

  const nx = distance > .0001 ? dx / distance : (a.slot + b.slot) % 2 ? 1 : 0;
  const nz = distance > .0001 ? dz / distance : nx ? 0 : 1;
  const shareA = b.profile.mass / (a.profile.mass + b.profile.mass);
  const shareB = 1 - shareA;
  a.x -= nx * overlap * shareA;
  a.z -= nz * overlap * shareA;
  b.x += nx * overlap * shareB;
  b.z += nz * overlap * shareB;
  const aApproach = a.vx * nx + a.vz * nz;
  const bApproach = -b.vx * nx - b.vz * nz;
  const closing = aApproach + bApproach;
  if (closing <= 0) return;

  // Slow contacts just separate. A fast run-up can send both barrels back.
  const rebound = .5 + Math.min(.86, Math.max(0, closing - .8) * .14);
  const impulse = closing * rebound;
  const aOutward = outwardSpeed(a);
  const bOutward = outwardSpeed(b);
  a.vx -= nx * impulse * (shareA * 2);
  a.vz -= nz * impulse * (shareA * 2);
  b.vx += nx * impulse * (shareB * 2);
  b.vz += nz * impulse * (shareB * 2);
  capVelocity(a, IMPACT_SPEED);
  capVelocity(b, IMPACT_SPEED);

  if (closing >= 2.4) {
    retreat(a, -nx, -nz, elapsed);
    retreat(b, nx, nz, elapsed);
  }
  if (closing >= 4.4) {
    a.recoilUntil = Math.max(a.recoilUntil, elapsed + .14);
    b.recoilUntil = Math.max(b.recoilUntil, elapsed + .14);
  }
  if (closing > 1.35) {
    if (match.drill) {
      if (!match.drill.impact || (match.drill.scenario === 'free' && !match.drill.impact.measuring)) {
        match.drill.impact = {
          at: elapsed, force: closing, ownRecoil: 0, dummyRecoil: 0,
          steeringDelay: Math.max(0, a.recoilUntil - elapsed), measuring: true, nx, nz,
          ownX: a.x, ownZ: a.z, dummyX: b.x, dummyZ: b.z,
        };
      }
    } else {
      noteKnock(match, a, b, bApproach, outwardSpeed(a) - aOutward, elapsed);
      noteKnock(match, b, a, aApproach, outwardSpeed(b) - bOutward, elapsed);
    }
    emit(match, {
      type: 'hit', x: (a.x + b.x) * .5, z: (a.z + b.z) * .5,
      force: closing, impulse, a: a.id, b: b.id, nx, nz,
    });
  }
}

export function emotePlayer(match, id, emote) {
  if (match?.phase !== 'playing' || !EMOTES.includes(emote)) return false;
  const player = match.players.find((entry) => entry.id === id);
  if (!player?.alive || player.bot || match.tick < player.nextEmoteTick) return false;
  player.nextEmoteTick = match.tick + EMOTE_COOLDOWN_TICKS;
  emit(match, { type: 'emote', playerId: id, emote });
  return true;
}

function finish(match, winner, decider) {
  match.phase = 'results';
  match.winnerId = winner.id;
  match.decider = decider;
  winner.rank = 1;
  winner.grab = null;
  winner.powderHop = null;
  winner.vx = winner.vz = 0;
  const distance = Math.hypot(winner.x, winner.z);
  if (distance > match.radius) {
    const scale = match.radius * .82 / distance;
    winner.x *= scale;
    winner.z *= scale;
  }
  if (deckMargin(match, winner) < 0) {
    for (const radius of [0, match.radius * .45, match.radius * .75, match.radius * .93]) {
      for (let index = 0; index < 16; index++) {
        const angle = index * Math.PI / 8;
        winner.x = Math.cos(angle) * radius;
        winner.z = Math.sin(angle) * radius;
        if (deckMargin(match, winner) >= 0) return;
      }
    }
  }
}

function overHole(match, player) {
  return match.holes.some(hole => holeMargin(hole, player.x, player.z, match.elapsed) < 0);
}

function deckMargin(match, player) {
  let margin = match.radius + FALL_MARGIN - Math.hypot(player.x, player.z);
  for (const hole of match.holes) margin = Math.min(margin, holeMargin(hole, player.x, player.z, match.elapsed));
  return margin;
}

function eliminate(match, players, { decider = null, cause = 'water' } = {}) {
  let remaining = match.players.filter((player) => player.alive).length;
  for (const player of players) {
    player.alive = false;
    player.grab = null;
    player.powderHop = null;
    player.rank = remaining--;
    player.eliminatedBy = cause === 'water' ? creditedAttacker(player, match.elapsed) : null;
    const attacker = match.players.find((entry) => entry.id === player.eliminatedBy);
    const revenge = attacker?.revengeId === player.id;
    if (revenge) attacker.revengeId = null;
    const weather = player.hazardKnock;
    const recentHazard = weather && match.elapsed - weather.at < 1.4 ? weather.kind : undefined;
    const hazard = cause === 'water' ? (recentHazard === 'kraken' || !overHole(match, player) ? recentHazard : 'collapse')
      : cause === 'crushed' ? 'crate' : undefined;
    if (cause === 'water') match.firstFallTick ??= match.tick;
    const first = cause === 'water' && match.firstFallTick === match.tick;
    const fall = emit(match, {
      type: 'fall', x: player.x, z: player.z, playerId: player.id,
      attackerId: player.eliminatedBy, revenge, first, cause, hazard,
    });
    match.falls.push(fall);
  }
  if (remaining === 1) finish(match, match.players.find((player) => player.alive), decider);
}

function settleFalls(match, active, previousMargins) {
  const falling = [];
  for (const [index, player] of active.entries()) {
    if (!player.alive || player.grab || player.powderHop) continue;
    const distance = Math.hypot(player.x, player.z);
    const margin = deckMargin(match, player);
    if (margin >= 0) continue;
    const before = Math.max(0, previousMargins[index]);
    falling.push({ player, distance, fraction: before / (before - margin) });
  }
  if (!falling.length) return;
  // Earliest crossings place last, even when several happen in the same substep.
  falling.sort((a, b) => a.fraction - b.fraction || b.distance - a.distance
    || b.player.priority - a.player.priority || b.player.slot - a.player.slot);
  const allFell = falling.length === active.filter(player => player.alive).length;
  if (allFell) falling.pop();
  eliminate(match, falling.map(({ player }) => player), { decider: allFell ? 'crossing' : null });
}

function catchBarrels(match, hazard, previous, active) {
  for (const player of active) {
    if (match.hazardStruck.has(player.id) || !krakenCatches(hazard, match.elapsed, previous, player)
      || deckMargin(match, player) <= 0) continue;
    const fromX = hazard.x - hazard.dx * hazard.reach;
    const fromZ = hazard.z - hazard.dz * hazard.reach;
    player.grab = { at: match.elapsed, x: player.x, z: player.z,
      along: (player.x - fromX) * hazard.dx + (player.z - fromZ) * hazard.dz,
      cross: (player.x - fromX) * -hazard.dz + (player.z - fromZ) * hazard.dx };
    player.vx = player.vz = 0;
    player.knock = null;
    match.hazardStruck.add(player.id);
    emit(match, { type: 'hazard-grab', playerId: player.id, x: player.x, z: player.z, nx: -hazard.dx, nz: -hazard.dz });
  }
}

function shoveFromHazard(match, player, kind, x, z) {
  const length = Math.hypot(x, z);
  const force = length / Math.sqrt(player.profile.mass);
  const nx = x / length;
  const nz = z / length;
  const along = player.vx * nx + player.vz * nz;
  const launch = Math.max(force - along, force * .30);
  player.vx += nx * launch;
  player.vz += nz * launch;
  capVelocity(player, IMPACT_SPEED);
  player.recoilUntil = Math.max(player.recoilUntil, match.elapsed + .16);
  player.knock = null;
  player.hazardKnock = { at: match.elapsed, kind };
  emit(match, { type: 'hazard-hit', kind, playerId: player.id, x: player.x, z: player.z, nx, nz, force });
}

function dragBarrels(match, active) {
  const hazard = match.hazard;
  for (const player of active) {
    if (!player.grab) continue;
    const point = krakenPoint(hazard, match.elapsed, player.grab.along, player.grab.cross);
    player.x = point.x;
    player.z = point.z;
    if (match.elapsed < hazard.end - .00001) continue;
    player.grab = null;
    player.hazardKnock = { at: match.elapsed, kind: 'kraken' };
  }
}

function updatePlacedTraps(match, hazard, previous, active) {
  const now = match.elapsed;
  const scale = match.labKnockbackScale ?? 1;
  for (const crane of [...(hazard.anchors ?? []), ...(hazard.crates ?? [])]) {
    turnCrane(crane, previous, now);
  }
  for (const anchor of hazard.anchors ?? []) {
    for (const { player, nx, nz, force, fromAnchor } of stepAnchor(anchor, active, now - previous, scale)) {
      if (fromAnchor) {
        player.knock = null;
        player.hazardKnock = { at: now, kind: 'anchor' };
      }
      emit(match, { type: fromAnchor ? 'hazard-hit' : 'anchor-launch', kind: 'anchor', playerId: player.id,
        x: player.x, z: player.z, nx, nz, force });
    }
  }
  for (const crate of hazard.crates ?? []) {
    if (crate.fireAt !== null && previous < crate.fireAt && now >= crate.fireAt) {
      emit(match, { type: 'hazard-fire', kind: 'crate', x: crate.x, z: crate.z });
      const crushed = [];
      for (const player of active) {
        if (!player.alive) continue;
        const dx = player.x - crate.x;
        const dz = player.z - crate.z;
        if (Math.max(Math.abs(dx), Math.abs(dz)) <= CRATE_HALF) {
          crushed.push(player);
          continue;
        }
        const distance = Math.hypot(dx, dz);
        if (distance < CRATE_SHOCK) {
          const force = Math.min(4.2, (1.6 + (CRATE_SHOCK - distance) * 1.2) * scale);
          shoveFromHazard(match, player, 'crate', dx / distance * force, dz / distance * force);
        }
      }
      if (crushed.length && crushed.length === active.length) {
        crushed.sort((a, b) => Math.hypot(a.x - crate.x, a.z - crate.z) - Math.hypot(b.x - crate.x, b.z - crate.z)
          || a.priority - b.priority || a.slot - b.slot);
        crushed.pop();
      }
      if (crushed.length) eliminate(match, crushed, { cause: 'crushed' });
      if (match.phase === 'results') return;
    }
  }
}

function blockScenery(match, players) {
  let moved = false;
  const placed = match.placedTrap;
  for (const player of players) {
    if (!player.alive || player.grab || player.powderHop) continue;
    for (const crane of placed?.anchors ?? []) moved = blockWithCrane(crane, player) || moved;
    for (const crate of placed?.crates ?? []) {
      moved = blockWithCrane(crate, player) || moved;
      moved = blockWithCrate(crate, match.elapsed, player) || moved;
    }
    for (const crate of match.groundedCrates) {
      if (crate.lostAt == null) moved = blockCircle(crate, player, BARREL_RADIUS + DROP_BARREL_RADIUS) || moved;
    }
  }
  return moved;
}

function launchOverPowderHole(match, player, push, holes) {
  const bearing = Math.atan2(push.z, push.x);
  const landingAt = match.elapsed + .52;
  const landingRadius = projectedTideRadius(match, landingAt);
  const preferred = Math.min(3.15, .8 + Math.hypot(push.x, push.z) * .22);
  const distances = [preferred];
  for (let distance = preferred - .35; distance >= .45; distance -= .35) distances.push(distance);
  for (let distance = preferred + .35; distance <= 9; distance += .35) distances.push(distance);
  let fallback;
  // Prefer the outward path and use another angle when the blast hits near the edge.
  for (const turn of [0, .28, -.28, .57, -.57, .95, -.95, 1.4, -1.4, 2, -2, Math.PI]) {
    const dx = Math.cos(bearing + turn), dz = Math.sin(bearing + turn);
    for (const distance of distances) {
      const x = player.x + dx * distance, z = player.z + dz * distance;
      if (Math.hypot(x, z) > landingRadius - .66) continue;
      if (holes.some(hole => holeMargin(hole, x, z, Infinity) < .5) ||
        match.holes.some(hole => holeMargin(hole, x, z, landingAt) < .4)) continue;
      const flight = { fromX: player.x, fromZ: player.z, x, z, start: match.elapsed, end: landingAt, dx, dz };
      fallback ??= flight;
      if (match.groundedCrates.some(crate => crate.lostAt == null && Math.hypot(x - crate.x, z - crate.z) < BARREL_RADIUS + DROP_BARREL_RADIUS) ||
        match.players.some(other => other !== player && other.alive && Math.hypot(x - (other.powderHop?.x ?? other.x), z - (other.powderHop?.z ?? other.z)) < CONTACT)) continue;
      player.powderHop = flight;
      return;
    }
  }
  if (fallback) player.powderHop = fallback;
}

function detonateMiniBarrels(match, active) {
  for (const barrel of match.groundedCrates) {
    if (barrel.lostAt != null || barrel.blastAt == null || match.elapsed < barrel.blastAt) continue;
    const { x, z, blastAt } = barrel;
    const hole = { kind: 'blast-tile', x, z, fireAt: blastAt };
    barrel.exploded = true;
    barrel.lostAt = match.elapsed;
    for (const player of active) {
      if (!player.alive || player.grab) continue;
      const push = powderPush(barrel, player, MINI_BLAST_REACH, 6.8, .62);
      if (!push) continue;
      shoveFromHazard(match, player, 'powder', push.x, push.z);
      if (holeMargin(hole, player.x, player.z, match.elapsed) < .38 ||
        (player.powderHop && holeMargin(hole, player.powderHop.x, player.powderHop.z, Infinity) < .38)) {
        launchOverPowderHole(match, player, push, [hole]);
      }
    }
    match.holes.push(hole);
    emit(match, { type: 'hazard-fire', kind: 'mini-powder', x, z });
  }
}

function advancePowderHop(player, elapsed) {
  const hop = player.powderHop;
  const fraction = Math.max(0, Math.min(1, (elapsed - hop.start) / (hop.end - hop.start)));
  const travel = fraction * (2 - fraction);
  player.x = hop.fromX + (hop.x - hop.fromX) * travel;
  player.z = hop.fromZ + (hop.z - hop.fromZ) * travel;
  if (fraction >= 1) {
    player.powderHop = null;
    player.vx = hop.dx * 1.65;
    player.vz = hop.dz * 1.65;
  }
}

function separatePowderFlights(active, grounded, elapsed) {
  for (const flying of active) {
    if (!flying.powderHop) continue;
    const height = powderFlightHeight(flying.powderHop, elapsed);
    if (height >= CONTACT) continue;
    const clearance = Math.sqrt(CONTACT ** 2 - height ** 2);
    for (const player of grounded) {
      if (!player.alive || player.powderHop || player.grab) continue;
      const dx = player.x - flying.x;
      const dz = player.z - flying.z;
      const distance = Math.hypot(dx, dz);
      if (distance >= clearance) continue;
      const nx = distance > .0001 ? dx / distance : -flying.powderHop.dz;
      const nz = distance > .0001 ? dz / distance : flying.powderHop.dx;
      player.x = flying.x + nx * clearance;
      player.z = flying.z + nz * clearance;
    }
  }
}

function projectedTideRadius(match, time) {
  const extraTime = Math.max(0, time - Math.max(match.elapsed, TIDE_PRESSURE_START));
  const pressure = match.adaptiveTide ? Math.min(2, match.tidePressure + extraTime * TIDE_PRESSURE_RATE) : 0;
  return pressurizedRadius(tideAt(time, match.tideSchedule).radius, pressure);
}

function updateHazard(match, previous, active) {
  const now = match.elapsed;
  if (match.hazard && now >= (match.hazard.exit ?? match.hazard.end)) match.hazard = null;
  const next = match.hazardPlan[match.hazardIndex];
  if (next && now >= next.start) {
    // A late blast must leave enough deck to land around the hole.
    const blastRadius = next.kind === 'powder' ? projectedTideRadius(match, next.fireAt + .52) : match.radius;
    const plan = next.kind === 'powder' && blastRadius < 5.7 ? hazardTiming('anchor-drop', next.start, next.id) : next;
    match.hazard = placeArenaHazard(plan, blastRadius, () => random(match.arenaRandom));
    match.hazardIndex++;
    match.hazardStruck.clear();
  }
  const hazard = match.hazard;
  if (!hazard) return;
  if (match.placedTrap?.kind === 'seesaw' && hazard.kind === 'barrel-roll') {
    match.hazard = null;
    return;
  }
  const damage = hazard.kind === 'powder' && previous < hazard.fireAt && now >= hazard.fireAt ? blastTiles(hazard) : null;
  if (previous < hazard.warnAt && now >= hazard.warnAt) emit(match, { type: 'hazard-warning', kind: hazard.kind });
  if (previous < hazard.fireAt && now >= hazard.fireAt) {
    if (hazard.kind === 'collapse' || hazard.kind === 'anchor-drop') match.holes.push(hazard);
    if (!hazard.lanes && hazard.kind !== 'crate-drop') {
      const x = hazard.kind === 'kraken' ? hazard.x - hazard.dx * hazard.reach : hazard.x;
      const z = hazard.kind === 'kraken' ? hazard.z - hazard.dz * hazard.reach : hazard.z;
      emit(match, { type: 'hazard-fire', kind: hazard.kind, x, z, nx: hazard.dx, nz: hazard.dz });
    }
  }
  if (hazard.kind === 'crate-drop') {
    for (const drop of hazard.drops ?? [hazard]) {
      if (previous >= drop.fireAt || now < drop.fireAt) continue;
      const { id, x, z, fireAt } = drop;
      const barrel = { id, x, z, fireAt, blastAt: fireAt + (drop.labFuse ?? MINI_FUSE_SECONDS) };
      match.groundedCrates.push(barrel);
      emit(match, { type: 'hazard-fire', kind: hazard.kind, x, z });
      if (!crateOnDeck(barrel, match.radius, match.holes, now)) continue;
      for (const player of active) {
        if (player.grab || player.powderHop) continue;
        const push = powderPush(barrel, player, BARREL_RADIUS + DROP_BARREL_RADIUS, 5.8, .35);
        if (!push) continue;
        shoveFromHazard(match, player, hazard.kind, push.x, push.z);
        const clearance = BARREL_RADIUS + DROP_BARREL_RADIUS;
        const force = Math.hypot(push.x, push.z);
        const contact = { x: x + push.x / force * clearance, z: z + push.z / force * clearance };
        if (deckMargin(match, contact) < .25) launchOverPowderHole(match, player, push, []);
      }
    }
    return;
  }
  if (hazard.kind === 'kraken') {
    catchBarrels(match, hazard, previous, active);
    return;
  }
  if (match.phase === 'results') return;
  for (const lane of hazard.lanes ?? [hazard]) {
    if (now < lane.fireAt || previous >= lane.end) continue;
    if (lane.kind === 'barrel-roll' && lane.fallAt == null) {
      const point = hazardPosition(lane, now);
      const edge = rollingExitAt(lane, match.radius);
      if (now >= edge || overHole(match, point)) lane.fallAt = Math.max(previous, lane.fireAt, Math.min(now, edge));
    }
    if (hazard.lanes && (hazard.kind !== 'barrel-roll' || lane.slot === 0) && previous < lane.fireAt) {
      emit(match, { type: 'hazard-fire', kind: lane.kind, x: lane.x, z: lane.z });
    }
    for (const player of active) {
      if (player.grab || (player.powderHop && hazard.kind !== 'powder')) continue;
      const target = lane.slot === undefined || hazard.kind === 'barrel-roll' ? player.id : lane.slot + '/' + player.id;
      if (match.hazardStruck.has(target)) continue;
      const push = hazardPush(lane, now, previous, player);
      if (!push) continue;
      match.hazardStruck.add(target);
      const scale = match.labKnockbackScale ?? 1;
      shoveFromHazard(match, player, hazard.kind, push.x * scale, push.z * scale);
      if (damage?.some(hole => holeMargin(hole, player.x, player.z, Infinity) < .42 ||
        (player.powderHop && holeMargin(hole, player.powderHop.x, player.powderHop.z, Infinity) < .42))) {
        launchOverPowderHole(match, player, push, damage);
      }
    }
  }
  if (damage) match.holes.push(...damage);
}

export function forfeitPlayer(match, id) {
  if (match.phase === 'results' || match.drill) return false;
  const player = match.players.find((entry) => entry.id === id && entry.alive);
  if (!player) return false;
  eliminate(match, [player], { cause: 'left' });
  return true;
}

export function stepMatch(match, dt, inputs = new Map()) {
  if (match.phase === 'results' || !Number.isFinite(dt) || dt <= 0) return;
  dt = Math.min(dt, .1);
  match.tick++;
  match.events = match.events.filter((event) => match.tick - event.tick <= EVENT_AGE).slice(-64);

  if (match.phase === 'countdown') {
    match.countdown -= dt;
    if (match.countdown <= .00001) match.phase = 'playing';
    return;
  }

  const drill = match.drill;
  if (drill?.done) return;
  let active = match.players.filter((player) => player.alive);
  const steering = new Map();
  if (drill) {
    for (const player of active) {
      steering.set(player.id, drill.scenario === 'free' && !player.bot ? humanInput(inputs.get(player.id)) : STILL);
    }
  } else {
    if (active.length === 2 && active.every((player) => player.bot)) match.duelAt ??= match.elapsed;
    const targets = botTargets(match, active);
    for (const player of active) {
      steering.set(player.id, player.bot ? botInput(match, player, targets.get(player.id), active) : humanInput(inputs.get(player.id)));
    }
  }
  const substeps = Math.max(2, Math.ceil(2 * IMPACT_SPEED * dt / (BARREL_RADIUS * .75)));
  const step = dt / substeps;
  for (let substep = 0; substep < substeps; substep++) {
    const previous = match.elapsed;
    const previousMargins = drill ? null : active.map(player => deckMargin(match, player));
    const grounded = active.some(player => player.grab || player.powderHop)
      ? active.filter(player => !player.grab && !player.powderHop) : active;
    const controls = restingControls(grounded, steering);
    const trap = drill ? null : match.placedTrap;
    if (trap?.kind === 'seesaw') updateSeesaw(trap, grounded, previous, step);
    for (const [index, player] of grounded.entries()) {
      player.stepX = player.x;
      player.stepZ = player.z;
      if (trap?.kind === 'seesaw') {
        const angle = Math.hypot(trap.tiltX, trap.tiltZ);
        const slope = angle > 0 ? Math.sin(angle) / angle : 1;
        player.vx += trap.tiltX * slope * 11 * step;
        player.vz += trap.tiltZ * slope * 11 * step;
      }
      moveBarrel(player, controls[index], step, previous);
    }
    match.elapsed = drill ? match.elapsed + step : Math.min(MATCH_SECONDS, match.elapsed + step);
    if (grounded !== active) {
      dragBarrels(match, active);
      for (const player of active) {
        if (!player.powderHop) continue;
        advancePowderHop(player, match.elapsed);
        if (!player.powderHop) {
          player.stepX = player.x;
          player.stepZ = player.z;
          grounded.push(player);
        }
      }
    }
    for (let pass = 0; pass < 3; pass++) {
      if (grounded !== active) separatePowderFlights(active, grounded, match.elapsed);
      for (let a = 0; a < grounded.length; a++) {
        for (let b = a + 1; b < grounded.length; b++) collide(match, grounded[a], grounded[b], match.elapsed);
      }
    }
    if (drill) {
      sampleDrill(match);
      if (drill.done) break;
      continue;
    }
    updateTide(match, active.length, step);
    if (trap) updatePlacedTraps(match, trap, previous, active);
    for (const player of grounded) capVelocity(player, IMPACT_SPEED);
    if (match.phase === 'results') return;
    updateHazard(match, previous, active.filter(player => player.alive));
    if (match.phase === 'results') return;
    for (const crate of match.groundedCrates) {
      if (crate.lostAt == null && !crateOnDeck(crate, match.radius, match.holes, match.elapsed)) crate.lostAt = match.elapsed;
    }
    detonateMiniBarrels(match, active);
    if (blockScenery(match, active)) {
      // A solid correction must not leave its neighbour embedded in a barrel.
      // Extra iterations are restricted to the substeps that touched scenery.
      for (let pass = 0; pass < 8; pass++) {
        for (let a = 0; a < grounded.length; a++) {
          if (!grounded[a].alive || grounded[a].grab || grounded[a].powderHop) continue;
          for (let b = a + 1; b < grounded.length; b++) {
            if (grounded[b].alive && !grounded[b].grab && !grounded[b].powderHop) {
              collide(match, grounded[a], grounded[b], match.elapsed);
            }
          }
        }
        if (!blockScenery(match, active)) break;
      }
    }
    if (grounded !== active) separatePowderFlights(active, grounded, match.elapsed);
    settleFalls(match, active, previousMargins);
    if (match.phase === 'results') return;
    active = active.filter((player) => player.alive);
    for (const player of active) {
      if (player.knock && player.knock.tick !== match.tick
        && (outwardSpeed(player) <= 0 || Math.hypot(player.vx, player.vz) < .8)) {
        player.knock = null;
      }
    }
  }

  if (!drill && match.elapsed >= MATCH_SECONDS - .00001) {
    active.sort((a, b) => Math.hypot(b.x, b.z) - Math.hypot(a.x, a.z) || b.priority - a.priority || b.slot - a.slot);
    active.pop();
    eliminate(match, active, { decider: 'center', cause: 'tide' });
  }
}

export function readMatch(match) {
  const drill = match.drill;
  const impact = drill?.impact;
  return {
    phase: match.phase,
    seconds: match.phase === 'countdown' ? Math.max(0, match.countdown)
      : match.phase === 'playing' && !drill ? MATCH_SECONDS - match.elapsed : 0,
    elapsed: match.elapsed,
    radius: match.radius,
    arenaMap: match.arenaMap,
    arenaStyle: match.arenaStyle,
    inaugural: match.inaugural,
    night: match.night,
    hazard: drill ? null : match.hazard,
    placedTrap: drill ? null : match.placedTrap,
    holes: match.holes,
    groundedCrates: match.groundedCrates,
    nextRadius: match.nextRadius,
    shrinkIn: match.shrinkIn,
    tick: match.tick,
    winnerId: match.winnerId,
    decider: match.decider,
    falls: match.falls,
    drill: drill ? {
      scenario: drill.scenario, trial: drill.trial, reset: drill.reset, done: drill.done,
      impact: impact ? {
        force: impact.force, ownRecoil: impact.ownRecoil, dummyRecoil: impact.dummyRecoil, steeringDelay: impact.steeringDelay,
      } : null,
    } : null,
    players: match.players.map(({ id, name, slot, bot, rig, appearance, x, z, vx, vz, angle, alive, rank, grab, powderHop }) => ({
      id, name, slot, bot, rig, appearance, x, z, vx, vz, angle, alive, rank, grab, powderHop,
    })),
    events: match.events.slice(-64),
  };
}
