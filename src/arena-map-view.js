import * as THREE from 'three';

const WATERLINE = -1.35;
const STONE = [0x546453, 0x68705a, 0x7d8265];
const LEAF = [0x2d5537, 0x488442, 0x66a745, 0x91b85a];
const ARENA_SCENERY_CLEARANCE = 10.6;

// Scenery has no combat collider. Keep its entire horizontal silhouette beyond
// the playable deck plus room for barrels, instead of hiding intersections.
export function clearArenaLandmark(root) {
  root.updateWorldMatrix(true, true);
  const center = root.getWorldPosition(new THREE.Vector3());
  const point = new THREE.Vector3();
  let envelope = 0;
  root.traverse(part => {
    if (!part.isMesh && part.userData.color === undefined) return;
    if (part.geometry && !part.geometry.boundingBox) part.geometry.computeBoundingBox();
    const bounds = part.geometry?.boundingBox;
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      point.set(bounds ? (x < 0 ? bounds.min.x : bounds.max.x) : x * .5,
        bounds ? (y < 0 ? bounds.min.y : bounds.max.y) : y * .5,
        bounds ? (z < 0 ? bounds.min.z : bounds.max.z) : z * .5).applyMatrix4(part.matrixWorld);
      envelope = Math.max(envelope, Math.hypot(point.x - center.x, point.z - center.z));
    }
  });
  const distance = Math.hypot(center.x, center.z);
  const required = ARENA_SCENERY_CLEARANCE + envelope;
  if (distance > 0 && distance < required) {
    point.copy(center).setX(center.x * required / distance).setZ(center.z * required / distance);
    root.position.copy(root.parent ? root.parent.worldToLocal(point) : point);
  }
  root.userData.arenaScenery = true;
}

function groupAt(parent, x, y, z, yaw = 0) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = yaw;
  parent.add(group);
  return group;
}

function block(parent, color, x, y, z, width, height, depth) {
  const box = new THREE.Object3D();
  box.position.set(x, y, z);
  box.scale.set(width, height, depth);
  box.userData.color = color;
  parent.add(box);
  return box;
}

function beam(parent, color, from, to, width) {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const direction = end.sub(start);
  const middle = start.addScaledVector(direction, .5);
  const bar = block(parent, color, middle.x, middle.y, middle.z, width, direction.length(), width);
  bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
}

function batch(parent, model, emissive = false) {
  model.updateMatrixWorld(true);
  const parts = [];
  model.traverse(part => {
    if (part.userData.color !== undefined) parts.push(part);
  });
  const material = emissive ? new THREE.MeshBasicMaterial() : new THREE.MeshLambertMaterial();
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), material, parts.length);
  const color = new THREE.Color();
  for (const [index, part] of parts.entries()) {
    mesh.setMatrixAt(index, part.matrixWorld);
    mesh.setColorAt(index, color.setHex(part.userData.color));
  }
  parent.add(mesh);
  return mesh;
}

function canopy(parent, x, y, z, scale, turn) {
  const tree = groupAt(parent, x, y, z, turn);
  tree.scale.setScalar(scale);
  block(tree, 0x534133, 0, 1.37, 0, .45, 2.74, .47).rotation.z = -.10;
  for (const side of [-1, 1]) {
    beam(tree, 0x5f4935, [0, .42, 0], [side * .73, .05, side * .38], .19);
    beam(tree, 0x684c35, [0, 1.71, 0], [side * .95, 2.64, -.32], .24);
  }
  for (const [index, [x, y, z, w, h, d]] of [
    [0, 2.92, 0, 2.24, .68, 1.59], [.08, 3.42, -.12, 1.68, .52, 1.38],
    [.02, 3.78, -.20, .97, .34, .95], [-.96, 2.69, -.32, 1.32, .45, 1.10],
    [1.05, 2.62, -.39, 1.37, .42, 1.11], [.60, 2.99, .67, 1.27, .45, .79],
  ].entries()) {
    block(tree, LEAF[index % LEAF.length], x, y, z, w, h, d).rotation.y = index * .27;
    if (index > 2) block(tree, LEAF[1], x + .27, y - .42, z + .12, .09, .69, .09);
  }
}

