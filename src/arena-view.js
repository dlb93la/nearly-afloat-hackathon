import * as THREE from 'three';
import { ARENA_STANDS, createSpectatorFleet } from './spectator-fleet.js';
import { crowdReaction } from '../shared/reactions.mjs';
import { createBayView } from './bay-view.js';
import { createVaultView } from './vault-view.js';
import { buildBarrelModel } from './barrel-model.js';
import { mountPerformanceMeter } from './performance-meter.js';
import { buildPetModel } from './pet-model.js';
import { createArenaCargoView } from './arena-cargo-view.js';
import { createArenaHazardView } from './arena-hazard-view.js';
import { createExperimentalTrapView } from './experimental-trap-view.js';
import { SEESAW_HEIGHT } from '../shared/experimental-traps.mjs';
import { clearArenaLandmark, createArenaMapView } from './arena-map-view.js';
import { buildFortWatchtower } from './fort-models.js';
import { rigFor } from '../shared/rigs.mjs';
import { cosmeticFor } from '../shared/cosmetics.mjs';
import { ARENA_TILE, CARGO_HAZARDS, holeCoversTile, krakenPoint, powderFlightHeight } from '../shared/arena-hazards.mjs';
import { ARENA_MAPS, arenaMapFor } from '../shared/arena-maps.mjs';
import { createNightLighting } from './night-lighting.js';
import { playerMarkerColors } from './player-markers.js';
import { accessibility, reducedMotion } from './accessibility.js';

export const BARREL_COLORS = [0xf16b55, 0xf5cb65, 0x54d9c8, 0xb296fb, 0x8cce63, 0x5ba8f7, 0xf48fbb, 0xfe954e];
export const ARENA_CAMERA = { x: 16, y: 24, z: 22 };

const MAX_BARRELS = 8;
const DOCK_RADIUS = 9;
const CAMERA_SPAN = 19;
const TILE = ARENA_TILE;
const WATER_Y = -1.35;
const MAX_SPARKS = 144;
const FOAM_COLOR = 0x8ae5d4;
const WET_WOOD = 0x492e2e;
const DANGER_WOOD = 0xf5a54a;
const WATER_COLOR = 0x176765;
// Four on the first band of planks lost to the tide, four halfway in,
// then one at the centre for the last stretch of the round.
const TORCH_TILES = [
  [-8, -3], [3, -8], [8, 3], [-3, 8],
  [-4, 1], [-1, -4], [4, -1], [1, 4],
  [0, 0],
];

function randomStream(seed) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function pixelTexture(width, height, draw) {
  const image = document.createElement('canvas');
  image.width = width;
  image.height = height;
  draw(image.getContext('2d'));
  const texture = new THREE.CanvasTexture(image);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

function woodTexture() {
  const texture = pixelTexture(32, 32, (brush) => {
    const random = randomStream(603);
    const boards = ['#d6a57a', '#bd835b', '#d49a69', '#b87d59'];
    for (let row = 0; row < boards.length; row++) {
      const y = row * 8;
      brush.fillStyle = boards[row];
      brush.fillRect(0, y, 32, 8);
      brush.fillStyle = '#80563e';
      brush.fillRect(0, y + 7, 32, 1);
      brush.fillStyle = '#efd0a0';
      brush.fillRect(0, y, 32, 1);
      for (let i = 0; i < 7; i++) {
        const x = Math.floor(random() * 30);
        brush.fillStyle = i % 2 ? '#e2b78b' : '#9b6647';
        brush.fillRect(x, y + 2 + Math.floor(random() * 4), 1 + Math.floor(random() * 10), 1);
      }
      brush.fillStyle = '#493c37';
      brush.fillRect(2, y + 3, 1, 1);
      brush.fillRect(29, y + 3, 1, 1);
    }
  });
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

function markerTexture() {
  return pixelTexture(15, 15, (brush) => {
    brush.fillStyle = '#302431';
    brush.fillRect(1, 1, 13, 6);
    brush.fillRect(3, 7, 9, 2);
    brush.fillRect(5, 9, 5, 2);
    brush.fillRect(6, 11, 3, 2);
    brush.fillStyle = '#fff';
    brush.fillRect(2, 2, 11, 5);
    brush.fillRect(4, 7, 7, 2);
    brush.fillRect(6, 9, 3, 2);
  });
}

function identityTexture(label) {
  return pixelTexture(64, 32, brush => {
    brush.fillStyle = '#19242d';
    brush.fillRect(3, 3, 58, 26);
    brush.strokeStyle = '#ffe8ad';
    brush.lineWidth = 2;
    brush.strokeRect(3, 3, 58, 26);
    brush.fillStyle = '#fff6df';
    brush.font = 'bold 20px monospace';
    brush.textAlign = 'center';
    brush.textBaseline = 'middle';
    brush.fillText(label, 32, 17);
  });
}

function reactionTexture(label, background) {
  return pixelTexture(84, 34, (brush) => {
    brush.fillStyle = '#302431';
    brush.fillRect(1, 5, 82, 20);
    brush.fillRect(4, 2, 76, 26);
    brush.fillRect(35, 27, 13, 4);
    brush.fillRect(36, 31, 7, 3);
    brush.fillStyle = background;
    brush.fillRect(3, 7, 78, 16);
    brush.fillRect(6, 4, 72, 22);
    brush.fillRect(37, 25, 9, 4);
    brush.fillRect(37, 29, 4, 3);
    brush.fillStyle = '#302431';
    brush.font = 'bold 17px monospace';
    brush.textAlign = 'center';
    brush.textBaseline = 'middle';
    brush.fillText(label, 42, 16);
  });
}

function piece(parent, width, height, depth, material, x, y, z) {
  const block = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  block.position.set(x, y, z);
  parent.add(block);
  return block;
}

function solid(color) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

function horizontalRing(inner, outer, material) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 64), material);
  ring.rotation.x = -Math.PI / 2;
  return ring;
}

