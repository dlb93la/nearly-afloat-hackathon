import * as THREE from 'three';
import { expansionShore } from './bay-expansion.js';
import { createShoreBatch } from './bay-navigation.js';

const crags = [
  [-10.0, -11.6, 6.6, 5.4, 5.45],
  [-14.7, -6.4, 3.9, 5.6, 3.54],
  [-5.4, -13.5, 4.1, 3.2, 3.72],
  [-19.2, -13.6, 1.75, 2.04, 4.06],
  [15.8, 1.35, 1.74, 1.45, 2.58],
  [-13.5, 12.8, 2.35, 1.63, 1.40],
  [5.0, 17.7, 1.46, 1.51, 1.15],
];
const headland = [
  [8.1, 7.7, 4.0, 3.7],
  [10.7, 12.1, 6.0, 4.9],
  [7.1, 14.9, 3.3, 2.9],
];
const step = .62;
const rock = [0x6d7063, 0x7a7669, 0x737568, 0x817964, 0x717065];
const grass = [0x667d40, 0x6c8243, 0x748846, 0x7c8d4a, 0x849350];

function grain(x, z) {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function elevation(x, z) {
  const jagged = Math.sin(x * 1.16 + z * .65) * .046 + Math.cos(z * 1.2 - x) * .046;
  let top = -2;
  for (const [cx, cz, rx, rz, rise] of crags) {
    const rim = 1 + jagged - Math.hypot((x - cx) / rx, (z - cz) / rz);
    if (rim < 0) continue;
    const slope = Math.min(1, rim * 1.64);
    top = Math.max(top, -.90 + rise * slope * slope * (3 - 2 * slope));
  }
  for (const [cx, cz, rx, rz] of headland) {
    const rim = 1 + jagged - Math.hypot((x - cx) / rx, (z - cz) / rz);
    if (rim >= 0) top = Math.max(top, Math.min(.32, -.96 + rim * 3.5));
  }
  return Math.round(top / .16) * .16;
}

function growForest(parent, treeSites, box, material) {
  const tracts = [
    new THREE.InstancedMesh(box, material, treeSites.length * 2),
    new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1), material, treeSites.length * 5),
  ];
  const helper = new THREE.Object3D();
  const tint = new THREE.Color();
  function piece(batch, index, color, x, y, z, w, h, d, heading, lean = 0) {
    helper.position.set(x, y, z);
    helper.scale.set(w, h, d);
    helper.rotation.set(0, heading, lean);
    helper.updateMatrix();
    batch.setMatrixAt(index, helper.matrix);
    batch.setColorAt(index, tint.setHex(color));
  }
  const greens = [[0x536f3d, 0x708a42, 0x8a9e4c], [0x3e693d, 0x548044, 0x6c9450], [0x587338, 0x778d42, 0x9ca557]];
  treeSites.forEach(([x, z, size], i) => {
    const gx = Math.round(x / step) * step;
    const gz = Math.round(z / step) * step;
    const y = elevation(gx, gz) + .07;
    const heading = grain(x, z) * Math.PI * 2;
    const colors = greens[Math.floor(grain(z, x) * greens.length)];
    piece(tracts[0], i * 2, 0x796049, x, y + .62 * size, z, .15 * size, 1.32 * size, .16 * size, heading, .08);
    piece(tracts[0], i * 2 + 1, 0x8a6c4b, x + Math.cos(heading) * .16 * size, y + .91 * size, z - Math.sin(heading) * .16 * size,
      .11 * size, .69 * size, .11 * size, heading, -.53);
    piece(tracts[1], i * 5, colors[1], x, y + 1.65 * size, z, .57 * size, .56 * size, .53 * size, heading);
    for (let side = 0; side < 4; side++) {
      const angle = heading + side * 1.55;
      const spread = size * (.30 + grain(i, side) * .23);
      piece(tracts[1], i * 5 + 1 + side, colors[side % 3], x + Math.cos(angle) * spread,
        y + (1.27 + grain(side, i) * .63) * size, z + Math.sin(angle) * spread,
        .47 * size, (.34 + grain(side, i + 8) * .14) * size, .42 * size, angle);
    }
  });
  parent.add(...tracts);
}

