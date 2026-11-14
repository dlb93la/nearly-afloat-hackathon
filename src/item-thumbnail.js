import * as THREE from 'three';
import { buildBarrelModel } from './barrel-model.js';
import { buildPetModel } from './pet-model.js';
import { makeRider } from './arena-view.js';
import { RARITIES, rarityFor } from '../shared/rarities.mjs';
import { reducedMotion } from './accessibility.js';

const previews = new WeakMap();
const motions = new WeakMap();
let activePreview = null;
let motionTimer = null;

function stopMotion() {
  clearTimeout(motionTimer);
  motionTimer = null;
  if (activePreview) activePreview.image.src = previews.get(activePreview.item);
  activePreview = null;
}

function animatePreview(image, item) {
  if (reducedMotion.matches || !image.dataset.motion) return;
  if (activePreview?.image === image) return;
  stopMotion();
  activePreview = { image, item, frame: 0 };
  const tick = () => {
    if (reducedMotion.matches || !image.isConnected || document.hidden || activePreview?.image !== image) { stopMotion(); return; }
    const frames = motions.get(item) ?? [];
    const frame = activePreview.frame++ % 8;
    frames[frame] ??= drawThumbnail(item, frame / 8 * Math.PI * 2);
    motions.set(item, frames);
    image.src = frames[frame];
    motionTimer = setTimeout(tick, 125);
  };
  tick();
}

if (typeof document !== 'undefined') {
  document.addEventListener('focusin', event => {
    const image = event.target.closest?.('button, article')?.querySelector?.('img[data-motion]');
    if (image?._previewItem) animatePreview(image, image._previewItem);
  });
  document.addEventListener('focusout', stopMotion);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopMotion(); });
}
const WIDTH = 112;
const HEIGHT = 96;
const box = new THREE.BoxGeometry();
const eye = new THREE.Vector3(1, 1, 1).normalize();
const right = new THREE.Vector3(1, 0, -1).normalize();
const up = new THREE.Vector3().crossVectors(eye, right);
const key = new THREE.Vector3(-.35, .85, .60).normalize();

function block(parent, color, x, y, z, w, h, d) {
  const mesh = new THREE.Mesh(box, new THREE.MeshLambertMaterial({ color }));
  mesh.position.set(x, y, z);
  mesh.scale.set(w, h, d);
  parent.add(mesh);
  return mesh;
}

export function itemThumbnail(item) {
  if (!previews.has(item)) previews.set(item, drawThumbnail(item));
  const image = new Image(WIDTH, HEIGHT);
  image.className = 'workshop-thumb';
  image.style.setProperty('--item-rarity', RARITIES[rarityFor(item)].color);
  image.dataset.rarity = rarityFor(item);
  image.alt = '';
  if (item.slot === 'pirate') {
    image.dataset.motion = 'pirate';
  }
  else if (item.slot === 'pet') image.dataset.motion = 'pet';
  else if (!item.slot || item.slot === 'rig' || item.slot === 'barrelPaint') image.dataset.motion = 'barrel';
  image._previewItem = item;
  image.addEventListener('pointerenter', () => animatePreview(image, item));
  image.addEventListener('pointerleave', () => { if (activePreview?.image === image && !image.parentElement?.contains(document.activeElement)) stopMotion(); });
  image.addEventListener('click', () => animatePreview(image, item));
  image.decoding = 'async';
  image.src = previews.get(item);
  return image;
}

