import * as THREE from 'three';

const WATER_GAP = 1.15;

// The rectangular envelope also covers the trim and the ship's rocking motion.
export function fleetChannel(boats) {
  const berths = boats.filter(({ vessel }) => !vessel.merchant && !vessel.expedition)
    .map(({ boat, vessel }) => ({
      x: boat.position.x,
      z: boat.position.z,
      cos: Math.cos(vessel.angle),
      sin: Math.sin(vessel.angle),
      halfBeam: vessel.beam * vessel.scale / 2 + WATER_GAP,
      halfLength: vessel.length * vessel.scale / 2 + WATER_GAP,
    }));
  return (x, z, radius = 0) => berths.some(berth => {
    const dx = x - berth.x;
    const dz = z - berth.z;
    return Math.abs(dx * berth.cos - dz * berth.sin) < berth.halfBeam + radius
      && Math.abs(dx * berth.sin + dz * berth.cos) < berth.halfLength + radius;
  });
}

// Repack the original coast blocks only when the responsive layout changes.
export function createShoreBatch(parent, box, material, cells) {
  const shore = new THREE.InstancedMesh(box, material, cells.length);
  const stamp = new THREE.Object3D();
  const tint = new THREE.Color();
  const origin = new THREE.Vector3();
  shore.name = 'Shore blocks';
  parent.add(shore);
  return channel => {
    parent.getWorldPosition(origin);
    let count = 0;
    for (const { x, y, z, w, h, d, color } of cells) {
      if (channel(origin.x + x, origin.z + z, Math.hypot(w, d) / 2)) continue;
      stamp.position.set(x, y, z);
      stamp.scale.set(w, h, d);
      stamp.updateMatrix();
      shore.setMatrixAt(count, stamp.matrix);
      shore.setColorAt(count, tint.setHex(color));
      count++;
    }
    shore.count = count;
    shore.instanceMatrix.needsUpdate = true;
    if (shore.instanceColor) shore.instanceColor.needsUpdate = true;
    shore.computeBoundingSphere();
  };
}
