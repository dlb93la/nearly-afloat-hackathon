import { blockBox, blockCircle, BARREL_COLLIDER_RADIUS } from './contact-geometry.mjs';

export const EXPERIMENTAL_TRAPS = new Set(['anchor', 'crate', 'seesaw']);

export const ANCHOR_COUNT = 5;
export const CRATE_COUNT = 7;
export const ANCHOR_LENGTH = 4.5;
export const ANCHOR_PIVOT = ANCHOR_LENGTH + .65;
export const CRATE_HALF = .72;
export const CRATE_SHOCK = 2.15;
export const SEESAW_HEIGHT = 1;
export const CRANE_REACH = 1.45;
export const CRANE_POST_WIDTH = .22;
const CRANE_CLEARANCE = BARREL_COLLIDER_RADIUS + Math.SQRT2 * CRANE_POST_WIDTH / 2;
const ANCHOR_MASS = .7;
const ANCHOR_CONTACT = .92;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const progress = (elapsed, from, to) => clamp((elapsed - from) / (to - from), 0, 1);
const smooth = value => value * value * (3 - 2 * value);

function crane(x, z, slot, speed) {
  return { x, z, postX: x, postZ: z - CRANE_REACH, yaw: 0,
    turnRate: (slot % 2 ? -1 : 1) * (speed + slot * .024), pivotVX: 0, pivotVZ: 0 };
}

export function turnCrane(piece, previous, elapsed) {
  const dt = elapsed - previous;
  if (!(dt > 0)) { piece.pivotVX = piece.pivotVZ = 0; return; }
  const warning = piece.fireAt == null ? Infinity : piece.fireAt - .95;
  const locked = Math.max(0, Math.min(elapsed, piece.end ?? Infinity) - Math.max(previous, warning));
  const oldX = piece.x;
  const oldZ = piece.z;
  piece.yaw += piece.turnRate * Math.max(0, dt - locked);
  piece.x = piece.postX + Math.sin(piece.yaw) * CRANE_REACH;
  piece.z = piece.postZ + Math.cos(piece.yaw) * CRANE_REACH;
  piece.pivotVX = (piece.x - oldX) / dt;
  piece.pivotVZ = (piece.z - oldZ) / dt;
}

export function blockWithCrane(piece, player) {
  return blockCircle({ x: piece.postX, z: piece.postZ }, player, CRANE_CLEARANCE);
}

export function createExperimentalTrap(kind) {
  if (kind === 'anchor') {
    const positions = [[0, 0], [-4.8, 3.6], [4.8, -3.6], [-4.1, -4.6], [4.2, 4.1]];
    return { kind, experimental: true, start: 0, fireAt: 0, end: 50, exit: 50,
      anchors: positions.map(([x, z], slot) => ({ ...crane(x, z, slot, .22),
        dx: 0, dy: -ANCHOR_LENGTH, dz: 0, vx: 0, vy: 0, vz: 0 })) };
  }
  if (kind === 'crate') {
    const positions = [[0, 0], [-4.5, 3.8], [4.5, -3.8], [-4.1, -4.6], [4.3, 4.3], [-5.8, -.3], [5.9, .1]];
    return { kind, experimental: true, start: 0, fireAt: 2.2, end: 12, exit: 50,
      crates: positions.map(([x, z], slot) => {
        const fireAt = 2.2 + slot * 1.25;
        return { ...crane(x, z, slot, .36), fireAt, end: fireAt + 1.8 };
      }) };
  }
  return { kind, experimental: true, start: 0, fireAt: 0, end: 50, exit: 50, tiltX: .044, tiltZ: 0 };
}

export function createRoundTrap(random) {
  return random() < .75 ? null : createExperimentalTrap('seesaw');
}

function constrainVelocity(anchor) {
  const radial = (anchor.dx * anchor.vx + anchor.dy * anchor.vy + anchor.dz * anchor.vz) / ANCHOR_LENGTH ** 2;
  anchor.vx -= anchor.dx * radial;
  anchor.vy -= anchor.dy * radial;
  anchor.vz -= anchor.dz * radial;
}