function lagoonBank(parent, x, z, width, depth, height, yaw, seed) {
  const root = groupAt(parent, x, WATERLINE, z, yaw);
  const rim = Array.from({ length: 13 }, (_, index) => {
    const angle = index / 13 * Math.PI * 2;
    const edge = .87 + .12 * Math.cos(index * 2.7 + seed) + .08 * Math.sin(index * 1.43);
    return [Math.cos(angle) * width * edge, Math.sin(angle) * depth * edge];
  });
  const rings = [[1.04, -.56], [1, .26], [.79, height * .72], [.69, height]];
  const position = [], colors = [];
  const color = new THREE.Color();
  const point = (ring, index) => {
    const [scale, y] = rings[ring];
    const [px, pz] = rim[index % rim.length];
    return [px * scale + ring * .10, y + (ring > 1 ? Math.sin(index * 2.7 + seed) * .21 : 0), pz * scale - ring * .12];
  };
  function triangle(a, b, c, hex) {
    position.push(...a, ...b, ...c);
    color.setHex(hex);
    for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
  }
  for (let index = 0; index < rim.length; index++) {
    for (let ring = 0; ring < rings.length - 1; ring++) {
      const a = point(ring, index), b = point(ring + 1, index);
      const c = point(ring, index + 1), d = point(ring + 1, index + 1);
      const palette = ring === 0 ? [0x6d6950, 0x95855c, 0x807554] : [0x46584e, 0x677565, 0x7b8063, 0x586952];
      triangle(a, b, c, palette[(index + ring) % palette.length]);
      triangle(b, d, c, palette[(index + ring + 1) % palette.length]);
    }
    triangle([.3, height, -.36], point(3, index + 1), point(3, index), [0x59753f, 0x708848, 0x829653][index % 3]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
  root.add(mesh);
  return root;
}

function palm(parent, x, y, z, scale, yaw) {
  const tree = groupAt(parent, x, y, z, yaw);
  tree.scale.setScalar(scale);
  for (let i = 0; i < 6; i++) {
    const start = [i ** 2 * .018, i * .48, 0];
    beam(tree, i % 2 ? 0x88704a : 0x665739, start, [(i + 1) ** 2 * .018, (i + 1) * .48 + .045, 0], .29 - i * .015);
  }
  for (let i = 0; i < 7; i++) {
    const leaf = groupAt(tree, .66, 2.9, 0, i * 2.399);
    beam(leaf, LEAF[(i + 1) % 4], [0, 0, 0], [0, .26, .92], .32);
    beam(leaf, LEAF[i % 4], [0, .26, .78], [0, -.13, 1.61], .28);
    beam(leaf, LEAF[(i + 1) % 3], [0, -.11, 1.49], [0, -.52, 1.91], .18);
  }
}

function lagoonGate(bank, y) {
  const gate = groupAt(bank, -.5, y, .65, .14);
  for (let step = 0; step < 4; step++) {
    block(gate, STONE[step % 3], 0, step * .17 - .21, 2.12 - step * .35, 4.1 - step * .27, .25, .72);
  }
  for (const side of [-1, 1]) {
    const pier = side * 1.5;
    for (let row = 0; row < 5; row++) {
      block(gate, STONE[(row + (side > 0 ? 1 : 0)) % 3], pier, .48 + row * .45, .14, 1.03, .44, 1.12);
    }
    block(gate, 0x8f9272, pier, 2.72, .14, 1.21, .23, 1.28);
    beam(gate, STONE[1], [pier, 2.77, .14], [side * .74, 3.56, .14], .78);
    for (let j = 0; j < 3; j++) {
      const x = pier + side * j * .21;
      beam(gate, LEAF[j % 3], [x, 2.81 - j * .14, .76], [x - .16, 1.33 - j * .32, .89], .08);
    }
  }
  block(gate, 0x929676, .02, 3.66, .13, 1.62, .59, 1.15).rotation.z = .08;
  block(gate, 0x334938, .05, 3.67, .73, .55, .28, .09);
  block(gate, 0xb8a978, .05, 3.67, .79, .17, .17, .065).rotation.z = Math.PI / 4;
  block(gate, LEAF[1], -.43, 3.94, .07, 1.05, .16, .91);
  block(gate, STONE[1], 2.42, .32, 1.05, 1.02, .51, .68).rotation.set(.16, .69, -.24);
}

function makeJungle(parent) {
  const temple = lagoonBank(parent, -12.6, -10.2, 5.8, 3.6, 1.82, .65, 2);
  lagoonGate(temple, 1.45);
  canopy(temple, -2.8, 1.60, -1.08, 1.04, .25);
  palm(temple, 2.4, 1.68, -.83, .98, 1.8);
  palm(temple, 3.46, 1.35, -.31, .74, -.8);
  for (let i = 0; i < 5; i++) {
    const x = -3.16 + i * 1.48;
    const y = 1.64 - Math.abs(x) * .055;
    beam(temple, LEAF[i % 3], [x, y, 1.31], [x + .32, y - .82, 2.31], .09);
  }
  const falls = lagoonBank(parent, 9, -12.8, 5.1, 3.4, 2.65, -.19, 7);
  canopy(falls, -1.66, 2.53, -.7, .84, -.4);
  canopy(falls, 1.79, 2.43, -1.25, .91, .87);
  palm(falls, 2.86, 2.09, .12, .83, 1.4);
  const stream = groupAt(falls, .27, 0, 1.91);
  const channel = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const x = (i - 3) * .17;
    beam(channel, [0x6cc9b9, 0x3e9895, 0xa1d8c0][i % 3], [x, 2.55, -.53], [x, 2.43, .23], .18);
    beam(channel, [0x6cc9b9, 0x3e9895, 0xa1d8c0][i % 3], [x, 2.44, .20], [x * 1.18, .11, 1.15], .18);
  }
  const spray = groupAt(stream, 0, .065, 1.17);
  const droplets = new THREE.Group();
  for (let i = 0; i < 11; i++) {
    const angle = i * 2.399;
    block(droplets, i % 2 ? 0x8bdcc5 : 0x66bcae, Math.cos(angle) * .91, .03, Math.sin(angle) * .47, .21, .055, .15);
  }
  batch(stream, channel);
  const mist = batch(spray, droplets);
  const skerry = lagoonBank(parent, -11.6, 9.5, 2.0, 1.3, .59, -.58, 10);
  palm(skerry, -.47, .48, -.13, .48, .93);
  const reef = lagoonBank(parent, 13.7, -3.1, 2.4, 1.34, .62, .21, 4);
  for (const root of [temple, falls, skerry, reef]) {
    clearArenaLandmark(root);
    const detail = new THREE.Group();
    for (const child of [...root.children]) {
      if (!child.isMesh && child !== stream) detail.add(child);
    }
    if (detail.children.length) batch(root, detail);
  }
  return time => {
    mist.scale.x = 1 + Math.sin(time * 3.3) * .13;
    mist.position.z = .12 + Math.cos(time * 2.4) * .13;
  };
}

const SKULL = [
  '  #####  ',
  ' ####### ',
  ' ## # ## ',
  ' ## # ## ',
  '  ## ##  ',
  '   ###   ',
  '  # # #  ',
  ' #     # ',
];

function tornSail(parent, x, y, width, height, emblem) {
  const sail = groupAt(parent, x, y, .32);
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 10; col++) {
      if ((row === 0 && col > 5) || (row === 1 && col > 7) || (row === 2 && col === 9)) continue;
      const bend = Math.sin(col / 9 * Math.PI) * .25;
      block(sail, [0x352d3e, 0x483846, 0x403446][(col + row * 2) % 3],
        (col - 4.5) * width / 10, row * height / 6, bend, width / 10 + .018, height / 6 + .02, .095);
    }
  }
  if (emblem) {
    for (const [row, line] of SKULL.entries()) {
      for (const [col, pixel] of [...line].entries()) {
        if (pixel === '#') block(sail, 0xe4cda9, (col - 4) * .106, height * .69 - row * .103, .32, .107, .105, .04);
      }
    }
  }
}

