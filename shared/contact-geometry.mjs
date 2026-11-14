// Collision helpers operate in deck-local coordinates. Previous coordinates are
// internal to one physics substep, not replicated state or renderer positions.
// The horizontal barrel's end caps/crest extend to .726; a .56 radius allowed
// two visible shells to overlap even when the old solver considered them apart.
export const BARREL_COLLIDER_RADIUS = .74;

function placeAtContact(player, x, z, nx, nz) {
  player.x = x;
  player.z = z;
  const inward = Math.min(0, player.vx * nx + player.vz * nz);
  player.vx -= inward * nx;
  player.vz -= inward * nz;
  return true;
}

function slideAtContact(player, x, z, nx, nz, dx, dz) {
  // A sweep consumes only the inward part of the remaining displacement. Keeping
  // its tangent lets a barrel steer along a crate face/corner instead of losing
  // all movement every frame while its input still points slightly into it.
  const inward = Math.min(0, dx * nx + dz * nz);
  return placeAtContact(player, x + dx - inward * nx + nx * 1e-7,
    z + dz - inward * nz + nz * 1e-7, nx, nz);
}

function rayCircle(x, z, dx, dz, radius) {
  const a = dx * dx + dz * dz;
  const b = x * dx + z * dz;
  const c = x * x + z * z - radius * radius;
  if (a < 1e-14 || c < 0 || b >= 0) return null;
  const determinant = b * b - a * c;
  if (determinant < 0) return null;
  const t = (-b - Math.sqrt(determinant)) / a;
  return t >= 0 && t <= 1 ? t : null;
}

export function blockCircle(center, player, radius) {
  const x = player.x - center.x, z = player.z - center.z;
  const distance = Math.hypot(x, z);
  const fromX = player.stepX ?? player.x, fromZ = player.stepZ ?? player.z;
  const startInside = Math.hypot(fromX - center.x, fromZ - center.z) < radius - 1e-9;
  if (distance < radius - 1e-9 && startInside) {
    const nx = distance > 1e-9 ? x / distance : 1;
    const nz = distance > 1e-9 ? z / distance : 0;
    return placeAtContact(player, center.x + nx * radius, center.z + nz * radius, nx, nz);
  }
  if (startInside) return false;
  const dx = player.x - fromX, dz = player.z - fromZ;
  const t = rayCircle(fromX - center.x, fromZ - center.z, dx, dz, radius);
  if (t === null) return false;
  const nx = (fromX + dx * t - center.x) / radius;
  const nz = (fromZ + dz * t - center.z) / radius;
  if (dx * nx + dz * nz >= -1e-8) return false;
  return slideAtContact(player, fromX + dx * t, fromZ + dz * t, nx, nz, dx * (1 - t), dz * (1 - t));
}

export function blockBox(center, player, half, radius = BARREL_COLLIDER_RADIUS) {
  const x = player.x - center.x, z = player.z - center.z;
  const closestX = Math.max(-half, Math.min(half, x));
  const closestZ = Math.max(-half, Math.min(half, z));
  const gapX = x - closestX, gapZ = z - closestZ;
  const distance = Math.hypot(gapX, gapZ);
  const fromX = (player.stepX ?? player.x) - center.x;
  const fromZ = (player.stepZ ?? player.z) - center.z;
  const startInside = Math.hypot(Math.max(0, Math.abs(fromX) - half), Math.max(0, Math.abs(fromZ) - half)) < radius - 1e-9;
  if (distance < radius - 1e-9 && startInside) {
    if (distance > 1e-9) {
      const nx = gapX / distance, nz = gapZ / distance;
      return placeAtContact(player, center.x + closestX + nx * radius, center.z + closestZ + nz * radius, nx, nz);
    }
    const sideX = Math.sign(x) || Math.sign((player.stepX ?? player.x) - center.x) || 1;
    const sideZ = Math.sign(z) || Math.sign((player.stepZ ?? player.z) - center.z) || 1;
    return half - Math.abs(x) <= half - Math.abs(z)
      ? placeAtContact(player, center.x + sideX * (half + radius), player.z, sideX, 0)
      : placeAtContact(player, player.x, center.z + sideZ * (half + radius), 0, sideZ);
  }
  if (startInside) return false;
  const dx = x - fromX, dz = z - fromZ;
  let best = null;
  const accept = (t, nx, nz) => {
    if (t >= 0 && t <= 1 && dx * nx + dz * nz < -1e-8 && (!best || t < best.t)) best = { t, nx, nz };
  };
  for (const side of [-1, 1]) {
    if (Math.abs(dx) > 1e-12) {
      const t = (side * (half + radius) - fromX) / dx;
      if (Math.abs(fromZ + dz * t) <= half) accept(t, side, 0);
    }
    if (Math.abs(dz) > 1e-12) {
      const t = (side * (half + radius) - fromZ) / dz;
      if (Math.abs(fromX + dx * t) <= half) accept(t, 0, side);
    }
    for (const other of [-1, 1]) {
      const t = rayCircle(fromX - side * half, fromZ - other * half, dx, dz, radius);
      if (t === null) continue;
      const px = fromX + dx * t, pz = fromZ + dz * t;
      if (px * side >= half && pz * other >= half) accept(t, (px - side * half) / radius, (pz - other * half) / radius);
    }
  }
  if (!best) return false;
  return slideAtContact(player, center.x + fromX + dx * best.t,
    center.z + fromZ + dz * best.t, best.nx, best.nz, dx * (1 - best.t), dz * (1 - best.t));
}