export function createBayCoast(scene, west, east, box, block, flag) {
  const shores = new Map([[west, []], [east, []], [scene, []]]);
  const coastAt = (x, z) => x > 0 && (z < 5 || x > 3.7 && z > 5.4 && z < 18) ? east : x < 0 && z < 1 ? west : scene;
  for (let row = -30; row <= 33; row++) {
    for (let column = -37; column <= 30; column++) {
      const x = column * step;
      const z = row * step;
      const y = elevation(x, z);
      if (y < -1.2) continue;
      const n = grain(column, row);
      const patch = .5 + Math.sin(x * .49 + z * .36) * .22 + Math.cos(z * .55 - x * .21) * .17;
      const color = Math.floor((patch * .92 + n * .08) * grass.length);
      const shore = coastAt(x, z);
      const cells = shores.get(shore);
      const land = shore !== scene;
      const path = (shore === east && z > 6 && z < 14.8 && Math.abs(x - 8.2 - (z - 7) * .27) < .87) || shore === west && z < -5 && z > -12.6 && Math.abs(x + 12.7 + Math.sin(z * 1.04) * .74) < .67;
      const grassy = !path && y >= -.5 && (land || y > .48);
      const cap = grassy ? grass[color] : y < -.5 ? 0xc8ab72 : path ? 0xbb9966 : rock[color];
      const cave = shore === west && Math.abs(x + 14.72) < .82 && z > -7 && z < -2.4;
      const bottom = cave ? 1.52 : -1.48;
      if (y < bottom) continue;
      const turf = grassy ? Math.min(y - bottom, .50) : 0;
      const base = y - turf;
      if (base > bottom) cells.push({ x, z, y: (base + bottom) / 2, h: base - bottom, w: step, d: step, color: rock[color] });
      cells.push({ x, z, y: y + .046 - turf / 2, h: .092 + turf, w: step, d: step, color: cap });
      if (cave) continue;
      if (grassy || y < .3 || n > .11) continue;
      for (const [dx, dz] of [[step / 2, 0], [0, step / 2]]) {
        const neighbor = elevation(x + dx * 2, z + dz * 2);
        if (neighbor > y - .78) continue;
        const shelf = Math.max(neighbor + .22, y - .48 - n);
        cells.push({ x: x + dx, z: z + dz, y: shelf, h: .13, w: dx ? .13 : step * .90,
          d: dz ? .13 : step * .90, color: rock[(color + 2) % rock.length] });
      }
    }
  }
  const material = new THREE.MeshLambertMaterial();
  const batches = [...shores].map(([parent, cells]) => createShoreBatch(parent, box, material, cells));
  growForest(west, [
    [-14.55, -13.8, .85], [-13.45, -14.15, .77], [-12.3, -14.6, 1.02], [-11.5, -15.45, .79],
    [-9.85, -14, .93], [-8.85, -13.4, 1.02], [-8.05, -14.8, .93], [-7.25, -13.3, 1.12],
    [-6.6, -12.4, .68], [-5.7, -13.78, .92], [-5.05, -14.44, 1.03], [-4.95, -12.1, .64],
    [-16.8, -8.96, 1.12], [-17.7, -7.5, .76], [-16.28, -6.52, .91], [-15.9, -4.32, .74],
    [-13.85, -7.18, .64], [-11.7, -8.98, .61], [-18.8, -13.5, .83],
    [-10.9, -7.71, .89], [-10.3, -6.86, .68], [-9.51, -7.66, .83], [-8.77, -8.43, .82],
  ], box, material);
  growForest(east, [
    [6.42, 7.71, .68], [6.65, 8.65, .76], [7.55, 9.77, .63], [12.74, 9.34, .74],
    [14.79, 10.78, .9], [15.44, 11.77, .65], [14.24, 13.8, .70], [12.95, 15.36, .61],
  ], box, material);

  const crowns = [];
  function palm(x, z, size, heading) {
    const tree = new THREE.Group();
    tree.position.set(x, elevation(x, z) + .08, z);
    tree.rotation.y = heading;
    tree.scale.setScalar(size);
    coastAt(x, z).add(tree);
    for (let i = 0; i < 5; i++) {
      block(tree, i % 2 ? 0x976c48 : 0xa87951, i * .09, .21 + i * .40, 0, .19 - i * .012, .42, .18).rotation.z = -.19;
    }
    const crown = new THREE.Group();
    tree.add(crown);
    crown.position.set(.38, 2.03, 0);
    for (let i = 0; i < 6; i++) {
      const frond = new THREE.Group();
      frond.rotation.y = i * Math.PI / 3 + Math.sin(i) * .17;
      crown.add(frond);
      const color = i % 2 ? 0x437338 : 0x61923b;
      block(frond, color, .29, .071, 0, .60, .088, .26).rotation.z = .14;
      block(frond, color, .69, -.017, 0, .39, .073, .22).rotation.z = -.47;
      block(frond, 0x779f41, .91, -.133, 0, .19, .061, .14).rotation.z = -.53;
    }
    block(crown, 0x627233, 0, -.06, 0, .31, .23, .30);
    crowns.push(crown);
  }
  for (const [x, z, size, yaw] of [
    [-15.5, -7.7, 1.26, 1.8], [-14.6, -5.1, .92, .4], [-13.9, -2.5, 1.12, 1.9],
    [-12.3, -8.3, 1.03, 2.4], [-8.45, -9.50, 1.19, .6], [-7.05, -11.6, .87, 1.3],
    [8.9, 9.7, 1.12, 2.3], [13.8, 11.2, .92, .5], [13.0, 14.8, 1.06, 2], [9.45, 14.75, .82, .7], [-4.60, -12.2, 1.12, 2.3], [-15.8, -11.7, 1.07, .5], [-13.6, 12.9, .69, 2.2],
  ]) palm(x, z, size, yaw);
  for (const [x, z] of [
    [-15.2, -3.1], [-13.0, -4.0], [-14.8, -6.0], [-15.1, -9.3], [-12.8, -10.4],
    [-11.0, -8.4], [-9.1, -8.9], [-7.6, -10.5], [-5.0, -11.2], [-7.0, -13.4],
    [-14.35, 12.7], [15.7, 1.65], [-18.7, -13.5],
  ]) {
    const y = elevation(x, z);
    const parent = coastAt(x, z);
    block(parent, 0x537639, x, y + .16, z, .79, .36, .71);
    block(parent, 0x7d9f42, x + .21, y + .30, z + .16, .57, .40, .46);
    block(parent, 0x9f9750, x - .29, y + .10, z + .38, .49, .23, .40);
  }

  for (const [x, z] of [[8.6, 8.2], [10.6, 10.3], [10.5, 13.1]]) {
    const y = elevation(x, z);
    block(east, 0x5d4536, x, y + .48, z, .13, .88, .13);
    block(east, 0x713d26, x, y + .99, z, .28, .22, .27);
    block(east, 0xffc165, x, y + .98, z, .18, .15, .28);
  }
  for (const [x, z] of [[12, 9.5], [14.2, 12.6], [10.1, 16.15]]) {
    const y = elevation(x, z);
    block(east, 0x756653, x, y + .16, z, .74, .39, .67);
    block(east, 0x8c9b50, x + .14, y + .39, z, .42, .13, .47);
  }

  const beacon = new THREE.Group();
  beacon.position.set(-10.3, elevation(-10.3, -9.9) + .07, -9.9);
  west.add(beacon);
  block(beacon, 0x787064, 0, .23, 0, 2.56, .48, 2.45);
  block(beacon, 0xb8a17c, 0, 1.51, 0, 1.55, 2.62, 1.54);
  for (const y of [.76, 2.09]) block(beacon, 0x9f5945, 0, y, 0, 1.61, .38, 1.60);
  block(beacon, 0x4a3d3b, 0, .80, .79, .49, .91, .08);
  block(beacon, 0x634a40, 0, 2.71, 0, 2.02, .16, 2.01);
  for (const x of [-.66, .66]) for (const z of [-.66, .66]) {
    block(beacon, 0x5a493e, x, 3.17, z, .11, .86, .11);
  }
  for (let i = 0; i < 4; i++) block(beacon, i % 2 ? 0x593e43 : 0x85463e, 0, 3.61 + i * .16, 0,
    1.80 - i * .39, .18, 1.80 - i * .39);
  flag(beacon, .03, 4.06, .01, 0x93484b, 'sabers');
  const glowMaterial = new THREE.MeshBasicMaterial({ color: 0xffcd73 });
  const flame = block(beacon, glowMaterial, 0, 3.11, 0, .47, .60, .47);
  const embers = Array.from({ length: 7 }, () => block(beacon, glowMaterial, 0, 0, 0, .10, .10, .10));
  const smoke = Array.from({ length: 6 }, (_, i) =>
    block(beacon, i % 2 ? 0xb9b1a0 : 0x9c9e92, 0, 0, 0, .21, .21, .21));
  function animate(time) {
    for (const [i, crown] of crowns.entries()) {
      crown.rotation.x = Math.sin(time * 1.8 + i * .9) * .11;
      crown.rotation.z = Math.sin(time * 1.4 + i) * .14;
    }
    flame.rotation.y = time * 3.2;
    flame.scale.y = .53 + Math.sin(time * 9) * .13 + Math.sin(time * 15) * .05;
    for (const [i, ember] of embers.entries()) {
      const age = (time * .78 + i / embers.length) % 1;
      ember.position.set(Math.sin(i * 2.1 + time) * .17 + age * .88, 3.3 + age * 1.4, Math.cos(i * 3.3) * .24);
      ember.scale.setScalar(.093 * (1 - age));
    }
    for (const [i, puff] of smoke.entries()) {
      const age = (time * .38 + i / smoke.length) % 1;
      puff.position.set(.16 + age * 2.49, 3.77 + age * .75, Math.sin(age * 2.5 + i) * .26);
      puff.rotation.set(i + age, i * .76, age * 2.5);
      puff.scale.setScalar((.18 + age * .44) * (1 - age ** 3));
    }
  }
  return { animate, fitChannel: channel => batches.forEach(batch => batch(channel)) };
}