function shipwreck(parent, x, z, scale, turn, large) {
  const wreck = groupAt(parent, x, WATERLINE - .18, z, turn);
  wreck.scale.setScalar(scale);
  wreck.rotation.z = large ? -.085 : .31;
  const planks = [0x553a3a, 0x76473c, 0x885540, 0x9f6648];
  for (let segment = -5; segment <= 5; segment++) {
    const width = 2.52 - .40 * Math.max(0, Math.abs(segment) - 2);
    for (let row = 0; row < 5; row++) {
      if (segment === 1 && row > 1) continue;
      block(wreck, planks[(segment + row + 8) % 4], segment * .71, row * .27 + Math.abs(segment) * .046, 0, .73, .28,
        width * (.61 + row * .12));
    }
    if (segment === 1) continue;
    for (const side of [-1, 1]) {
      block(wreck, 0xb48255, segment * .71, 1.28 + Math.abs(segment) * .045, side * width * .51, .72, .12, .14);
      if (Math.abs(segment) < 4) block(wreck, 0x26232d, segment * .71, .97, side * width * .50, .30, .24, .09);
    }
  }
  for (const side of [-1, 1]) {
    for (let slat = 0; slat < 5; slat++) {
      block(wreck, planks[slat % 4], 1.10 + slat * .22, 1.2 + slat % 2 * .16, side * (1.05 - slat * .10),
        .17, .64, .15).rotation.z = side * (.37 + slat * .14);
    }
  }
  block(wreck, 0x674540, -2.76, 1.68, 0, 2.12, .67, 1.84);
  block(wreck, 0xb37b53, -2.76, 2.06, 0, 2.31, .14, 2.00);
  for (const x of [-3.39, -2.76, -2.13]) {
    block(wreck, 0x372d39, x, 1.71, .94, .36, .35, .08);
    block(wreck, 0xf1b06c, x, 1.72, .99, .22, .21, .045);
  }
  beam(wreck, 0x775344, [3.10, 1.18, 0], [4.46, 2.0, 0], .23);
  const mast = groupAt(wreck, -.82, 1.22, -.10);
  mast.rotation.z = large ? .18 : -.46;
  block(mast, 0x604442, 0, 2.09, 0, .26, 4.39, .27);
  if (large) {
    block(mast, 0xa17c5c, 0, 3.45, 0, 3.24, .14, .15);
    tornSail(mast, 0, 1.64, 3.0, 2.02, true);
    beam(wreck, 0x9c8066, [-3.26, 1.92, 1.01], [-1.58, 5.06, -.10], .052);
    beam(wreck, 0x9c8066, [2.70, 1.48, 1.04], [-1.58, 5.06, -.10], .052);
    const snappedMast = groupAt(wreck, 2.42, 1.33, .08);
    snappedMast.rotation.z = -.69;
    block(snappedMast, 0x755243, 0, .94, 0, .21, 1.9, .22);
    tornSail(snappedMast, .44, .44, 1.25, 1.18, false);
  } else {
    block(mast, 0xa07a60, .54, 2.93, .12, 1.32, .34, .12);
    block(mast, 0xa34d42, .57, 3.11, .12, 1.38, .29, .13);
  }
  // Broken gun-deck ribs and cargo cradles give the wreck readable depth.
  for (const x of [-2, -.9, .2]) {
    block(wreck, 0x3d3039, x, 1.35, -.72, .42, .27, .65);
    block(wreck, 0x9d744d, x, 1.53, -.72, .49, .09, .72);
  }
  clearArenaLandmark(wreck);
}