function makeDock(deck, scene, wood, helper, lighting, torches) {
  const random = randomStream(931);
  const tiles = [];
  for (let row = -9; row <= 9; row++) {
    for (let col = -9; col <= 9; col++) {
      const x = col * TILE;
      const z = row * TILE;
      const radius = Math.hypot(x, z);
      if (radius <= DOCK_RADIUS + 0.15) {
        const color = new THREE.Color().setHSL(0.086, 0.2, 0.77 + random() * 0.15);
        const torchIndex = TORCH_TILES.findIndex(([x, z]) => col === x && row === z);
        const torch = torchIndex < 0 ? null : lighting.torch(deck, x, 0, z, {
          height: torchIndex === 8 ? 1.60 : 1.27,
          power: torchIndex === 8 ? 18 : 16,
          reach: torchIndex === 8 ? 4.5 : 5.8,
        });
        if (torch) torches.push({ x, z, torch });
        tiles.push({ x, z, radius, color, torch, fellAt: null, turn: random() > 0.5 ? 1 : -1, drift: random() });
      }
    }
  }
  const side = solid(0xa77350);
  const top = new THREE.MeshLambertMaterial({ map: wood, color: 0xfff5df, flatShading: true });
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(TILE - 0.018, 0.48, TILE - 0.018),
    [side, side, top, side, side, side], tiles.length,
  );
  const debris = new THREE.InstancedMesh(mesh.geometry, mesh.material, tiles.length);
  for (const surface of [mesh, debris]) {
    surface.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    surface.frustumCulled = false;
  }
  deck.add(mesh);
  scene.add(debris);
  const ledgeTiles = tiles.filter(tile => tile.radius > DOCK_RADIUS - 1.05 && Math.round(tile.x * 10 + tile.z * 10) % 3 === 0);
  const ledges = new THREE.InstancedMesh(new THREE.BoxGeometry(.21, .86, .21), solid(0x6d4937), ledgeTiles.length);
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  ledgeTiles.forEach((tile, index) => {
    tile.ledge = index;
    ledges.setMatrixAt(index, new THREE.Matrix4().makeTranslation(tile.x, -.79, tile.z));
  });
  deck.add(ledges);
  const origin = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const torchOffset = new THREE.Matrix4().makeTranslation(0, .24, 0);
  const torchFlame = new THREE.Vector3();
  const cue = new THREE.Color(DANGER_WOOD);
  const submerged = new THREE.Color(WET_WOOD);
  const tint = new THREE.Color();

  return (radius, phase, time, style, hazard, holes, elapsed, reset) => {
    top.color.setHex(style?.color ?? 0xfff5df);
    deck.updateMatrix();
    let surfaceChanged = false;
    let debrisChanged = false;
    const playing = phase === 'playing' || phase === 'results';
    const fracture = ['collapse', 'anchor-drop'].includes(hazard?.kind) ? hazard : null;
    for (const [index, tile] of tiles.entries()) {
      if (reset) {
        tile.fellAt = null;
        tile.warning = undefined;
        tile.sunk = false;
        if (tile.torch) {
          deck.add(tile.torch.root);
          tile.torch.root.matrixAutoUpdate = true;
          tile.torch.root.position.set(tile.x, 0, tile.z);
          tile.torch.present = tile.torch.lit = true;
        }
        debris.setMatrixAt(index, hidden);
        debrisChanged = true;
        if (tile.ledge !== undefined) {
          ledges.setMatrixAt(tile.ledge, new THREE.Matrix4().makeTranslation(tile.x, -.79, tile.z));
          ledges.instanceMatrix.needsUpdate = true;
        }
      }
      if (tile.sunk) continue;
      const warningTile = fracture && elapsed >= fracture.warnAt && holeCoversTile(fracture, tile.x, tile.z);
      const weakened = holes.some(hole => hole.fireAt > elapsed && holeCoversTile(hole, tile.x, tile.z));
      const cracked = warningTile || weakened;
      const lost = tile.radius > radius + .24 || holes.some(hole => elapsed >= hole.fireAt && holeCoversTile(hole, tile.x, tile.z)) ||
        (warningTile && elapsed >= fracture.fireAt);
      if (lost && tile.fellAt === null) {
        tile.fellAt = time;
        tile.origin = new THREE.Vector3(tile.x, -.24, tile.z).applyMatrix4(deck.matrix);
        tile.rotation = deck.quaternion.clone();
        if (tile.torch) {
          scene.add(tile.torch.root);
          tile.torch.root.matrixAutoUpdate = false;
        }
        mesh.setMatrixAt(index, hidden);
        if (tile.ledge !== undefined) {
          ledges.setMatrixAt(tile.ledge, hidden);
          ledges.instanceMatrix.needsUpdate = true;
        }
        surfaceChanged = true;
      }
      if (tile.fellAt === null) {
        const warning = playing && (cracked || tile.radius > radius - .7);
        if (!warning && tile.warning === false) continue;
        helper.position.set(tile.x, -.24, tile.z);
        helper.rotation.set(cracked ? Math.sin(time * 26 + index) * .04 : 0, 0, 0);
        helper.scale.setScalar(1);
        helper.updateMatrix();
        mesh.setMatrixAt(index, helper.matrix);
        tint.copy(tile.color);
        if (warning) tint.lerp(cue, weakened ? .27 + Math.sin(time * 10 + tile.turn) * .09 : .65 + Math.sin(time * 5 + tile.turn) * .16);
        mesh.setColorAt(index, tint);
        tile.warning = warning;
        surfaceChanged = true;
        continue;
      }
      const age = tile.fellAt === null ? 0 : time - tile.fellAt;
      const fall = Math.min(1, age / .54);
      const wet = THREE.MathUtils.smoothstep(age, .37, .82);
      const wash = Math.min(3.6, Math.max(0, age - .45) * (.14 + tile.drift * .28));
      const bob = Math.sin(time * 2.1 + index) * .075 * wet;
      const sinks = tile.drift > .40 / 3;
      const sinking = sinks ? Math.max(0, age - .95) * (.30 + tile.drift * .42) : 0;
      if (sinking > 3.1) {
        debris.setMatrixAt(index, hidden);
        tile.sunk = true;
        if (tile.torch) tile.torch.present = tile.torch.lit = false;
        debrisChanged = true;
        continue;
      }
      const waterline = sinks ? -1.71 : -1.45;
      const range = Math.max(.65, tile.radius);
      origin.copy(tile.origin);
      helper.position.set(origin.x + wash * tile.x / range + wet * tile.turn * (.21 + wash * .16),
        THREE.MathUtils.lerp(origin.y, waterline, fall ** 1.7) - sinking + bob, origin.z + wash * tile.z / range + wet * tile.drift * .24);
      helper.rotation.set(fall * tile.turn * .46, wet * tile.turn * (.42 + wash * .24), fall * tile.turn * .24);
      turn.copy(helper.quaternion).premultiply(tile.rotation);
      helper.quaternion.copy(turn);
      helper.scale.set(1 - wet * .16, 1, 1 - wet * .13);
      helper.updateMatrix();
      debris.setMatrixAt(index, helper.matrix);
      if (tile.torch) {
        tile.torch.root.matrix.multiplyMatrices(helper.matrix, torchOffset);
        tile.torch.root.matrixWorldNeedsUpdate = true;
        torchFlame.copy(tile.torch.flame.position).applyMatrix4(tile.torch.root.matrix);
        if (torchFlame.y <= WATER_Y || age >= .72) tile.torch.lit = false;
      }
      tint.copy(tile.color).lerp(submerged, fall * .66);
      debris.setColorAt(index, tint);
      debrisChanged = true;
    }
    if (surfaceChanged) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    if (debrisChanged) {
      debris.instanceMatrix.needsUpdate = true;
      if (debris.instanceColor) debris.instanceColor.needsUpdate = true;
    }
  };
}