export function createBayWreck(scene, block) {
  const wreck = new THREE.Group();
  scene.add(wreck);
  for (const [x, z, width, depth, height] of [
    [-1.57, .1, 1.29, 1.48, .49], [-.66, -.34, 1.22, 2.08, .63], [.36, 0, 1.55, 1.75, .61],
    [1.55, .21, 1.10, 1.14, .42], [2.05, -.37, .80, .67, .34], [-1.70, -.78, .74, .73, .76],
  ]) {
    block(wreck, 0x777468, x, -1.39 + height / 2, z, width, height, depth);
    block(wreck, 0xc3a36d, x, -1.39 + height, z, width * .91, .14, depth * .89);
  }
  const hull = new THREE.Group();
  hull.rotation.set(.10, -.53, -.27);
  hull.position.set(-.22, -.76, -.40);
  wreck.add(hull);
  for (const [i, width] of [.42, .88, 1.08, 1.11, .78].entries()) {
    const z = (i - 2) * .47;
    block(hull, 0x613e38, 0, .14, z, width, .39, .48);
    block(hull, 0xb08452, 0, .35, z, width * .89, .11, .47);
    for (const side of [-1, 1]) {
      if (i === 3 && side === 1) continue;
      block(hull, 0x7c5141, side * width * .45, .45, z, .13, .21, .43);
    }
  }
  block(hull, 0x654737, .06, 1.19, -.34, .105, 1.76, .11).rotation.z = -.16;
  block(hull, 0x845c43, .18, 1.74, -.30, 1.38, .09, .09).rotation.z = .16;
  const sail = new THREE.Group();
  sail.position.set(.17, 1.68, -.27);
  hull.add(sail);
  for (const [i, width] of [.99, .91, .72, .48].entries()) {
    block(sail, i % 2 ? 0xb29976 : 0xcdb58e, -.13 - i * .055, -.07 - i * .14,
      .075 + i * .025, width, .15, .08);
  }
  block(wreck, 0x52753d, -1.80, -.43, -.82, .45, .31, .38);
  block(wreck, 0x779048, -1.64, -.37, -.94, .39, .28, .31);
  return {
    wreck,
    animate(time) { sail.rotation.x = Math.sin(time * 3.3) * .29; },
  };
}

