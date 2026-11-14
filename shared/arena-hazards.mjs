import { BARREL_COLLIDER_RADIUS } from './contact-geometry.mjs';

export const ARENA_TILE = 1.04;
export const HAZARD_LABELS = {
  broadside: ['Fleet lining up', 'Cannon crossfire'],
  parrots: ['Flocks inbound', 'Parrot crossfire'],
  'anchor-drop': ['Anchor overhead', 'Anchor broke the deck'],
  'crate-drop': ['Cargo overhead', 'Barrels falling'],
  'barrel-roll': ['Raiding boat incoming', 'Barrels rolling'],
  collapse: ['Deck breaking', 'Mind the hole'],
  powder: ['Powder fuse lit', 'Powder blast'],
  kraken: ['Dodge the tentacle', 'Kraken sweep'],
};

export const CARGO_HAZARDS = ['anchor-drop', 'crate-drop', 'barrel-roll'];
export const DROP_BARREL_SCALE = .62;
export const DROP_BARREL_RADIUS = .61 * DROP_BARREL_SCALE;
export const MINI_FUSE_SECONDS = 2;
export const MINI_BLAST_REACH = 2 * ARENA_TILE;
export const POWDER_REACH = 6 * ARENA_TILE;

export function powderFlightHeight(flight, elapsed) {
  if (!flight) return 0;
  const progress = Math.max(0, Math.min(1, (elapsed - flight.start) / (flight.end - flight.start)));
  return Math.sin(progress * Math.PI) * 1.55;
}
export const DROP_CRATES = 4;
export const ROLLING_BARRELS = 3;
const OPTIONS = {
  'anchor-drop': { approach: 2.05, warning: 1.02, duration: .9, retreat: 1.4 },
  'crate-drop': { approach: 2.45, warning: 1.01, duration: .7, retreat: .9, width: DROP_BARREL_RADIUS },
  'barrel-roll': { approach: 2.65, warning: .96, duration: 1.72, retreat: 1.3, width: .58, kick: 15.7, stagger: .26 },
  broadside: { approach: 3.35, warning: .92, duration: 1.12, retreat: 3.1, width: .74, kick: 10.4, stagger: .66 },
  parrots: { approach: 2.55, warning: .83, duration: 1.46, retreat: 2.2, width: .92, kick: 8.4, stagger: .57 },
  collapse: { approach: .47, warning: 1.04, duration: .84, retreat: 0 },
  powder: { approach: 1.38, warning: .92, duration: .78, retreat: .30, width: POWDER_REACH, kick: 10.4 },
  kraken: { approach: 1.7, warning: .88, duration: .78, retreat: .48, width: 1.05 },
};

export function hazardTiming(kind, start, id = 0) {
  const { approach, warning, duration, retreat, stagger = 0 } = OPTIONS[kind];
  const warnAt = start + approach;
  const fireAt = warnAt + warning;
  const end = fireAt + duration + 2 * stagger;
  return { kind, id, start, warnAt, fireAt, end, exit: end + retreat };
}

export function arenaHazardPlan(random, previousKind, choices = Object.keys(OPTIONS).filter(kind => kind !== 'collapse')) {
  const remaining = [...choices];
  const first = remaining.filter(kind => kind !== previousKind);
  const openers = first.length ? first : remaining;
  const opener = openers[Math.floor(random() * openers.length)];
  const kinds = [opener];
  remaining.splice(remaining.indexOf(opener), 1);
  while (kinds.length < 3 && remaining.length) kinds.push(remaining.splice(Math.floor(random() * remaining.length), 1)[0]);
  let next = 1.65 + random() * 1.25;
  return kinds.map((kind, id) => {
    const plan = hazardTiming(kind, next, id);
    next = plan.exit + 1.25 + random() * 2.1;
    return plan;
  });
}