function makeWreck(parent) {
  const model = new THREE.Group();
  shipwreck(model, -13.35, 1.2, 1.04, .40, true);
  shipwreck(model, 4.4, -11.75, .65, -.57, false);
  for (const [i, [x, z]] of [[-12.7, 6.9], [1.3, -14.9], [12, -5.5], [10.4, 8.5], [-6.9, 11.2]].entries()) {
    const reef = groupAt(model, x, WATERLINE, z, i * 1.36);
    for (let rock = 0; rock < 10; rock++) {
      const angle = rock * 2.4;
      const height = .35 + ((rock * 11 + i * 3) % 9) * .27;
      block(reef, [0x424052, 0x555467, 0x625765][rock % 3], Math.cos(angle) * (rock % 4) * .61, height / 2,
        Math.sin(angle) * (rock % 4) * .53, 1.04, height, .93).rotation.set(0, angle, .18);
    }
    for (const side of [-1, 1]) {
      beam(reef, 0x66473f, [side * 1.02, .15, .67], [side * 1.46, 1.65, 1.16], .19);
    }
    beam(reef, 0x865943, [-1.6, .51, .81], [1.61, .83, 1.24], .13);
    clearArenaLandmark(reef);
  }
  batch(parent, model);
  const debris = [];
  for (const [i, [x, z]] of [[-11.1, 3], [-3, -10.9], [2.7, -11.7], [10.7, -.9], [7.8, 8.1]].entries()) {
    const float = groupAt(parent, x, WATERLINE, z, i * 1.7);
    const boards = new THREE.Group();
    for (let j = 0; j < 4; j++) {
      block(boards, j % 2 ? 0x7f5545 : 0x9d6d55, (j - 1.5) * .26, .07, 0, .25, .11, .94 - j * .16);
    }
    block(boards, 0x644b45, 0, .16, -.11, 1.03, .14, .16);
    batch(float, boards);
    debris.push(float);
  }
  return time => {
    for (const [i, float] of debris.entries()) {
      float.position.y = WATERLINE + Math.sin(time * 1.9 + i) * .09;
      float.rotation.x = Math.cos(time * 1.5 + i) * .10;
    }
  };
}

