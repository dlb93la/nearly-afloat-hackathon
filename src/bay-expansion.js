import * as THREE from 'three';
import { buildPirateBird, flapBird } from './pirate-bird.js';
import { createShoreBatch } from './bay-navigation.js';

const stone = [0x63675b, 0x827967, 0x777569, 0x947f64, 0x6d6c60];
const grass = [0x667d40, 0x6c8243, 0x748846, 0x7c8d4a, 0x849350];
const paving = [0xc3a982, 0xae9777, 0xbba588, 0xcab18d, 0xb59e7e];
const sand = [0xd9bb80, 0xe3c68d, 0xd2ad75, 0xe8cb92, 0xcfaa72];
const oak = 0x694432;
const gold = 0xeab05d;
const cream = 0xf3dfb5;
const teal = 0x319db0;
const STEP = .64;

// Shared by the land and water shader so the shoals follow the responsive districts.
export const expansionShore = [
  { district: 'town', shape: [-.1, -15.9, 6.8, 4.8], height: 2.2 },
  { district: 'town', shape: [7.4, -18.8, 5.7, 3.6], height: 3.45 },
  { district: 'town', shape: [6.1, -10.4, 2.9, 3], height: .3 },
  { district: 'west', shape: [-4.1, -13.9, 2.8, 1.75], height: 2.65 },
  { district: 'islet', shape: [-10.2, 13, 3.55, 2.52], height: .42 },
  { district: 'scene', shape: [-11.3, 18, 4, 3.25], height: 1.7 },
  { district: 'east', shape: [10.2, 16.35, 5.8, 4.2], height: .1 },
  { district: 'east', shape: [15.1, 13.2, 3.9, 3.5], height: .32 },
];