export function placeArenaHazard(plan, radius, random) {
  const opts = OPTIONS[plan.kind];
  if (plan.kind === 'kraken') {
    const angle = random() * Math.PI * 2;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const offset = (random() - .5) * radius * .58;
    return { ...plan, dx, dz, x: -dz * offset, z: dx * offset, reach: radius + 1.95, width: opts.width,
      strikeEnd: plan.fireAt + .12, pullAt: plan.fireAt + .12 };
  }
  if (plan.kind === 'barrel-roll') {
    const angle = random() * Math.PI * 2;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const offset = (random() - .5) * radius * .52;
    const reach = radius + 2.2;
    const lanes = Array.from({ length: ROLLING_BARRELS }, (_, slot) => {
      const gap = (slot - 1) * 1.38 + (random() - .5) * .32;
      const heading = angle + (random() - .5) * .17;
      const fireAt = plan.fireAt + slot * opts.stagger;
      return { ...plan, slot, dx: Math.cos(heading), dz: Math.sin(heading), reach, startReach: radius * (.66 + random() * .10), width: opts.width,
        fireAt, end: fireAt + opts.duration - slot * .075, x: -dz * (offset + gap), z: dx * (offset + gap) };
    });
    return { ...plan, lanes, dx, dz, reach, x: -dz * offset, z: dx * offset };
  }
  if (plan.kind === 'crate-drop') {
    const angle = random() * Math.PI * 2;
    const approach = random() * Math.PI * 2;
    const drops = Array.from({ length: DROP_CRATES }, (_, slot) => {
      const landing = angle + slot * Math.PI / 2 + (random() - .5) * .74;
      const heading = approach - slot * Math.PI / 2 + (random() - .5) * .61;
      const reach = radius * (.18 + random() * .49);
      return { ...plan, id: plan.id * DROP_CRATES + slot, dx: Math.cos(heading), dz: Math.sin(heading),
        x: Math.round(Math.cos(landing) * reach / ARENA_TILE) * ARENA_TILE,
        z: Math.round(Math.sin(landing) * reach / ARENA_TILE) * ARENA_TILE,
        side: (slot + plan.id) % 2 ? 1 : -1, width: DROP_BARREL_RADIUS, fireAt: plan.fireAt + slot * .065 };
    });
    return { ...plan, drops };
  }
  if (['collapse', 'powder', 'anchor-drop'].includes(plan.kind)) {
    const angle = random() * Math.PI * 2;
    const requested = radius * (.26 + random() * .32);
    const range = Math.min(Math.max(0, radius - (plan.kind === 'powder' ? 4.4 : .7)), requested);
    const x = Math.round(Math.cos(angle) * range / ARENA_TILE) * ARENA_TILE;
    const z = Math.round(Math.sin(angle) * range / ARENA_TILE) * ARENA_TILE;
    const hazard = { ...plan, x, z, side: Math.cos(angle) < 0 ? -1 : 1,
      dx: Math.cos(angle), dz: Math.sin(angle), reach: radius + 3.4, width: opts.width ?? ARENA_TILE * (plan.kind === 'anchor-drop' || (radius > 6 && random() < .68) ? 1.38 : .88) };
    if (plan.kind === 'powder') {
      const startX = random() < .5 ? -2 : -1;
      const startZ = random() < .5 ? -2 : -1;
      const tiles = [];
      for (let row = startZ; row < startZ + 4; row++) {
        for (let col = startX; col < startX + 4; col++) {
          if (col || row) tiles.push({ col, row, order: random() });
        }
      }
      tiles.sort((a, b) => a.order - b.order);
      hazard.damage = tiles.slice(0, 4 + Math.floor(random() * 4)).map(({ col, row }, index) => ({
        col, row, delay: .48 + index * .24 + random() * .12,
      }));
    }
    return hazard;
  }
  const heading = random() * Math.PI * 2;
  const handedness = random() < .5 ? -1 : 1;
  const lanes = Array.from({ length: 3 }, (_, slot) => {
    const angle = heading + handedness * slot * Math.PI * 2 / 3 + (random() - .5) * .32;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const offset = (random() - .5) * radius * .64;
    const delay = slot * opts.stagger;
    const fireAt = plan.fireAt + delay;
    const end = fireAt + opts.duration;
    return { kind: plan.kind, slot, dx, dz, x: -dz * offset, z: dx * offset, reach: radius + 2.3,
      width: opts.width, start: plan.start + delay, warnAt: plan.warnAt + delay, fireAt, end, exit: end + opts.retreat };
  });
  return { ...plan, lanes };
}