function makeHarborDetails(parent) {
  const model = new THREE.Group();
  const lighthouse = groupAt(model, -14.5, WATERLINE, -9.2, -.24);
  for (let layer = 0; layer < 4; layer++) {
    block(lighthouse, [0x5d6a65, 0x718173, 0x94866c][layer % 3], 0, .2 + layer * .22, 0,
      3.8 - layer * .35, .25, 3.15 - layer * .27);
  }
  for (let layer = 0; layer < 9; layer++) {
    const width = 1.54 - layer * .055;
    block(lighthouse, layer % 3 === 1 ? 0xa7674e : 0xc8b792, 0, 1.07 + layer * .29, 0, width, .28, width);
    if (layer % 3 === 0) block(lighthouse, 0x3d5260, .11, 1.08 + layer * .29, width * .52, .22, .17, .045);
  }
  block(lighthouse, 0x6b4c38, 0, 3.71, 0, 1.8, .17, 1.8);
  block(lighthouse, 0xffd48c, 0, 4.07, 0, .71, .57, .71);
  for (const x of [-.53, .53]) for (const z of [-.53, .53]) block(lighthouse, 0x4e4545, x, 4.05, z, .09, .71, .09);
  block(lighthouse, 0x563f42, 0, 4.46, 0, 1.53, .22, 1.53);
  block(lighthouse, 0x77534a, 0, 4.66, 0, 1.08, .18, 1.08);
  block(lighthouse, 0xcaa36b, 0, 4.9, 0, .12, .34, .12);
  for (let step = 0; step < 5; step++) block(lighthouse, 0x8d826c, .7, .23 + step * .12, 1.65 - step * .22, 1.02, .16, .31);
  clearArenaLandmark(lighthouse);

  const quay = groupAt(model, 7.2, WATERLINE, -15.3, -.38);
  for (const x of [-2.2, 2.2]) for (const z of [-.95, .95]) block(quay, 0x614735, x, .42, z, .22, 1.8, .24);
  for (let plank = 0; plank < 14; plank++) block(quay, plank % 4 ? 0x996440 : 0xb48050, (plank - 6.5) * .36, 1.2, 0, .35, .16, 2.65);
  for (const x of [-1.8, 1.8]) {
    block(quay, 0x6a4a36, x, 2.3, -.45, .17, 2.1, .19);
    beam(quay, 0x9e754a, [x, 1.4, .35], [x, 2.95, -.45], .10);
  }
  block(quay, 0x6b4d38, 0, 3.29, -.45, 4.1, .18, .24);
  beam(quay, 0xba9767, [.7, 3.27, -.45], [.7, 1.9, -.45], .055);
  block(quay, 0x3c4b54, .7, 1.82, -.45, .23, .23, .23);
  for (const [i, x] of [-1.35, -.45, 1.3].entries()) {
    block(quay, 0x865a3b, x, 1.61 + (i % 2) * .12, .3, .72, .68, .72);
    for (const side of [-1, 1]) block(quay, 0xc19a63, x + side * .27, 1.61 + (i % 2) * .12, .3, .07, .76, .77);
  }
  for (const side of [-1, 1]) {
    block(quay, 0x364c52, side * 1.8, 2.94, -.45, .2, .31, .26);
    block(quay, 0xffd28d, side * 1.8, 2.94, -.28, .13, .18, .06);
  }
  clearArenaLandmark(quay);
  batch(parent, model);
}

export function createArenaMapView(scene, buildHarbor) {
  const maps = new Map();
  const builders = { harbor: root => {
    const animate = buildHarbor(root);
    makeHarborDetails(root);
    return animate;
  }, jungle: makeJungle, wreck: makeWreck };
  let current;
  return (id, time) => {
    if (!maps.has(id)) {
      const root = new THREE.Group();
      scene.add(root);
      maps.set(id, { root, update: builders[id](root) });
    }
    const next = maps.get(id);
    if (current !== next) {
      if (current) current.root.visible = false;
      current = next;
      current.root.visible = true;
    }
    current.update(time);
  };
}
