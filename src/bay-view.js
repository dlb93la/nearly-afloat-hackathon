import * as THREE from 'three';
import { createBayHostScene } from './bay-host-scene.js';
import { createBayLife } from './bay-life.js';
import { createBayCoast, createBayWater, createBayWreck } from './bay-coast.js';
import { createBaySpectacle } from './bay-spectacle.js';
import { createBayExpansion } from './bay-expansion.js';
import { createShoreBatch, fleetChannel } from './bay-navigation.js';
import { createExpeditionVoyage, decorateExpeditionOffice } from './expedition-scene.js';
import { COSMETICS } from '../shared/cosmetics.mjs';
import { createCaptainsHome } from './captains-home.js';
import { createNightLighting } from './night-lighting.js';
import { bayDarkness } from '../shared/world-lighting.mjs';
import { gameIcon } from './game-icons.js';
import { reducedMotion as reduceCameraMotion } from './accessibility.js';

const crewOutfits = Object.values(COSMETICS).filter(item => item.slot === 'pirate');
const destinations = {
  arena: { icon: 'sword', color: 0x933f37, height: 4.9 },
  lab: { icon: 'barrel', color: 0x636234, height: 3.9 },
  home: { icon: 'home', color: 0x76537d, height: 4.9 },
  expeditions: { icon: 'route', color: 0x337170, height: 5 },
};