export function hazardPosition(hazard, elapsed) {
  const stop = hazard.strikeEnd ?? hazard.end;
  const progress = Math.max(0, Math.min(1, (elapsed - hazard.fireAt) / (stop - hazard.fireAt)));
  const startReach = hazard.startReach ?? hazard.reach;
  const along = progress * (hazard.reach + startReach) - startReach;
  return { x: hazard.x + hazard.dx * along, z: hazard.z + hazard.dz * along };
}

export function krakenPoint(hazard, elapsed, along, cross = 0) {
  const smooth = value => {
    const p = Math.max(0, Math.min(1, value));
    return p * p * (3 - 2 * p);
  };
  const originX = hazard.x - hazard.dx * hazard.reach;
  const originZ = hazard.z - hazard.dz * hazard.reach;
  if (elapsed < hazard.fireAt) {
    const span = along / (2 * hazard.reach);
    const rise = smooth((elapsed - hazard.start) / (hazard.warnAt - hazard.start));
    const drop = smooth((elapsed - hazard.fireAt + .18) / .18);
    const curl = span * (1.4 + .75 * span);
    const phase = span * Math.PI * 2.2 - (elapsed - hazard.start) * 1.9;
    const upright = (1 - drop) * rise;
    const forward = (span * .38 + Math.cos(phase) * curl * .58) * upright + along * drop;
    const sideways = Math.sin(phase) * curl * upright;
    return {
      x: originX + hazard.dx * forward - hazard.dz * (cross + sideways),
      z: originZ + hazard.dz * forward + hazard.dx * (cross + sideways),
      y: -1.68 + span * 9.1 * upright + Math.min(1, along / 2) * 2.30 * drop,
    };
  }
  const lift = smooth((elapsed - hazard.strikeEnd) / .20);
  const retract = smooth((elapsed - hazard.strikeEnd - .20) / (hazard.end - hazard.strikeEnd - .20));
  const length = along * (1 - retract);
  const angle = lift * 1.12;
  return {
    x: originX + hazard.dx * length * Math.cos(angle) - hazard.dz * cross * (1 - retract),
    z: originZ + hazard.dz * length * Math.cos(angle) + hazard.dx * cross * (1 - retract),
    y: -1.68 + (Math.min(1, along / 2) * 2.30 + Math.sin(angle) * Math.min(along, 4.8)) * (1 - retract),
  };
}

function sweepContact(hazard, elapsed, previous, player, radius) {
  const { dx, dz } = hazard;
  const start = Math.max(previous, hazard.fireAt), end = Math.min(elapsed, hazard.end);
  const from = hazardPosition(hazard, start), to = hazardPosition(hazard, end);
  const span = elapsed - previous;
  const motionX = player.x - (player.stepX ?? player.x), motionZ = player.z - (player.stepZ ?? player.z);
  const a = span > 0 ? (start - previous) / span : 1;
  const b = span > 0 ? (end - previous) / span : 1;
  const relativeX = from.x - (player.stepX ?? player.x) - motionX * a;
  const relativeZ = from.z - (player.stepZ ?? player.z) - motionZ * a;
  const travelX = to.x - from.x - motionX * (b - a);
  const travelZ = to.z - from.z - motionZ * (b - a);
  const lengthSquared = travelX ** 2 + travelZ ** 2;
  const t = lengthSquared > 1e-12 ? Math.max(0, Math.min(1, -(relativeX * travelX + relativeZ * travelZ) / lengthSquared)) : 0;
  const offsetX = -(relativeX + travelX * t), offsetZ = -(relativeZ + travelZ * t);
  return Math.hypot(offsetX, offsetZ) <= radius ? offsetX * -dz + offsetZ * dx : null;
}

