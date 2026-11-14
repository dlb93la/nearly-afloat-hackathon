import * as THREE from 'three';

function shoutTexture(label) {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 40;
  const brush = canvas.getContext('2d');
  brush.fillStyle = '#322934';
  brush.fillRect(1, 2, 94, 30);
  brush.fillStyle = '#ffdfa4';
  brush.fillRect(4, 5, 88, 24);
  brush.fillRect(44, 29, 8, 7);
  brush.fillStyle = '#422a35';
  brush.font = 'bold 21px monospace';
  brush.textAlign = 'center';
  brush.fillText(label, 48, 25);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

export const ARENA_STANDS = [
  { x: -18.7, z: -3, kind: 'boat' }, { x: 5.5, z: -19.8, kind: 'stand' },
  { x: 18.5, z: 4.5, kind: 'boat' }, { x: -6, z: 18.5, kind: 'stand' },
];

export function createSpectatorFleet(scene, stations, waterline = -1.35, dressSeats) {
  const fleet = new THREE.Group();
  scene.add(fleet);
  const parts = [];
  const people = [];
  const vessels = [];
  const flags = [];
  const textures = ['#!?*', 'YARR!', '%@?!'].map(shoutTexture);
  const colors = [0xd85b4f, 0xf4bc62, 0x5fb8a4, 0xa387c3, 0x649bc3, 0xd88399];
  function block(parent, color, x, y, z, w, h, d) {
    const part = new THREE.Object3D();
    part.position.set(x, y, z);
    part.scale.set(w, h, d);
    parent.add(part);
    parts.push({ part, color });
    return part;
  }
  for (const [i, station] of stations.entries()) {
    const root = new THREE.Group();
    root.position.set(station.x, waterline, station.z);
    root.rotation.y = station.yaw ?? Math.atan2(-station.x, -station.z);
    root.scale.setScalar(station.scale ?? 1);
    fleet.add(root);
    vessels.push(root);
    const boat = station.kind === 'boat';
    if (boat) {
      for (let band = -3; band <= 3; band++) {
        const width = 2.15 - Math.max(0, Math.abs(band) - 1) * .57;
        block(root, 0x624139, 0, .27, band * .65, width, .63, .68);
        block(root, 0xb27c4f, 0, .56, band * .65, width * .95, .12, .66);
        for (const side of [-1, 1]) block(root, 0xe0b16a, side * width * .48, .72, band * .65, .12, .31, .63);
      }
      root.rotation.y += Math.PI / 2;
    } else {
      block(root, 0x4c3432, 0, .15, 0, 4.8, .5, 2.7);
      block(root, 0xb27b50, 0, .47, 0, 4.9, .17, 2.8);
      for (const x of [-1.8, 0, 1.8]) block(root, 0x614837, x, -.08, 0, .47, .74, 2.96);
    }
    const seats = new THREE.Group();
    root.add(seats);
    if (boat) seats.rotation.y = -Math.PI / 2;
    dressSeats?.(seats, i);
    for (let tier = 0; tier < 2; tier++) {
      const z = .47 - tier * .91;
      block(seats, 0x6d4b3d, 0, .79 + tier * .43, z, boat ? 3.4 : 4.1, .18, .57);
      block(seats, 0xb57b50, 0, .99 + tier * .43, z - .25, boat ? 3.4 : 4.1, .27, .10);
      for (let seat = 0; seat < 3; seat++) {
        const index = people.length;
        const person = new THREE.Group();
        person.position.set((seat - 1) * (boat ? 1.05 : 1.30), .89 + tier * .43, z);
        seats.add(person);
        const coat = colors[index % colors.length];
        const skin = [0xeab184, 0xb07b59, 0x895c48][index % 3];
        block(person, coat, 0, .27, 0, .37, .39, .29);
        block(person, 0xf1d2a1, 0, .28, .16, .09, .22, .035);
        block(person, skin, 0, .65, .02, .38, .34, .35);
        block(person, 0x332a36, 0, .85, .01, index % 3 ? .43 : .58, .10, .44);
        if (index % 3 !== 1) block(person, 0x332a36, 0, .94, 0, .32, .14, .30);
        for (const side of [-1, 1]) {
          block(person, 0x312b34, side * .10, .69, .20, .045, .055, .023);
          block(person, 0x392c37, side * .12, .06, .14, .14, .16, .24);
        }
        const arms = [-1, 1].map(side => {
          const arm = new THREE.Group();
          arm.position.set(side * .24, .42, 0);
          person.add(arm);
          block(arm, coat, 0, -.10, 0, .14, .24, .15);
          block(arm, skin, 0, -.27, 0, .12, .12, .12);
          return arm;
        });
        people.push({ person, arms, base: person.position.y, index });
      }
    }
    for (const side of [-1, 1]) {
      block(seats, 0x66463b, side * 2.08, 1.39, -.78, .11, 1.8, .11);
      const flag = new THREE.Group();
      flag.position.set(side * 2.08, 2.14, -.78);
      seats.add(flag);
      block(flag, colors[i], side * .37, 0, 0, .73, .39, .075);
      flags.push(flag);
    }
    const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures[i % textures.length], depthWrite: false }));
    bubble.position.set(0, 2.92, 0);
    bubble.scale.set(1.5, .63, 1);
    seats.add(bubble);
    root.userData.bubble = bubble;
  }
  const batch = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial({ color: 0xffffff }), parts.length);
  batch.frustumCulled = false;
  batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(batch);
  const tint = new THREE.Color();
  for (const [index, { color }] of parts.entries()) batch.setColorAt(index, tint.setHex(color));
  let reactionAt = -Infinity;
  let eventKey;
  return (time, reactionKey = '') => {
    if (reactionKey === null) reactionAt = -Infinity;
    else if (eventKey !== undefined && eventKey !== reactionKey) reactionAt = time;
    eventKey = reactionKey;
    const excitement = Math.max(0, 1 - (time - reactionAt) / 1.4);
    for (const { person, arms, base, index } of people) {
      const cheer = Math.sin(time * 4.6 + index * 1.71);
      const jump = Math.max(0, Math.sin(time * 8.2 + index * 2.3)) * (.012 + excitement * .22);
      person.position.y = base + jump;
      person.rotation.z = Math.sin(time * 3.7 + index) * .10;
      arms[0].rotation.set(-.48 - Math.max(0, cheer) * (.18 + excitement * 2.1), 0, -.17);
      arms[1].rotation.set(-.48 - Math.max(0, -cheer) * (.18 + excitement * 2.1), 0, .17);
    }
    for (const [index, root] of vessels.entries()) {
      root.position.y = waterline + Math.sin(time * 1.7 + index * 1.9) * .085;
      root.rotation.z = Math.sin(time * 1.13 + index) * .025;
      const phase = time - reactionAt - index * .055;
      root.userData.bubble.visible = phase >= 0 && phase < 1.05;
      const pop = Math.max(0, Math.min(1, phase * 9, (1.05 - phase) * 7));
      root.userData.bubble.scale.set(1.5 * pop, .63 * pop, pop);
    }
    for (const [index, flag] of flags.entries()) flag.rotation.y = Math.sin(time * 4 + index) * .35;
    fleet.updateMatrixWorld(true);
    for (const [index, { part }] of parts.entries()) batch.setMatrixAt(index, part.matrixWorld);
    batch.instanceMatrix.needsUpdate = true;
  };
}
