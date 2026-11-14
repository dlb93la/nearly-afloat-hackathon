import { MathUtils } from 'three';

// Clip-space horizontal travel keeps the hoist at the same screen height as
// it crosses. The endpoints stay beyond the side edges even on a narrow screen.
export function cableCrossing(matrix, side, x, z, height, elapsed, start, touchdown, exit = touchdown + (touchdown - start)) {
  const m = matrix.elements;
  let dx = m[9], dz = -m[1];
  const horizontal = m[0] * dx + m[8] * dz;
  if (Math.abs(horizontal) < 1e-9) {
    dx = m[0];
    dz = m[8];
  }
  const scale = m[0] * dx + m[8] * dz;
  const center = m[0] * x + m[4] * height + m[8] * z + m[12];
  const span = 1.4 + Math.abs(center) + Math.abs(m[4]) * 8;
  const fraction = Math.max(0, Math.min(1, (elapsed - start) / (touchdown - start)));
  const slide = fraction < .2 ? fraction ** 2 / .36 : (fraction - .10) / .90;
  const departure = MathUtils.smoothstep(elapsed, touchdown, exit);
  const travel = side * span * (1 - slide - departure) / (scale || 1);
  return { x: x + dx * travel, z: z + dz * travel };
}

export function cableTop(matrix, x, z) {
  const m = matrix.elements;
  if (Math.abs(m[5]) < .00001) return 100;
  return Math.max(7, (1.09 - m[1] * x - m[9] * z - m[13]) / m[5]);
}

export function hoistEnd(rest, clearance, elapsed, releasedAt, touchdown) {
  return rest + clearance * MathUtils.smoothstep(elapsed, releasedAt, touchdown + .36);
}