export function krakenCatches(hazard, elapsed, previous, player) {
  if (elapsed < hazard.fireAt || previous >= hazard.strikeEnd) return false;
  const fromX = hazard.x - hazard.dx * hazard.reach;
  const fromZ = hazard.z - hazard.dz * hazard.reach;
  const length = hazard.reach * 2;
  const span = elapsed - previous;
  const start = span > 0 ? Math.max(0, (hazard.fireAt - previous) / span) : 1;
  const end = span > 0 ? Math.min(1, (hazard.strikeEnd - previous) / span) : 1;
  const beforeX = player.stepX ?? player.x, beforeZ = player.stepZ ?? player.z;
  const x = beforeX + (player.x - beforeX) * start - fromX;
  const z = beforeZ + (player.z - beforeZ) * start - fromZ;
  const along = x * hazard.dx + z * hazard.dz;
  const cross = x * -hazard.dz + z * hazard.dx;
  const moveX = (player.x - beforeX) * (end - start), moveZ = (player.z - beforeZ) * (end - start);
  const da = moveX * hazard.dx + moveZ * hazard.dz, dc = moveX * -hazard.dz + moveZ * hazard.dx;
  const candidates = [0, 1];
  if (Math.abs(da) > 1e-12) candidates.push(-along / da, (length - along) / da);
  if (Math.abs(dc) > 1e-12) candidates.push(-cross / dc);
  const speedSquared = da * da + dc * dc;
  if (speedSquared > 1e-12) candidates.push(-(along * da + cross * dc) / speedSquared,
    -((along - length) * da + cross * dc) / speedSquared);
  return candidates.some(t => t >= 0 && t <= 1 &&
    Math.hypot(Math.max(0, -(along + da * t), along + da * t - length), cross + dc * t) <= hazard.width);
}

export function powderPush({ x, z }, player, reach, kick, falloff, curve = 1) {
  const dx = player.x - x, dz = player.z - z;
  const distance = Math.hypot(dx, dz);
  if (distance > reach) return null;
  const force = kick * (1 - falloff * (distance / reach) ** curve);
  return distance > .001 ? { x: dx / distance * force, z: dz / distance * force } : { x: force, z: 0 };
}

export function hazardPush(hazard, elapsed, previous, player) {
  const { kind, fireAt, end, width } = hazard;
  if (elapsed < fireAt || previous >= end || previous >= (hazard.fallAt ?? Infinity) ||
    ['collapse', 'kraken', 'anchor-drop', 'crate-drop'].includes(kind)) return null;
  if (kind === 'powder') {
    if (previous >= fireAt) return null;
    return powderPush(hazard, player, width, OPTIONS.powder.kick, .71, 2);
  }
  const { dx, dz } = hazard;
  const contactRadius = width + (kind === 'barrel-roll' ? BARREL_COLLIDER_RADIUS : .36);
  const cross = sweepContact(hazard, Math.min(elapsed, hazard.fallAt ?? Infinity), previous, player, contactRadius);
  if (cross === null) return null;
  // Attenuate across the lane, independently of the physics step that first touches the target.
  const kick = OPTIONS[kind].kick * (1 - .48 * (cross / contactRadius) ** 2);
  if (kind === 'broadside' || kind === 'barrel-roll') return { x: dx * kick, z: dz * kick };
  const side = Math.sign(cross) || 1;
  return { x: (dx * .37 - dz * side * .93) * kick, z: (dz * .37 + dx * side * .93) * kick };
}

export function holeMargin(hazard, x, z, elapsed) {
  if (!['collapse', 'anchor-drop', 'blast-tile'].includes(hazard?.kind) || elapsed < hazard.fireAt) return Infinity;
  const dx = Math.abs(x - hazard.x);
  const dz = Math.abs(z - hazard.z);
  if (hazard.kind === 'blast-tile') return Math.max(dx, dz) - ARENA_TILE / 2;
  const half = ARENA_TILE / 2;
  const reach = half + (hazard.width >= ARENA_TILE ? ARENA_TILE : 0);
  return Math.min(Math.max(dx - reach, dz - half), Math.max(dx - half, dz - reach)) + .12;
}