function grain(x, z) {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export function createBayExpansion(scene, west, east, { box, block, batchBlocks, flag, lamp, line, barrel, planks }) {
  const districts = { west, east, scene, town: east, islet: west };
  const sets = Object.fromEntries(Object.entries(districts).map(([key, parent]) => {
    const group = new THREE.Group();
    group.name = `Bay expansion: ${key}`;
    parent.add(group);
    return [key, group];
  }));
  const lit = new THREE.MeshBasicMaterial({ color: 0xffbc59 });
  const pale = new THREE.MeshBasicMaterial({ color: 0xffedaa });
  const glows = Object.fromEntries(Object.entries(sets).map(([key, parent]) => {
    const glow = new THREE.Group();
    parent.add(glow);
    return [key, glow];
  }));
  function glow(key, x, y, z, w, h, d, material = lit) {
    block(glows[key], material, x, y, z, w, h, d);
  }

  function ground(key, x, z) {
    let y = -2;
    for (const { district, shape: [cx, cz, rx, rz], height } of expansionShore) {
      if (key !== district) continue;
      const rim = 1 - Math.hypot((x - cx) / rx, (z - cz) / rz) + Math.sin(x * 1.7 + z * .91) * .03;
      if (rim < 0) continue;
      y = Math.max(y, -1.14 + (height + 1.14) * Math.min(1, rim * 2.9));
    }
    if (key === 'town' && z >= -18 && z <= -13.4 && x >= -4.5 && x <= 4.55) {
      y = Math.max(y, 2.2);
    }
    if (key === 'town' && z >= -19.85 && z <= -17.75 && Math.abs(x) < 2.98) y = Math.max(y, 2.2);
    if (key === 'town' && Math.abs(x - 3.65) < .95 && z > -13.39 && z < -9.02) {
      y = Math.min(y, -.03 + Math.round((-9.25 - z) / .46) * .225);
    }
    if (key === 'east' && x > 9.9 && x < 13.3 && z > 15.55 && z < 16.45) y = 0;
    if (key === 'islet' && x > -11 && x < -8.65 && z > 12.4 && z < 13.08) y = .25;
    if (key === 'scene') {
      if (Math.abs(x + 11.8) < 1.65 && Math.abs(z - 17.65) < 1.05) y = 1.7;
      if (z > 18.48 && Math.abs(x - (-11.27 - (20.53 - z) * .27)) < .61) {
        y = Math.min(y, -.75 + (20.53 - z) * .9);
      }
    }
    return y < -1.2 ? -2 : Math.round(y / .125) * .125;
  }

  const pathAt = (key, x, z) => (key === 'east' || key === 'town') && (
    (z >= -18 && z <= -13.4 && x >= -4.5 && x <= 4.55)
    || (z > 12.8 && Math.abs(x - (9.1 + (z - 13) * .58)) < 1.25)
    || (x > 11 && z > 15.3 && z < 16.6)
  );
  const terrain = [];
  const groundMaterial = new THREE.MeshLambertMaterial();
  for (const [key, parent] of Object.entries(sets)) {
    const cells = [];
    const land = expansionShore.filter(shore => shore.district === key);
    const range = (axis, sign) => (sign < 0 ? Math.min : Math.max)(
      ...land.map(({ shape }) => shape[axis] + sign * (shape[axis + 2] + STEP)));
    for (let iz = Math.floor(range(1, -1) / STEP); iz <= Math.ceil(range(1, 1) / STEP); iz++) {
      for (let ix = Math.floor(range(0, -1) / STEP); ix <= Math.ceil(range(0, 1) / STEP); ix++) {
        const x = ix * STEP, z = iz * STEP;
        const y = ground(key, x, z);
        if (y < -1.2) continue;
        const n = grain(ix, iz);
        const cap = pathAt(key, x, z) ? paving : y < -.43 || (key === 'east' && z > 14 && y <= 0) ? sand : grass;
        const patch = .5 + Math.sin(x * .49 + z * .36) * .22 + Math.cos(z * .55 - x * .21) * .17;
        const turf = cap === grass ? .42 : 0;
        const base = y - turf;
        const shade = Math.floor((cap === grass ? patch * .92 + n * .08 : n) * cap.length);
        cells.push({ x, z, y: (base - 1.5) / 2, w: STEP, h: base + 1.5, d: STEP, color: stone[shade] });
        const size = cap === paving ? STEP - .026 : STEP;
        cells.push({ x, z, y: y + .046 - turf / 2, w: size, h: .092 + turf, d: size, color: cap[shade] });
      }
    }
    terrain.push(createShoreBatch(parent, box, groundMaterial, cells));
  }

  function group(parent, x, y, z, heading = 0) {
    const root = new THREE.Group();
    root.position.set(x, y, z);
    root.rotation.y = heading;
    parent.add(root);
    return root;
  }
  function crate(parent, x, y, z, size = .49) {
    block(parent, 0xa46a3e, x, y + size / 2, z, size, size, size);
    for (const side of [-1, 1]) {
      block(parent, 0xc18a53, x + side * size * .39, y + size * .53, z, .065, size * 1.06, size * 1.05);
    }
    block(parent, 0xd09b60, x, y + size * .52, z + size * .53, .075, size * 1.02, .06).rotation.z = .72;
  }
  function torch(key, x, y, z) {
    const parent = sets[key];
    block(parent, oak, x, y + .49, z, .14, .98, .14);
    block(parent, 0x553b32, x, y + .94, z, .33, .2, .33);
    glow(key, x, y + 1.13, z, .21, .29, .21);
    glow(key, x - .025, y + 1.27, z, .108, .19, .11, pale);
    glow(key, x + .04, y + 1.06, z, .26, .10, .24);
  }
  function palm(parent, x, y, z, scale, heading) {
    const root = group(parent, x, y, z, heading);
    root.scale.setScalar(scale);
    for (let i = 0; i < 5; i++) {
      block(root, i % 2 ? 0x976c48 : 0xa87951, i * .09, .21 + i * .37, 0, .19 - i * .012, .41, .18).rotation.z = -.21;
    }
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3;
      for (let j = 0; j < 3; j++) {
        const r = .28 + j * .27;
        const leaf = block(root, [0x507d38, 0x68953c, 0x819e3c][(i + j) % 3],
          .36 + Math.cos(angle) * r, 1.96 - j * j * .052, Math.sin(angle) * r, .47, .13, .27 - j * .055);
        leaf.rotation.set(0, -angle, .14 - j * .19, 'YXZ');
      }
    }
    batchBlocks(root);
  }
  function flowers(parent, x, y, z, color) {
    block(parent, 0x52753d, x, y + .09, z, .68, .22, .48);
    for (let i = 0; i < 5; i++) {
      const dx = (grain(i, x) - .5) * .65, dz = (grain(z, i) - .5) * .47;
      block(parent, 0x7c9a49, x + dx, y + .24, z + dz, .14, .31, .14);
      block(parent, i % 2 ? color : 0xe7ae76, x + dx, y + .39, z + dz, .23, .12, .18);
    }
  }
  function steps(parent, x, y, z, count, rise, width, depth, heading = 0) {
    const root = group(parent, x, y, z, heading);
    for (let i = 0; i < count; i++) {
      const h = (i + 1) * rise;
      block(root, stone[i % 5], 0, h / 2 - .17, -i * depth, width, h + .34, depth);
      block(root, paving[i % 5], 0, h, -i * depth, width + .06, .12, depth + .025);
    }
    batchBlocks(root);
  }
  function arch(parent, x, y, z, width, height, depth) {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const inset = i < 3 ? 0 : (i - 2) * width * .18;
        block(parent, stone[(i + 1) % 5], x + side * (width / 2 - inset),
          y + (i + .5) * height / 6, z, width * .28, height / 6 - .015, depth);
      }
    }
    block(parent, paving[1], x, y + height * .88, z, width * .41, height * .19, depth + .07);
  }

  // High Town
  const town = sets.town;
  const tavern = group(town, .1, 2.29, -18.06);
  block(tavern, stone[1], 0, .10, 0, 5.77, .24, 3.48);
  block(tavern, planks, 0, 1.36, 0, 5.35, 2.42, 3.08);
  for (const x of [-2.56, -.87, .87, 2.56]) {
    for (const z of [-1.58, 1.58]) block(tavern, oak, x, 1.4, z, .22, 2.54, .23);
  }
  for (const y of [.33, 1.45, 2.54]) block(tavern, oak, 0, y, 1.59, 5.55, .16, .16);
  for (const z of [-1.15, -.68, -.21, .26, .73, 1.2, 1.67]) {
    for (const side of [-1, 1]) block(tavern, z > 1 ? 0xb14536 : 0xa74336, side * 1.46, 3.15, z, 3.36, .22, .49).rotation.z = -side * .48;
  }
  for (let i = 0; i < 5; i++) block(tavern, 0x88563c, 0, 2.62 + i * .215, 1.6, 5.2 - i, .223, .13);
  block(tavern, 0x743530, 0, 3.95, .23, .25, .25, 3.52);
  block(tavern, 0x51352b, 0, .86, 1.61, 1.33, 1.54, .16);
  glow('town', .1, 3.18, -16.357, .91, 1.28, .065);
  for (const x of [-1.76, 1.76]) for (const y of [.91, 1.99]) {
    block(tavern, oak, x, y, 1.62, .79, .62, .16);
    for (const dx of [-.146, .146]) for (const dy of [-.108, .108]) {
      glow('town', .1 + x + dx, 2.29 + y + dy, -16.34, .25, .18, .058);
    }
  }
  // A voxel tankard hangs on the gable.
  block(tavern, 0x482f2a, 0, 2.96, 1.77, 1.14, .89, .16);
  block(tavern, gold, -.085, 2.91, 1.88, .46, .47, .11);
  block(tavern, cream, -.085, 3.14, 1.9, .49, .10, .13);
  block(tavern, cream, .21, 2.96, 1.88, .18, .08, .09);
  block(tavern, cream, .21, 2.79, 1.88, .18, .07, .09);
  block(tavern, cream, .31, 2.875, 1.88, .065, .22, .09);
  block(tavern, 0x806456, -1.71, 3.72, -.64, .57, 1.21, .55);
  block(tavern, 0x503c35, -1.71, 4.34, -.64, .71, .19, .68);
  batchBlocks(tavern);
  const smoke = Array.from({ length: 7 }, (_, i) => block(town, i % 2 ? 0xd1c7af : 0xaba99b, 0, 0, 0, .23, .23, .23));
  const effects = new THREE.Group();
  town.add(effects);
  effects.add(...smoke);

  function stall(parent, x, y, z, color, yaw, scale = 1) {
    const root = group(parent, x, y, z, yaw);
    root.scale.setScalar(scale);
    for (const sx of [-.75, .75]) for (const sz of [-.5, .5]) {
      block(root, oak, sx, .83, sz, .095, 1.65, .095);
    }
    block(root, planks, 0, .68, .23, 1.67, .13, .67);
    for (let i = -3; i <= 3; i++) {
      block(root, i % 2 ? cream : color, i * .255, 1.65, 0, .257, .12, 1.32).rotation.x = .23;
      block(root, i % 2 ? cream : color, i * .255, 1.43, .64, .255, .23, .06);
    }
    for (let i = -2; i <= 2; i++) block(root, [0xcc7840, 0x85933e, 0xd9af5b][(i + 2) % 3],
      i * .25, .83, .28 + (i % 2) * .09, .19, .16, .21);
    crate(root, -.48, 0, .17, .42);
    batchBlocks(root);
  }
  stall(town, -3.62, 2.29, -16.39, 0xb7473b, -.28);
  stall(town, -3.74, 2.29, -14.46, 0x407f96, -.48, .9);
  stall(town, 3.43, 2.29, -16.7, 0xbb4539, .18);
  stall(town, 4.15, 2.29, -14.75, 0xd28138, .32, .92);
  stall(town, 5.28, ground('town', 5.28, -17.6) + .09, -17.6, 0xb7473b, .45, .81);

  const fountain = group(town, 1.02, 2.3, -14.29);
  const basin = (y, r, height, color) => {
    block(fountain, color, 0, y, 0, r * 2, height, r * 1.46);
    block(fountain, color, 0, y, 0, r * 1.46, height, r * 2);
  };
  basin(.14, 1.01, .28, stone[0]);
  basin(.286, .79, .04, teal);
  for (const side of [-1, 1]) {
    block(fountain, paving[1], side * .92, .31, 0, .23, .21, 1.48);
    block(fountain, paving[2], 0, .31, side * .92, 1.48, .21, .23);
  }
  block(fountain, stone[1], 0, .69, 0, .38, .82, .38);
  basin(1.07, .54, .17, stone[2]);
  basin(1.17, .43, .045, 0x58cbd3);
  block(fountain, paving[2], 0, 1.32, 0, .23, .29, .23);
  const spray = group(fountain, 0, 0, 0);
  const drops = Array.from({ length: 10 }, () => block(spray, 0xb9f3e5, 0, 0, 0, .07, .15, .07));
  batchBlocks(fountain);

  steps(town, 3.65, -.05, -9.25, 10, .225, 1.8, .46);
  steps(town, 1.97, -.06, -8.96, 10, .225, 1.36, .46, .04);
  block(town, stone[0], 2.9, -.52, -9.05, 3.12, 1.18, 1.13);
  block(town, paving[1], 2.9, .105, -9.05, 3.15, .13, 1.16);
  steps(town, 6.2, 2.28, -18.17, 6, .205, .94, .40, -1.03);
  for (const [x, y, z] of [[1.19, 1.02, -11.34], [4.7, 1.2, -11.5], [2.74, .17, -9.14], [-1.95, 2.27, -13.42], [3, 2.28, -13.5]]) torch('town', x, y, z);

  const townPennants = [];
  function bunting(parent, a, b) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    for (const p of [start, end]) {
      block(parent, oak, p.x, p.y - 1.28, p.z, .145, 2.62, .145);
      block(parent, gold, p.x, p.y + .02, p.z, .22, .13, .22);
    }
    const colors = [0xaf4641, 0xe4ac4f, 0x467e7b, 0xa8607c, 0xe4c691];
    let prev = start;
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      const p = new THREE.Vector3().lerpVectors(start, end, t);
      p.y -= Math.sin(t * Math.PI) * .42;
      line(parent, oak, prev, p, .035);
      if (i < 10) {
        const cloth = group(parent, p.x, p.y, p.z, Math.atan2(start.z - end.z, end.x - start.x));
        for (let row = 0; row < 3; row++) {
          block(cloth, colors[i % colors.length], 0, -.06 - row * .08, 0, .25 - row * .07, .09, .042);
        }
        batchBlocks(cloth);
        townPennants.push(cloth);
      }
      prev = p;
    }
  }
  bunting(town, [-4.55, 4.88, -17.8], [-2.8, 4.88, -13.55]);
  bunting(town, [2.9, 4.89, -17.4], [4.56, 4.89, -13.4]);

  const lookoutY = ground('town', 9.38, -19.45) + .09;
  const lookout = group(town, 9.38, lookoutY, -19.45);
  block(lookout, stone[0], 0, .19, 0, 2.23, .38, 2.15);
  block(lookout, planks, 0, 2.3, 0, 2.01, .24, 2.02);
  for (const x of [-.77, .77]) for (const z of [-.77, .77]) {
    block(lookout, oak, x, 1.95, z, .23, 3.27, .23);
    if (z > 0) block(lookout, 0xad7747, x, 2.67, z, .21, .82, .22);
  }
  block(lookout, oak, 0, 2.73, .89, 1.98, .12, .13);
  for (const angle of [-.67, .67]) block(lookout, oak, 0, 1.25, .83, .15, 2.37, .14).rotation.z = angle;
  for (let i = 0; i < 5; i++) {
    block(lookout, i % 2 ? 0x943c32 : 0xbb5139, 0, 3.51 + i * .16, 0, 2.46 - i * .47, .18, 2.46 - i * .47);
  }
  flag(lookout, -.04, 4.2, 0, 0x272731, 'skull');
  glow('town', 9.38, lookoutY + 2.92, -19.04, .28, .39, .26);
  batchBlocks(lookout);
  for (const [x, z, size] of [[-4.6, -17.4, .9], [4.9, -18.2, 1.03], [6.3, -20.2, 1.12], [7.3, -17.7, .77], [11.6, -19.9, .76]]) {
    palm(town, x, ground('town', x, z) + .08, z, size, x);
  }
  for (const [x, z] of [[-3, -13.38], [2.84, -13.36], [4.66, -15.2], [5.7, -16.25], [7.5, -18]]) {
    flowers(town, x, ground('town', x, z) + .09, z, 0xd46689);
  }

  // Lighthouse gorge: bridge piers and a stepped stone arch, with water behind it.
  const bridge = group(scene, 0, 0, 0);
  for (let i = 0; i < 19; i++) {
    const t = (i + .5) / 19;
    const y = Math.sin(t * Math.PI) * .27;
    block(bridge, paving[i % 5], t, y, 0, .053, .2, 1.46);
    const archBottom = -3.7 + 3.46 * Math.sin(t * Math.PI) ** .63;
    block(bridge, stone[i % 5], t, (y - .1 + archBottom) / 2, 0, .053, y - .1 - archBottom, 1.26);
    for (const z of [-.7, .7]) {
      block(bridge, stone[(i + 2) % 5], t, y + .24, z, .053, .29, .19);
      if (i % 4 === 0) block(bridge, paving[2], t, y + .43, z, .036, .34, .26);
    }
  }
  batchBlocks(bridge);
  const bridgeLights = [new THREE.Group(), new THREE.Group()];
  for (const light of bridgeLights) {
    scene.add(light);
    lamp(light, 0, .83, 0);
    block(light, lit, 0, 1.31, 0, .25, .26, .326);
  }
  const gorge = sets.west;
  const cascade = group(gorge, -3.42, 0, -11.91, .20);
  block(cascade, stone[0], 0, .79, -.39, 1.66, 4.24, 1.15);
  block(cascade, stone[1], 0, -.43, .09, 2.03, 1.33, 1.61);
  block(cascade, 0x377da1, 0, 1.62, .245, 1.28, 2.65, .26);
  block(cascade, teal, 0, 2.95, -.22, 1.29, .16, 1.22);
  block(cascade, 0x5ebdbf, 0, .31, .54, 1.46, .13, .85);
  block(cascade, 0x418fa8, 0, -.38, .87, 1.42, 1.4, .23);
  batchBlocks(cascade);
  const streakColors = [0x6bcfd8, 0x8cddd8, 0xc3f1e5, 0x52a9b8];
  const cascadeStreaks = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial(), 32);
  const cascadeFoam = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial(), 18);
  const splashDot = new THREE.Object3D();
  const streakTint = new THREE.Color();
  // Particle bounds move with the waterfall, while the instances stay in a single draw per layer.
  for (const batch of [cascadeStreaks, cascadeFoam]) {
    batch.frustumCulled = false;
    batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < batch.count; i++) batch.setColorAt(i, streakTint.setHex(streakColors[i % 4]));
    cascade.add(batch);
  }
  const streaks = Array.from({ length: cascadeStreaks.count }, (_, i) => ({
    phase: grain(i, 6), x: grain(i, 7) - .5, speed: .73 + grain(i, 8) * .54,
    width: .046 + grain(i, 9) * .07,
  }));
  const foam = Array.from({ length: cascadeFoam.count }, (_, i) => ({
    angle: (grain(i, 11) - .5) * Math.PI * 1.38, phase: grain(i, 12),
    size: .072 + grain(i, 13) * .14, drift: .52 + grain(i, 14) * .63,
  }));
  function flowWater(time) {
    for (const [i, stream] of streaks.entries()) {
      const upper = i < 22;
      const a = (time * stream.speed * (upper ? 1 : 1.5) + stream.phase) % 1;
      const length = .07 + Math.sin(a * Math.PI) * (upper ? .53 : .32);
      splashDot.position.set(stream.x * (upper ? 1.20 : 1.38),
        upper ? 2.95 - a ** 1.21 * 2.66 : .36 - a ** 1.17 * 1.54,
        upper ? .408 + .105 * a ** 9 : 1.028 + a ** 3 * .19);
      splashDot.rotation.set(0, 0, 0);
      splashDot.scale.set(stream.width, length, .052);
      splashDot.updateMatrix();
      cascadeStreaks.setMatrixAt(i, splashDot.matrix);
    }
    for (const [i, dot] of foam.entries()) {
      const a = (time * .83 + dot.phase) % 1;
      const arc = 4 * a * (1 - a);
      splashDot.position.set(Math.sin(dot.angle) * (.28 + a * dot.drift), -1.147 + arc * (i % 3 === 0 ? .33 : .035),
        1.2 + Math.cos(dot.angle) * a * dot.drift);
      splashDot.rotation.set(0, -dot.angle, 0);
      splashDot.scale.set(dot.size * (1.1 - a), .035 + arc * .02, dot.size * (1 + arc));
      splashDot.updateMatrix();
      cascadeFoam.setMatrixAt(i, splashDot.matrix);
    }
    cascadeStreaks.instanceMatrix.needsUpdate = true;
    cascadeFoam.instanceMatrix.needsUpdate = true;
  }
  flowWater(0);
  arch(gorge, -14.72, -.48, -5.23, 1.73, 2.28, .54);
  block(gorge, 0x2a2426, -14.72, .35, -6.97, 1.47, 1.64, .18);
  block(gorge, 0x40322b, -14.72, -.45, -6.13, 1.45, .17, 1.95);
  torch('west', -15.12, -.49, -6.12);

  function pier(parent, x, z, length, heading, width = 1.6) {
    const root = group(parent, x, -.07, z, heading);
    for (let i = 0; i < Math.ceil(length / .31); i++) {
      const edge = i * .31;
      block(root, planks, 0, 0, edge, width, .17, .30);
      if (i % 4 === 0) for (const side of [-1, 1]) {
        block(root, oak, side * width * .46, -.45, edge, .22, 1.48, .23);
        block(root, gold, side * width * .46, .30, edge, .25, .065, .26);
      }
    }
    batchBlocks(root);
    return root;
  }
  const islet = sets.islet;
  const approachPier = pier(islet, -6.65, 11.75, 4.16, -1.28);
  pier(islet, -10.35, 12.89, 3.36, -1.66, 1.25);
  for (const [x, z] of [[-8.52, 12.32], [-11.82, 13.2], [-13.25, 12.64]]) {
    torch('islet', x, -.06, z);
    crate(islet, x + .31, .03, z - .24, .39);
  }
  for (const [x, z, s] of [[-11.52, 13.81, 1.04], [-9.28, 13.6, .83], [-10.5, 14.18, .92]]) {
    const y = ground('islet', x, z) + .08;
    palm(islet, x, y, z, s, z);
    flowers(islet, x + .34, y, z + .33, 0xc65b77);
  }

  // Channel fort and its landing.
  const fort = sets.scene;
  const keep = group(fort, -11.8, 1.79, 17.17);
  block(keep, stone[0], 0, .21, 0, 2.49, .42, 2.38);
  for (let i = 0; i < 7; i++) {
    const y = .45 + i * .33;
    block(keep, stone[i % 5], 0, y, 0, 1.97, .335, 1.89);
    for (const x of [-.77, .77]) {
      block(keep, stone[(i + 2) % 5], x, y, .955, i % 2 ? .47 : .4, .319, .08);
      block(keep, stone[(i + 3) % 5], .992, y, x, .075, .321, i % 2 ? .43 : .37);
    }
  }
  block(keep, 0x4a3833, -.24, .61, .96, .57, 1.18, .105);
  block(keep, paving[2], -.24, 1.24, 1.01, .68, .16, .14);
  for (const y of [1.54, 2.18]) block(keep, 0x343336, .38, y, .96, .17, .34, .13);
  block(keep, 0x778075, 0, 2.64, 0, 2.34, .33, 2.27);
  for (const x of [-.9, 0, .9]) for (const z of [-.89, .89]) {
    block(keep, paving[1], x, 2.99, z, .43, .46, .46);
    if (x) block(keep, paving[2], x, 2.99, 0, .43, .46, .43);
  }
  flag(keep, -.57, 2.87, -.11, 0xa94337, 'skull');
  batchBlocks(keep);
  steps(fort, -11.27, -.63, 20.53, 10, .24, .96, .25, .26);
  for (const [x, y, z] of [[-12.86, 1.56, 17.92], [-10.42, 1.38, 17.33], [-11.94, -.38, 20.1]]) torch('scene', x, y, z);
  const cannon = group(fort, -10.32, 1.65, 17.92, 1.18);
  block(cannon, oak, 0, .19, 0, .65, .31, .93);
  for (const x of [-.35, .35]) block(cannon, 0xa16e46, x, .17, -.17, .16, .35, .4);
  block(cannon, 0x34383b, 0, .42, .11, .42, .34, 1.08).rotation.x = -.13;
  block(cannon, 0x5e5d5c, 0, .49, .66, .47, .41, .16);
  block(cannon, 0x27292c, 0, .50, .752, .28, .24, .035);
  batchBlocks(cannon);
  for (const [x, z] of [[-13.15, 18.55], [-9.04, 18.68], [-13.32, 17.19]]) {
    const y = ground('scene', x, z) + .09;
    palm(fort, x, y, z, .80, x);
    flowers(fort, x + .31, y, z + .3, 0xe5688a);
  }

  // Barrel Works beach, fish rack and crane wharf.
  const beach = sets.east;
  arch(beach, 10.08, .11, 14.19, 1.87, 2.64, .64);
  steps(beach, 10.08, -.34, 15.55, 5, .095, 1.40, .24);
  torch('east', 8.86, .08, 14.38);
  torch('east', 11.28, .08, 14.32);
  const tent = group(beach, 13.07, .08, 14.36, -.14);
  block(tent, planks, 0, .07, 0, 2.76, .14, 2.18);
  for (const x of [-1.13, 1.13]) for (const z of [-.86, .86]) {
    block(tent, oak, x, .88, z, .13, 1.73, .13);
  }
  for (let i = -4; i <= 4; i++) {
    for (const side of [-1, 1]) {
      const color = i % 2 ? cream : 0x467a9c;
      block(tent, color, side * .61, 2.05, i * .258, 1.50, .14, .261).rotation.z = -side * .56;
      block(tent, color, side * 1.22, 1.58, i * .258, .12, .20, .26);
    }
  }
  for (let i = -4; i <= 4; i++) {
    block(tent, i % 2 ? cream : 0x467a9c, i * .30, 1.60, 1.16, .302, .22, .10);
  }
  flag(tent, 0, 2.40, -.36, 0x294251, 'skull');
  barrel(tent, .79, .13, .13, 0xa8764a);
  crate(tent, -.64, .12, .51, .42);
  batchBlocks(tent);
  const rack = group(beach, 11.43, .04, 17.08, -.19);
  for (const x of [-.95, .95]) {
    block(rack, oak, x, .65, 0, .13, 1.39, .15);
    block(rack, oak, x, .48, -.19, .12, .97, .13).rotation.x = -.36;
  }
  line(rack, oak, new THREE.Vector3(-.95, 1.3, 0), new THREE.Vector3(0, 1.18, 0), .043);
  line(rack, oak, new THREE.Vector3(0, 1.18, 0), new THREE.Vector3(.95, 1.3, 0), .043);
  for (let i = -2; i <= 2; i++) {
    const x = i * .32;
    block(rack, 0x6d9caa, x, .79, .045, .16, .46, .09).rotation.z = i * .06;
    block(rack, 0xacc8bd, x + .03, .74, .096, .083, .27, .03);
    block(rack, 0x5f8291, x, 1.014, .04, .23, .10, .065);
    block(rack, 0x403e42, x - .045, .65, .105, .035, .037, .027);
  }
  batchBlocks(rack);
  for (const [x, z, heading] of [[14.11, 16.55, -.24], [8.42, 17.4, .37], [12.75, 18.9, -.49]]) {
    const y = ground('east', x, z);
    const chest = group(beach, x, y + .014, z, heading);
    block(chest, 0x88513a, 0, .13, 0, .65, .32, .47);
    block(chest, 0xb57443, 0, .30, -.02, .68, .13, .49);
    block(chest, 0xc18b4b, 0, .39, -.025, .60, .10, .34);
    for (const dx of [-.235, .235]) block(chest, gold, dx, .24, 0, .075, .39, .50);
    block(chest, 0xf2c067, 0, .24, .254, .15, .16, .043);
    batchBlocks(chest);
  }
  pier(beach, 13.7, 12.05, 5.45, 1.52, 2.45);
  const crane = group(beach, 17.67, .02, 12.27, -.30);
  block(crane, stone[1], 0, .16, 0, .91, .31, .84);
  block(crane, oak, 0, 1.56, 0, .31, 2.95, .33);
  block(crane, 0xa26a40, .82, 2.98, 0, 2.26, .22, .24);
  line(crane, oak, new THREE.Vector3(.02, 1.75, 0), new THREE.Vector3(1.2, 2.93, 0), .16);
  line(crane, 0x77634b, new THREE.Vector3(1.81, 2.89, 0), new THREE.Vector3(1.81, 1.47, 0), .047);
  crate(crane, 1.81, 1.02, 0, .52);
  batchBlocks(crane);
  stall(beach, 15.5, .04, 11.97, 0xae4a3c, -.21, .85);
  for (const [x, y, z] of [[14.52, -.03, 13.08], [18.06, -.03, 11.38], [12.14, .04, 15.15]]) torch('east', x, y, z);
  for (const [x, z, size] of [[7.2, 18.6, .96], [8.5, 19, .88], [12.36, 17.7, .71], [14.86, 16.03, .92], [16.67, 13.51, 1.07]]) {
    const y = ground('east', x, z) + .09;
    palm(beach, x, y, z, size, z);
    flowers(beach, x + .43, y, z + .22, 0xc66588);
  }
  function pirate(parent, color, hat) {
    const root = group(parent, 0, 0, 0);
    block(root, color, 0, .48, 0, .32, .31, .25);
    block(root, 0x5a392e, 0, .39, .012, .34, .061, .27);
    block(root, gold, 0, .39, .151, .08, .07, .026);
    block(root, 0xd39a66, 0, .74, .035, .27, .25, .25);
    for (const x of [-.066, .066]) block(root, 0x312b32, x, .76, .168, .038, .044, .021);
    block(root, hat, 0, .872, .027, .41, .078, .32);
    block(root, hat, .018, .947, .013, .28, .12, .22);
    for (const x of [-.212, .212]) {
      block(root, color, x, .515, 0, .12, .20, .14);
      block(root, 0xd39a66, x, .383, .028, .113, .099, .12);
    }
    const feet = [-.087, .087].map(x => {
      const foot = group(root, x, .34, 0);
      block(foot, 0x42333a, 0, -.12, 0, .12, .24, .13);
      block(foot, 0x352b34, 0, -.287, .045, .14, .085, .21);
      batchBlocks(foot);
      return foot;
    });
    batchBlocks(root);
    return { root, feet };
  }
  const routes = [
    ['town', [-2.35, 2.34, -15.2], [-.48, 2.34, -14.03]],
    ['town', [-1.48, 2.34, -15.88], [1.89, 2.34, -15.81]],
    ['town', [2.55, 2.34, -13.77], [2.61, 2.34, -15.58]],
    ['town', [3.65, .235, -9.25], [3.65, 2.26, -13.39]],
    ['east', [10.24, .09, 15.94], [11.83, .09, 15.99]],
    ['east', [12.18, .09, 16.04], [13.02, .09, 16.03]],
    ['islet', [-10.53, .34, 12.8], [-9.06, .34, 12.8]],
  ].map(([key, a, b], i) => ({
    ...pirate(sets[key], [0xa14040, 0x457d8d, 0x587845, 0x905783][i % 4], i % 3 ? 0x3e3237 : 0x82443c),
    a: new THREE.Vector3(...a),
    b: new THREE.Vector3(...b),
  }));

  function hull(parent, scale, color) {
    const root = group(parent, 0, 0, 0);
    root.scale.setScalar(scale);
    for (const [i, width] of [.52, .86, 1.16, 1.24, 1.09, .72, .34].entries()) {
      const z = (i - 3) * .39;
      block(root, 0x5c3832, 0, -.02, z, width, .40, .397);
      block(root, planks, 0, .18, z, width * .89, .10, .39);
      for (const side of [-1, 1]) {
        block(root, color, side * width * .46, .23, z, .11, .22, .399);
      }
    }
    return root;
  }
  const sloop = hull(scene, 1.43, 0xbb8147);
  block(sloop, oak, 0, 1.24, -.12, .10, 2.24, .10);
  for (let i = 0; i < 7; i++) {
    const fullness = Math.sin(i / 6 * Math.PI);
    block(sloop, i % 2 ? 0xb24b41 : 0x9d3d35, 0, .84 + i * .177,
      -.03 + fullness * .13, 1.32 + fullness * .32, .182, .12);
  }
  block(sloop, cream, 0, 1.45, .185, .27, .23, .06);
  block(sloop, cream, 0, 1.28, .185, .15, .12, .06);
  for (const x of [-.058, .058]) block(sloop, 0x663735, x, 1.47, .223, .046, .05, .025);
  for (const angle of [-.42, .42]) block(sloop, cream, 0, 1.19, .19, .42, .045, .058).rotation.z = angle;
  block(sloop, oak, 0, 2.01, -.01, 1.56, .069, .09);
  flag(sloop, 0, 1.5, -.12, 0x3a3437, 'skull');
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) block(sloop, i % 2 ? 0x84c1b6 : 0xb4ddd1,
      side * (.49 + i * .11), -.31, -1.5 - i * .42, .065, .025, .32).rotation.y = side * .29;
  }
  batchBlocks(sloop);

  const skiff = hull(scene, .69, 0xbd955c);
  const fisher = pirate(skiff, 0x42786f, 0x984d68);
  fisher.root.position.set(.06, .24, .05);
  fisher.root.rotation.y = -.8;
  line(skiff, 0xb18454, new THREE.Vector3(-.15, .69, .25), new THREE.Vector3(-1.15, 1.3, .53), .047);
  line(skiff, cream, new THREE.Vector3(-1.15, 1.3, .53), new THREE.Vector3(-1.32, -.21, .56), .022);
  block(skiff, 0xd67759, -1.32, -.22, .56, .093, .079, .081);
  batchBlocks(skiff);

  const gulls = ['west', 'scene', 'scene'].map((key, i) => {
    const bird = buildPirateBird(sets[key], block, { body: 0xf2e3cc, wings: 0xd6d5ca, chest: 0xfff1d6, tail: 0x69777b });
    bird.model.scale.setScalar(i ? .6 : .72);
    for (const wing of bird.wings) batchBlocks(wing);
    batchBlocks(bird.model);
    return bird;
  });
  for (const parent of Object.values(sets)) batchBlocks(parent);
  // Emissive pieces use their own batches to preserve the glow.
  for (const parent of Object.values(glows)) {
    for (const material of [lit, pale]) {
      const pieces = parent.children.filter(piece => piece.material === material);
      if (!pieces.length) continue;
      const batch = new THREE.InstancedMesh(pieces[0].geometry, material, pieces.length);
      pieces.forEach((piece, i) => {
        piece.updateMatrix();
        batch.setMatrixAt(i, piece.matrix);
      });
      parent.remove(...pieces);
      parent.add(batch);
    }
  }

  const toBridge = new THREE.Vector3();
  let sloopOffset = 0;
  function layout(portrait) {
    sloopOffset = -1.55 * portrait;
    sets.town.position.set(-2.45 * portrait, 0, -3.35 - 20.7 * portrait - 4.3 * Math.sin(Math.PI * portrait));
    sets.east.position.set(-4.3 * portrait, 0, -2.6 * portrait);
    islet.position.set(-3.5 * portrait, 0, 5.6 * portrait);
    approachPier.visible = portrait < .08;
    sets.scene.position.set(-2.4 + 8.1 * portrait, 0, .75 + 4.75 * portrait);
    bridge.position.set(west.position.x - 3.65, 2.2, west.position.z - 12.65);
    toBridge.set(east.position.x + sets.town.position.x - 4.46, 2.2,
      east.position.z + sets.town.position.z - 14.18);
    toBridge.sub(bridge.position);
    bridge.rotation.y = -Math.atan2(toBridge.z, toBridge.x);
    bridge.scale.x = Math.hypot(toBridge.x, toBridge.z);
    bridgeLights.forEach((light, i) => {
      light.position.copy(bridge.position).addScaledVector(toBridge, i ? .87 : .13);
      light.position.x += Math.sin(bridge.rotation.y) * .71;
      light.position.z += Math.cos(bridge.rotation.y) * .71;
    });
  }
  function animate(time, reducedMotion) {
    const t = reducedMotion ? 0 : time;
    townPennants.forEach((cloth, i) => {
      cloth.rotation.x = .29 * Math.sin(t * 4 + i * .7);
      cloth.rotation.z = .09 * Math.sin(t * 3 + i);
    });
    smoke.forEach((puff, i) => {
      const age = (time * (reducedMotion ? .18 : .46) + (i / smoke.length) ** 1.35) % 1;
      puff.position.set(-1.61 + age ** 1.4 * 1.95, 6.76 + age * 2.12, -18.7 + Math.sin(i * 3 + age * 5) * age * .39);
      puff.rotation.set(i, age * 2, i * .7 + age);
      puff.scale.setScalar((.15 + age * .65) * Math.sin(Math.PI * age) ** .55);
    });
    if (!reducedMotion) flowWater(t);
    drops.forEach((drop, i) => {
      const a = (t * .96 + i / drops.length) % 1, angle = i * 2.4;
      drop.position.set(Math.cos(angle) * a * .65, 1.49 + Math.sin(a * 3.7) * .58 - a * .5, Math.sin(angle) * a * .65);
    });
    routes.forEach(({ root, feet, a, b }, i) => {
      const angle = t * (.33 + (i % 3) * .055) + i * 2;
      const phase = .5 - .5 * Math.cos(angle);
      root.position.lerpVectors(a, b, phase);
      if (i === 3) root.position.y = .235 + Math.round(phase * 9) * .225;
      root.position.y += reducedMotion ? 0 : Math.abs(Math.sin(t * 7 + i)) * .038;
      root.rotation.y = Math.atan2(b.x - a.x, b.z - a.z) + (Math.sin(angle) < 0 ? Math.PI : 0);
      feet.forEach((foot, side) => { foot.rotation.x = Math.sin(t * 7 + i + side * Math.PI) * .33; });
    });
    const sail = t * .17 + .4;
    sloop.position.set(-5.35 + sloopOffset + Math.sin(sail) * .62, -.79 + Math.sin(t * 1.5) * .075, 16.75 + Math.cos(sail) * .76);
    sloop.rotation.set(Math.sin(t * 1.9) * .04, .55 + Math.sin(sail) * .32, Math.cos(t * 1.46) * .057);
    skiff.position.set(2.55 + Math.sin(t * .56) * .16, -.92 + Math.sin(t * 1.9) * .069, 9.52);
    skiff.rotation.set(.055 * Math.sin(t * 2), -.47, .05 * Math.cos(t * 2));
    gulls.forEach((bird, i) => {
      const a = t * .51 + i * 1.94;
      bird.model.position.set((i ? -10 : -9.5) + Math.cos(a) * (i ? 3.8 : 3.1),
        (i ? 3.6 : 7.1) + Math.sin(a * 2) * .43, (i ? 18.1 : -10.8) + Math.sin(a) * 1.87);
      bird.model.rotation.y = Math.atan2(Math.sin(a) * 3.5, -Math.cos(a) * 1.87);
      flapBird(bird, t * 10.5 + i, .55);
    });
  }
  return { layout, animate, fitChannel: channel => terrain.forEach(batch => batch(channel)), town: sets.town, beach: sets.east, fort, islet };
}
