import * as THREE from 'three';
import { hazardPosition, krakenPoint } from '../shared/arena-hazards.mjs';
import { buildPirateBird, flapBird } from './pirate-bird.js';
import { buildBarrelModel } from './barrel-model.js';
import { cableCrossing, cableTop, hoistEnd } from './arena-cable-route.js';

export function createArenaHazardView(scene, deck = scene) {
  const group = new THREE.Group();
  scene.add(group);
  // Combat paths use the same local frame as collision/player positions.
  // Boats and their wake remain on the sea instead of tilting with the floor.
  const surface = new THREE.Group();
  deck.add(surface);
  const geometry = new THREE.BoxGeometry();
  const surfaces = new Map();
  function box(root, color, x, y, z, w, h, d) {
    if (!surfaces.has(color)) surfaces.set(color, new THREE.MeshLambertMaterial({ color }));
    const mesh = new THREE.Mesh(geometry, surfaces.get(color));
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    root.add(mesh);
    return mesh;
  }
  const { smoothstep, lerp, clamp } = THREE.MathUtils;
  const fade = (t, from, to) => smoothstep(t, from, to);
  const stamp = new THREE.Object3D();
  const fleet = [
    { hull: [1.03, 1.48, 1.76, 1.57, 1.0], length: 1, body: 0x6e473c, rail: 0x3d5855,
      flag: 0xb84e47, cue: 0xffab58, birds: [0xcf5649, 0xe77742, 0xd2904c] },
    { hull: [.86, 1.64, 2.16, 2.07, 1.32], length: 1.18, body: 0x364951, rail: 0x57928b,
      flag: 0x368e78, cue: 0x91e1cc, birds: [0x3aaf80, 0x3395a9, 0x508bb2] },
    { hull: [.66, 1.25, 1.46, 1.35, .70], length: 1.35, body: 0x4d3345, rail: 0x72588f,
      flag: 0x9579b1, cue: 0xe5b5fc, birds: [0x7f64b4, 0x965ca6, 0xb773b1] },
  ];

  function createSweep(paint, index) {
    const root = new THREE.Group();
    group.add(root);
    const laneMaterial = new THREE.MeshBasicMaterial({ color: paint.cue, transparent: true, depthWrite: false });
    const lane = new THREE.InstancedMesh(geometry, laneMaterial, 48);
    surface.add(lane);
    stamp.scale.set(.105, .035, .054);
    for (let i = 0; i < lane.count; i++) {
      stamp.position.set(i < 24 ? -1 : 1, .057, (i % 24 - 11.5) / 12);
      stamp.updateMatrix();
      lane.setMatrixAt(i, stamp.matrix);
    }
    const launch = new THREE.Group();
    root.add(launch);
    const hull = paint.hull;
    launch.scale.set(1, 1, paint.length);
    for (const [i, width] of hull.entries()) {
      box(launch, paint.body, 0, -.64, (i - 2) * .64, width, .56, .66);
      box(launch, 0xb38356, 0, -.31, (i - 2) * .64, width * .90, .14, .61);
      for (const side of [-1, 1]) {
        box(launch, paint.rail, side * width * .46, -.19, (i - 2) * .64, .15, .19, .66);
        box(launch, 0xdec081, side * width * .46, -.068, (i - 2) * .64, .18, .05, .66);
      }
    }
    box(launch, 0x52362e, 0, .10, 0, .88, .65, .84);
    const gun = new THREE.Mesh(new THREE.CylinderGeometry(.27, .20, 1.48, 10), new THREE.MeshLambertMaterial({ color: 0x42474d }));
    gun.rotation.x = Math.PI / 2;
    gun.position.set(0, .53, .48);
    launch.add(gun);
    box(launch, 0x211f27, 0, .53, 1.19, .24, .24, .055);
    box(launch, 0xe7ba69, 0, .91, -.99, .083, 2.35, .085);
    const flag = new THREE.Group();
    flag.position.set(0, 1.92, -.99);
    launch.add(flag);
    box(flag, paint.flag, .38, 0, 0, .75, .42, .056);
    box(flag, 0xffdea1, .31, 0, .039, .24, .19, .035);
    if (index === 1) {
      box(launch, 0x314548, 0, .24, -.85, .99, .72, .73);
      box(launch, 0xd9a963, 0, .67, -.89, 1.11, .19, .77);
      box(launch, 0xffcf71, -.25, .33, -1.24, .16, .20, .045);
    }
    if (index === 2) {
      const sail = box(launch, 0x765d8e, 0, 1.26, -.74, 1.30, .92, .11);
      sail.rotation.y = -.18;
      box(launch, 0xc2a5cc, 0, 1.29, -.67, .35, .29, .075);
      box(launch, 0xa76f56, 0, .13, -1.24, 1.04, .21, .55);
    }
    const wake = new THREE.Group();
    root.add(wake);
    for (const side of [-1, 1]) for (let i = 0; i < 6; i++) {
      box(wake, i % 2 ? 0x74c9bf : 0xa6d8c7, side * (.58 + i * .22), 0, -1.33 - i * .48,
        .25 + i * .075, .035, .40).rotation.y = side * -.35;
    }
    const smoke = new THREE.Group();
    root.add(smoke);
    const puffs = Array.from({ length: 7 }, () => {
      const puff = new THREE.Mesh(geometry,
        new THREE.MeshBasicMaterial({ color: 0xe5c7a0, transparent: true, depthWrite: false }));
      smoke.add(puff);
      return puff;
    });

    const missile = new THREE.Group();
    surface.add(missile);
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(.36, 1),
      new THREE.MeshLambertMaterial({ color: 0x322b36, emissive: 0x5d2411 }));
    missile.add(ball);
    for (let i = 0; i < 5; i++) {
      box(missile, i % 2 ? 0xff963c : 0xffdc7e, (i % 3 - 1) * .15, (i % 2) * .09, -.34 - i * .24,
        .19, .16, .25);
    }
    const flock = new THREE.Group();
    surface.add(flock);
    const birds = [
      { body: 0xcf5649, wings: 0xe0b951, chest: 0xf4da9a, tail: 0x3daaaa },
      { body: 0x3aaf80, wings: 0x56a5d3, chest: 0xf5e198, tail: 0x4d629c },
      { body: 0x7f64b4, wings: 0xd588b0, chest: 0xffd4a2, tail: 0x568f9a },
    ].map((palette, i) => {
      const bird = buildPirateBird(flock, box, { ...palette, body: paint.birds[i], tail: paint.flag });
      bird.model.position.set((i - 1) * .68, i % 2 * .22, i === 1 ? -.5 : .22);
      bird.model.scale.setScalar(1.35);
      return bird;
    });

    return (laneAttack, elapsed, time, radius) => {
      root.visible = Boolean(laneAttack && elapsed >= laneAttack.start && elapsed < laneAttack.exit);
      if (!root.visible) {
        lane.visible = missile.visible = flock.visible = false;
        return;
      }
      const { kind, x, z, width, start, warnAt, fireAt, end, exit, reach, dx, dz } = laneAttack;
      const active = elapsed >= fireAt;
      const cue = fade(elapsed, warnAt, warnAt + .13) * (1 - fade(elapsed, end - .22, end));
      const pulse = .76 + Math.sin(time * 10 + index) * .18;
      const approach = fade(elapsed, start, fireAt);
      const leave = fade(elapsed, end, exit);
      lane.visible = cue > .01;
      launch.visible = kind === 'broadside';
      wake.visible = launch.visible;
      smoke.visible = launch.visible && active && elapsed < fireAt + .82;
      missile.visible = launch.visible && active && elapsed < end + .22;
      flock.visible = kind === 'parrots';
      const yaw = Math.atan2(dx, dz);
      lane.position.set(x, 0, z);
      lane.rotation.y = yaw;
      lane.scale.set(width + .34, 1, Math.min(radius * .98, reach));
      laneMaterial.opacity = cue * (active ? .27 : pulse);
      const point = hazardPosition(laneAttack, elapsed);
      const horizon = Math.max(47, reach + 33);
      if (flock.visible) {
        const flyIn = clamp((elapsed - start) / (fireAt - start), 0, 1) ** 1.4;
        const flyOut = 1 - (1 - clamp((elapsed - end) / (exit - end), 0, 1)) ** 1.24;
        const lead = (flyIn - 1 + flyOut) * (horizon - reach);
        const climb = (1 - approach) * 6.5 + leave * 6.1;
        const drift = Math.sin(approach * Math.PI) * 2 - leave * 4;
        flock.position.set(point.x + dx * lead - dz * drift, .87 + climb + Math.sin(time * 9) * .12,
          point.z + dz * lead + dx * drift);
        flock.rotation.y = yaw + Math.PI;
        flock.rotation.z = Math.sin(time * 3.3) * .13 * (active ? .4 : 1);
        for (const [i, bird] of birds.entries()) flapBird(bird, time * 18 + i + index * 1.7);
        return;
      }
      flag.rotation.x = Math.sin(time * 9) * .16;
      const headingOut = fade(elapsed, end, end + .64);
      const bow = -lerp(horizon, reach + 1.1, approach) - leave * (horizon - reach);
      const curve = (1 - approach) * 5 + leave * 10;
      launch.position.set(x + dx * bow - dz * curve, -.40 + Math.sin(time * 4) * .12, z + dz * bow + dx * curve);
      launch.rotation.set(Math.sin(time * 2.7) * .046, yaw + headingOut * 2.88, Math.sin(time * 3.3) * .07);
      gun.position.z = .48 - .20 * (active ? 1 - fade(elapsed, fireAt, fireAt + .27) : 0);
      wake.position.copy(launch.position).setY(waterline + .03);
      wake.rotation.y = launch.rotation.y;
      wake.scale.setScalar(.34 + (1 - approach) * .66 + leave * .54);
      const overrun = Math.max(0, elapsed - end) * 22;
      missile.position.set(point.x + dx * overrun, .52 + Math.sin((elapsed - fireAt) * 2.7) * .31 - overrun * .24,
        point.z + dz * overrun);
      missile.rotation.y = yaw;
      if (smoke.visible) {
        const age = (elapsed - fireAt) / .82;
        smoke.position.set(x - dx * reach, .15, z - dz * reach);
        smoke.rotation.y = yaw;
        for (const [i, puff] of puffs.entries()) {
          puff.position.set(Math.sin(i * 2.1) * age * .64, .27 + age * (1.1 + i * .09), .25 + age * (.40 + i * .14));
          puff.scale.setScalar(.16 + age * (.36 + i * .031));
          puff.rotation.set(i + age, i * .61, age * 2.1);
          puff.material.opacity = (1 - age) * .62;
        }
      }
    };
  }

  const sweeps = fleet.map(createSweep);
  const ring = new THREE.Mesh(new THREE.RingGeometry(.989, 1, 64),
    new THREE.MeshBasicMaterial({ color: 0xffad60, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  surface.add(ring);
  const cask = new THREE.Group();
  surface.add(cask);
  const powderBarrel = new THREE.Group();
  powderBarrel.position.y = .74;
  powderBarrel.rotation.z = Math.PI / 2;
  buildBarrelModel(powderBarrel, 0xa54030, 0x3f3436);
  cask.add(powderBarrel);
  const wick = box(cask, 0x553a2d, .08, 1.55, 0, .065, .28, .065);
  wick.rotation.z = -.37;
  const fuse = box(cask, 0xffb84c, .13, 1.68, 0, .13, .16, .13);
  const rope = box(surface, 0xc5a77b, 0, 0, 0, .045, 1, .045);
  const beast = new THREE.Group();
  surface.add(beast);
  const stripeMaterial = new THREE.MeshBasicMaterial({ color: 0xbe69ff, transparent: true, depthWrite: false });
  const stripe = new THREE.Mesh(geometry, stripeMaterial);
  const marksMaterial = new THREE.MeshBasicMaterial({ color: 0xffd7ff, transparent: true, depthWrite: false });
  const marks = new THREE.InstancedMesh(geometry, marksMaterial, 52);
  const path = new THREE.Group();
  path.add(stripe, marks);
  beast.add(path);
  stripe.position.y = .044;
  stripe.scale.set(2, .014, 2);
  for (let i = 0; i < marks.count; i++) {
    const side = i % 2 ? 1 : -1;
    const arrow = i >= 36;
    stamp.position.set(side * (arrow ? .22 : .97), .062, arrow ? (Math.floor((i - 36) / 2) - 3.5) / 4.4 : (Math.floor(i / 2) - 8.5) / 9);
    stamp.scale.set(arrow ? .48 : .10, .022, arrow ? .026 : .073);
    stamp.rotation.y = arrow ? side * .072 : 0;
    stamp.updateMatrix();
    marks.setMatrixAt(i, stamp.matrix);
  }
  const limbGeometry = new THREE.CylinderGeometry(.78, 1, 1, 8);
  const limbSkin = new THREE.MeshLambertMaterial({ color: 0x79509c });
  const arm = Array.from({ length: 13 }, (_, index) => {
    const joint = new THREE.Group();
    beast.add(joint);
    const flesh = new THREE.Mesh(limbGeometry, limbSkin);
    joint.add(flesh);
    const cup = box(joint, index % 2 ? 0xe5adab : 0xf3c4ac, 0, 0, .62, .88, .47, .63);
    box(cup, 0xad6c8d, 0, 0, .55, .55, .54, .16);
    return joint;
  });
  const waterline = -1.35;
  const seaRipple = new THREE.Mesh(new THREE.RingGeometry(.73, 1, 36),
    new THREE.MeshBasicMaterial({ color: 0xb4ede0, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  seaRipple.rotation.x = -Math.PI / 2;
  group.add(seaRipple);
  const deckToClip = new THREE.Matrix4();
  const origin = new THREE.Vector3();
  const before = new THREE.Vector3();
  const after = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  return (hazard, elapsed, time, radius, camera) => {
    group.visible = surface.visible = Boolean(hazard);
    if (!hazard) return;
    const { kind, x, z, width, start, warnAt, fireAt, end, exit, reach, dx, dz } = hazard;
    for (const [index, sweep] of sweeps.entries()) sweep(hazard.lanes?.[index], elapsed, time, radius);
    const active = elapsed >= fireAt;
    const cue = fade(elapsed, warnAt, warnAt + .16) * (1 - fade(elapsed, end - .22, end));
    const leave = fade(elapsed, end, exit);
    ring.visible = !hazard.lanes && kind !== 'kraken' && cue > .01;
    cask.visible = kind === 'powder' && !active;
    rope.visible = kind === 'powder';
    beast.visible = kind === 'kraken';
    seaRipple.visible = beast.visible;
    const pulse = .76 + Math.sin(time * 10) * .18;
    if (hazard.lanes) return;
    ring.position.set(x, .055, z);
    ring.scale.setScalar(width * (kind === 'powder' && active ? 1 + (elapsed - fireAt) * .2 : 1));
    ring.material.opacity = cue * pulse * (active ? .36 : .69);
    const landing = fade(elapsed, start, warnAt);
    cask.position.set(x, (1 - landing) * 4.5, z);
    cask.rotation.z = Math.sin(time * 5) * .19 * (1 - landing);
    if (kind === 'powder' && camera) {
      camera.updateMatrixWorld();
      deck.updateWorldMatrix(true, false);
      deckToClip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(deck.matrixWorld);
      const travel = cableCrossing(deckToClip, hazard.side ?? 1, x, z, 5.98, elapsed, start, warnAt, warnAt + .92);
      if (elapsed < warnAt) cask.position.set(travel.x, cask.position.y, travel.z);
      const top = cableTop(deckToClip, travel.x, travel.z);
      const lower = hoistEnd(cask.position.y + 1.48, 2.3, elapsed, warnAt - .10, warnAt);
      rope.visible = lower < top && elapsed < warnAt + .92;
      rope.position.set(travel.x, (lower + top) / 2, travel.z);
      rope.scale.y = Math.max(0, top - lower);
    }
    fuse.scale.setScalar(.13 + pulse * .10);
    if (kind === 'kraken') {
      const reveal = fade(elapsed, start, warnAt);
      const warning = fade(elapsed, warnAt, warnAt + .11) * (1 - fade(elapsed, fireAt, hazard.strikeEnd));
      path.visible = warning > .01;
      path.position.set(x, 0, z);
      path.rotation.y = Math.atan2(dx, dz);
      path.scale.set(width, 1, Math.sqrt(Math.max(.01, radius ** 2 - x ** 2 - z ** 2)));
      stripeMaterial.opacity = warning * (.26 + pulse * .15);
      marksMaterial.opacity = warning * pulse;
      origin.set(x - dx * reach, waterline - .33, z - dz * reach);
      before.copy(origin);
      const windup = reveal * (1 - fade(elapsed, fireAt - .18, fireAt));
      for (const [index, joint] of arm.entries()) {
        const f = (index + 1) / arm.length;
        after.copy(krakenPoint(hazard, elapsed, 2 * reach * f));
        axis.subVectors(after, before);
        const length = axis.length();
        joint.position.copy(before).lerp(after, .5);
        joint.quaternion.setFromUnitVectors(up, axis.normalize());
        if (windup > 0) joint.rotateY(Math.sin(f * 5.5 - (elapsed - start) * 2) * .82 * windup);
        const thickness = lerp(.83, .37, f) * Math.max(.15, reveal);
        joint.scale.set(thickness, length + thickness * .4, thickness);
        before.copy(after);
      }
      const wash = (time * 1.45) % 1;
      seaRipple.position.copy(origin);
      deck.localToWorld(seaRipple.position);
      seaRipple.position.y = waterline + .055;
      seaRipple.scale.setScalar(1 + wash * 2.25);
      seaRipple.material.opacity = clamp(reveal * (1 - wash) * (1 - leave), 0, .86);
    }
  };
}