export function blastTiles(hazard) {
  const { x, z, fireAt } = hazard;
  return [{ kind: 'blast-tile', x, z, fireAt }, ...(hazard.damage ?? []).map(tile => ({
    kind: 'blast-tile', x: x + tile.col * ARENA_TILE, z: z + tile.row * ARENA_TILE,
    fireAt: fireAt + tile.delay,
  }))];
}

export function holeCoversTile(hazard, x, z) {
  return hazard.kind === 'blast-tile'
    ? Math.max(Math.abs(x - hazard.x), Math.abs(z - hazard.z)) < ARENA_TILE / 2
    : Math.hypot(x - hazard.x, z - hazard.z) <= hazard.width;
}

export function rollingExitAt(lane, radius) {
  // Intersect the line of travel with the edge of the remaining deck.
  const along = lane.x * lane.dx + lane.z * lane.dz;
  const offsetSquared = lane.x ** 2 + lane.z ** 2 - along ** 2;
  if (offsetSquared >= radius ** 2) return lane.fireAt;
  const edge = Math.sqrt(radius ** 2 - offsetSquared) - along;
  const fraction = Math.max(0, Math.min(1, (edge + lane.startReach) / (lane.reach + lane.startReach)));
  return lane.fireAt + fraction * (lane.end - lane.fireAt);
}

export function arenaHazardCue(hazard, elapsed) {
  if (!hazard || elapsed < hazard.warnAt || elapsed >= hazard.end) return null;
  return HAZARD_LABELS[hazard.kind][Number(elapsed >= hazard.fireAt)];
}

export function evadeArenaHazard(hazard, elapsed, player) {
  if (!hazard || elapsed < hazard.warnAt || (elapsed >= hazard.end && hazard.kind !== 'collapse')) return null;
  if (hazard.kind === 'blast-tile') return null;
  if (hazard.drops) return null;
  if (hazard.lanes) {
    for (const lane of hazard.lanes) {
      const dodge = evadeArenaHazard(lane, elapsed, player);
      if (dodge) return dodge;
    }
    return null;
  }
  const { kind, fireAt, x, z, width, dx, dz } = hazard;
  const aheadX = player.x + player.vx * .24 - x;
  const aheadZ = player.z + player.vz * .24 - z;
  if (['collapse', 'anchor-drop', 'crate-drop', 'powder'].includes(kind)) {
    if (kind !== 'collapse' && kind !== 'anchor-drop' && elapsed > fireAt) return null;
    const distance = Math.hypot(aheadX, aheadZ);
    if (distance > width + .61) return null;
    const divisor = Math.max(.001, distance);
    return { x: aheadX / divisor - player.vx * .06, z: aheadZ / divisor - player.vz * .06 };
  }
  const cross = aheadX * -dz + aheadZ * dx;
  if (kind === 'kraken' && elapsed >= hazard.strikeEnd) return null;
  if (Math.abs(cross) > width + .68 || (kind !== 'kraken' && fireAt - elapsed > .9)) return null;
  const position = hazardPosition(hazard, elapsed);
  if (elapsed > fireAt && (position.x - player.x) * dx + (position.z - player.z) * dz > 1.8) return null;
  const side = Math.sign(cross) || (player.slot % 2 ? 1 : -1);
  return { x: -dz * side - player.vx * .08, z: dx * side - player.vz * .08 };
}

export function crateOnDeck(crate, radius, holes, elapsed) {
  return Math.hypot(crate.x, crate.z) + .25 <= radius
    && holes.every(hole => holeMargin(hole, crate.x, crate.z, elapsed) >= 0);
}

export function cargoDescent(hazard, elapsed, duration = .43) {
  const progress = Math.max(0, Math.min(1, (elapsed - hazard.fireAt + duration) / duration));
  return 1 - progress ** 2;
}