export function createBayWater(scene, west, hub, east, wreck, { town, beach, fort, islet }) {
  const time = { value: 0 };
  const shores = [west, hub, east, wreck];
  const shoreOffsets = shores.map(() => new THREE.Vector2());
  const expansionOffsets = {
    town: new THREE.Vector2(), east: new THREE.Vector2(),
    fort: new THREE.Vector2(), islet: new THREE.Vector2(),
  };
  const expansionDistances = expansionShore.map(({ district, shape }) => {
    const coords = { west: 'w', east: 'e - beachOffset', town: 'e - townOffset', scene: 'p - fortOffset',
      islet: 'w - isletOffset' }[district];
    const [x, z, rx, rz] = shape.map(n => n.toFixed(2));
    return `shore = min(shore, distanceFrom(${coords}, vec2(${x}, ${z}), vec2(${rx}, ${rz})));`;
  }).join('\n');
  const material = new THREE.ShaderMaterial({
    uniforms: {
      time,
      night: { value: 0 },
      shoreOffsets: { value: shoreOffsets },
      townOffset: { value: expansionOffsets.town },
      beachOffset: { value: expansionOffsets.east },
      fortOffset: { value: expansionOffsets.fort },
      isletOffset: { value: expansionOffsets.islet },
      deep: { value: new THREE.Color(0x164957) },
      blue: { value: new THREE.Color(0x167d89) },
      shoal: { value: new THREE.Color(0x50bda5) },
    },
    vertexShader: `
      varying vec2 worldXZ;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.);
        worldXZ = world.xz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform float night;
      uniform vec2 shoreOffsets[4];
      uniform vec2 townOffset;
      uniform vec2 beachOffset;
      uniform vec2 fortOffset;
      uniform vec2 isletOffset;
      uniform vec3 deep;
      uniform vec3 blue;
      uniform vec3 shoal;
      varying vec2 worldXZ;

      float distanceFrom(vec2 p, vec2 center, vec2 radius) {
        return (length((p - center) / radius) - 1.) * min(radius.x, radius.y);
      }
      void main() {
        vec2 p = floor(worldXZ * 10.) / 10.;
        vec2 w = p - shoreOffsets[0];
        vec2 h = p - shoreOffsets[1];
        vec2 e = p - shoreOffsets[2];
        float west = max(distanceFrom(w, vec2(0., -.4), vec2(13.8, 9.5)), w.x + 4.4);
        float east = max(distanceFrom(e, vec2(0., -.4), vec2(13.8, 9.5)), 4.4 - e.x);
        float shore = min(min(west, east), distanceFrom(h, vec2(0., -5.4), vec2(4.5, 4.4)));
        shore = min(shore, distanceFrom(w, vec2(-10.4, -11.6), vec2(7., 5.5)));
        shore = min(shore, distanceFrom(w, vec2(-14.9, -6.4), vec2(4., 5.8)));
        shore = min(shore, distanceFrom(w, vec2(-19.2, -13.6), vec2(1.8, 2.1)));
        shore = min(shore, distanceFrom(e, vec2(15.8, 1.35), vec2(1.8, 1.5)));
        shore = min(shore, distanceFrom(p, vec2(-13.5, 12.8), vec2(2.4, 1.7)));
        shore = min(shore, distanceFrom(p, vec2(5., 17.7), vec2(1.5, 1.6)));
        shore = min(shore, distanceFrom(p, shoreOffsets[3], vec2(2.8, 1.5)));
        ${expansionDistances}
        float distortion = sin(p.x * 1.61 + p.y * .88 + time * .83) * .28
                         + cos(p.y * 2.4 - p.x * .79 - time * 1.16) * .20;
        float depth = shore + distortion;
        vec3 color = mix(blue, deep, smoothstep(.0, 13., depth));
        color = mix(color, shoal, (1. - smoothstep(.16, 2.55, depth)) * .78);
        float swell = sin(p.y * 1.59 + p.x * .63 + sin(p.x * .77 + time * .54) * 1.68 - time * 1.92);
        float crossSwell = cos(p.x * 1.83 - p.y * .67 + time * 1.04 + cos(p.y * .9));
        float glitter = smoothstep(1.04, 1.97, swell + crossSwell);
        float foam = (1. - smoothstep(.06, .30, abs(depth - .32))) * smoothstep(-.2, .91, swell);
        float ripples = smoothstep(.81, .98, sin(p.y * 5.9 + p.x * 1.7 + cos(p.x * 1.31) * 2.2 - time * 2.7))
                      * smoothstep(.13, .95, crossSwell);
        color = mix(color, shoal, glitter * (.075 + .13 * (1. - smoothstep(.0, 7., depth))));
        color = mix(color, shoal, ripples * .19);
        color = mix(color, vec3(.56, .81, .70), foam * .32);
        color *= mix(vec3(1.), vec3(.23, .29, .48), night);
        gl_FragColor = vec4(color, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(170, 170), material);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -1.2;
  scene.add(water);
  return (elapsed, night = 0) => {
    time.value = elapsed;
    material.uniforms.night.value = night;
    for (const [i, group] of shores.entries()) shoreOffsets[i].set(group.position.x, group.position.z);
    expansionOffsets.town.set(town.position.x, town.position.z);
    expansionOffsets.east.set(beach.position.x, beach.position.z);
    expansionOffsets.fort.set(fort.position.x, fort.position.z);
    expansionOffsets.islet.set(islet.position.x, islet.position.z);
  };
}
