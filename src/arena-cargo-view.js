import * as THREE from 'three';
import { buildBarrelModel } from './barrel-model.js';
import { cableCrossing, cableTop, hoistEnd } from './arena-cable-route.js';
import { ARENA_TILE, CARGO_HAZARDS, DROP_BARREL_SCALE, DROP_CRATES, MINI_BLAST_REACH, ROLLING_BARRELS, cargoDescent, hazardPosition } from '../shared/arena-hazards.mjs';

export function createArenaCargoView(deck) {
  const root = new THREE.Group();
  deck.add(root);
  const moving = new THREE.Group();
  root.add(moving);
  const box = new THREE.BoxGeometry();
  const materials = new Map();
  const iron = 0x4a5964;
  const brass = 0xdab67a;
  const fuseMaterial = new THREE.MeshBasicMaterial({ color: 0xffbc68 });
  function block(parent, color, x, y, z, w, h, d) {
    if (!materials.has(color)) materials.set(color, new THREE.MeshLambertMaterial({ color }));
    const mesh = new THREE.Mesh(box, materials.get(color));
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    parent.add(mesh);
    return mesh;
  }

  function cargoBarrel(parent) {
    const group = new THREE.Group();
    parent.add(group);
    const drum = new THREE.Group();
    drum.position.y = .75;
    drum.rotation.z = Math.PI / 2;
    buildBarrelModel(drum, 0xa55539, iron);
    group.add(drum);
    group.scale.setScalar(DROP_BARREL_SCALE);
    const spark = new THREE.Mesh(box, fuseMaterial);
    spark.position.set(.10, 1.61, 0);
    spark.scale.setScalar(.13);
    group.add(spark);
    group.userData.spark = spark;
    spark.visible = false;
    return group;
  }

  const landed = Array.from({ length: DROP_CRATES }, () => cargoBarrel(root));
  const blastRing = new THREE.RingGeometry(MINI_BLAST_REACH - .035, MINI_BLAST_REACH, 44);
  blastRing.rotateX(-Math.PI / 2);
  const miniWarnings = landed.map(() => {
    const ring = new THREE.Mesh(blastRing, new THREE.MeshBasicMaterial({ color: 0xffb569, transparent: true, depthWrite: false }));
    root.add(ring);
    return ring;
  });
  const detached = new THREE.Group();
  (deck.parent ?? deck).add(detached);
  const fallRotation = new THREE.Quaternion();
  const fallAxis = new THREE.Vector3(0, 0, 1);
  let previousElapsed = Infinity;
  const overhead = new THREE.Group();
  root.add(overhead);
  const suspended = Array.from({ length: DROP_CRATES }, () => {
    const load = cargoBarrel(overhead);
    const cable = block(overhead, 0x896a4d, 0, 0, 0, .048, 1, .048);
    const grip = new THREE.Group();
    overhead.add(grip);
    block(grip, iron, 0, 0, 0, .46, .15, .30);
    const jaws = [-1, 1].map(side => block(grip, brass, side * .20, -.13, 0, .10, .25, .18));
    return { load, cable, grip, jaws };
  });
  const anchor = new THREE.Group();
  moving.add(anchor);
  block(anchor, iron, 0, 1.04, 0, .26, 1.68, .32);
  block(anchor, brass, 0, 1.52, 0, 1.05, .17, .27);

  block(anchor, iron, 0, 1.94, 0, .43, .23, .31);
  for (let turn = 0; turn < 4; turn++) {
    const arm = new THREE.Group();
    arm.rotation.y = turn * Math.PI / 2;
    anchor.add(arm);
    block(arm, iron, .63, .19, 0, 1.30, .24, .40);
    block(arm, iron, 1.18, .39, 0, .27, .66, .40).rotation.z = -.54;
    block(arm, 0x8895a0, 1.32, .61, 0, .34, .19, .44).rotation.z = .21;
  }

  const rollers = Array.from({ length: ROLLING_BARRELS }, (_, index) => {
    const heading = new THREE.Group();
    const drum = new THREE.Group();
    moving.add(heading);
    heading.add(drum);
    buildBarrelModel(drum, [0xa96b42, 0xbb794c, 0x9b5743][index % 3], iron);
    return { heading, drum };
  });
  const boat = new THREE.Group();
  (deck.parent ?? deck).add(boat);
  for (let row = -3; row <= 3; row++) {
    const width = [1.16, 2.27, 3.45, 4.16, 4.08, 2.96, 1.32][row + 3];
    block(boat, 0x633d30, 0, .24, row * .58, width, .67, .59);
    block(boat, 0xbd8b57, 0, .62, row * .58, width * .92, .13, .585);
    for (const side of [-1, 1]) {
      block(boat, 0x85493d, side * width * .46, .75, row * .58, .15, .32, .61);
      block(boat, 0xe8ba79, side * width * .46, .92, row * .58, .18, .07, .60);
    }
  }
  block(boat, 0x6b4934, 0, 1.39, -1.22, .12, 1.82, .12);
  const pennant = block(boat, 0xba5441, .42, 2.14, -1.22, .81, .44, .06);
  block(boat, 0xffd595, 0, 1.15, 1.56, .19, .31, .19);
  const crew = rollers.map((_, index) => {
    const pirate = new THREE.Group();
    pirate.position.set((index - 1) * 1.17, .72, .38);
    boat.add(pirate);
    const coat = [0x5c9587, 0xa55546, 0x665482][index];
    const skin = [0xbe875f, 0xe9b78a, 0xa97152][index];
    for (const side of [-1, 1]) block(pirate, 0x352a30, side * .095, .15, 0, .15, .30, .23);
    block(pirate, coat, 0, .49, 0, .43, .42, .30);
    block(pirate, 0xf4cf92, 0, .36, .16, .42, .075, .035);
    block(pirate, skin, 0, .83, 0, .36, .31, .34);
    block(pirate, 0x352936, 0, .99, 0, .58, .11, .38);
    block(pirate, 0x352936, 0, 1.10, -.02, .34, .17, .31);
    for (const side of [-1, 1]) block(pirate, 0x39282f, side * .086, .86, .173, .044, .043, .018);
    const arms = [-1, 1].map(side => {
      const arm = new THREE.Group();
      arm.position.set(side * .24, .63, .03);
      pirate.add(arm);
      block(arm, coat, 0, -.12, 0, .15, .29, .17);
      block(arm, skin, 0, -.30, 0, .13, .14, .15);
      return arm;
    });
    return { pirate, arms };
  });
  const launchPoint = new THREE.Vector3();
  const boatOffset = new THREE.Vector3();

  const anchorCable = block(moving, 0xad845b, 0, 0, 0, .064, 1, .064);
  const { smoothstep, lerp, clamp } = THREE.MathUtils;

  const deckToClip = new THREE.Matrix4();

  function drawCable(cable, x, z, end, top) {
    cable.visible = end < top;
    if (!cable.visible) return;
    cable.position.set(x, (top + end) * .5, z);
    cable.scale.y = top - end;
  }

  const warningInk = new THREE.MeshBasicMaterial({ color: 0xf2b360, transparent: true, depthWrite: false });
  const anchorWarning = new THREE.Group();
  for (const [x, z] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const tile = new THREE.Mesh(box, warningInk);
    tile.position.set(x * ARENA_TILE, 0, z * ARENA_TILE);
    tile.scale.set(ARENA_TILE * .93, .014, ARENA_TILE * .93);
    anchorWarning.add(tile);
  }
  moving.add(anchorWarning);
  const laneWarning = new THREE.Mesh(box, warningInk);
  moving.add(laneWarning);

  return (hazard, crates, elapsed, time, radius, camera) => {
    boat.visible = false;
    if (CARGO_HAZARDS.includes(hazard?.kind)) {
      camera.updateMatrixWorld();
      deck.updateWorldMatrix(true, false);
      deckToClip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(deck.matrixWorld);
    }
    for (const [index, model] of landed.entries()) {
      const item = crates[index];
      const age = item?.lostAt == null ? 0 : Math.max(0, elapsed - item.lostAt);
      const key = item ? `${item.x}/${item.z}/${item.fireAt}/${item.lostAt}` : '';
      if (elapsed < previousElapsed || item?.lostAt == null || model.userData.cargoKey !== key) {
        if (model.parent !== root) root.add(model);
        model.userData.fallOrigin = null;
        model.userData.cargoKey = key;
      }
      model.visible = Boolean(item && !item.exploded && elapsed >= item.fireAt && age < .93);
      const warning = miniWarnings[index];
      const armed = model.visible && item.lostAt == null && Number.isFinite(item.blastAt);
      model.userData.spark.visible = armed;
      warning.visible = armed;
      if (armed) {
        const urgency = 1 - clamp(item.blastAt - elapsed, 0, 2) / 2;
        const flicker = .5 + .5 * Math.sin(time * (8 + urgency * 14) + index);
        model.userData.spark.scale.setScalar(.09 + flicker * .095);
        warning.position.set(item.x, .042, item.z);
        warning.material.opacity = .18 + urgency * (.13 + flicker * .18);
      }
      if (!model.visible) continue;
      if (item.lostAt == null) {
        model.position.set(item.x, 0, item.z);
        model.rotation.set(0, 0, 0);
      } else {
        if (!model.userData.fallOrigin) {
          model.position.set(item.x, 0, item.z);
          model.rotation.set(0, 0, 0);
          deck.updateWorldMatrix(true, true);
          detached.attach(model);
          model.userData.fallOrigin = model.position.clone();
          model.userData.fallQuaternion = model.quaternion.clone();
        }
        const origin = model.userData.fallOrigin;
        model.position.set(origin.x + .2 * age, origin.y - 3.2 * age ** 1.5, origin.z + .15 * age);
        model.quaternion.copy(model.userData.fallQuaternion).multiply(fallRotation.setFromAxisAngle(fallAxis, age * .95));
      }
    }
    previousElapsed = elapsed;
    overhead.visible = hazard?.kind === 'crate-drop';
    if (overhead.visible) {
      for (const [index, view] of suspended.entries()) {
        const drop = hazard.drops?.[index];
        if (!drop) {
          view.cable.visible = view.grip.visible = view.load.visible = false;
          continue;
        }
        const release = drop.fireAt - .43;
        const lift = smoothstep(elapsed, release, drop.fireAt + .44);
        const { x, z } = cableCrossing(deckToClip, drop.side ?? 1, drop.x, drop.z, 5.46, elapsed, drop.start, drop.fireAt, hazard.exit);
        view.load.visible = elapsed < drop.fireAt;
        view.load.position.set(x, 4.5 * cargoDescent(drop, elapsed), z);
        view.load.rotation.set(Math.sin(time * 4 + index) * .13 * lift, 0, Math.cos(time * 5 + index) * .09 * lift);
        view.cable.visible = view.grip.visible = true;
        const top = cableTop(deckToClip, x, z);
        view.grip.position.set(x, hoistEnd(5.46, 1.35, elapsed, release, drop.fireAt), z);
        drawCable(view.cable, x, z, view.grip.position.y, top);
        for (const [i, jaw] of view.jaws.entries()) jaw.rotation.z = (i ? 1 : -1) * (.12 + .79 * lift);
      }
    }
    moving.visible = Boolean(hazard && !overhead.visible && CARGO_HAZARDS.includes(hazard.kind));
    if (!moving.visible) return;
    const rolling = hazard.kind === 'barrel-roll';
    const anchorDrop = hazard.kind === 'anchor-drop';
    const { dx, dz, x, z, start, warnAt, fireAt, end, exit } = hazard;
    const released = elapsed >= fireAt;
    const descent = cargoDescent(hazard, elapsed);
    const angle = Math.atan2(dx, dz);
    anchorCable.visible = anchorDrop;
    anchor.visible = anchorDrop && elapsed < fireAt + .80;
    if (anchorDrop) {
      const { x: loadX, z: loadZ } = cableCrossing(deckToClip, hazard.side ?? 1, x, z, 6.3, elapsed, start, fireAt, exit);
      const top = cableTop(deckToClip, loadX, loadZ);
      drawCable(anchorCable, loadX, loadZ, hoistEnd(6.3, 1.45, elapsed, fireAt - .43, fireAt), top);
      anchor.position.set(released ? x : loadX,
        released ? -5 * smoothstep(elapsed, fireAt, fireAt + .8) : 4.35 * descent, released ? z : loadZ);
      anchor.rotation.set(Math.sin(time * 3) * .1 * descent, angle * descent, Math.sin(time * 4) * .14 * descent);
    }

    const warn = elapsed >= warnAt && !released;
    warningInk.opacity = (.65 + .21 * Math.sin(time * 17)) * smoothstep(elapsed, warnAt, warnAt + .13);
    anchorWarning.visible = anchorDrop && warn;
    anchorWarning.position.set(x, .045, z);
    laneWarning.visible = rolling && warn;
    laneWarning.position.set(x, .05, z);
    laneWarning.rotation.y = angle;
    laneWarning.scale.set(3.75, .021, 2 * radius);
    const launchTime = .48;
    const approach = smoothstep(elapsed, start, fireAt - launchTime);
    const departure = smoothstep(elapsed, end, exit);
    const mooring = hazard.reach + 1.3;
    if (rolling) {
      boat.visible = true;
      const drift = (1 - approach) * -18 + departure * 20;
      boat.position.set(x - dx * (mooring + (1 - approach) * 7) + dz * drift,
        -1.35 + Math.sin(time * 2.5) * .09,
        z - dz * (mooring + (1 - approach) * 7) - dx * drift);
      boat.rotation.set(Math.sin(time * 2.9) * .046, angle + departure * 1.03, Math.cos(time * 2.2) * .062, 'YXZ');
      pennant.rotation.y = Math.sin(time * 5) * .24;
      boat.updateWorldMatrix(true, true);
    }
    for (const [index, { heading, drum }] of rollers.entries()) {
      const lane = hazard.lanes?.[index];
      heading.visible = Boolean(rolling && lane && elapsed < (lane.fallAt ?? lane.end) + .62);
      if (!rolling || !lane) continue;
      const release = lane.fireAt - launchTime;
      const landed = elapsed >= lane.fireAt;
      const age = Math.max(0, elapsed - lane.fireAt);
      const startPoint = hazardPosition(lane, lane.fireAt);
      const { pirate, arms } = crew[index];
      const heave = smoothstep(elapsed, release - .29, release) * (1 - smoothstep(elapsed, release + .055, release + .25));
      pirate.rotation.x = -.18 - heave * .21;
      for (const arm of arms) arm.rotation.x = -1.31 - heave * 1.06 + smoothstep(elapsed, release + .1, release + .32) * .96;
      const flight = clamp((elapsed - release) / launchTime, 0, 1);
      // The boat holds position through the volley. The launch origin is fixed
      // to the thrower's station rather than tracking the rocking hull in flight.
      if (flight === 0) {
        pirate.localToWorld(launchPoint.set(0, .76 + heave * .28, .53));
      } else {
        boatOffset.set((index - 1) * 1.17, .72 + 1.04 - 1.35, .91);
        launchPoint.set(x - dx * mooring + dz * boatOffset.x + dx * boatOffset.z,
          boatOffset.y, z - dz * mooring - dx * boatOffset.x + dz * boatOffset.z);
      }
      deck.worldToLocal(launchPoint);
      if (!heading.visible) continue;

      const travel = lane.reach + lane.startReach;
      const speed = travel / (lane.end - lane.fireAt);
      const fallAt = lane.fallAt ?? lane.end;
      const pastEdge = clamp(elapsed - fallAt, 0, .62);
      const point = landed ? hazardPosition(lane, Math.min(elapsed, fallAt)) : startPoint;
      const rollingAge = Math.max(0, Math.min(elapsed, fallAt) - lane.fireAt);
      const bounce = landed ? Math.abs(Math.sin(rollingAge * (8.7 + index * 1.5))) * Math.exp(-rollingAge * 1.7) * (.79 - index * .11) : 0;
      const height = landed ? .62 + bounce - 15 * pastEdge ** 1.45 : lerp(launchPoint.y, .62, flight) + Math.sin(flight * Math.PI) * 2.45;
      const drift = Math.min(pastEdge * 2, .36);
      heading.position.set(lerp(launchPoint.x, point.x, landed ? 1 : flight) + lane.dx * drift, height,
        lerp(launchPoint.z, point.z, landed ? 1 : flight) + lane.dz * drift);
      heading.rotation.set(0, Math.atan2(lane.dx, lane.dz),
        Math.sin(time * (6 + index) + index) * (landed ? .14 * Math.exp(-age) : .22), 'YXZ');
      drum.rotation.x = landed ? age * speed / .62 + Math.PI * 2 : flight * Math.PI * 2;
    }
  };
}
