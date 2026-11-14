import * as THREE from 'three';
import { createSpectatorFleet } from './spectator-fleet.js';
import { cannonLanes, FORT_CELLS, FORT_COLUMNS, FORT_ENTRY, FORT_PIECES, FORT_ROWS,
  FORT_TILE, fortCellCenter, gullPosition, trapPhase } from '../shared/live-vault.mjs';
import { cosmeticFor } from '../shared/cosmetics.mjs';
import { rigFor } from '../shared/rigs.mjs';
import { buildPirateBird, flapBird } from './pirate-bird.js';
import { buildFortEntrance, buildFortObstacle, buildFortTreasure, buildFortWatchtower } from './fort-models.js';

const FORT_LIGHTS = [
  { sky: 0x164b5c, sea: 0x1c6174, sun: 0xffd199, ambient: 0xffebc7, flag: 0xaa6a65 },
  { sky: 0x37475c, sea: 0x365b71, sun: 0xffae7f, ambient: 0xf7bc9c, flag: 0xae7a54 },
  { sky: 0x243749, sea: 0x24536a, sun: 0xb1cde7, ambient: 0xffdab9, flag: 0x6e779c },
];

export function createVaultView(wood, makeRider) {
  const scene = new THREE.Scene();
  const cheerCrowd = createSpectatorFleet(scene, [
    { x: -21, z: 13, kind: 'boat', yaw: Math.PI / 2 }, { x: 21, z: -3, kind: 'stand', yaw: -Math.PI / 2 },
    { x: -21, z: -19, kind: 'stand', yaw: Math.PI / 2 }, { x: 20.5, z: -28, kind: 'boat', yaw: -Math.PI / 2 },
  ], -1.2);
  scene.background = new THREE.Color(0x164b5c);
  const ambient = new THREE.HemisphereLight(0xffebc7, 0x47809e, 2.15);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffd199, 2.15);
  sun.position.set(-6, 12, -3);
  scene.add(sun);
  const camera = new THREE.OrthographicCamera(-11, 11, 10, -10, .1, 150);
  const cube = new THREE.BoxGeometry();
  const round = new THREE.CylinderGeometry(1, 1, 1, 12);
  const spike = new THREE.ConeGeometry(.15, .56, 5);
  const cylinder = new THREE.CylinderGeometry(.51, .51, .94, 10);
  const hoop = new THREE.CylinderGeometry(.54, .54, .12, 10);
  const seaGeometry = new THREE.PlaneGeometry(140, 140);
  const materials = new Map();
  const woodMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, map: wood });
  const stoneMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const hoopMaterial = new THREE.MeshLambertMaterial({ color: 0x3a3036 });
  const boat = new THREE.Group();
  const barrel = new THREE.Group();
  scene.add(boat);
  boat.add(barrel);
  function material(color) {
    if (!materials.has(color)) materials.set(color, new THREE.MeshLambertMaterial({ color }));
    return materials.get(color);
  }
  function box(root, color, x, y, z, width, height, depth) {
    const mesh = new THREE.Mesh(cube, material(color));
    mesh.position.set(x, y, z);
    mesh.scale.set(width, height, depth);
    root.add(mesh);
    return mesh;
  }
  function tube(root, color, x, y, z, radius, length) {
    const mesh = new THREE.Mesh(round, material(color));
    mesh.position.set(x, y, z);
    mesh.scale.set(radius, length, radius);
    root.add(mesh);
    return mesh;
  }
  function batchStatic(group) {
    group.updateMatrixWorld(true);
    const batches = new Map();
    group.traverse(mesh => {
      if (!mesh.isMesh || mesh.geometry !== cube) return;
      if (!batches.has(mesh.material)) batches.set(mesh.material, []);
      batches.get(mesh.material).push(mesh);
    });
    for (const [surface, meshes] of batches) {
      if (meshes.length < 2) continue;
      const batch = new THREE.InstancedMesh(cube, surface, meshes.length);
      meshes.forEach((mesh, i) => {
        batch.setMatrixAt(i, mesh.matrixWorld);
        mesh.removeFromParent();
      });
      group.add(batch);
    }
  }
  const sea = new THREE.Mesh(seaGeometry, material(0x1c6174));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -1.2;
  scene.add(sea);
  const ripples = new THREE.InstancedMesh(cube, material(0x77a899), 90);
  ripples.frustumCulled = false;
  scene.add(ripples);
  const barrelBody = new THREE.Mesh(cylinder, material(0xa3673d));
  barrelBody.rotation.z = Math.PI / 2;
  barrel.add(barrelBody);
  for (const x of [-.29, .29]) {
    const ring = new THREE.Mesh(hoop, hoopMaterial);
    ring.rotation.z = Math.PI / 2;
    ring.position.x = x;
    barrel.add(ring);
  }
  const lifters = new THREE.Group();
  boat.add(lifters);
  function bird(root, color, x, y, z, scale) {
    const bird = buildPirateBird(root, box, color === 0xd6d8e2
      ? { body: 0xe2dbc7, wings: 0x80869b, chest: 0xf2e5c4, tail: 0x52546b }
      : { body: color, wings: 0x65a5bb, chest: 0xecc366, tail: 0x566c9b });
    const { model } = bird;
    model.position.set(x, y, z);
    model.scale.setScalar(scale);
    return bird;
  }
  const escorts = [-1, 1].map(side => bird(lifters, side < 0 ? 0xec6752 : 0x64bb59, side * .64, 1.36, -.14, 1.1));
  const scratch = new THREE.Object3D();
  const wake = new THREE.Object3D();
  const focus = new THREE.Vector3();
  let dock;
  let props = [];
  let id;
  let rider;
  let roll = 0;
  let introduction = 0;

  function build(run) {
    if (dock) {
      dock.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
      dock.removeFromParent();
    }
    if (rider) {
      const used = new Set();
      rider.root.traverse(object => {
        object.geometry?.dispose();
        if (object.material) used.add(object.material);
      });
      for (const surface of used) surface.dispose();
      rider.root.removeFromParent();
    }
    dock = new THREE.Group();
    scene.add(dock);
    props = [];
    const palette = FORT_LIGHTS[(run.seed ?? 0) % FORT_LIGHTS.length];
    scene.background.setHex(palette.sky);
    sea.material.color.setHex(palette.sea);
    sun.color.setHex(palette.sun);
    ambient.color.setHex(palette.ambient);
    const map = run.map;
    const pieces = new Map(map.pieces.map(({ cell, kind }) => [cell, kind]));
    const structures = new THREE.Group();
    dock.add(structures);
    const stoneCells = [];
    const woodCells = [];
    for (let cell = 0; cell < FORT_CELLS; cell++) {
      if (pieces.get(cell) === 'pit') continue;
      const row = Math.floor(cell / FORT_COLUMNS);
      (row < 7 || row > 13 ? stoneCells : woodCells).push(cell);
    }
    const color = new THREE.Color();
    for (const [cells, surface] of [[woodCells, woodMaterial], [stoneCells, stoneMaterial]]) {
      const deck = new THREE.InstancedMesh(cube, surface, cells.length);
      for (const [slot, cell] of cells.entries()) {
        const { x, z } = fortCellCenter(cell);
        const row = Math.floor(cell / FORT_COLUMNS);
        const column = cell % FORT_COLUMNS;
        const stone = surface === stoneMaterial;
        const swatches = stone ? [0x786f60, 0x877d68, 0x837b68, 0x8d8471] : [0xa67651, 0xc08d64, 0xb18463];
        scratch.position.set(x, stone ? -.26 : -.13, z);
        scratch.scale.set(FORT_TILE - .045, stone ? .52 : .26, FORT_TILE - .045);
        scratch.updateMatrix();
        deck.setMatrixAt(slot, scratch.matrix);
        deck.setColorAt(slot, color.setHex(swatches[(column * 13 + row * 7) % swatches.length]));
        if (stone) {
          for (let course = -1; course <= 1; course++) {
            const offset = (course + column + row) % 2 ? .19 : -.23;
            for (const side of [-1, 1]) {
              const split = 1.22 + side * offset;
              box(structures, swatches[(row + column * 3 + course + side + 8) % swatches.length],
                x + side * (1.25 - split / 2), .007, z + course * .83, split - .032, .014, .793);
            }
          }
        }
      }
      dock.add(deck);
    }
    for (const side of [-1, 1]) {
      for (let row = 0; row < FORT_ROWS; row += 2) {
        const edge = fortCellCenter(row * FORT_COLUMNS + (side < 0 ? 0 : FORT_COLUMNS - 1));
        const x = edge.x + side * 1.18;
        box(structures, 0x674739, x, -.34, edge.z, .29, 1.69, .29);
        box(structures, 0xc79760, x, .52, edge.z, .38, .16, .38);
        if (row % 6 === 0) {
          box(structures, 0x765440, x, 1.05, edge.z, .105, 1.25, .105);
          box(structures, row % 12 ? 0x886fa2 : 0x3caa93, x, 1.49, edge.z + .30, .08, .35, .70);
        }
      }
      for (const row of [2, 8, 15]) {
        const tower = new THREE.Group();
        tower.position.set(side * (FORT_COLUMNS * FORT_TILE / 2 + 1.45), 0, fortCellCenter(row * FORT_COLUMNS).z);
        tower.rotation.y = side * .18;
        structures.add(tower);
        buildFortWatchtower(tower, box, (row + (side < 0 ? 1 : 0)) % 2 === 0, palette.flag);
        for (let i = 0; i < 4; i++) {
          box(tower, i % 2 ? 0x627a72 : 0x536861, side * (.6 + i * .37), -1.12 + i * .13,
            (i % 2 ? 1 : -1) * 1.38, 1.4 - i * .17, .43 + i * .16, 1.15).rotation.y = i * .29;
        }
      }
      for (const row of [0, 1, 3, 4, 5, 14, 16, 17, 18]) {
        const x = side * (FORT_COLUMNS * FORT_TILE / 2 + .35);
        const z = fortCellCenter(row * FORT_COLUMNS).z;
        box(structures, 0x59635e, x, -.46, z, .68, 1.48, 2.44);
        for (const y of [.18, .43, .69]) {
          box(structures, y === .43 ? 0x74786a : 0x676e63, x, y, z, .70, .22, 2.48);
        }
        box(structures, 0xa09678, x, .85, z, .79, .13, 2.53);
        for (const part of [-.76, 0, .76]) {
          box(structures, 0x7a8170, x, 1.04, z + part, .72, .28, .42);
        }
      }
    }
    const start = fortCellCenter(FORT_ENTRY);
    box(structures, 0x59ac9d, start.x, .025, start.z, 1.42, .05, 1.4);
    const arch = new THREE.Group();
    structures.add(arch);
    arch.position.set(start.x, 0, start.z + .83);
    buildFortEntrance(arch, box);
    for (const side of [-1, 1]) {
      const x = start.x + side * 3.85;
      for (let i = 0; i < 3; i++) {
        box(structures, 0x706b58, x, -.33 + i * .31, start.z + 1.58, 2.17 - i * .35, .32, .59);
        box(structures, 0x918774, x, -.18 + i * .31, start.z + 1.58, 2.19 - i * .35, .055, .60);
      }
    }
    for (const side of [-1, 1]) {
      const x = start.x + side * 3.4;
      box(structures, 0x554c45, x, -.38, start.z + 2.0, 1.3, .56, 2.75);
      for (let i = 0; i < 5; i++) box(structures, i % 2 ? 0xc98b55 : 0x997151, x, -.06, start.z + 1.0 + i * .45,
        1.16, .13, .42);
      box(structures, 0x61453b, x, .40, start.z + 2.8, .23, .95, .24);
      box(structures, 0xefd28d, x, .90, start.z + 2.8, .27, .28, .27);
    }
    const chest = fortCellCenter(map.chest);
    const treasure = new THREE.Group();
    treasure.position.set(chest.x, 0, chest.z);
    structures.add(treasure);
    buildFortTreasure(treasure, box, cosmeticFor(run.skin));
    for (const [cell, kind] of pieces) {
      if (kind !== 'pit') continue;
      const { x, z } = fortCellCenter(cell);
      box(structures, 0x4c7e7c, x + .49, -1.12, z + .22, .37, .13, 1.11).rotation.y = cell % 3;
      box(structures, 0x735a48, x - .38, -.64, z - .43, .91, .14, .17).rotation.y = cell % 5;
    }
    batchStatic(structures);
    for (const { cell, kind } of map.pieces) {
      if (kind === 'pit') continue;
      const { x, z } = fortCellCenter(cell);
      const tint = FORT_PIECES[kind].color;
      const root = new THREE.Group();
      root.position.set(x, 0, z);
      dock.add(root);
      const prop = { cell, kind, root };
      if (kind === 'wall' || kind === 'gate') {
        buildFortObstacle(root, kind, tint, box, tube);
      } else if (kind === 'cannon') {
        prop.turret = buildFortObstacle(root, kind, tint, box, tube);
        prop.flash = box(prop.turret, 0xffc56b, 0, .02, 1.13, .41, .38, .47);
        prop.lanes = cannonLanes(cell, pieces).map(lane => {
          const point = fortCellCenter(lane);
          return box(dock, 0xf4a254, point.x, .018, point.z, 2.38, .037, 2.38);
        });
      } else if (kind === 'gull' || kind === 'parrot') {
        box(root, tint, 0, .025, 0, 1.72, .045, 1.72);
        prop.bird = bird(root, tint, 0, 1.15, 0, kind === 'gull' ? 1.75 : 1.4);
        if (kind === 'parrot') {
          for (const side of [-1, 1]) {
            box(root, 0x845b45, side * .89, .53, .39, .18, 1.02, .20);
            box(root, 0xe7af64, side * .89, 1.04, .39, .25, .17, .26);
            box(root, 0x487e76, side * .91, .72, -.68, .15, 1.35, .15);
            box(root, side < 0 ? 0xd26c55 : 0x65a98d, side * .91, 1.30, -.86, .08, .22, .36);
          }
          box(root, 0x855d47, 0, .82, .39, 1.92, .12, .15);
          box(root, 0xffd776, 0, .058, -.25, .18, .035, 1.23);
          for (const side of [-1, 1]) box(root, 0xffd776, side * .19, .061, -.69, .13, .035, .55).rotation.y = side * .7;
        }
      } else {
        box(root, tint, 0, .035, 0, 1.86, .068, 1.84);
        if (kind === 'spikes') {
          prop.spikes = new THREE.Group();
          root.add(prop.spikes);
          for (const x of [-.6, 0, .6]) for (const z of [-.6, 0, .6]) {
            const tooth = new THREE.Mesh(spike, material(0xe1d4c7));
            tooth.position.set(x, .29, z);
            prop.spikes.add(tooth);
          }
        }
        if (kind === 'powder') {
          prop.post = new THREE.Group();
          root.add(prop.post);
          tube(prop.post, 0x99563d, 0, .41, 0, .38, .72);
          for (const y of [.16, .63]) tube(prop.post, 0x4d4148, 0, y, 0, .42, .10);
          box(prop.post, 0xffd37c, .13, .81, -.14, .105, .13, .13);
          box(prop.post, 0xf4d098, 0, .42, .39, .21, .23, .05);
        }
        if (kind === 'anchor') {
          for (const side of [-1, 1]) box(root, 0x795846, side * .66, .59, 0, .17, 1.16, .17);
          box(root, 0xaa7d52, 0, 1.13, 0, 1.49, .20, .24);
          tube(root, 0xc99851, 0, .87, 0, .24, .32);
          tube(root, 0xf0c174, 0, .72, 0, .32, .14);
          tube(root, 0x76574a, 0, .60, 0, .055, .16);
        }
        if (kind === 'tide') for (const offset of [-.55, 0, .55]) box(root, 0x96e7e5, 0, .07, offset, 1.43, .08, .13);
      }
      props.push(prop);
    }
    hoopMaterial.color.setHex(rigFor(run.rig).color ?? 0x3a3036);
    rider = makeRider(0, 0x538da3, run.appearance);
    rider.root.position.y = .51;
    boat.add(rider.root);
    focus.set(0, 0, -2);
    boat.position.set(run.frame.x, .53, run.frame.z);
    roll = 0;
    introduction = 0;
  }

  function render(renderer, width, height, time, dt, run) {
    cheerCrowd(time, run.frame.hearts + '/' + run.frame.status);
    if (id !== run.id) {
      id = run.id;
      build(run);
    }
    const { frame } = run;
    introduction = Math.min(1.2, introduction + dt);
    for (let i = 0; i < ripples.count; i++) {
      const phase = time * .8 + i * 2.39;
      wake.position.set((i % 10 - 4.5) * 5.4 + Math.sin(phase) * .9, -1.17,
        (Math.floor(i / 10) - 4) * 6.9 + Math.cos(i * 5.36) * 2.3);
      wake.scale.set(.38 + (1 + Math.sin(phase)) * .48, .02, .044);
      wake.updateMatrix();
      ripples.setMatrixAt(i, wake.matrix);
    }
    ripples.instanceMatrix.needsUpdate = true;
    const ease = 1 - Math.exp(-dt * 20);
    if (Math.hypot(boat.position.x - frame.x, boat.position.z - frame.z) > 5) {
      boat.position.set(frame.x, .53, frame.z);
    }
    boat.position.x = THREE.MathUtils.lerp(boat.position.x, frame.x, ease);
    boat.position.z = THREE.MathUtils.lerp(boat.position.z, frame.z, ease);
    boat.position.y = .53 + frame.lift * 2.9;
    boat.rotation.y = frame.angle;
    const speed = Math.hypot(frame.vx, frame.vz);
    roll += speed * dt / .51;
    barrel.rotation.x = roll;
    const swing = rider.run(speed, dt);
    rider.root.rotation.x = Math.min(.22, speed * .035) - frame.lift * .18;
    rider.left.rotation.set(-.36 + swing, 0, -.14 - frame.lift);
    rider.right.rotation.set(-.36 - swing, 0, .14 + frame.lift);
    lifters.visible = frame.lift > 0;
    for (const escort of escorts) flapBird(escort, time * 17, .57);
    const powder = new Map(frame.powder);
    for (const prop of props) {
      const phase = trapPhase(frame.time, prop.cell, run.seed);
      const firing = phase >= 1.5 && phase <= 1.91;
      if (prop.kind === 'gate') prop.root.position.y = frame.opened ? -1.12 : 0;
      if (prop.kind === 'wall') prop.root.visible = frame.breach !== prop.cell;
      if (prop.kind === 'plate') prop.root.scale.y = frame.opened ? .4 : 1;
      if (prop.kind === 'anchor') prop.root.scale.y = frame.checkpoint === prop.cell ? 1.25 : 1;
      if (prop.lanes) for (const lane of prop.lanes) lane.visible = firing || (phase > .98 && Math.sin(time * 24) > 0 && phase < 1.5);
      if (prop.turret) {
        prop.turret.rotation.y = Math.floor((frame.time + phase) / 3.1) * Math.PI / 2;
        prop.flash.visible = firing;
        prop.flash.rotation.z = time * 7;
      }
      if (prop.spikes) prop.spikes.scale.y = firing ? 1 : .17;
      if (prop.kind === 'powder') prop.post.visible = !powder.has(prop.cell) || frame.time - powder.get(prop.cell) < .7;
      if (prop.bird) {
        const gull = prop.kind === 'gull';
        const { x, z } = fortCellCenter(prop.cell);
        const fly = gull ? gullPosition(prop.cell, frame.time, run.seed) : null;
        prop.bird.model.position.x = fly ? fly.x - x : Math.sin(time * 2) * .35;
        prop.bird.model.position.z = fly ? fly.z - z : Math.cos(time * 2) * .27;
        prop.bird.model.rotation.y = fly?.vertical ? 0 : Math.PI / 2;
        prop.bird.model.position.y = gull && firing ? .82 : 1.55 + Math.sin(time * 3 + prop.cell) * .24;
        flapBird(prop.bird, time * 13, .48);
      }
    }
    focus.x = THREE.MathUtils.lerp(focus.x, boat.position.x, 1 - Math.exp(-dt * 5.5));
    const lookAhead = THREE.MathUtils.lerp(3.8, 5.4, THREE.MathUtils.smoothstep(width / height, .55, 1.2));
    focus.z = THREE.MathUtils.lerp(focus.z, boat.position.z - lookAhead, 1 - Math.exp(-dt * 5.5));
    const intro = THREE.MathUtils.smootherstep(introduction, 0, 1.2);
    const span = THREE.MathUtils.lerp(Math.max(64, 42 * height / width), Math.max(21.5, 11 * height / width), intro);
    camera.left = -span * width / height / 2;
    camera.right = -camera.left;
    camera.top = span / 2;
    camera.bottom = -camera.top;
    camera.position.set(focus.x, 17, focus.z + 16);
    camera.lookAt(focus);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }
  return { render, scene };
}