export function createBayView(wood) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x164957);
  const sky = new THREE.HemisphereLight(0xffeed2, 0x528186, 1.85);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(0xffdaaa, 2.45);
  sun.position.set(-12, 19, -8);
  scene.add(sun);
  const lighting = createNightLighting(scene, sky, sun, { moonlight: .32 });
  const camera = new THREE.OrthographicCamera(-18, 18, 11, -11, .1, 180);
  const offset = new THREE.Vector3(15, 23, 35);
  const focus = new THREE.Vector3();
  const target = new THREE.Vector3();
  const screenRight = new THREE.Vector3();
  const screenUp = new THREE.Vector3();
  const projection = new THREE.Vector3();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const materials = new Map();
  const planks = new THREE.MeshLambertMaterial({ map: wood, color: 0xdba878 });
  const painted = new THREE.MeshLambertMaterial();
  const west = new THREE.Group();
  const hub = new THREE.Group();
  const east = new THREE.Group();
  scene.add(west, hub, east);
  const buildings = new Map();
  const hitRegions = [];
  const pointer = new THREE.Vector2();
  const picker = new THREE.Raycaster();
  const selectionLight = new THREE.PointLight(0xffd592, 0, 9, 2);
  scene.add(selectionLight);
  const flags = [];
  const pennants = [];
  const boats = [];
  let seed = 1815;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  function block(parent, color, x, y, z, w, h, d) {
    if (typeof color === 'number' && !materials.has(color)) materials.set(color, new THREE.MeshLambertMaterial({ color }));
    const mesh = new THREE.Mesh(box, typeof color === 'number' ? materials.get(color) : color);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    parent.add(mesh);
    return mesh;
  }
  function batchBlocks(parent) {
    const blocks = parent.children.filter(child => child.visible && child.isMesh && !child.isInstancedMesh && child.geometry === box);
    for (const material of [painted, planks]) {
      const textured = material === planks;
      const pieces = blocks.filter(child => (child.material === planks) === textured);
      if (pieces.length < 2) continue;
      const batch = new THREE.InstancedMesh(box, material, pieces.length);
      for (const [i, piece] of pieces.entries()) {
        piece.updateMatrix();
        batch.setMatrixAt(i, piece.matrix);
        if (!textured) batch.setColorAt(i, piece.material.color);
      }
      parent.remove(...pieces);
      parent.add(batch);
    }
  }
  function flag(parent, x, y, z, color, emblem = 'coin') {
    block(parent, 0x543b37, x, y + .65, z, .1, 1.4, .1);
    const cloth = new THREE.Group();
    cloth.position.set(x, y + 1.15, z);
    parent.add(cloth);
    const destination = destinations[emblem];
    if (destination) {
      block(cloth, color, .62, 0, 0, 1.24, .72, .08);
      for (const edge of [-.31, .31]) block(cloth, 0xc9a26e, .62, edge, 0, 1.18, .04, .09);
      const icon = gameIcon(destination.icon);
      icon.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      icon.setAttribute('width', '48');
      icon.setAttribute('height', '48');
      icon.setAttribute('color', '#ffeac0');
      const texture = new THREE.TextureLoader().load('data:image/svg+xml,' + encodeURIComponent(icon.outerHTML));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter;
      const badge = new THREE.Mesh(new THREE.PlaneGeometry(.53, .53), new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: .2 }));
      badge.position.set(.6, 0, .052);
      const reverse = badge.clone();
      reverse.position.z = -.052;
      reverse.rotation.y = Math.PI;
      cloth.add(badge, reverse);
      flags.push(cloth);
      return;
    }
    block(cloth, color, .53, 0, 0, 1.06, .42, .08);
    for (const side of [-1, 1]) {
      const face = side * .052;
      if (emblem === 'skull') {
        block(cloth, 0xffead1, .48, .045, face, .27, .21, .03);
        block(cloth, 0xffead1, .48, -.079, face, .15, .08, .03);
        for (const eye of [.42, .54]) block(cloth, 0x262731, eye, .068, side * .075, .055, .052, .015);
        for (const angle of [-.42, .42]) block(cloth, 0xffead1, .48, -.12, face, .44, .042, .025).rotation.z = angle;
      } else if (emblem === 'sabers') {
        for (const angle of [-.70, .70]) block(cloth, 0xffe3a0, .48, 0, face, .42, .047, .03).rotation.z = angle;
      } else {
        block(cloth, 0xffd384, .48, 0, face, .19, .19, .03).rotation.z = Math.PI / 4;
      }
    }
    flags.push(cloth);
  }
  function lamp(parent, x, y, z) {
    block(parent, 0x573936, x, y, z, .16, .95, .16);
    block(parent, 0xffc164, x, y + .48, z, .32, .36, .32);
    block(parent, 0x4d3540, x, y + .7, z, .43, .10, .42);
  }
  function barrel(parent, x, y, z, color) {
    block(parent, color, x, y + .33, z, .57, .67, .54);
    for (const height of [.14, .52]) block(parent, 0x3d3439, x, y + height, z, .61, .09, .58);
    block(parent, 0xbf875a, x, y + .68, z, .47, .06, .45);
  }
  function line(parent, color, start, end, width) {
    const direction = new THREE.Vector3().subVectors(end, start);
    const cord = block(parent, color, 0, 0, 0, width, direction.length(), width);
    cord.position.lerpVectors(start, end, .5);
    cord.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  }

  function bunting(parent, x, z, endX, endZ) {
    const start = new THREE.Vector3(x, 2.84, z);
    const end = new THREE.Vector3(endX, 2.59, endZ);
    for (const point of [start, end]) {
      block(parent, 0x73523d, point.x, point.y / 2, point.z, .115, point.y, .115);
      block(parent, 0xc29260, point.x, point.y + .045, point.z, .19, .13, .19);
    }
    const colors = [0xb74643, 0xe5ac56, 0x42857c, 0x9c5c72];
    let previous = start;
    for (let i = 1; i <= 8; i++) {
      const u = i / 8;
      const point = new THREE.Vector3().lerpVectors(start, end, u);
      point.y -= Math.sin(u * Math.PI) * .41;
      line(parent, 0x684c40, previous, point, .035);
      previous = point;
      if (i === 8) continue;
      const pennant = new THREE.Group();
      pennant.position.copy(point);
      parent.add(pennant);
      for (let row = 0; row < 3; row++) {
        block(pennant, colors[i % colors.length], 0, -.052 - row * .075, 0, .25 - row * .071, .078, .031);
      }
      pennants.push(pennant);
    }
  }

  const { wreck, animate: animateWreck } = createBayWreck(scene, block);
  const expansion = createBayExpansion(scene, west, east, { box, block, batchBlocks, flag, lamp, line, barrel, planks });
  const updateWater = createBayWater(scene, west, hub, east, wreck, expansion);
  const coast = createBayCoast(scene, west, east, box, block, flag);
  const renderHosts = createBayHostScene(block);
  const waveMesh = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ color: 0xffffff }), 180);
  waveMesh.frustumCulled = false;
  scene.add(waveMesh);
  const waves = Array.from({ length: waveMesh.count }, (_, i) => {
    waveMesh.setColorAt(i, new THREE.Color([0x4c9492, 0x5ba99c, 0x8abfa7, 0x427c86][i % 4]));
    return { x: (random() - .5) * 85, z: (random() - .5) * 58, length: .24 + random() * 1.8, phase: random() * 7 };
  });
  const wave = new THREE.Object3D();

  const decking = new Map([[west, []], [hub, []], [east, []]]);
  const westQuay = [];
  const westQuayFixtures = [];
  const timber = [0xb68a5d, 0x9e6f4c, 0xb8895b, 0xc09363, 0xa97f57];
  const cobble = [0x9c8e75, 0x887d70, 0xb1a186, 0xaa9373, 0xa6977d];
  function quay(parent, left, right, z) {
    const width = right - left;
    const x = (left + right) / 2;
    const channelEdge = parent === west && z >= 5;
    for (const [color, y, extra, h] of [
      [0x395c58, -.97, .92, .55], [0x756a51, -.62, .40, .43],
      [0xc5a678, -.34, .10, .18], [0x74543e, -.205, 0, .17],
    ]) {
      if (channelEdge) {
        const columns = Math.ceil((width + extra) / .57);
        const w = (width + extra) / columns;
        for (let i = 0; i < columns; i++) {
          westQuay.push({ x: left - extra / 2 + (i + .5) * w, y, z, w, h, d: 1.02, color });
        }
      } else block(parent, color, x, y, z, width + extra, h, 1.02);
    }
    const paving = parent === hub;
    const palette = paving ? cobble : timber;
    for (const row of [-.32, 0, .32]) {
      for (let edge = left; edge < right;) {
        const end = Math.min(right, edge + (paving ? .49 + random() * .52 : 1.17 + random() * 2.8));
        const length = end - edge;
        if (length > .036) decking.get(parent).push({ x: (end + edge) / 2, z: z + row,
          length, channelEdge, color: palette[Math.floor(random() * palette.length)] });
        edge = end;
      }
    }
  }
  function piling(parent, x, z, height = 1.37) {
    block(parent, 0x654837, x, -.96 + height / 2, z, .24, height, .24);
    block(parent, 0x9f7350, x, -.96 + height, z, .26, .065, .26);
  }
  for (let z = -9; z <= 8; z++) {
    const width = Math.round(13.8 * Math.sqrt(Math.max(.15, 1 - ((z + .4) / 9.5) ** 2)));
    const center = Math.round(Math.sin(z * .7) * .8);
    const left = center - width;
    const right = center + width;
    const bank = z < 2 ? 4.4 : z < 6 ? 4.07 : 4.35;
    quay(west, left, -bank, z);
    quay(east, bank, right, z);
    if (z < -1) {
      const rim = z === -9 || z === -2 ? 3.55 : 4.18;
      quay(hub, -rim, rim, z);
    }
    for (const [side, parent] of [[-1, west], [1, east]]) {
      const outerX = center + side * (width - .30);
      const lampX = center + side * (width - .65);
      let outer = parent;
      if (parent === west && z >= 5 && (z % 2 || z % 3 === 0)) {
        outer = new THREE.Group();
        parent.add(outer);
        westQuayFixtures.push({ group: outer, x: outerX, z });
      }
      if (z % 2) {
        piling(parent, side * (bank + .15), z);
        piling(outer, outerX, z);
      }
      if (z % 3 === 0) lamp(outer, lampX, .33, z);
      if (outer !== parent) batchBlocks(outer);
    }
  }
  const board = new THREE.Object3D();
  const deckTint = new THREE.Color();
  for (const [parent, pieces] of decking) {
    const fixed = pieces.filter(piece => !piece.channelEdge);
    for (const { x, z, length, color } of pieces.filter(piece => piece.channelEdge)) {
      const columns = Math.ceil(length / .57);
      for (let i = 0; i < columns; i++) {
        westQuay.push({ x: x - length / 2 + (i + .5) * length / columns, y: -.135, z,
          w: length / columns - .012, h: .138, d: .306, color });
      }
    }
    const deck = new THREE.InstancedMesh(box, painted, fixed.length);
    for (const [i, piece] of fixed.entries()) {
      board.position.set(piece.x, -.135, piece.z);
      board.scale.set(piece.length - .02, .138, .306);
      board.updateMatrix();
      deck.setMatrixAt(i, board.matrix);
      deck.setColorAt(i, deckTint.setHex(piece.color));
    }
    parent.add(deck);
  }
  const fitWestQuay = createShoreBatch(west, box, painted, westQuay);
  const westLanding = new THREE.Group();
  west.add(westLanding);
  const landingBoards = [];
  for (const [parent, x, length] of [[westLanding, -6.0, 4.1], [east, 5.85, 2.55]]) {
    for (let row = 0; row < Math.ceil(length / .43); row++) {
      const z = 8.5 + row * .43;
      const section = parent === westLanding ? new THREE.Group() : parent;
      if (section !== parent) {
        section.position.set(x, 0, z);
        parent.add(section);
        landingBoards.push(section);
      }
      const localX = section === parent ? x : 0;
      const localZ = section === parent ? z : 0;
      block(section, planks, localX, -.15, localZ, 2.18, .23, .41);
      if (row % 3 === 0) for (const edge of [-1.04, 1.04]) piling(section, localX + edge, localZ);
      if (section !== parent) batchBlocks(section);
    }
  }
  // Water-level landing for the skiff.
  for (let row = 0; row < 6; row++) {
    block(west, planks, -3.68, -.55, 1.52 + row * .36, 1.48, .18, .35);
  }
  for (const x of [-4.32, -3.03]) piling(west, x, 3.45, .73);
  for (let step = 0; step < 4; step++) block(west, 0xa6774e, -5 + step * .31,
    -.15 - step * .11, 1.76, .34, .14, .86);
  bunting(west, -11.55, 2.84, -7.26, 3.18);
  bunting(east, 8.15, 5.18, 10.95, 3.64);

  function site(parent, name, color, w, d, x, z, signY) {
    const root = new THREE.Group();
    parent.add(root);
    root.position.set(x, 0, z);
    block(root, 0x5b463b, 0, .02, 0, w + .65, .28, d + .76);
    block(root, planks, 0, .18, 0, w + .40, .16, d + .50);
    block(root, 0x433236, 0, .29, d * .52, w * .56, .07, .9);
    lamp(root, -w * .38, .71, d * .46);
    lamp(root, w * .38, .71, d * .46);
    if (name !== 'tide') lighting.torch(root, w * .33, .27, d * .54,
      { height: .68, power: 24, reach: 8.5, halo: 3.5 });
    const plaque = new THREE.Vector3(0, signY, d * .56);
    const facade = name === 'home' ? new THREE.Group() : root;
    if (facade !== root) root.add(facade);
    for (const dx of [-1.2, 1.2]) {
      block(facade, 0x4c3a31, dx, signY + .13, d * .515, .14, .75, .30);
    }
    block(facade, 0x51382c, 0, signY, d * .547, 3.02, .61, .17);
    buildings.set(name, { root, plaque, facade });
    const destination = destinations[name];
    if (destination) {
      const outline = new THREE.Group();
      root.add(outline);
      const trim = new THREE.MeshBasicMaterial({ color: destination.color });
      const brass = new THREE.MeshBasicMaterial({ color: 0xc5a574 });
      const outerX = w / 2 + .23, outerZ = d / 2 + .24;
      for (const sign of [-1, 1]) {
        block(outline, trim, 0, .29, sign * outerZ, outerX * 2, .14, .15);
        block(outline, trim, sign * outerX, .29, 0, .15, .14, outerZ * 2);
        for (const side of [-1, 1]) {
          block(outline, brass, side * (outerX - .23), .32, sign * outerZ, .55, .09, .16);
          block(outline, brass, sign * outerX, .32, side * (outerZ - .23), .16, .09, .55);
        }
      }
      const hit = new THREE.Mesh(box);
      hit.visible = false;
      hit.position.y = destination.height / 2;
      hit.scale.set(w + .45, destination.height, d + .55);
      hit.userData.place = name;
      root.add(hit);
      hitRegions.push(hit);
      Object.assign(buildings.get(name), { trim, brass });
    }
    for (const x of [-w * .44, w * .44]) block(facade, color, x, 1.32, d * .48, .24, 2.12, .23);
    return root;
  }

  const fort = site(west, 'tide', 0x778880, 6.1, 4.2, -8.25, -.8, 2.28);
  block(fort, 0x617d77, 0, 1.44, 0, 5.9, 2.5, 4.02);
  for (const x of [-2.48, 2.48]) {
    block(fort, 0x84978a, x, 1.85, 1.34, 1.32, 3.25, 1.40);
    block(fort, 0xa3a58b, x, 3.53, 1.34, 1.53, .26, 1.58);
    for (const dx of [-.53, .53]) block(fort, 0xa1a68f, x + dx, 3.79, 1.85, .42, .39, .37);
    block(fort, 0x283b3d, x, 2.32, 2.06, .20, .50, .08);
  }
  for (let x = -2; x <= 2; x++) block(fort, 0x8c9a89, x, 2.97, -.98, .63, .45, .55);
  block(fort, 0x37484b, 0, 1.27, 2.05, 1.65, 2.01, .17);
  block(fort, 0xc8a660, 0, 2.32, 2.17, 1.86, .23, .23);
  for (const x of [-.49, 0, .49]) block(fort, 0xa78655, x, 1.25, 2.18, .09, 1.73, .09);
  flag(fort, -2.47, 3.8, 1.18, 0x599ead);
  for (const x of [-1.55, 1.55]) {
    block(fort, 0x4a777f, x, 2.09, 2.08, .48, 1.09, .09);
    block(fort, 0xf0c980, x, 2.20, 2.15, .21, .21, .08).rotation.z = Math.PI / 4;
  }

  const arena = site(hub, 'arena', 0x6a4337, 7, 4.5, 0, -5.6, 2.62);
  block(arena, 0x8b5143, 0, 1.72, -.26, 6.7, 2.95, 3.88);
  block(arena, 0x362c32, 0, 1.52, 1.76, 3.96, 2.53, .20);
  block(arena, 0xd28958, 0, 2.91, 1.92, 4.64, .25, .25);
  for (let row = 0; row < 7; row++) {
    block(arena, row % 2 ? 0xa54337 : 0xc25642, 0, 3.16 + row * .24, -.17, 7.58 - row * .93, .27, 4.55);
  }
  block(arena, 0x733b38, 0, 4.77, -.18, 1.98, .20, 4.6);
  for (let x = -3; x <= 3; x++) block(arena, x % 2 ? 0xf3bf71 : 0xab493e, x, 2.86, 2.11, .99, .24, .80);
  flag(arena, .18, 4.79, 0, destinations.arena.color, 'arena');
  for (const x of [-2.85, 2.85]) {
    block(arena, 0x823b41, x, 2.02, 2.35, .54, 1.14, .10);
    for (const angle of [-.64, .64]) block(arena, 0xf4cd8d, x, 2.12, 2.42, .31, .048, .09).rotation.z = angle;
    block(arena, 0x563b32, x, 1.04, 1.81, .76, .18, .25);
    block(arena, 0x3e332e, x, .95, 2.34, .20, .40, .18);
    block(arena, 0xcf9a58, x, .95, 2.44, .09, .27, .04);
  }
  for (const x of [-2.32, 2.32]) block(arena, 0xa36a4a, x, 1.47, 2.02, .22, 2.67, .22);
  block(arena, 0x95605a, 0, 4.9, -.18, 1.68, .11, 4.56);
  for (const x of [-2.77, 2.77]) barrel(arena, x, .27, 2.03, 0xb97a47);

  arena.scale.set(.92, .89, .94);
  fort.scale.set(.89, .86, .91);
  const shop = site(east, 'lab', 0x976845, 5.5, 3.8, 8.55, -2.65, 2.07);
  block(shop, 0xbc875a, 0, 1.30, 0, 5.29, 2.21, 3.63);
  for (let row = 0; row < 5; row++) block(shop, row % 2 ? 0x387771 : 0x498b7d,
    0, 2.44 + row * .24, 0, 5.93 - row * 1.09, .27, 4.05);
  block(shop, 0x735752, -1.61, 3.28, -.87, .73, 1.57, .72);
  block(shop, 0xa88972, -1.61, 4.09, -.87, .94, .21, .92);
  const shopSmoke = new THREE.Group();
  shop.add(shopSmoke);
  const puffs = Array.from({ length: 7 }, (_, i) =>
    block(shopSmoke, i % 2 ? 0xd6c8ae : 0xb0ab9d, 0, 0, 0, .2, .2, .2));
  block(shop, 0x443237, 0, 1.20, 1.86, 1.31, 1.82, .13);
  for (const x of [-1.72, 1.72]) {
    block(shop, 0x6c4a3d, x, 1.49, 1.87, .96, .76, .13);
    block(shop, 0xf9bd66, x, 1.49, 1.95, .65, .50, .09);
    block(shop, 0x78543f, x, 1.49, 2.01, .063, .54, .05);
    block(shop, 0x78543f, x, 1.49, 2.01, .69, .055, .05);
    block(shop, 0x8d5d43, x, 1.13, 2.03, 1.02, .13, .22);
  }
  for (const x of [-.78, .78]) block(shop, 0x754d38, x, 1.20, 1.96, .13, 1.91, .16);
  block(shop, 0x9b6849, 0, 2.18, 1.98, 1.85, .13, .20);
  for (const [x, z, color] of [[-2.26, 2.11, 0x9b5d46], [2.22, 2.06, 0xc38852], [2.48, 1.35, 0x658b67]]) barrel(shop, x, .28, z, color);
  flag(shop, 1.77, 3.60, -.61, destinations.lab.color, 'lab');
  for (const building of [fort, arena, shop]) batchBlocks(building);

  shop.scale.set(.93, .92, .95);
  const expeditionOffice = site(west, 'expeditions', 0x9b7656, 3.62, 3.08, -7.46, 4.10, 4.27);
  decorateExpeditionOffice(expeditionOffice, { block, planks, flag, batchBlocks });

  function cottage(x, z, width, depth, height, siding, roof, awning) {
    const house = new THREE.Group();
    house.position.set(x, 0, z);
    (x < 0 ? west : east).add(house);
    block(house, planks, 0, .05, .04, width + .27, .24, depth + .42);
    block(house, siding, 0, height / 2 + .15, 0, width, height, depth);
    for (const edge of [-1, 1]) {
      block(house, 0x664737, edge * (width / 2 - .09), height / 2 + .15, depth / 2 + .02, .14, height, .12);
      const slope = Math.atan2(.60, width / 2);
      block(house, roof, edge * width / 4, height + .45, 0,
        Math.hypot(width / 2, .60) + .28, .16, depth + .42).rotation.z = -edge * slope;
    }
    for (let tier = 0; tier < 3; tier++) {
      block(house, siding, 0, height + .23 + .15 * tier, 0, width * (.85 - tier * .25), .16, depth);
    }
    const front = depth / 2;
    block(house, 0x483438, -.32, .67, front + .045, .60, 1.05, .11);
    block(house, 0xf1ba72, .40, .99, front + .06, .45, .37, .10);
    block(house, 0x67493b, .40, .99, front + .12, .045, .40, .042);
    if (awning) {
      for (let stripe = -2; stripe <= 2; stripe++) {
        block(house, stripe % 2 ? 0xf2c58b : awning, stripe * .32, 1.39, front + .33,
          .32, .09, .77).rotation.x = .21;
      }
      for (const side of [-1, 1]) block(house, 0x725343, side * .73, .65, front + .63, .08, 1.31, .08);
    } else {
      block(house, 0x856555, .46, height + .47, -.42, .29, .77, .33);
      block(house, 0x73534b, .46, height + .84, -.42, .38, .12, .40);
    }
    batchBlocks(house);
  }
  cottage(-6.2, -6.65, 2.42, 1.9, 1.66, 0x926149, 0x517b72);
  cottage(5.65, -6.75, 2.32, 1.8, 2.03, 0xb38b62, 0x6b5362);
  cottage(-10.57, 2.64, 2.18, 1.70, 1.72, 0xc0986a, 0x8e594b, 0xad4b40);
  cottage(10.24, 2.50, 2.26, 1.76, 1.63, 0x709183, 0x925344, 0x42857d);

  const home = site(hub, 'home', 0x8d9b71, 6.5, 5.2, -1.1, 8.2, 1.35);
  for (let plank = 0; plank < 10; plank++) {
    block(hub, planks, -1.1, .04, 3.46 + plank * .23, 1.22, .16, .222);
  }
  const residence = createCaptainsHome(home, { block, batchBlocks, planks, barrel, lamp, flag });
  const { exterior, interior } = residence;
  flag(exterior, .55, 3.75, -.35, destinations.home.color, 'home');
  const homeSign = buildings.get('home').facade;
  batchBlocks(homeSign);

  for (const [x, z] of [[-6.9, 5.98], [5.45, -.1], [-6.64, -4.88], [9.48, 4.23]]) {
    const parent = x < 0 ? west : east;
    block(parent, 0x9a5f40, x, .22, z, .68, .58, .65);
    block(parent, planks, x, .54, z, .72, .09, .69);
    barrel(parent, x + .7, -.04, z - .24, 0xb87b50);
  }
  for (const district of [west, hub, east]) batchBlocks(district);
  const stations = [west, west, east, east, east, west, hub, east];
  const dockhands = [];
  const drumBody = new THREE.CylinderGeometry(.29, .29, .60, 10);
  const drumBand = new THREE.CylinderGeometry(.31, .31, .075, 10);
  const drumIron = new THREE.MeshLambertMaterial({ color: 0x3e3539 });
  for (const [index, color] of [0xcb6049, 0xdeb95e, 0x57a391, 0x665271, 0xc99462, 0x71a787, 0xa25850, 0x698baa].entries()) {
    const hand = new THREE.Group();
    hand.scale.setScalar(1.2);
    stations[index].add(hand);
    const rider = index < 3;
    const skin = [0xd99a6d, 0x93634e, 0xe3b085][index % 3];
    const limbs = [];
    const legs = [];
    let drum;
    if (rider) {
      drum = new THREE.Group();
      hand.add(drum);
      drum.position.y = .31;
      const body = new THREE.Mesh(drumBody, new THREE.MeshLambertMaterial({ color }));
      body.rotation.z = Math.PI / 2;
      drum.add(body);
      for (const side of [-.21, .21]) {
        const band = new THREE.Mesh(drumBand, drumIron);
        band.rotation.z = Math.PI / 2;
        band.position.x = side;
        drum.add(band);
      }
    }
    for (const x of [-.092, .092]) {
      const leg = new THREE.Group();
      leg.position.set(x, rider ? .94 : .39, 0);
      hand.add(leg);
      block(leg, 0x42333a, 0, -.16, 0, .13, .34, .15);
      block(leg, 0x352b34, 0, -.29, .036, .15, .10, .23);
      (rider ? legs : limbs).push(leg);
    }
    const hips = rider ? .90 : .35;
    const outfit = new THREE.MeshLambertMaterial({ color });
    const cap = new THREE.MeshLambertMaterial({ color: 0x48343b });
    block(hand, outfit, 0, hips + .15, 0, .36, .33, .26);
    block(hand, 0xe4bf82, 0, hips + .07, .139, .12, .07, .036);
    block(hand, skin, 0, hips + .42, .023, .30, .27, .27);
    for (const x of [-.067, .067]) block(hand, 0x382b35, x, hips + .447, .163, .042, .045, .021);
    block(hand, cap, 0, hips + .55, .02, .38, .10, .32);
    const crown = block(hand, cap, 0, hips + .64, .01, .27, .11, .23);
    const sash = block(hand, outfit, .16, hips + .43, -.11, .11, .25, .08);
    sash.rotation.z = .33;
    for (const x of [-.229, .229]) {
      const arm = new THREE.Group();
      hand.add(arm);
      arm.position.set(x, hips + .26, .018);
      block(arm, outfit, 0, -.083, 0, .13, .19, .15);
      block(arm, skin, 0, -.19, 0, .11, .10, .12);
      limbs.push(arm);
    }
    dockhands.push({ hand, drum, limbs, legs, outfit, cap, crown, sash, changeAt: index * .6 });
  }
  const updateLife = createBayLife(scene, west, east, block, planks, dockhands);

  function bridge() {
    const root = new THREE.Group();
    scene.add(root);
    for (let i = 0; i < 20; i++) {
      const x = (i + .5) / 20;
      block(root, timber[i % timber.length], x, -.14 - Math.sin(x * Math.PI) * .12, 0, .047, .15, 1.58);
    }
    for (const z of [-.76, .76]) {
      for (const x of [0, .25, .5, .75, 1]) {
        block(root, 0x6d4e39, x, .12, z, .019, 1.24, .14);
      }
      for (let i = 0; i < 8; i++) {
        const a = i / 8;
        const b = (i + 1) / 8;
        line(root, 0xa77b50,
          new THREE.Vector3(a, .61 - Math.sin(a * Math.PI) * .16, z),
          new THREE.Vector3(b, .61 - Math.sin(b * Math.PI) * .16, z), .041);
      }
    }
    batchBlocks(root);
    return (from, fromX, fromZ, toX, toZ) => {
      root.position.set(from.position.x + fromX, 0, from.position.z + fromZ);
      const dx = hub.position.x + toX - root.position.x;
      const dz = hub.position.z + toZ - root.position.z;
      root.rotation.y = -Math.atan2(dz, dx);
      root.scale.x = Math.hypot(dx, dz);
    };
  }
  const westBridge = bridge();
  const eastBridge = bridge();

  const buoys = [-1, 1].map(side => {
    const buoy = new THREE.Group();
    scene.add(buoy);
    const paint = side < 0 ? 0xb4543d : 0x4d9a78;
    block(buoy, paint, 0, .14, 0, .64, .35, .64);
    block(buoy, 0xd9ad6c, 0, .34, 0, .51, .11, .50);
    block(buoy, paint, 0, .51, 0, .35, .25, .35);
    block(buoy, 0x543f34, 0, .72, 0, .092, .33, .092);
    block(buoy, 0xffcd7d, 0, .91, 0, .18, .18, .18);
    block(buoy, 0x614a3c, 0, 1.04, 0, .24, .08, .24);
    batchBlocks(buoy);
    return { buoy, side };
  });

  const fleet = [
    { wide: [12.55, -11.55], narrow: [3.4, -15.55], wing: east, angle: .82, scale: 1.13, length: 11.7, beam: 3.75,
      hull: 0x51343c, trim: 0xb88448, canvas: 0x46404b, seam: 0x57505b, colors: [0x25262e, 'skull'], masts: [-3.65, -.75, 2.5] },
    { wide: [-17.05, 4.15], narrow: [-7.9, 7.3], wing: west, angle: 1.04, scale: .98, length: 8.5, beam: 2.65,
      hull: 0x704139, trim: 0x9e503d, canvas: 0xe9c994, seam: 0xc79f78, colors: [0xa7473d, 'sabers'], masts: [-1.9, 1.1] },
    { wide: [21.25, 10.5], narrow: [18.2, 21.6], wing: east, angle: .28, scale: .78, length: 4.5, beam: 1.77,
      hull: 0x68443b, trim: 0x588d83, canvas: 0xd5e3c9, seam: 0x92b9a8, colors: [0x4a849e, 'coin'], masts: [.15] },
    { wide: [19.35, 3.15], narrow: [16.8, 11.5], wing: east, angle: 1.35, scale: .66, length: 5.8, beam: 2.1,
      hull: 0x754432, trim: 0xd9a94d, canvas: 0xffdeb0, seam: 0xe0a661, colors: [0xb47934, 'coin'], masts: [.3], merchant: true },
    { angle: 0, scale: .83, length: 5.8, beam: 2.25,
      hull: 0x454556, trim: 0x60889a, canvas: 0xe8d6ae, seam: 0x6693a3, colors: [0x426b87, 'coin'], masts: [.24], expedition: true },
  ];
  for (const vessel of fleet) {
    const { angle, scale, length, beam, hull, trim, canvas, seam, colors, masts } = vessel;
    const boat = new THREE.Group();
    boat.rotation.y = angle;
    boat.scale.setScalar(scale);
    scene.add(boat);
    const segments = [.62, .81, .97, 1, 1, .92, .73, .39];
    const slice = length / segments.length;
    for (const [i, section] of segments.entries()) {
      const z = -length / 2 + slice * (i + .5);
      const width = beam * section;
      block(boat, 0x392b33, 0, -.15, z, width * .78, .52, slice + .014);
      block(boat, hull, 0, .30, z, width, .83, slice + .014);
      block(boat, trim, 0, .64, z, width + .10, .13, slice + .022);
      block(boat, planks, 0, .78, z, width - .12, .18, slice);
      for (const x of [-width * .48, width * .48]) {
        block(boat, hull, x, .94, z, .13, .27, slice + .015);
        block(boat, trim, x, 1.11, z, .17, .11, slice + .015);
        if (masts.length > 1 && i >= 1 && i <= 5) {
          block(boat, 0x24242c, x, .46, z, .20, .32, .43);
          block(boat, 0x484552, x * 1.10, .46, z, .39, .13, .13);
        }
      }
    }
    if (masts.length > 1) {
      block(boat, hull, 0, 1.49, -length * .37, beam * .67, 1.24, length * .22);
      block(boat, trim, 0, 2.16, -length * .37, beam * .77, .18, length * .25);
      for (const x of [-beam * .34, beam * .34]) for (const z of [-length * .40, -length * .34]) {
        block(boat, 0xefb66a, x, 1.56, z, .09, .34, .33);
      }
      block(boat, trim, 0, 1.20, length * .53, .15, .16, length * .18).rotation.x = -.29;
    }
    for (const [i, z] of masts.entries()) {
      const height = (masts.length > 1 ? 4.5 : 2.7) + (i === 1 ? .8 : 0);
      block(boat, 0x594139, 0, .69 + height / 2, z, .15, height, .15);
      for (let tier = 0; tier < (masts.length > 1 ? 2 : 1); tier++) {
        const width = beam * (tier ? .77 : 1.04);
        const bottom = (masts.length > 1 ? 1.86 : 1.15) + tier * 1.62;
        for (let row = 0; row < 5; row++) {
          const belly = Math.sin(row / 4 * Math.PI);
          block(boat, row === 1 ? seam : canvas, 0, bottom + row * .252,
            z + .18 + belly * .25, width * (.79 + belly * .21), .258, .21);
        }
        block(boat, 0x5c423b, 0, bottom + 1.11, z + .17, width * 1.07, .085, .11);
      }
      if (masts.length > 1) {
        const top = new THREE.Vector3(0, height + .26, z);
        for (const x of [-beam * .49, beam * .49]) {
          line(boat, 0x725443, new THREE.Vector3(x, 1.10, z - .57), top, .045);
        }
        line(boat, 0x735645, new THREE.Vector3(0, 1.21, length * .46), top, .04);
        if (i === 1) block(boat, trim, 0, height + .35, z, .72, .16, .67);
      }
      if (i === 0 || i === 1 && masts.length === 3) flag(boat, 0, height - .47, z, ...colors);
    }
    if (vessel.merchant) {
      barrel(boat, -.48, .89, -1.62, 0x8e5a42);
      barrel(boat, .48, .89, -1.62, 0xa57743);
      block(boat, 0xa97846, 0, 1.14, .98, 1.05, .62, .75);
    }
    batchBlocks(boat);
    const voyage = vessel.expedition ? createExpeditionVoyage(boat, west, block, batchBlocks) : null;
    boats.push({ boat, vessel, voyage });
  }

  const updateSpectacle = createBaySpectacle(scene, east, box, block, boats[0].boat, batchBlocks);

  // Extra scenery belongs to the open sea and has fixed world coordinates.
  const openSea = new THREE.Group();
  scene.add(openSea);
  for (const [x, z, turn] of [[-41, -13, .42], [43, 14, -.53], [-32, 29, 1.2], [31, -37, .85]]) {
    const island = new THREE.Group();
    island.position.set(x, 0, z);
    island.rotation.y = turn;
    openSea.add(island);
    for (const [dx, dz, size] of [[-2.3, .9, .7], [0, 0, 1], [2.25, -.7, .63]]) {
      block(island, 0x53615b, dx, -.35, dz, 4.5 * size, 1.6, 4 * size);
      block(island, 0x7c7a57, dx, .5, dz, 3.7 * size, .55, 3.2 * size);
      block(island, 0x4e744c, dx, .85, dz, 2.9 * size, .38, 2.8 * size);
      block(island, 0x5b4637, dx, 1.6, dz, .25, 1.5, .25);
      block(island, 0x42684b, dx, 2.4, dz, 1.65, .75, 1.42);
      block(island, 0x58845b, dx + .18, 2.78, dz, 1.15, .42, 1);
    }
    batchBlocks(island);
  }
  const seaTraffic = [boats[2].boat.clone(), boats[1].boat.clone()];
  seaTraffic.forEach(vessel => openSea.add(vessel));

  let aspect, framedWidth, framedHeight;
  let spread;
  let portrait;
  let zoom = 1;
  let startZoom = zoom;
  let lastDestination;
  let cutaway = 0;
  const overview = new THREE.Vector3();
  const startFocus = new THREE.Vector3();
  const { lerp, smoothstep, smootherstep } = THREE.MathUtils;
  function render(renderer, width, height, time, dt, destination, travel, place, appearance, merchant, firstBrawl, hosts, expedition, homeState) {
    const open = destination === 'home';
    cutaway = lerp(cutaway, Number(open), 1 - Math.exp(-dt * 8.5));
    interior.visible = cutaway > .16;
    exterior.visible = cutaway < .985;
    exterior.position.y = cutaway * 1.3;
    exterior.scale.setScalar(1 - cutaway * .96);
    homeSign.visible = exterior.visible;
    homeSign.scale.y = exterior.scale.y;
    residence.update(homeState, appearance, firstBrawl, time, reduceCameraMotion.matches, interior.visible);
    const ratio = width / height;
    const resized = width !== framedWidth || height !== framedHeight;
    if (resized) {
      framedWidth = width;
      framedHeight = height;
      aspect = ratio;
      portrait = 1 - smoothstep(ratio, .58, 1.3);
      spread = 5.2;
      west.position.set(lerp(-spread, -.9, portrait), 0, lerp(-.6, -10.1, portrait));
      east.position.set(lerp(spread, .8, portrait), 0, lerp(2.0, 9.9, portrait));
      hub.position.set(.15, 0, lerp(-.65, .4, portrait));
      expansion.layout(portrait);
      wreck.position.set(lerp(7.2 + spread * .35, -.65, portrait), 0, lerp(-17.5, -26.3, portrait));
      westBridge(west, -4.55, lerp(-4.7, 5.5, portrait), -4.04, -4.7);
      eastBridge(east, 4.55, lerp(-3.1, -7.15, portrait), 4.04, -3.1);
      for (const { boat, vessel, voyage } of boats) {
        if (voyage) continue;
        const { wide, narrow, wing } = vessel;
        boat.position.set(lerp(wide[0] + wing.position.x, narrow[0], portrait), -.85,
          lerp(wide[1] + wing.position.z, narrow[1], portrait));
      }
      const channel = fleetChannel(boats);
      let landingClear = true;
      for (const board of landingBoards) {
        landingClear &&= !channel(west.position.x + board.position.x, west.position.z + board.position.z, 1.12);
        board.visible = landingClear;
      }
      coast.fitChannel(channel);
      expansion.fitChannel(channel);
      fitWestQuay(channel);
      for (const { group, x, z } of westQuayFixtures) {
        group.visible = !channel(west.position.x + x, west.position.z + z, .65);
      }
      for (const { buoy, side } of buoys) {
        buoy.position.set(side * lerp(3.6 + spread * .23, 2.95, portrait), -1.12, side < 0 ? 6.0 : 9.25);
      }
      overview.set(lerp(.25, .65, portrait), lerp(2.62, 2.25, portrait), lerp(2.85, 3.45, portrait));
      const span = Math.max(29.3, lerp(57, 31.6, portrait) / aspect, height / 25);
      camera.left = -span * aspect / 2;
      camera.right = span * aspect / 2;
      camera.top = span / 2;
      camera.bottom = -span / 2;
      openSea.visible = camera.right >= 32;
    }
    const selected = buildings.get(destination);
    if (selected) {
      selected.root.getWorldPosition(target).setY(1.1);
      const sidePanel = width >= 620 && aspect >= 1.2;
      screenRight.set(offset.z, 0, -offset.x).normalize();
      screenUp.crossVectors(offset, screenRight).normalize();
      const shift = destination === 'home' ? (sidePanel ? .23 : .48) : destination === 'tide' ? .12 : .27;
      if (sidePanel) target.addScaledVector(screenRight, camera.right * shift);
      else target.addScaledVector(screenUp, -camera.top * shift);
    } else target.copy(overview);
    if (lastDestination !== destination) {
      lastDestination = destination;
      startFocus.copy(focus);
      startZoom = zoom;
    }
    const ease = smootherstep(travel, 0, 1);
    focus.lerpVectors(startFocus, target, ease);
    const closeZoom = destination === 'home' ? (aspect < 1 ? 1.9 : 2.4) : 1.57;
    const targetZoom = selected ? lerp(1, closeZoom, reduceCameraMotion.matches ? .55 : 1) : 1;
    zoom = lerp(startZoom, targetZoom, ease);
    camera.zoom = zoom;
    camera.position.copy(focus).add(offset);
    camera.lookAt(focus);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const darkness = lighting.update(time, dt, bayDarkness());
    if (openSea.visible) for (const [i, vessel] of seaTraffic.entries()) {
      const phase = (time * .85 + i * 31) % 64;
      vessel.position.set(i === 0 ? -39 : 40, -.85 + Math.sin(time + i) * .14, i === 0 ? phase - 32 : 32 - phase);
      vessel.rotation.set(Math.sin(time * 1.1) * .035, i * Math.PI, Math.cos(time + i) * .045);
    }
    updateWater(time, darkness);
    waveMesh.material.color.setRGB(1 - darkness * .66, 1 - darkness * .55, 1 - darkness * .38);
    coast.animate(reduceCameraMotion.matches ? 0 : time);
    expansion.animate(time, reduceCameraMotion.matches);
    for (const [i, puff] of puffs.entries()) {
      const age = ((reduceCameraMotion.matches ? 0 : time) * .40 + i / puffs.length) % 1;
      puff.position.set(-1.61 + age * 1.35, 4.23 + age * 1.34, -.87 - age * .5);
      puff.rotation.set(i * .7 + age, i + age, age * 2);
      puff.scale.setScalar((.18 + age * .34) * (1 - age ** 4));
    }
    animateWreck(time);
    for (const [i, ripple] of waves.entries()) {
      wave.position.set(ripple.x + Math.sin(time * .65 + ripple.phase) * .47, -1.17, ripple.z);
      wave.scale.set(ripple.length * (.79 + Math.sin(time * 1.1 + ripple.phase) * .21), .02, .055);
      wave.updateMatrix();
      waveMesh.setMatrixAt(i, wave.matrix);
    }
    waveMesh.instanceMatrix.needsUpdate = true;
    for (const [i, cloth] of flags.entries()) cloth.rotation.y = Math.sin(time * 2.8 + i * .64) * .42;
    for (const [i, pennant] of pennants.entries()) {
      pennant.rotation.x = Math.sin(time * 3.7 + i * .54) * .47;
      pennant.rotation.z = Math.sin(time * 4.2 + i * .57) * .14;
    }
    for (const [i, { buoy }] of buoys.entries()) {
      buoy.position.y = -1.16 + Math.sin(time * 2 + i) * .14;
      buoy.rotation.set(Math.sin(time * 1.8 + i) * .14, time * .15 + i, Math.cos(time * 1.6 + i) * .18);
    }
    const strain = updateSpectacle(boats[0].boat, time);
    const wallTime = Date.now();
    for (const [i, { boat, vessel, voyage }] of boats.entries()) {
      if (voyage) {
        voyage(time, wallTime, expedition, camera.right);
        continue;
      }
      if (vessel.merchant) {
        const remaining = merchant?.restockAt ? (merchant.restockAt - wallTime) / 1000 : Infinity;
        const sinceArrival = merchant?.arrivedAt ? (wallTime - merchant.arrivedAt) / 1000 : Infinity;
        const incoming = !merchant?.waitingForFunds && remaining <= 16 && remaining >= -3;
        boat.visible = incoming || sinceArrival < 10;
        const approach = incoming ? smoothstep(16 - remaining, 0, 16) : 1;
        const { wide, narrow, wing } = vessel;
        const leave = incoming ? 0 : smoothstep(sinceArrival, 6, 10);
        boat.position.x = lerp(wide[0] + wing.position.x, narrow[0], portrait) + (1 - approach + leave) * 20;
        boat.position.z = lerp(wide[1] + wing.position.z, narrow[1], portrait) - (1 - approach + leave) * 1.8;
        boat.rotation.y = vessel.angle + (incoming ? Math.PI : 0);
      }
      const resistance = i === 0 ? strain : 0;
      boat.position.y = -.85 + Math.sin(time * 1.1 + i) * .13;
      boat.rotation.x = Math.sin(time * .87 + i) * .045 + resistance * .065;
      boat.rotation.z = Math.sin(time * 1.4 + i) * .048 + resistance * .13;
    }
    updateLife(time, lerp(spread, 1.45, portrait));
    for (const hand of dockhands) {
      if (time < hand.changeAt) continue;
      const look = crewOutfits[Math.floor(Math.random() * crewOutfits.length)];
      hand.outfit.color.setHex(look.color);
      hand.cap.color.setHex(look.hat);
      hand.crown.visible = look.shape !== 1;
      hand.crown.scale.y = look.shape === 2 ? .07 : .15;
      hand.sash.visible = look.shape === 1;
      hand.changeAt = time + 9 + Math.random() * 10;
    }
    renderer.render(scene, camera);
    renderHosts(renderer, hosts, width, height, time, dt, reduceCameraMotion.matches);
    for (const [name, { root, plaque }] of buildings) {
      root.localToWorld(projection.copy(plaque)).project(camera);
      const pixelsPerUnit = height * camera.zoom / (camera.top - camera.bottom);
      const side = name === 'home' || name === 'expeditions' ? -1 : 1;
      const sideOffset = Math.max(38, Math.min(112, pixelsPerUnit * 3.6));
      const lowerOffset = Math.max(12, Math.min(32, pixelsPerUnit * 1.1));
      place(name, (projection.x + 1) * width / 2 + side * sideOffset, (1 - projection.y) * height / 2 + lowerOffset);
    }
  }
  function pickPlace(x, y) {
    pointer.set(x * 2 - 1, 1 - y * 2);
    picker.setFromCamera(pointer, camera);
    return picker.intersectObjects(hitRegions, false)[0]?.object.userData.place;
  }

  function highlightPlace(place) {
    const selected = buildings.get(place);
    selectionLight.intensity = selected ? 30 : 0;
    if (selected) {
      selectionLight.position.set(0, 3.4, 3);
      selected.root.localToWorld(selectionLight.position);
    }
    for (const [name, building] of buildings) {
      if (!building.trim) continue;
      building.trim.color.setHex(name === place ? 0xffce70 : destinations[name].color);
      building.brass.color.setHex(name === place ? 0xffefba : 0xc5a574);
    }
  }

  return { render, scene, pickPlace, highlightPlace };
}