export function stepAnchor(anchor, players, dt, strength) {
  // A point mass on a rigid chain. Gravity restores the swing, and drag removes energy over time.
  const drag = Math.exp(-.42 * dt);
  const centripetal = CRANE_REACH * anchor.turnRate ** 2;
  anchor.vx = (anchor.vx + Math.sin(anchor.yaw) * centripetal * dt) * drag;
  anchor.vy = (anchor.vy - 16 * dt) * drag;
  anchor.vz = (anchor.vz + Math.cos(anchor.yaw) * centripetal * dt) * drag;
  constrainVelocity(anchor);
  anchor.dx += anchor.vx * dt;
  anchor.dy += anchor.vy * dt;
  anchor.dz += anchor.vz * dt;
  const correction = ANCHOR_LENGTH / Math.hypot(anchor.dx, anchor.dy, anchor.dz);
  anchor.dx *= correction;
  anchor.dy *= correction;
  anchor.dz *= correction;
  constrainVelocity(anchor);

  const contacts = [];
  if (ANCHOR_PIVOT + anchor.dy > 1.7) return contacts;
  for (const player of players) {
    if (!player.alive || player.grab) continue;
    const dx = player.x - anchor.x - anchor.dx;
    const dz = player.z - anchor.z - anchor.dz;
    const distance = Math.hypot(dx, dz);
    if (distance >= ANCHOR_CONTACT || distance < .0001) continue;
    const nx = dx / distance;
    const nz = dz / distance;
    player.x += nx * (ANCHOR_CONTACT - distance);
    player.z += nz * (ANCHOR_CONTACT - distance);
    const playerSpeed = player.vx * nx + player.vz * nz;
    const anchorSpeed = (anchor.vx + anchor.pivotVX) * nx + (anchor.vz + anchor.pivotVZ) * nz;
    const closing = anchorSpeed - playerSpeed;
    if (closing <= 0) continue;

    // Apply equal and opposite impulses. The chain only accepts the tangential component.
    const radial = (anchor.dx * nx + anchor.dz * nz) / ANCHOR_LENGTH;
    const inversePlayerMass = 1 / player.profile.mass;
    const inverseAnchorMass = 1 / ANCHOR_MASS;
    const restitution = Math.min(.88, .42 * strength);
    const impulse = (1 + restitution) * closing / (inversePlayerMass + (1 - radial ** 2) * inverseAnchorMass);
    const delta = impulse * inversePlayerMass;
    player.vx += nx * delta;
    player.vz += nz * delta;
    anchor.vx -= nx * impulse * inverseAnchorMass;
    anchor.vz -= nz * impulse * inverseAnchorMass;
    constrainVelocity(anchor);

    if (closing > .85) contacts.push({ player, nx, nz, force: delta, fromAnchor: anchorSpeed > -playerSpeed });
  }
  return contacts;
}

export function crateHeight(crate, elapsed) {
  if (crate.fireAt === null) return 5.4;
  const drop = progress(elapsed, crate.fireAt - .34, crate.fireAt);
  const lift = smooth(progress(elapsed, crate.end - .72, crate.end));
  return 5.4 * (1 - drop ** 2 + lift);
}

export function blockWithCrate(crate, elapsed, player) {
  if (crate.fireAt === null || elapsed < crate.fireAt || elapsed >= crate.end || crateHeight(crate, elapsed) > 1.25) return false;
  return blockWithSolidCrate(crate, player);
}

export function blockWithSolidCrate(crate, player, half = CRATE_HALF) {
  return blockBox(crate, player, half);
}
export function updateSeesaw(trap, active, elapsed, dt) {
  let momentX = 0;
  let momentZ = 0;
  let mass = 0;
  for (const player of active) {
    momentX += player.x * player.profile.mass;
    momentZ += player.z * player.profile.mass;
    mass += player.profile.mass;
  }
  const scale = Math.min(.095 / Math.max(1, mass), .25 / (Math.hypot(momentX, momentZ) || 1));
  // The pivot keeps rocking even when the load is balanced. Riders still drive the larger tilt.
  const rock = elapsed * 2.4;
  const response = 1 - Math.exp(-dt * 4.5);
  trap.tiltX += (.044 * Math.cos(rock) + momentX * scale - trap.tiltX) * response;
  trap.tiltZ += (.034 * Math.sin(rock) + momentZ * scale - trap.tiltZ) * response;
}