function makeSea(scene, helper) {
  const waterTime = { value: 0 };
  const seaColors = { deep: { value: new THREE.Color() }, shoreTint: { value: new THREE.Color() }, glint: { value: new THREE.Color() } };
  const surface = new THREE.ShaderMaterial({
    uniforms: { time: waterTime, radius: { value: DOCK_RADIUS }, night: { value: 0 }, ...seaColors },
    vertexShader: `
      varying vec2 world;
      void main() {
        vec4 point = modelMatrix * vec4(position, 1.);
        world = point.xz;
        gl_Position = projectionMatrix * viewMatrix * point;
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform float radius;
      uniform float night;
      uniform vec3 deep;
      uniform vec3 shoreTint;
      uniform vec3 glint;
      varying vec2 world;
      void main() {
        vec2 p = floor(world * 12.) / 12.;
        float swell = sin(p.x * .87 + p.y * 1.4 + sin(p.x * .55 - time * .64) - time * 1.55);
        float crossSwell = cos(p.x * 1.22 - p.y * .62 + time * 1.16);
        float depth = abs(length(p) - radius - .45);
        float shore = 1. - smoothstep(.15, 3.3, depth);
        float foam = (1. - smoothstep(.08, .48, depth + swell * .28)) * smoothstep(.15, .97, crossSwell);
        float sparkle = smoothstep(1.48, 1.96, swell + crossSwell);
        vec3 ink = mix(deep, shoreTint, shore * .67 + swell * .045 + .16);
        ink = mix(ink, glint, foam * .51 + sparkle * .15);
        ink *= mix(vec3(1.), vec3(.11, .15, .30), night);
        gl_FragColor = vec4(ink, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), surface);
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_Y;
  scene.add(water);
  const foam = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), 150);
  foam.frustumCulled = false;
  foam.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(foam);
  const random = randomStream(5440);
  const strips = Array.from({ length: foam.count }, (_, i) => {
    const angle = random() * Math.PI * 2;
    const radius = i < 58 ? 8.2 + random() * 3.2 : 10 + random() * 34;
    const color = [0x358779, 0x65b8a4, 0x236e6e, 0x489b8b][Math.floor(random() * 4)];
    return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, seed: random() * 10, length: 0.1 + random() * 1.05, color };
  });
  let currentPalette;
  const tint = new THREE.Color();

  return (time, radius, palette, night) => {
    if (currentPalette !== palette) {
      currentPalette = palette;
      const [deep, shore, glint] = palette;
      seaColors.deep.value.setHex(deep);
      seaColors.shoreTint.value.setHex(shore);
      seaColors.glint.value.setHex(glint);
      for (const [index, line] of strips.entries()) {
        foam.setColorAt(index, tint.setHex(line.color).lerp(seaColors.shoreTint.value, .46));
      }
      foam.instanceColor.needsUpdate = true;
    }
    waterTime.value = time;
    surface.uniforms.night.value = night;
    foam.material.color.setRGB(1 - night * .64, 1 - night * .51, 1 - night * .33);
    surface.uniforms.radius.value = radius;
    for (const [index, line] of strips.entries()) {
      helper.position.set(line.x + Math.sin(time * 0.72 + line.seed) * 0.42, WATER_Y + 0.027, line.z + Math.cos(time * 0.46 + line.seed) * 0.18);
      helper.rotation.set(0, 0, 0);
      const pulse = 0.66 + 0.25 * Math.sin(time * 1.7 + line.seed);
      helper.scale.set(line.length * pulse, 0.035, 0.07 + (index % 3) * 0.024);
      helper.updateMatrix();
      foam.setMatrixAt(index, helper.matrix);
    }
    foam.instanceMatrix.needsUpdate = true;
  };
}

function dressBay(scene) {
  const slate = solid(0x285758);
  const rock = solid(0x4e7568);
  const sand = solid(0xa19363);
  const dark = solid(0x4d342f);
  const wood = solid(0x9e5a39);
  const sail = solid(0xdad69b);
  const pennant = solid(0xd86b55);
  const moss = solid(0x6b843e);
  const cream = solid(0xe9cc91);
  const lantern = new THREE.MeshBasicMaterial({ color: 0xffcc77 });
  const modelMats = new Map();
  function block(root, color, x, y, z, w, h, d) {
    if (!modelMats.has(color)) modelMats.set(color, solid(color));
    return piece(root, w, h, d, modelMats.get(color), x, y, z);
  }
  const random = randomStream(441);
  const braziers = [];
  const reefs = [];
  for (const [x, z, scale] of [[-13.2, 1.8, 1.28], [-8.9, -12.8, 1.37], [3.5, -16.3, 1.06],
    [14.8, -7.9, 1.18], [-17.2, 9, .78], [10.5, 10.7, .86], [-3, 15.8, .82]]) {
    const shoal = new THREE.Group();
    scene.add(shoal);
    reefs.push(shoal);
    shoal.position.set(x, WATER_Y, z);
    shoal.scale.setScalar(scale);
    piece(shoal, 3.4, 0.38, 2.0, slate, 0, 0.03, 0);
    piece(shoal, 2.6, 0.67, 1.52, rock, -0.05, 0.39, 0.02);
    piece(shoal, 1.72, 0.17, 1.16, sand, -0.17, 0.81, 0.1);
    piece(shoal, 0.92, 0.71, 0.88, rock, 1.17, 0.16, 0.52);
    piece(shoal, 0.73, 0.34, 0.88, slate, -1.6, 0.08, -0.36);
    for (let chip = 0; chip < 19; chip++) {
      const theta = random() * Math.PI * 2;
      const r = .65 + random() * 1.52;
      const bx = Math.cos(theta) * r;
      const bz = Math.sin(theta) * r * .79;
      const height = .19 + random() * (.94 - r * .19);
      const size = .27 + random() * .61;
      piece(shoal, size, height, size * .87, chip % 3 === 0 ? slate : rock, bx, height / 2, bz).rotation.y = chip * .29;
      if (chip % 4 === 0) piece(shoal, size * .86, .09, size * .72, moss, bx, height + .025, bz);
    }
    if (scale > 1.2) {
      const watch = new THREE.Group();
      watch.scale.setScalar(.65);
      watch.position.set(.15, .85, -.31);
      shoal.add(watch);
      buildFortWatchtower(watch, block, false, x < -10 ? 0xc05b56 : 0x4b9484);
    } else {
      for (const side of [-1, 1]) {
        piece(shoal, .21, 1.3, .21, dark, side * .55, 1.40, -.10);
        piece(shoal, .31, .17, .29, wood, side * .55, 1.91, -.1);
        braziers.push(piece(shoal, .23, .25, .23, lantern, side * .55, 2.10, -.10));
      }
    }
  }
  const staticParts = [];
  const flames = new Set(braziers);
  for (const reef of reefs) {
    clearArenaLandmark(reef);
    reef.updateMatrixWorld(true);
    reef.traverse(part => { if (part.isMesh && !flames.has(part)) staticParts.push(part); });
  }
  const reefBatch = new THREE.InstancedMesh(new THREE.BoxGeometry(), solid(0xffffff), staticParts.length);
  const dimensions = new THREE.Matrix4();
  const transform = new THREE.Matrix4();
  for (const [i, part] of staticParts.entries()) {
    const { width, height, depth } = part.geometry.parameters;
    reefBatch.setMatrixAt(i, transform.copy(part.matrixWorld).multiply(dimensions.makeScale(width, height, depth)));
    reefBatch.setColorAt(i, part.material.color);
    part.removeFromParent();
    part.geometry.dispose();
  }
  scene.add(reefBatch);
  const buoys = [];
  for (const [index, angle] of [.28, .95, 1.82, 2.83, 3.42, 4.59, 5.52].entries()) {
    const buoy = new THREE.Group();
    buoy.position.set(Math.cos(angle) * 10.67, WATER_Y, Math.sin(angle) * 10.67);
    scene.add(buoy);
    piece(buoy, .43, .24, .45, wood, 0, .15, 0);
    piece(buoy, .32, .41, .34, index % 2 ? pennant : cream, 0, .37, 0);
    piece(buoy, .20, .14, .21, dark, 0, .63, 0);
    piece(buoy, .13, .14, .13, lantern, 0, .75, 0);
    buoys.push(buoy);
  }
  const cutter = new THREE.Group();
  scene.add(cutter);
  cutter.position.set(-13, WATER_Y + 0.16, -11);
  cutter.rotation.y = 0.6;
  piece(cutter, 1.03, 0.38, 2.75, dark, 0, 0.02, 0);
  piece(cutter, 1.28, 0.24, 3.05, wood, 0, 0.27, 0);
  piece(cutter, 0.79, 0.12, 0.48, wood, 0, 0.38, -1.69);
  piece(cutter, 0.12, 2.68, 0.12, dark, 0, 1.71, 0.03);
  for (let row = 0; row < 4; row++) {
    piece(cutter, 1.14 - row * 0.18, 0.42, 0.16, sail, row * 0.09, 1.04 + row * 0.42, 0.17);
  }
  piece(cutter, 0.48, 0.21, 0.08, pennant, -0.22, 2.97, 0.03);
  return (time) => {
    cutter.position.y = WATER_Y + 0.16 + Math.sin(time * 1.15) * 0.065;
    cutter.rotation.z = Math.sin(time * 0.83) * 0.06;
    for (const [i, buoy] of buoys.entries()) {
      buoy.position.y = WATER_Y + Math.sin(time * 2.3 + i * 1.6) * .12;
      buoy.rotation.set(Math.sin(time + i) * .14, i, Math.cos(time * 1.7 + i) * .17);
    }
    for (const [i, light] of braziers.entries()) light.scale.y = 1 + Math.sin(time * 10 + i) * .32;
  };
}

function makeHeadPet(root, pet) {
  const perch = new THREE.Group();
  perch.position.y = .93;
  root.add(perch);
  const materials = new Map();
  buildPetModel(perch, pet, (parent, color, x, y, z, w, h, d) => {
    if (!materials.has(color)) materials.set(color, solid(color));
    return piece(parent, w, h, d, materials.get(color), x, y, z);
  });
  return perch;
}

function batchRiderParts(parent, keep = null) {
  const parts = parent.children.filter(child => child.isMesh && child !== keep);
  if (parts.length < 2) return;
  const batch = new THREE.InstancedMesh(new THREE.BoxGeometry(), solid(0xffffff), parts.length);
  const stamp = new THREE.Object3D();
  const materials = new Set();
  for (const [index, part] of parts.entries()) {
    const { width, height, depth } = part.geometry.parameters;
    stamp.position.copy(part.position);
    stamp.quaternion.copy(part.quaternion);
    stamp.scale.set(width, height, depth).multiply(part.scale);
    stamp.updateMatrix();
    batch.setMatrixAt(index, stamp.matrix);
    batch.setColorAt(index, part.material.color);
    part.geometry.dispose();
    materials.add(part.material);
  }
  parent.remove(...parts);
  parent.add(batch);
  return materials;
}

export function makeRider(slot, color, appearance, previewOutfit, batchParts = false) {
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  const outfit = previewOutfit ?? cosmeticFor(appearance?.pirate);
  const pet = cosmeticFor(appearance?.pet);
  const shape = outfit?.shape ?? slot % 3;
  const skin = solid([0xe7a679, 0xad704d, 0xf3bc93, 0x85563e][slot % 4]);
  const coat = solid(new THREE.Color(outfit?.color ?? appearance?.pirateColor ?? color).lerp(new THREE.Color(0x322832), 0.2));
  const hat = solid(outfit?.hat ?? 0x352933);
  const linen = solid(0xf7dcb2);
  const gold = solid(outfit?.trim ?? 0xf1be65);
  piece(torso, 0.43, 0.34, 0.34, coat, 0, 0.20, 0);
  piece(torso, 0.15, 0.22, 0.04, linen, 0, 0.24, 0.17);
  piece(torso, 0.15, 0.10, 0.05, gold, 0, 0.095, 0.19);
  const trousers = solid(0x493642);
  const legs = [-1, 1].map(side => {
    const hip = new THREE.Group();
    hip.position.x = side * .116;
    root.add(hip);
    piece(hip, .173, .225, .19, trousers, 0, -.098, 0);
    const knee = new THREE.Group();
    knee.position.y = -.197;
    hip.add(knee);
    piece(knee, .145, .18, .15, trousers, 0, -.075, 0);
    piece(knee, .178, .105, .253, hat, 0, -.168, .043);
    piece(knee, .179, .026, .254, gold, 0, -.147, .049);
    return { hip, knee };
  });

  piece(torso, 0.50, 0.43, 0.43, skin, 0, 0.56, 0.025);
  for (const side of [-1, 1]) {
    piece(torso, 0.07, 0.075, 0.025, hat, side * 0.12, 0.605, 0.247);
  }
  const mouth = piece(torso, 0.105, 0.04, 0.026, hat, 0, 0.48, 0.249);
  if (shape === 0) {
    piece(torso, 0.68, 0.085, 0.52, hat, 0, 0.77, 0.02);
    piece(torso, 0.48, 0.15, 0.36, hat, 0, 0.86, 0.01);
    piece(torso, 0.27, 0.085, 0.06, gold, 0, 0.815, 0.224);
  } else if (shape === 1) {
    piece(torso, 0.53, 0.125, 0.46, coat, 0, 0.743, 0.025);
    piece(torso, 0.13, 0.21, 0.12, coat, -0.26, 0.67, -0.14);
  } else {
    piece(torso, 0.56, 0.14, 0.45, hat, 0, 0.79, 0.02);
    piece(torso, 0.47, 0.07, 0.21, hat, 0, 0.74, 0.29);
    piece(torso, 0.10, 0.08, 0.04, gold, 0, 0.8, 0.25);
  }

  const [left, right] = [-1, 1].map((side) => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.26, 0.31, 0.025);
    torso.add(arm);
    piece(arm, 0.16, 0.25, 0.17, coat, 0, -0.095, 0);
    piece(arm, 0.13, 0.12, 0.14, skin, 0, -0.25, 0);
    return arm;
  });
  const perch = pet ? makeHeadPet(torso, pet) : null;
  if (batchParts) {
    const disposable = new Set();
    for (const parent of [torso, left, right, ...legs.flatMap(({ hip, knee }) => [hip, knee])]) {
      for (const material of batchRiderParts(parent, mouth) ?? []) disposable.add(material);
    }
    root.traverse(part => { if (part.material) disposable.delete(part.material); });
    for (const material of disposable) material.dispose();
  }
  let stride = slot * 1.7;
  let effort = 0;
  function run(speed, dt) {
    effort = THREE.MathUtils.lerp(effort, Math.min(1, speed / 4.5), 1 - Math.exp(-dt * 16));
    stride += dt * Math.min(23, 5 + speed * 2);
    const swing = Math.sin(stride) * effort;
    const hips = .405 + Math.abs(Math.cos(stride)) * effort * .031;
    torso.position.y = hips;
    for (const [i, { hip, knee }] of legs.entries()) {
      const step = swing * (i ? -1 : 1);
      hip.position.y = hips + .016;
      hip.rotation.x = -.08 - step * .68;
      knee.rotation.x = .12 + Math.max(0, step) * .84;
    }
    return swing * .72;
  }
  run(0, 0);
  return { root, left, right, mouth, perch, run, heading: 0 };
}

function makeBarrel(scene, arrowMap, bubbleMap, slot) {
  const group = new THREE.Group();
  const shell = new THREE.Group();
  const roll = new THREE.Group();
  scene.add(group);
  const color = BARREL_COLORS[slot];
  const rider = makeRider(slot, color, undefined, undefined, true);
  group.add(shell, rider.root);
  shell.add(roll);
  const grip = new THREE.Group();
  grip.visible = false;
  group.add(grip);
  const gripCurve = new THREE.TorusGeometry(.63, .105, 6, 14, Math.PI * 1.72);
  const gripSkin = solid(0x8e51a2);
  const cup = solid(0xe9a6c2);
  for (const side of [-1, 1]) {
    const curl = new THREE.Mesh(gripCurve, gripSkin);
    curl.position.y = side * .16;
    curl.rotation.set(Math.PI / 2 + side * .29, 0, side * 1.3);
    grip.add(curl);
    piece(grip, .18, .12, .15, cup, side * .56, side * .16 + .04, .23);
  }
  const { painted, hoopMaterial, grain, setStyle } = buildBarrelModel(roll, color);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.76, 18), new THREE.MeshBasicMaterial({
    color: 0x302126, opacity: 0.34, transparent: true, depthWrite: false,
  }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.027;
  const ownRing = horizontalRing(0.78, 0.95, new THREE.MeshBasicMaterial({ color: 0xffd677, transparent: true, depthWrite: false, depthTest: false }));
  ownRing.renderOrder = 19;
  const ownHalo = horizontalRing(0.74, 1.01, new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false, depthTest: false }));
  ownHalo.renderOrder = 18;
  ownRing.position.y = 0.032;
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: arrowMap, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  marker.scale.set(0.83, 0.83, 1);
  marker.renderOrder = 20;
  const bubble = new THREE.Sprite(new THREE.SpriteMaterial({
    map: bubbleMap, transparent: true, depthTest: false, depthWrite: false,
  }));
  const identityBadge = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  identityBadge.visible = false;
  identityBadge.renderOrder = 22;
  bubble.visible = false;
  bubble.renderOrder = 21;
  scene.add(shadow, ownHalo, ownRing, marker, bubble, identityBadge);
  return { group, shell, roll, grip, rider, painted, hoopMaterial, grain, setStyle, shadow, ownHalo, ownRing, marker, bubble, identityBadge,
    id: null, look: '//', yaw: 0, hit: null, reaction: null, nextShout: 0 };
}

function makeEffects(scene, helper, deck) {
  const particles = [];
  const rings = [];
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const cubes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, MAX_SPARKS);
  cubes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cubes.frustumCulled = false;
  scene.add(cubes);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xd2ffff, opacity: 1, transparent: true, depthWrite: false });
  for (let i = 0; i < 10; i++) {
    const ring = horizontalRing(0.87, 1, ringMaterial.clone());
    ring.visible = false;
    scene.add(ring);
    rings.push({ mesh: ring, age: 1, duration: 0.64, growth: 1.1 });
  }
  const foam = new THREE.Color(FOAM_COLOR);
  const pale = new THREE.Color(0xffefbf);
  const gold = new THREE.Color(0xffaa50);
  const accents = {
    broadside: new THREE.Color(0xff7036),
    powder: new THREE.Color(0xfcb94b),
    parrots: new THREE.Color(0x9fdd72),
    kraken: new THREE.Color(0xb66cff),
    crate: new THREE.Color(0xbc8452),
    anchor: new THREE.Color(0xa5d9f0),
  };
  const random = randomStream(731);
  const origin = new THREE.Vector3();
  const orientation = new THREE.Quaternion();
  const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

  function burst(x, z, splash, force, kind, nx = 0, nz = 0) {
    const count = splash ? 15 : Math.min(19, 4 + Math.floor(force * 1.05));
    const accent = accents[kind] ?? gold;
    const originY = splash ? WATER_Y + 0.04 : 0.52;
    origin.set(x, originY, z);
    if (!splash) deck.localToWorld(origin);
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2;
      const speed = (splash ? 1.65 : 2.3 + Math.min(1.55, force * 0.13)) + random() * 3;
      particles.push({
        x: origin.x, z: origin.z, y: origin.y,
        vx: Math.cos(angle) * speed + nx * Math.min(force * .21, 3),
        vz: Math.sin(angle) * speed + nz * Math.min(force * .21, 3),
        vy: 1.3 + random() * (splash ? 4.1 : 2.2), age: 0, life: 0.24 + random() * 0.46,
        scale: 0.08 + random() * 0.14, color: i % 3 ? (splash ? foam : accent) : pale,
        stretch: kind === 'parrots' ? 2.35 : kind === 'anchor' ? 1.5 : 1,
      });
    }
    if (particles.length > MAX_SPARKS) particles.splice(0, particles.length - MAX_SPARKS);
    const ring = rings.find((entry) => !entry.mesh.visible) ?? rings.reduce((a, b) => a.age > b.age ? a : b);
    ring.age = 0;
    ring.duration = splash ? 0.72 : 0.33;
    ring.growth = splash ? 2 : 1.05 + Math.min(1.05, force * 0.07);
    ring.mesh.visible = true;
    ring.mesh.position.set(x, splash ? WATER_Y + 0.065 : 0.065, z);
    ring.mesh.quaternion.copy(flat);
    if (!splash) {
      deck.localToWorld(ring.mesh.position);
      ring.mesh.quaternion.premultiply(deck.getWorldQuaternion(orientation));
    }
    ring.mesh.material.color.copy(splash ? foam : accent);
  }

  function update(dt) {
    let count = 0;
    for (let index = particles.length - 1; index >= 0; index--) {
      const particle = particles[index];
      particle.age += dt;
      if (particle.age >= particle.life) {
        particles.splice(index, 1);
        continue;
      }
      particle.vy -= 12 * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.z += particle.vz * dt;
      helper.position.set(particle.x, particle.y, particle.z);
      helper.rotation.set(particle.age * 4, 0, particle.age * 6);
      const size = particle.scale * (1 - particle.age / particle.life * 0.66);
      helper.scale.set(size * particle.stretch, size, size);
      helper.updateMatrix();
      cubes.setMatrixAt(count, helper.matrix);
      cubes.setColorAt(count++, particle.color);
    }
    cubes.count = count;
    cubes.instanceMatrix.needsUpdate = true;
    if (cubes.instanceColor) cubes.instanceColor.needsUpdate = true;
    for (const ring of rings) {
      if (!ring.mesh.visible) continue;
      ring.age += dt;
      const progress = ring.age / ring.duration;
      ring.mesh.visible = progress < 1;
      const scale = 0.33 + progress * ring.growth;
      ring.mesh.scale.set(scale, scale, 1);
      ring.mesh.material.opacity = Math.max(0, (1 - progress) * 0.78);
    }
  }

  function clear() {
    particles.length = 0;
    cubes.count = 0;
    for (const ring of rings) ring.mesh.visible = false;
  }

  return { burst, update, clear };
}

const DISPLAY_BARRELS = [
  { id: 'display-0', slot: 0, x: -2.65, z: 0.9, vx: 0, vz: 0, angle: -0.4, alive: true },
  { id: 'display-1', slot: 2, x: 0.3, z: -1.8, vx: 0, vz: 0, angle: 0.65, alive: true },
  { id: 'display-2', slot: 1, x: 2.65, z: 1.3, vx: 0, vz: 0, angle: -0.73, alive: true },
];

function turnTowards(from, to, amount) {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * amount;
}

export function arenaZoom(radius) {
  return Math.max(1, Math.min(2.05, CAMERA_SPAN / (radius * 2 + 5.4)));
}

export function createArenaView(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  const performanceMeter = mountPerformanceMeter(canvas, renderer);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(WATER_COLOR);
  const sky = new THREE.HemisphereLight(0xf5e9ce, 0x537785, 2.05);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(0xffdeaf, 2.15);
  sun.position.set(-7, 13, -4);
  scene.add(sun);
  const lighting = createNightLighting(scene, sky, sun, { moonlight: .18 });
  const camera = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 130);
  camera.position.copy(ARENA_CAMERA);
  camera.lookAt(0, -0.28, 0);
  const helper = new THREE.Object3D();
  const wood = woodTexture();
  const bay = createBayView(wood);
  let vault;
  const arrow = markerTexture();
  let identityMaps;
  const swearMaps = ['#!?*', '%@?!', '&*!#'].map((label) => reactionTexture(label, '#ffc889'));
  const emoteMaps = new Map([
    ['wave', reactionTexture('AHOY!', '#bfeadb')],
    ['cheer', reactionTexture('YARR!', '#ffe090')],
    ['shrug', reactionTexture('EH?', '#d8c8fb')],
  ]);
  const drawSea = makeSea(scene, helper);
  const deck = new THREE.Group();
  const deckTiltAxis = new THREE.Vector3();
  const visibleTilt = new THREE.Vector2();
  scene.add(deck);
  const deckTorches = [];
  const drawDock = makeDock(deck, scene, wood, helper, lighting, deckTorches);
  const drawHazard = createArenaHazardView(scene, deck);
  const drawCargo = createArenaCargoView(deck);
  let drawExperimentalTrap;
  const drawScenery = createArenaMapView(scene, dressBay);
  const cheerCrowd = createSpectatorFleet(scene, ARENA_STANDS, WATER_Y, (seats, index) => {
    lighting.torch(seats, 1.89, .68, .87, { height: .98, power: index % 2 ? 10 : 0, reach: 4.5, halo: 3.1 });
  });
  const nightBuoys = [[-10.2, 4.7], [7.5, 10.8], [11.6, -3.6], [-4.5, -12.3]].map(([x, z]) => {
    const buoy = new THREE.Group();
    scene.add(buoy);
    buoy.position.set(x, WATER_Y, z);
    piece(buoy, .81, .30, .81, solid(0x916446), 0, .13, 0);
    piece(buoy, .55, .26, .55, solid(0x694639), 0, .35, 0);
    lighting.torch(buoy, 0, .48, 0, { height: .74, halo: 3.1 });
    return buoy;
  });
  const barrels = Array.from({ length: MAX_BARRELS }, (_, slot) => makeBarrel(deck, arrow, swearMaps[0], slot));
  const effects = makeEffects(scene, helper, deck);
  const seenEvents = new Set();
  let crowdEvent = '';
  let phase = '';
  let tick = -1;
  let shownElapsed = 0;
  let roundKey = '';
  let drillReset = 0;
  let width = 0;
  let height = 0;
  let bufferWidth = 0;
  let bufferHeight = 0;
  let bayRendering = false;
  const renderScales = { bay: 1, arena: 1 };
  let sampleTime = 0;
  let samples = 0;
  let steadySamples = 0;
  let slowArenaFrames = 0;
  const warmedArenaLighting = new Set();
  let arenaMapsReady = false;
  let lastArenaResize = -Infinity;
  const touchDisplay = window.matchMedia('(any-pointer: coarse)');
  let time = 0;
  let radius = DOCK_RADIUS;
  let shake = 0;

  function resize(frameTime, isBay = false, headingToArena = false) {
    performanceMeter.sample(frameTime);
    const useArenaBudget = !isBay || headingToArena;
    const scene = useArenaBudget ? 'arena' : 'bay';
    if (bayRendering !== isBay) {
      if (!isBay && renderScales.bay < .84) renderScales.arena = Math.min(renderScales.arena, .78);
      bayRendering = isBay;
      canvas.classList.toggle('harbor-render', isBay);
      sampleTime = samples = steadySamples = 0;
      slowArenaFrames = 0;
      lastArenaResize = time;
    }
    const nextWidth = Math.max(1, canvas.clientWidth);
    const nextHeight = Math.max(1, canvas.clientHeight);
    if (!isBay && !document.hidden && frameTime > 0 && frameTime < .24) {
      slowArenaFrames = frameTime > .035 ? slowArenaFrames + 1 : 0;
      if (slowArenaFrames >= 4 && time - lastArenaResize >= 4 && renderScales.arena > .52) {
        renderScales.arena = Math.max(.52, renderScales.arena - .12);
        lastArenaResize = time;
        slowArenaFrames = 0;
        sampleTime = samples = steadySamples = 0;
      }
    }
    if (!headingToArena && frameTime > 0 && frameTime < .24 && !document.hidden) {
      sampleTime += frameTime;
      samples++;
      if (sampleTime >= 1.35) {
        const average = sampleTime / samples;
        // Leave room for the renderer to hit the 16.7 ms budget of a 60 Hz display.
        if (average > .0195 && (isBay || time - lastArenaResize >= 4)) {
          renderScales[scene] = Math.max(isBay ? .64 : .52, renderScales[scene] - .08);
          if (!isBay) lastArenaResize = time;
        }
        steadySamples = average < .0176 ? steadySamples + 1 : 0;
        if (steadySamples >= 3 && (isBay || time - lastArenaResize >= 4)) {
          renderScales[scene] = Math.min(1, renderScales[scene] + .04);
          steadySamples = 0;
          if (!isBay) lastArenaResize = time;
        }
        sampleTime = samples = 0;
      }
    }
    if (headingToArena && renderScales.bay < .84) renderScales.arena = Math.min(renderScales.arena, .78);
    const areaBudget = !useArenaBudget ? (touchDisplay.matches ? 625_000 : 2_080_000) : (touchDisplay.matches ? 400_000 : Infinity);
    const pixelBudget = Math.sqrt(areaBudget / (nextWidth * nextHeight));
    const screenRatio = !useArenaBudget && touchDisplay.matches ? Math.min(1.25, window.devicePixelRatio || 1) : 1;
    const resolution = Math.min(screenRatio, (useArenaBudget ? 960 : 1920) / nextWidth,
      (useArenaBudget ? 640 : 1200) / nextHeight, pixelBudget) * renderScales[scene];
    const nextBufferWidth = Math.max(1, Math.round(nextWidth * resolution));
    const nextBufferHeight = Math.max(1, Math.round(nextHeight * resolution));
    const sizeChanged = nextWidth !== width || nextHeight !== height;
    // Keep the drawing buffer stable through the intro. Reallocating it can block
    // the browser's GPU queue just as the first arena frame needs to be presented.
    const startingRound = !isBay && (phase === 'countdown' || time - lastArenaResize < .5);
    if ((nextBufferWidth !== bufferWidth || nextBufferHeight !== bufferHeight) && (sizeChanged || !startingRound)) {
      bufferWidth = nextBufferWidth;
      bufferHeight = nextBufferHeight;
      renderer.setSize(bufferWidth, bufferHeight, false);
    }
    if (nextWidth === width && nextHeight === height) return;
    width = nextWidth;
    height = nextHeight;
    const aspect = width / height;
    // Frame the playable deck by aspect ratio so a taller desktop viewport
    // increases its on-screen size instead of exposing more empty sea.
    const span = Math.max(15.6, 21 / aspect);
    camera.left = -span * aspect / 2;
    camera.right = span * aspect / 2;
    camera.top = span / 2;
    camera.bottom = -span / 2;
    camera.updateProjectionMatrix();
  }

  function warmArena(night) {
    if (warmedArenaLighting.has(night)) return;
    warmedArenaLighting.add(night);
    lighting.update(time, 0, Number(night), true);
    if (!arenaMapsReady) {
      // Build the map batches before the countdown.
      for (const map of Object.keys(ARENA_MAPS)) drawScenery(map, time);
      drawScenery('harbor', time);
      arenaMapsReady = true;
    }
    renderer.compileAsync(scene, camera).catch(() => warmedArenaLighting.delete(night));
  }

  function showReaction(visual, kind, texture, duration) {
    visual.reaction = { kind, at: time, duration };
    visual.bubble.material.map = texture;
  }

  function applyEvents(match, ownId) {
    for (const event of match?.events ?? []) {
      if (seenEvents.has(event.id)) continue;
      seenEvents.add(event.id);
      if (crowdReaction(event)) crowdEvent = event.id;
      if (seenEvents.size > 250) seenEvents.delete(seenEvents.values().next().value);
      if (event.type === 'hit') {
        const force = Number(event.force) || 0;
        if (force < 1.15) continue;
        const power = Number(event.impulse) || force;
        effects.burst(event.x, event.z, false, power);
        const direction = Math.atan2(event.nx ?? 0, event.nz ?? 1);
        for (const [id, angle] of [[event.a, direction + Math.PI], [event.b, direction]]) {
          const visual = barrels.find((entry) => entry.id === id);
          if (!visual) continue;
          visual.hit = { at: time, strength: Math.min(1, power / 9), angle };
          if (crowdReaction(event) && time >= visual.nextShout && time - (visual.reaction?.at ?? -Infinity) >= 1.1) {
            const variant = (event.id + barrels.indexOf(visual)) % swearMaps.length;
            showReaction(visual, 'impact', swearMaps[variant], 0.86);
            visual.nextShout = time + 2.4;
          }
        }
        if (event.a === ownId || event.b === ownId) shake = Math.max(shake, Math.min(0.30, power * 0.021));
      } else if (event.type === 'hazard-hit' || event.type === 'hazard-grab') {
        const grabbed = event.type === 'hazard-grab';
        const force = grabbed ? 13 : event.force;
        const visual = barrels.find(entry => entry.id === event.playerId);
        if (visual) {
          visual.hit = { at: time, angle: Math.atan2(event.nx, event.nz), strength: Math.min(1, force / 12) };
          if (crowdReaction(event) && time >= visual.nextShout) {
            showReaction(visual, 'impact', swearMaps[event.id % swearMaps.length], grabbed ? 1 : .72);
            visual.nextShout = time + 2.4;
          }
        }
        effects.burst(event.x, event.z, false, force, event.kind, event.nx, event.nz);
        if (event.playerId === ownId) shake = Math.max(shake, grabbed ? .36 : .12 + force * .008);
      } else if (event.type === 'anchor-launch') {
        effects.burst(event.x, event.z, false, event.force, 'anchor', event.nx, event.nz);
      } else if (event.type === 'hazard-fire' && ['collapse', 'powder', 'mini-powder', 'kraken', 'crate', 'crate-drop', 'anchor-drop'].includes(event.kind)) {
        const mini = event.kind === 'mini-powder';
        effects.burst(event.x, event.z, ['collapse', 'kraken'].includes(event.kind), mini ? 5 : 9, mini ? 'powder' : event.kind);
        if (['crate', 'crate-drop', 'anchor-drop'].includes(event.kind)) shake = Math.max(shake, .19);
        if (event.kind === 'kraken') {
          shake = Math.max(shake, .27);
          for (const offset of [3, 7, 11, 15]) effects.burst(event.x + event.nx * offset, event.z + event.nz * offset, false, 13, 'kraken');
        }
      } else if (event.type === 'fall') {
        effects.burst(event.x, event.z, event.cause !== 'crushed', event.cause === 'crushed' ? 10 : 0);
        if (event.playerId === ownId) shake = Math.max(shake, 0.11);
      } else if (event.type === 'emote') {
        const visual = barrels.find((entry) => entry.id === event.playerId);
        const texture = emoteMaps.get(event.emote);
        if (visual && texture) showReaction(visual, event.emote, texture, 1.22);
      }
    }
  }

  function poseRider(visual, heading, speed, squash, recoil, dt, slot) {
    const { rider, hit, reaction, bubble, group } = visual;
    const turn = 1 - Math.exp(-dt * (recoil > 0.06 ? 2.8 : 11));
    rider.heading = turnTowards(rider.heading, heading, turn);
    const kick = (hit?.angle ?? rider.heading) - rider.heading;
    const swing = rider.run(speed, dt) * (1 - recoil * .65);
    const age = reaction ? time - reaction.at : Infinity;
    const remaining = reaction ? reaction.duration - age : 0;
    const gesture = Math.max(0, Math.min(1, age * 10, remaining * 6));
    let height = 0.61 - squash * 0.10;
    let tilt = -Math.sin(kick) * recoil * 0.59;
    let leftLift = 0.12 + recoil * 2.25;
    let rightLift = leftLift;
    if (reaction?.kind === 'wave') {
      rightLift = Math.max(rightLift, gesture * (2.18 + Math.sin(age * 19) * 0.34));
    } else if (reaction?.kind === 'cheer') {
      height += gesture * (0.08 + Math.sin(age * 19) * 0.06);
      leftLift = rightLift = Math.max(leftLift, gesture * 2.58);
    } else if (reaction?.kind === 'shrug') {
      tilt += gesture * 0.16;
      leftLift = rightLift = Math.max(leftLift, gesture * 1.18);
    }

    rider.root.position.y = height;
    rider.root.rotation.set(Math.min(0.22, speed * 0.035) + Math.cos(kick) * recoil * 0.54,
      rider.heading - visual.yaw, tilt, 'YXZ');
    rider.left.rotation.set(-0.36 + swing + recoil * 0.80, 0, -leftLift);
    rider.right.rotation.set(-0.36 - swing + recoil * 0.80, 0, rightLift);
    rider.mouth.scale.y = 1 + recoil * 2.4;
    if (rider.perch) rider.perch.rotation.z = Math.sin(time * 7) * .12 - tilt * .45;

    bubble.visible = remaining > 0;
    if (bubble.visible) {
      const pop = Math.min(1, 0.55 + age * 6, remaining * 8);
      bubble.scale.set(1.70 * pop, 0.69 * pop, 1);
      bubble.position.set(group.position.x, group.position.y + 2.48 + (slot % 2) * 0.22 + age * 0.28, group.position.z);
    }
  }

  function drawBarrels(players, ownId, phase, dt, reset, elapsed, hazard) {
    const markerColors = playerMarkerColors();
    if (accessibility.color && !identityMaps) identityMaps = Array.from({ length: MAX_BARRELS + 1 }, (_, i) => identityTexture(i === 0 ? 'YOU' : String(i)));
    for (const [slot, visual] of barrels.entries()) {
      const player = players.find((entry) => entry.slot === slot);
      const visible = Boolean(player?.alive);
      const own = visible && player.id === ownId;
      const grabbed = Boolean(player?.grab);
      visual.group.visible = visible;
      visual.shadow.visible = visible && !grabbed;
      visual.ownRing.visible = own && !grabbed;
      visual.ownHalo.visible = own && !grabbed && accessibility.marker;
      visual.identityBadge.visible = visible && accessibility.color;
      visual.grip.visible = visible && grabbed;
      visual.marker.visible = visual.bubble.visible = false;
      if (!player) {
        visual.id = null;
        continue;
      }
      const { pirate, pet, pirateColor, barrelColor, barrelPaint } = player.appearance ?? {};
      const look = [pirate, pet, pirateColor].join('/');
      if (visual.look !== look) {
        const { rider } = visual;
        const materials = new Set();
        rider.root.traverse(mesh => {
          if (mesh.geometry) mesh.geometry.dispose();
          if (mesh.material) materials.add(mesh.material);
        });
        for (const material of materials) material.dispose();
        rider.root.removeFromParent();
        visual.rider = makeRider(slot, BARREL_COLORS[slot], player.appearance, undefined, true);
        visual.rider.heading = rider.heading;
        visual.group.add(visual.rider.root);
        visual.look = look;
      }
      const paint = [player.rig, barrelColor, pirateColor, barrelPaint].join('/');
      if (visual.paint !== paint) {
        const rigColor = rigFor(player.rig).color;
        const style = cosmeticFor(barrelPaint);
        visual.identity = style?.color ?? barrelColor ?? pirateColor ?? BARREL_COLORS[slot];
        visual.paint = paint;
        visual.painted.color.set(style?.color ?? barrelColor ?? rigColor ?? BARREL_COLORS[slot]);
        visual.setStyle(style);
        visual.grain.color.copy(visual.painted.color).multiplyScalar(.59);
        visual.hoopMaterial.color.set(rigColor ?? 0x3c3038);
      }
      if (own) {
        // Dark barrel paints must not make the player's identifier disappear.
        const arrow = markerColors.arrow ?? (accessibility.marker ? '#ffe69a' : visual.identity);
        const ring = markerColors.ring ?? (accessibility.marker ? '#ffd77d' : visual.identity);
        if (visual.arrowColor !== arrow) {
          visual.marker.material.color.set(arrow);
          visual.arrowColor = arrow;
        }
        if (visual.ringColor !== ring) {
          visual.ownRing.material.color.set(ring);
          visual.ringColor = ring;
        }
      }
      const speed = Math.hypot(player.vx, player.vz);
      const heading = speed > 0.12 ? Math.atan2(player.vx, player.vz) : Number(player.angle) || 0;
      const snap = reset || visual.id !== player.id;
      if (snap) {
        visual.group.position.set(player.x, 0.608, player.z);
        visual.yaw = visual.rider.heading = heading;
        visual.roll.rotation.x = 0;
        visual.hit = visual.reaction = null;
        visual.nextShout = 0;
      }
      visual.id = player.id;
      if (!visible) continue;
      const hitAge = time - (visual.hit?.at ?? -Infinity);
      const strength = visual.hit?.strength ?? 0;
      const squash = strength * Math.max(0, 1 - hitAge / 0.17);
      const recoil = strength * Math.max(0, 1 - hitAge / 0.44);
      const hop = recoil * Math.sin(Math.PI * Math.min(1, hitAge / 0.35)) * 0.34;
      // The same authoritative barrel must follow the same filter on every client.
      const follow = grabbed ? 48 : hitAge < 0.2 ? 34 : 25;
      const blend = 1 - Math.exp(-dt * follow);
      visual.group.position.x = THREE.MathUtils.lerp(visual.group.position.x, player.x, blend);
      visual.group.position.z = THREE.MathUtils.lerp(visual.group.position.z, player.z, blend);
      visual.group.position.y = 0.62 - squash * 0.10 + hop + powderFlightHeight(player.powderHop, elapsed)
        + (phase ? 0 : Math.sin(time * 2.5 + slot) * 0.015);
      if (grabbed && hazard?.kind === 'kraken') {
        const point = krakenPoint(hazard, elapsed, player.grab.along, player.grab.cross);
        visual.group.position.set(point.x, point.y + .62, point.z);
      }
      visual.yaw = turnTowards(visual.yaw, heading, blend);
      visual.group.rotation.y = visual.yaw;
      visual.group.rotation.z = grabbed ? Math.sin(time * 15 + slot) * .23 : 0;
      visual.shell.scale.set(1 + squash * 0.14, 1 - squash * 0.18, 1 + squash * 0.14);
      visual.roll.rotation.x += speed * dt / 0.61;
      visual.painted.emissive.setHex(0xffebac);
      visual.painted.emissiveIntensity = squash * 0.51;
      poseRider(visual, heading, speed, squash, grabbed ? Math.max(.52, recoil) : recoil, dt, slot);
      const { x, y, z } = visual.group.position;
      visual.shadow.position.set(x + 0.11, 0.027, z + 0.13);
      visual.ownRing.position.set(x, 0.032, z);
      visual.ownRing.material.opacity = accessibility.marker ? 1 : .62;
      visual.ownHalo.position.copy(visual.ownRing.position);
      visual.marker.visible = own;
      const worldPerPixel = (camera.top - camera.bottom) / (height * camera.zoom);
      const arrowSize = accessibility.marker ? Math.max(.83, (touchDisplay.matches ? 34 : 26) * worldPerPixel) : .83;
      visual.marker.scale.set(arrowSize, arrowSize, 1);
      const markerY = y + (visual.bubble.visible ? 3 : 2.36) + (reducedMotion.matches ? 0 : Math.sin(time * 5) * 0.085);
      visual.marker.position.set(x, markerY, z);
      if (visual.identityBadge.visible) {
        const badge = visual.identityBadge;
        const map = identityMaps[own ? 0 : slot + 1];
        if (badge.material.map !== map) { badge.material.map = map; badge.material.needsUpdate = true; }
        const badgeHeight = Math.max(.55, 19 * worldPerPixel);
        badge.scale.set(badgeHeight * 2, badgeHeight, 1);
        badge.position.set(x, markerY + (own ? arrowSize * .5 + badgeHeight * .5 : 0), z);
      }
    }
  }

  function render(match, ownId, deltaSeconds, nextRoundKey = '') {
    const dt = THREE.MathUtils.clamp(Number(deltaSeconds) || 0, 0, 0.075);
    time += dt;
    resize(deltaSeconds);
    const nextPhase = match?.phase ?? '';
    const nextTick = match?.tick ?? -1;
    const nextDrillReset = match?.drill?.reset ?? 0;
    const reset = nextRoundKey !== roundKey || nextTick < tick || (nextPhase === 'countdown' && phase !== 'countdown');
    const snapBarrels = reset || nextDrillReset !== drillReset;
    if (reset) {
      seenEvents.clear();
      effects.clear();
      crowdEvent = null;
      shake = 0;
    }
    roundKey = nextRoundKey;
    drillReset = nextDrillReset;
    phase = nextPhase;
    tick = nextTick;
    const targetRadius = Number.isFinite(match?.radius) ? Math.max(0.16, match.radius) : DOCK_RADIUS;
    radius = reset ? targetRadius : THREE.MathUtils.lerp(radius, targetRadius, 1 - Math.exp(-dt * 9));
    const intro = phase === 'countdown' ? THREE.MathUtils.smootherstep(1 - match.seconds / 3, 0, 1) : 1;
    const openingZoom = reducedMotion.matches ? 1 : .94;
    const trapZoom = match?.placedTrap?.kind === 'seesaw' ? .87
      : match?.hazard?.kind === 'kraken' || ['anchor', 'crate'].includes(match?.placedTrap?.kind) ? .93 : 1;
    const targetZoom = arenaZoom(radius) * THREE.MathUtils.lerp(openingZoom, trapZoom, intro);
    const zoom = reset ? targetZoom : THREE.MathUtils.lerp(camera.zoom, targetZoom, 1 - Math.exp(-dt * 4.2));
    if (Math.abs(zoom - camera.zoom) > 0.0001) {
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
    }
    const mapId = Object.hasOwn(ARENA_MAPS, match?.arenaMap) ? match.arenaMap : 'harbor';
    const map = arenaMapFor(mapId);
    const snapshot = match?.elapsed ?? 0;
    shownElapsed = reset ? snapshot : nextPhase === 'results' ? Math.max(snapshot, shownElapsed) + dt
      : Math.min(snapshot + .08, Math.max(snapshot, shownElapsed + dt));
    const hazard = shownElapsed < (match?.hazard?.exit ?? 0) ? match.hazard : null;
    const placedTrap = match?.placedTrap;
    const onSeesaw = placedTrap?.kind === 'seesaw';
    deck.position.y = onSeesaw ? SEESAW_HEIGHT : 0;
    // Match the barrels' visual smoothing without changing server collision positions.
    const trapBlend = reset ? 1 : 1 - Math.exp(-dt * 20);
    if (onSeesaw) {
      visibleTilt.x = THREE.MathUtils.lerp(visibleTilt.x, placedTrap.tiltX, trapBlend);
      visibleTilt.y = THREE.MathUtils.lerp(visibleTilt.y, placedTrap.tiltZ, trapBlend);
    } else visibleTilt.set(0, 0);
    const tilt = visibleTilt.length();
    if (tilt > .0001) {
      deckTiltAxis.set(visibleTilt.y, 0, -visibleTilt.x).normalize();
      deck.quaternion.setFromAxisAngle(deckTiltAxis, tilt);
    } else deck.quaternion.identity();
    drawDock(radius, phase, time, cosmeticFor(match?.arenaStyle) ?? map, hazard, match?.holes ?? [], shownElapsed, reset);
    drawScenery(mapId, time);
    drawBarrels(match?.players ?? DISPLAY_BARRELS, ownId, phase, dt, snapBarrels, shownElapsed, hazard);
    drawHazard(CARGO_HAZARDS.includes(hazard?.kind) ? null : hazard, shownElapsed, time, radius, camera);
    if (placedTrap) drawExperimentalTrap ??= createExperimentalTrapView(scene, deck);
    drawExperimentalTrap?.(placedTrap, shownElapsed, radius, trapBlend);
    applyEvents(match, ownId);
    cheerCrowd(time, crowdEvent);
    const darkness = lighting.update(time, dt, Number(match?.night === true), reset);
    for (const visual of barrels) {
      if (!visual.shadow.visible) continue;
      const { x, z } = visual.group.position;
      let nearest = null, distance = Infinity;
      if (darkness > 0) {
        for (const { x: tx, z: tz, torch } of deckTorches) {
          if (!torch.lit || torch.root.parent !== deck) continue;
          const range = Math.hypot(x - tx, z - tz);
          if (range < Math.min(distance, torch.light.distance)) {
            nearest = { x: tx, z: tz };
            distance = range;
          }
        }
      }
      const stretch = nearest ? darkness * (1 - distance / 7) : 0;
      if (nearest && distance > .001) {
        const dx = (x - nearest.x) / distance, dz = (z - nearest.z) / distance;
        visual.shadow.position.set(x + dx * stretch * .65, .028, z + dz * stretch * .65);
        visual.shadow.rotation.set(-Math.PI / 2, 0, Math.atan2(-dz, dx));
      } else visual.shadow.rotation.set(-Math.PI / 2, 0, 0);
      visual.shadow.scale.set(1 + stretch * 1.2, 1 - stretch * .22, 1);
      visual.shadow.material.opacity = .34 + stretch * .34 - darkness * .12;
    }
    for (const [index, buoy] of nightBuoys.entries()) {
      buoy.visible = darkness > 0;
      buoy.position.y = WATER_Y + Math.sin(time * 1.7 + index) * .065;
    }
    drawSea(time, radius, map.sea, darkness);
    effects.update(dt);
    shake = reducedMotion.matches ? 0 : Math.max(0, shake - dt * 1.7);
    camera.position.set(
      ARENA_CAMERA.x + Math.sin(time * 76) * shake,
      ARENA_CAMERA.y + (onSeesaw ? SEESAW_HEIGHT : 0),
      ARENA_CAMERA.z + Math.cos(time * 71) * shake,
    );
    const cargo = onSeesaw && hazard?.kind === 'barrel-roll' ? null : hazard;
    drawCargo(cargo, match?.groundedCrates ?? [], shownElapsed, time, radius, camera);
    renderer.render(scene, camera);
  }

  function dispose() {
    const geometry = new Set();
    const materials = new Set();
    const collect = (object) => {
      if (object.geometry) geometry.add(object.geometry);
      if (object.material) {
        for (const material of [object.material].flat()) materials.add(material);
      }
    };
    scene.traverse(collect);
    bay.scene.traverse(collect);
    vault?.scene.traverse(collect);
    for (const shape of geometry) shape.dispose();
    for (const material of materials) material.dispose();
    wood.dispose();
    arrow.dispose();
    identityMaps?.forEach(texture => texture.dispose());
    for (const texture of [...swearMaps, ...emoteMaps.values()]) texture.dispose();
    renderer.dispose();
    performanceMeter.dispose();
  }

  function renderBay(deltaSeconds, destination, travel, place, appearance, merchant, firstBrawl, hosts, expedition, homeState) {
    const dt = THREE.MathUtils.clamp(Number(deltaSeconds) || 0, 0, .075);
    time += dt;
    resize(deltaSeconds, true, destination === 'arena');
    bay.render(renderer, width, height, time, dt, destination, travel, place, appearance, merchant, firstBrawl, hosts, expedition, homeState);
  }

  function renderVault(deltaSeconds, run) {
    const dt = THREE.MathUtils.clamp(Number(deltaSeconds) || 0, 0, .075);
    time += dt;
    resize(deltaSeconds);
    vault ??= createVaultView(wood, makeRider);
    vault.render(renderer, width, height, time, dt, run);
  }

  return { render, renderBay, renderVault, dispose, warmArena, pickBayPlace: bay.pickPlace, highlightBayPlace: bay.highlightPlace };
}
