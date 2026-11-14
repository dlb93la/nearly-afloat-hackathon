import * as THREE from 'three';
import { ANCHOR_COUNT, ANCHOR_LENGTH, ANCHOR_PIVOT, CRANE_POST_WIDTH, CRANE_REACH, CRATE_COUNT, CRATE_HALF, CRATE_SHOCK, crateHeight,
  SEESAW_HEIGHT } from '../shared/experimental-traps.mjs';

export function createExperimentalTrapView(scene, deck) {
  const root = new THREE.Group();
  deck.add(root);
  const cube = new THREE.BoxGeometry();
  const materials = new Map();
  const batchMaterial = new THREE.MeshLambertMaterial();
  function batchStaticBoxes(parent) {
    const parts = parent.children.filter(child => child.isMesh && child.geometry === cube);
    if (parts.length < 2) return;
    const batch = new THREE.InstancedMesh(cube, batchMaterial, parts.length);
    for (const [index, part] of parts.entries()) {
      part.updateMatrix();
      batch.setMatrixAt(index, part.matrix);
      batch.setColorAt(index, part.material.color);
    }
    batch.computeBoundingSphere();
    parent.remove(...parts);
    parent.add(batch);
  }
  const wood = 0x69402b;
  const iron = 0x465565;
  const brass = 0xc9ac77;

  function box(parent, color, x, y, z, w, h, d) {
    if (!materials.has(color)) materials.set(color, new THREE.MeshLambertMaterial({ color }));
    const piece = new THREE.Mesh(cube, materials.get(color));
    piece.position.set(x, y, z);
    piece.scale.set(w, h, d);
    parent.add(piece);
    return piece;
  }

  function support(parent, height) {
    box(parent, iron, 0, (height - 2) / 2, 0, CRANE_POST_WIDTH, height + 2, CRANE_POST_WIDTH);
    box(parent, iron, 0, .10, 0, .50, .2, .50);
    box(parent, brass, 0, height - .15, 0, .32, .20, .32);
    const head = new THREE.Group();
    parent.add(head);
    head.position.y = height;
    box(head, wood, 0, 0, CRANE_REACH / 2, .20, .22, CRANE_REACH + .28);
    box(head, iron, 0, .03, -.22, .45, .36, .54);
    box(head, brass, 0, .01, CRANE_REACH, .30, .28, .28);
    batchStaticBoxes(parent);
    batchStaticBoxes(head);
    return head;
  }

  function craneView(height) {
    const group = new THREE.Group();
    const load = new THREE.Group();
    root.add(group, load);
    return { group, load, head: support(group, height) };
  }

  function poseCrane(view, piece, blend) {
    const follow = view.group.visible ? blend : 1;
    view.group.visible = view.load.visible = Boolean(piece);
    if (!piece) return follow;
    view.group.position.set(piece.postX, 0, piece.postZ);
    const yaw = THREE.MathUtils.lerp(view.head.rotation.y, piece.yaw, follow);
    view.head.rotation.y = yaw;
    // Derive the load from the same angle so the cable stays under the crane head.
    view.load.position.set(piece.postX + Math.sin(yaw) * CRANE_REACH, 0,
      piece.postZ + Math.cos(yaw) * CRANE_REACH);
    return follow;
  }

  function createAnchor() {
    const view = craneView(ANCHOR_PIVOT);
    const pivot = new THREE.Group();
    pivot.position.y = ANCHOR_PIVOT;
    view.load.add(pivot);
    for (let i = 0; i < 10; i++) {
      const link = box(pivot, i % 2 ? iron : 0x86949a, 0, -.23 - i * .43, 0, .13, .39, .18);
      link.rotation.y = i % 2 ? Math.PI / 2 : 0;
    }
    const anchor = new THREE.Group();
    anchor.position.y = -ANCHOR_LENGTH;
    anchor.scale.setScalar(.75);
    pivot.add(anchor);
    box(anchor, iron, 0, .38, 0, .29, .92, .29);
    box(anchor, iron, 0, .05, 0, 1.47, .23, .33);
    box(anchor, brass, 0, .65, 0, 1.05, .16, .22);
    for (const side of [-1, 1]) {
      box(anchor, iron, side * .67, .19, 0, .25, .51, .36).rotation.z = -side * .57;
      box(anchor, 0x82929e, side * .84, .33, 0, .38, .19, .42).rotation.z = side * .4;
    }
    batchStaticBoxes(pivot);
    batchStaticBoxes(anchor);
    return { ...view, pivot, swing: new THREE.Vector3(0, -ANCHOR_LENGTH, 0) };
  }

  const impactGeometry = new THREE.PlaneGeometry(CRATE_HALF * 2, CRATE_HALF * 2);
  const shockGeometry = new THREE.RingGeometry(CRATE_SHOCK - .065, CRATE_SHOCK, 48);
  function floorMark(group, geometry, color) {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
    const mark = new THREE.Mesh(geometry, material);
    mark.rotation.x = -Math.PI / 2;
    mark.position.y = .054;
    group.add(mark);
    return material;
  }

  function createCrate() {
    const view = craneView(7.35);
    const group = view.load;
    const crate = new THREE.Group();
    group.add(crate);
    const rope = box(group, brass, 0, 0, 0, .08, 1, .08);
    crate.scale.setScalar(CRATE_HALF / 1.12);
    box(crate, 0x97582e, 0, .78, 0, 2.24, 1.56, 2.24);
    for (const side of [-1, 1]) {
      for (const rail of [.16, 1.4]) {
        box(crate, wood, 0, rail, side * 1.12, 2.27, .17, .12);
        box(crate, wood, side * 1.12, rail, 0, .12, .17, 2.27);
      }
      box(crate, brass, 0, .78, side * 1.12, 2.34, .21, .13).rotation.z = side * .48;
      box(crate, brass, side * 1.12, .78, 0, .13, .21, 2.34).rotation.x = side * .48;
    }
    box(crate, iron, 0, 1.65, 0, .33, .18, .33);
    batchStaticBoxes(crate);
    const impact = floorMark(group, impactGeometry, 0xf05840);
    const shock = floorMark(group, shockGeometry, 0xffce66);
    return { ...view, crate, rope, impact, shock };
  }

  const anchors = Array.from({ length: ANCHOR_COUNT }, createAnchor);
  const crates = Array.from({ length: CRATE_COUNT }, createCrate);
  const seesaw = new THREE.Group();
  seesaw.position.y = SEESAW_HEIGHT;
  scene.add(seesaw);
  const hub = new THREE.Group();
  deck.add(hub);
  for (const [parent, color, radius, height, y] of [
    [seesaw, wood, 1.05, 2.7, -1.55],
    [seesaw, iron, 1.04, .23, -.66],
    [hub, iron, .89, .13, .04],
    [hub, brass, .53, .10, .11],
  ]) {
    const part = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 10), materials.get(color));
    part.position.y = y;
    parent.add(part);
  }
  const down = new THREE.Vector3(0, -1, 0);
  const chainDirection = new THREE.Vector3();

  return (trap, elapsed, radius, blend) => {
    root.visible = Boolean(trap);
    hub.visible = root.visible && trap.kind === 'seesaw';
    seesaw.visible = hub.visible;
    if (!root.visible) {
      for (const view of anchors) view.group.visible = false;
      for (const view of crates) view.group.visible = false;
      return;
    }
    for (const [index, view] of anchors.entries()) {
      const anchor = trap.anchors?.[index];
      const follow = poseCrane(view, anchor, blend);
      if (!anchor) continue;
      view.swing.lerp(chainDirection.set(anchor.dx, anchor.dy, anchor.dz), follow);
      chainDirection.copy(view.swing).normalize();
      view.pivot.quaternion.setFromUnitVectors(down, chainDirection);
    }
    for (const [index, view] of crates.entries()) {
      const crate = trap.crates?.[index];
      poseCrane(view, crate, blend);
      if (!crate) continue;
      const height = crateHeight(crate, elapsed);
      view.crate.position.y = height;
      const hook = height + 1.65 * view.crate.scale.y;
      view.rope.position.y = (7.35 + hook) / 2;
      view.rope.scale.y = 7.35 - hook;
      const waiting = crate.fireAt === null || elapsed < crate.fireAt;
      const warning = crate.fireAt !== null && elapsed > crate.fireAt - .95 && waiting;
      const pulse = .5 + Math.sin(elapsed * 23) * .19;
      const onDeck = Math.hypot(view.load.position.x, view.load.position.z) + CRATE_HALF < radius;
      view.impact.opacity = onDeck ? (warning ? pulse : waiting ? .18 : .06) : 0;
      view.shock.opacity = onDeck ? (warning ? .82 : waiting ? .30 : .10) : 0;
    }
  };
}