function buildItem(item, phase) {
  if (item.slot === 'pirate') {
    const rider = makeRider(0, item.color, null, item);
    rider.root.rotation.y = .35 + Math.sin(phase) * .13;
    rider.right.rotation.z = Math.sin(phase) * .55;
    rider.root.rotation.z = Math.sin(phase) * .05;
    rider.mouth.scale.y = 1 + Math.max(0, Math.sin(phase)) * .5;
    return rider.root;
  }
  const model = new THREE.Group();
  const color = item.color ?? 0x9d623f;
  const trim = item.trim ?? 0xe3b271;
  const oak = 0x79513a;
  const iron = 0x493943;
  const wood = 0xb88555;
  const brass = 0xd7a45c;
  const piece = (...args) => block(model, ...args);

  switch (item.slot) {
    case 'pet':
      buildPetModel(model, item, block);
      model.rotation.y = Math.sin(phase) * .3;
      model.rotation.z = Math.sin(phase * 2) * .09;
      break;
    case 'arena':
      for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
        if (Math.abs(x) + Math.abs(z) > 3) continue;
        const shade = new THREE.Color(color).multiplyScalar(.78 + ((x * x + z + 6) % 4) * .08);
        piece(oak, x * .31, .06, z * .31, .31, .19, .31);
        piece(shade, x * .31, .177, z * .31, .296, .09, .296);
      }
      for (const x of [-.55, .55]) {
        piece(oak, x, .34, .51, .12, .37, .13);
        piece(trim, x, .54, .51, .137, .10, .145);
      }
      piece(trim, 0, .234, 0, .51, .018, .52).rotation.y = Math.PI / 4;
      piece(iron, 0, .246, 0, .28, .013, .28).rotation.y = Math.PI / 4;
      break;
    case 'home':
      piece(oak, 0, .07, 0, 1.24, .17, 1.01);
      piece(color, 0, .46, 0, 1.03, .67, .82);
      for (const x of [-.50, .50]) piece(oak, x, .46, .414, .073, .68, .065);
      piece(iron, -.19, .36, .43, .23, .47, .043);
      piece(brass, -.12, .33, .458, .036, .04, .016);
      piece(oak, .26, .53, .431, .29, .27, .059);
      for (const x of [.201, .316]) for (const y of [.482, .577]) {
        piece(0xffd180, x, y, .47, .092, .08, .025);
      }
      for (const side of [-1, 1]) {
        for (let i = -3; i <= 3; i++) {
          const tile = new THREE.Color(trim).multiplyScalar(i % 2 ? .79 : 1.08);
          piece(tile, side * .295, .895, i * .142, .68, .085, .145).rotation.z = -side * .57;
        }
      }
      piece(oak, 0, 1.078, 0, .12, .12, 1.045);
      piece(0x735653, -.32, 1.047, -.26, .15, .37, .14);
      piece(0x9a7460, -.32, 1.239, -.26, .184, .064, .17);
      break;
    case 'seat':
      for (const x of [-.50, .50]) for (const z of [-.27, .27]) {
        piece(oak, x, .16, z, .09, .32, .10);
      }
      piece(oak, 0, .29, 0, 1.16, .16, .65);
      piece(trim, 0, .395, 0, 1.08, .12, .57);
      piece(color, .12, .48, .005, .8, .09, .57);
      for (const x of [-.20, .31]) piece(trim, x, .531, .012, .056, .018, .571);
      piece(0xf5e2b6, -.39, .51, 0, .23, .12, .44);
      break;
    case 'rug':
      piece(trim, 0, .04, 0, 1.34, .07, .91);
      piece(color, 0, .086, 0, 1.21, .025, .79);
      for (const x of [-.68, .68]) for (let i = -4; i <= 4; i++) {
        piece(i % 2 ? trim : color, x, .027, i * .087, .123, .035, .056);
      }
      for (const [x, z, size] of [[0, 0, .46], [-.43, 0, .15], [.43, 0, .15]]) {
        piece(trim, x, .102, z, size, .018, size).rotation.y = Math.PI / 4;
        piece(color, x, .113, z, size * .52, .012, size * .52).rotation.y = Math.PI / 4;
      }
      break;
    case 'ornament':
      piece(oak, 0, .065, 0, .55, .13, .52);
      piece(trim, 0, .156, 0, .42, .081, .40);
      piece(color, 0, .39, 0, .294, .392, .293);
      for (const x of [-.15, .15]) for (const z of [-.15, .15]) piece(trim, x, .39, z, .051, .394, .049);
      piece(0xffe9ad, 0, .39, .154, .177, .234, .027);
      piece(trim, 0, .625, 0, .42, .091, .41);
      piece(oak, 0, .739, 0, .176, .163, .166);
      piece(trim, 0, .813, 0, .125, .058, .122);
      break;
    case 'loot':
    case 'chest': {
      piece(color, 0, .26, 0, 1.08, .47, .72);
      for (const z of [-.31, 0, .31]) {
        piece(wood, 0, .53, z, 1.06, .12, .21);
        if (z === 0) piece(color, 0, .641, 0, 1.04, .11, .44);
      }
      for (const x of [-.40, .40]) {
        piece(trim, x, .31, .375, .099, .55, .045);
        piece(trim, x, .701, 0, .098, .034, .46);
        for (const z of [-.31, .31]) piece(brass, x, .599, z, .099, .053, .21);
        for (const y of [.14, .39]) piece(iron, x, y, .407, .034, .04, .016);
      }
      piece(brass, 0, .434, .385, .197, .157, .051);
      piece(iron, 0, .429, .418, .045, .074, .020);
      break;
    }
    default:
      const barrel = buildBarrelModel(model, item.color ?? 0xb67849, item.color ? 0x424052 : 0x3c3038);
      barrel.setStyle(item.slot === 'barrelPaint' ? item : null);
      model.rotation.y = phase;
  }
  return model;
}

function drawThumbnail(item, phase = 0) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  const model = buildItem(item, phase);
  model.updateMatrixWorld(true);
  const triangles = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  model.traverseVisible(mesh => {
    if (!mesh.isMesh) return;
    const { position } = mesh.geometry.attributes;
    const indices = mesh.geometry.index;
    const vertices = Array.from({ length: position.count }, (_, index) =>
      new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld));
    for (const group of mesh.geometry.groups.length ? mesh.geometry.groups : [{ start: 0, count: indices.count }]) {
      const material = Array.isArray(mesh.material) ? mesh.material[group.materialIndex] : mesh.material;
      if (!material) continue;
      for (let i = group.start; i < group.start + group.count; i += 3) {
        const points = [vertices[indices.getX(i)], vertices[indices.getX(i + 1)], vertices[indices.getX(i + 2)]];
        const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize();
        if (normal.dot(eye) <= 0) continue;
        const pixels = points.map(point => [point.dot(right), -point.dot(up)]);
        for (const [x, y] of pixels) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
        const lit = .50 + Math.max(0, normal.dot(key)) * .64 + Math.max(0, normal.y) * .16;
        triangles.push({
          pixels,
          depth: points.reduce((sum, point) => sum + point.dot(eye), 0),
          shade: material.color.clone().multiplyScalar(lit).getStyle(),
        });
      }
    }
  });

  const scale = Math.min((WIDTH - 19) / (maxX - minX), (HEIGHT - 18) / (maxY - minY));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  ctx.fillStyle = '#17162185';
  ctx.beginPath();
  ctx.ellipse(WIDTH / 2, HEIGHT / 2 + (maxY - centerY) * scale, Math.min(42, (maxX - minX) * scale * .47), 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = .65;
  for (const { pixels, shade } of triangles.sort((a, b) => a.depth - b.depth)) {
    ctx.beginPath();
    pixels.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](
      WIDTH / 2 + (x - centerX) * scale, HEIGHT / 2 + (y - centerY) * scale - 3));
    ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle = shade;
    ctx.fill();
    ctx.stroke();
  }
  return canvas.toDataURL();
}
