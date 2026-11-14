import * as THREE from 'three';
import { cosmeticFor } from '../shared/cosmetics.mjs';
import { rigFor } from '../shared/rigs.mjs';
import { buildPetModel } from './pet-model.js';

// Static room geometry is instanced by the bay's shared block batcher.
// Displays change only after a confirmed inventory/appearance update.
export function createCaptainsHome(root, { block, batchBlocks, planks, barrel, lamp, flag }) {
  const exterior = new THREE.Group();
  const interior = new THREE.Group();
  root.add(exterior, interior);
  const beam = 0x573b2c, oak = 0x94613d, brass = 0xd9ab61;
  const deck = new THREE.Group();
  root.add(deck);
  for (let row = 0; row < 17; row++) {
    block(deck, row % 4 === 0 ? oak : planks, 0, .29, -2.45 + row * .38, 6.4, .12, .365);
  }
  for (const x of [-3.05, 3.05]) {
    for (const z of [-2.35, .3, 3.5]) block(deck, beam, x, -.4, z, .23, 1.8, .25);
    block(deck, beam, x, .78, 2.85, .12, .75, 1.6);
    block(deck, brass, x, 1.18, 2.85, .16, .09, 1.7);
  }
  for (let i = 0; i < 4; i++) block(deck, planks, 1.95, .18 - i * .13, 3.75 + i * .25, 1.55, .16, .3);
  lamp(deck, -2.9, .92, 3.55);
  lamp(deck, 2.9, .92, 3.55);
  flag(deck, -2.8, 1.05, 2.75, 0x344b59, 'skull');
  barrel(deck, -2.25, .36, 2.85, 0x99663e);
  // Fishing tackle, spare oars and an unmistakably personal front porch.
  block(deck, beam, -.75, .72, 3.1, 1.35, .15, .5);
  for (const x of [-1.25, -.25]) block(deck, beam, x, .52, 3.1, .12, .38, .4);
  for (const x of [-2.65, -2.4]) {
    block(deck, 0xbd9760, x, .92, 2.15, .055, 1.2, .055).rotation.z = -.25;
    block(deck, 0xeee0bd, x + .16, 1.36, 2.15, .25, .12, .07);
  }
  for (const child of deck.children) if (child.isGroup) batchBlocks(child);
  batchBlocks(deck);

  // The facade lifts as one piece to reveal a dollhouse interior.
  for (const z of [-2.45, 2]) block(exterior, 0x638374, 0, 1.45, z, 6.15, 2.2, .18);
  for (const x of [-3, 3]) block(exterior, 0x567265, x, 1.45, -.2, .18, 2.2, 4.6);
  block(exterior, beam, -.65, 1.12, 2.12, 1.05, 1.6, .16);
  for (const x of [-2.1, 1.85]) {
    block(exterior, brass, x, 1.58, 2.14, .95, .84, .15);
    block(exterior, 0x365864, x, 1.58, 2.24, .78, .66, .06);
    for (const side of [-1, 1]) block(exterior, 0x824b35, x + side * .58, 1.58, 2.17, .23, .94, .12);
    block(exterior, brass, x, 1.58, 2.3, .07, .73, .06);
  }
  for (const side of [-1, 1]) {
    for (let tile = 0; tile < 8; tile++) {
      block(exterior, tile % 3 ? 0xa05b3d : 0xbf7950, side * 1.65, 2.9, -2.55 + tile * .67, 3.6, .17, .69).rotation.z = -side * .36;
    }
  }
  block(exterior, beam, 0, 3.53, -.17, .23, .19, 5.5);
  block(exterior, 0x786759, 2.1, 3.1, -1.4, .62, 1.1, .67);
  block(exterior, 0xa09279, 2.1, 3.68, -1.4, .8, .16, .84);
  batchBlocks(exterior);

  // Open front/right walls keep the whole room readable from the game camera.
  block(interior, 0x56766c, 0, 1.38, -2.45, 6.15, 2.05, .17);
  block(interior, 0x547367, -3, .94, -.2, .16, 1.18, 4.6);
  for (const x of [-2.9, -.85, 1.18, 2.92]) block(interior, beam, x, 1.4, -2.32, .12, 2.1, .18);
  for (const y of [.48, 2.37]) block(interior, beam, 0, y, -2.3, 6.1, .14, .19);
  // Sea window, chart desk, books and bottles.
  block(interior, brass, 1.78, 1.65, -2.28, 1.48, 1.04, .16);
  block(interior, 0x73aaae, 1.78, 1.65, -2.16, 1.28, .84, .05);
  for (const x of [1.45, 1.78, 2.11]) block(interior, beam, x, 1.65, -2.11, .055, .89, .06);
  block(interior, beam, 1.78, 1.65, -2.08, 1.32, .06, .05);
  block(interior, oak, 1.8, .95, -1.25, 1.75, .16, .85);
  for (const x of [1.08, 2.52]) block(interior, beam, x, .65, -1.25, .15, .6, .7);
  block(interior, 0xf0d29a, 1.64, 1.052, -1.2, .95, .025, .64).rotation.y = -.14;
  for (const [x, z] of [[1.4, -1.2], [1.8, -1.35], [1.95, -1.1]]) block(interior, 0x49857a, x, 1.07, z, .22, .025, .09);
  block(interior, 0xb14b3b, 1.8, 1.09, -1.35, .07, .025, .09).rotation.y = .7;
  for (let i = 0; i < 4; i++) block(interior, [0x855048, 0x3f6070, 0x6e8452, 0xb58b4a][i], 1.1 + i * .15, 1.17, -1.48, .11, .28, .16);
  // Canopy berth and layered mattress, not two unadorned boxes.
  block(interior, beam, -2, .57, -1.24, 1.25, .38, 1.85);
  for (const x of [-2.6, -1.4]) for (const z of [-2.12, -.35]) block(interior, beam, x, 1.17, z, .095, 1.6, .095);
  block(interior, 0xe8cb98, -2, 1.98, -1.23, 1.45, .11, 2.08);
  block(interior, 0xe9d6ac, -2, .82, -1.83, 1.03, .17, .46);
  // Barrel rack with empty cradles waiting for actual owned equipment.
  for (const x of [-2.1, -.55, 1]) {
    block(interior, beam, x, .55, 1.34, 1.32, .15, .78);
    for (const dx of [-.51, .51]) block(interior, brass, x + dx, .72, 1.34, .12, .2, .71);
  }
  // Trophy alcove: two earned displays and three treasure stands.
  block(interior, oak, -.5, 1.62, -2.12, 1.65, .12, .5);
  for (const x of [1.85, 2.53]) block(interior, 0x70533d, x, .67, .45, .48, .63, .48);
  block(interior, oak, 2.19, 1.06, .45, 1.35, .12, .76);
  batchBlocks(interior);

  const bunk = new THREE.MeshLambertMaterial({ color: 0x42766f });
  block(interior, bunk, -2, .76, -.98, 1.08, .2, 1.3);
  const rug = new THREE.MeshLambertMaterial({ color: 0x78413f });
  const rugTrim = new THREE.MeshLambertMaterial({ color: brass });
  block(interior, rugTrim, -.05, .374, -.14, 2.3, .025, 1.9);
  block(interior, rug, -.05, .392, -.14, 2.1, .025, 1.7);
  for (const angle of [-.6, .6]) block(interior, rugTrim, -.05, .41, -.14, 1.2, .02, .07).rotation.y = angle;
  const chestColor = new THREE.MeshLambertMaterial({ color: oak });
  const chestTrim = new THREE.MeshLambertMaterial({ color: brass });
  block(interior, chestColor, .05, .6, -1.5, 1.05, .5, .65);
  block(interior, chestColor, .05, .91, -1.5, 1.05, .18, .65);
  for (const x of [-.33, .43]) block(interior, chestTrim, x, .76, -1.5, .09, .63, .7);
  block(interior, chestTrim, .05, .75, -1.14, .18, .2, .07);
  const captainTrim = new THREE.Group();
  interior.add(captainTrim);
  block(captainTrim, brass, 0, 2.52, -2.27, 6.35, .12, .17);
  for (const x of [-2.9, 2.92]) block(captainTrim, brass, x, 1.4, -2.22, .17, 2.2, .22);
  block(captainTrim, 0x344b59, -.25, 2.03, -2.2, .4, .66, .07);
  block(captainTrim, brass, -.25, 2.15, -2.14, .15, .15, .05).rotation.z = Math.PI / 4;
  batchBlocks(captainTrim);
  const displays = new THREE.Group();
  interior.add(displays);
  const companion = new THREE.Group();
  companion.position.set(2.63, 1.1, 1.6);
  interior.add(companion);
  block(interior, beam, 2.63, .85, 1.6, .1, .9, .1);
  block(interior, brass, 2.63, 1.3, 1.6, .5, .07, .1);
  const firstCup = new THREE.Group();
  interior.add(firstCup);
  block(firstCup, brass, -.82, 1.76, -2.02, .3, .12, .25);
  block(firstCup, brass, -.82, 1.92, -2.02, .07, .26, .09);
  block(firstCup, 0xffd978, -.82, 2.08, -2.02, .31, .22, .2);
  for (const x of [-1.03, -.61]) block(firstCup, brass, x, 2.09, -2.02, .12, .12, .11);
  batchBlocks(firstCup);
  const owner = new THREE.Group();
  interior.add(owner);
  owner.position.set(.1, .4, .25);
  owner.rotation.y = -.35;
  const coat = new THREE.MeshLambertMaterial({ color: 0xb7473f });
  const hat = new THREE.MeshLambertMaterial({ color: 0x3a2930 });
  for (const x of [-.13, .13]) {
    block(owner, 0x33333a, x, .22, 0, .17, .36, .19);
    block(owner, 0x342824, x, .08, .06, .2, .13, .3);
  }
  block(owner, coat, 0, .62, 0, .52, .54, .34);
  block(owner, 0xe4b966, 0, .46, .18, .48, .07, .06);
  block(owner, 0xe6b581, 0, 1.02, .02, .41, .39, .35);
  for (const x of [-.095, .095]) {
    block(owner, 0xf7e6c4, x, 1.07, .205, .08, .07, .03);
    block(owner, 0x2b2527, x, 1.07, .227, .04, .05, .02);
  }
  block(owner, 0x573c32, 0, .93, .22, .16, .04, .03);
  block(owner, hat, 0, 1.26, 0, .68, .13, .48);
  block(owner, hat, 0, 1.38, -.01, .42, .17, .35);
  block(owner, brass, 0, 1.38, .18, .12, .09, .03);
  const arms = [-1, 1].map(side => {
    const arm = new THREE.Group();
    arm.position.set(side * .32, .8, 0);
    block(arm, coat, 0, -.12, 0, .16, .3, .2);
    block(arm, 0xe6b581, 0, -.32, .02, .14, .14, .17);
    owner.add(arm);
    return arm;
  });
  // Only fixed-colour body pieces are batched; outfit materials stay editable.
  let previousState, previousAppearance, previousFirst;
  return {
    exterior, interior,
    update(state, appearance, firstBrawl, time, reduced, active) {
      if (state !== previousState || appearance !== previousAppearance || firstBrawl !== previousFirst) {
        previousState = state; previousAppearance = appearance; previousFirst = firstBrawl;
        firstCup.visible = firstBrawl?.status === 'claimed';
        const outfit = cosmeticFor(appearance?.pirate);
        coat.color.setHex(outfit?.color ?? 0xb7473f);
        hat.color.setHex(outfit?.hat ?? 0x3a2930);
        bunk.color.setHex(cosmeticFor(appearance?.seat)?.color ?? 0x42766f);
        const carpet = cosmeticFor(appearance?.rug);
        rug.color.setHex(carpet?.color ?? 0x78413f);
        rugTrim.color.setHex(carpet?.trim ?? brass);
        const chest = cosmeticFor(appearance?.chest);
        chestColor.color.setHex(chest?.color ?? oak);
        chestTrim.color.setHex(chest?.trim ?? brass);
        captainTrim.visible = Boolean(appearance?.home);
        // Shared geometry/materials are reused; no GPU allocations per frame.
        for (const group of [displays, companion]) {
          group.traverse(piece => { if (piece.isInstancedMesh) piece.dispose(); });
          group.clear();
        }
        const pet = cosmeticFor(appearance?.pet);
        if (pet) {
          buildPetModel(companion, pet, block);
          batchBlocks(companion);
        }
        for (const [i, id] of (state?.rigs ?? []).slice(0, 3).entries()) {
          const config = rigFor(id), x = -2.1 + i * 1.55;
          barrel(displays, x, .68, 1.34, config.color ?? oak);
        }
        const importance = item => item.id === appearance?.ornament ? 2 : Number(Boolean(item.expeditionOnly));
        const treasures = (state?.owned ?? []).map(cosmeticFor).filter(item => item?.expeditionOnly || item?.slot === 'ornament')
          .sort((a, b) => importance(b) - importance(a)).slice(0, 3);
        for (const [i, item] of treasures.entries()) {
          const x = i === 2 ? -.12 : 1.85 + i * .68, y = i === 2 ? 1.76 : 1.26, z = i === 2 ? -2.02 : .45;
          block(displays, item.trim ?? brass, x, y - .1, z, .28, .09, .28);
          if (item.species) {
            const model = new THREE.Group();
            model.position.set(x, y, z);
            model.scale.setScalar(.75);
            buildPetModel(model, item, block);
            batchBlocks(model);
            displays.add(model);
          } else if (item.id.includes('astrolabe') || item.id.includes('compass')) {
            for (let segment = 0; segment < 12; segment++) {
              const angle = segment / 12 * Math.PI * 2;
              block(displays, item.trim ?? brass, x + Math.cos(angle) * .19, y + .2 + Math.sin(angle) * .19, z, .12, .04, .045).rotation.z = angle + Math.PI / 2;
            }
            block(displays, item.color, x, y + .2, z, .04, .38, .06).rotation.z = -.5;
            block(displays, item.trim ?? brass, x, y + .2, z + .04, .3, .035, .05).rotation.z = .3;
          } else {
            block(displays, item.color, x, y + .12, z, .3, .3, .24).rotation.z = Math.PI / 4;
            block(displays, item.trim ?? brass, x, y + .12, z + .14, .1, .1, .03);
          }
        }
        batchBlocks(displays);
      }
      owner.visible = Boolean(state);
      if (!active) return;
      const t = reduced ? 0 : time;
      owner.position.y = .4 + Math.sin(t * 2.3) * .025;
      owner.rotation.y = -.35 + Math.sin(t * .65) * .1;
      arms[0].rotation.x = Math.sin(t * 1.7) * .12;
      arms[1].rotation.z = -.14 - Math.max(0, Math.sin(t * .8)) ** 8 * .7;
      companion.position.y = 1.1 + Math.sin(t * 2.4) * .045;
      companion.rotation.y = Math.sin(t * .9) * .24;
    },
  };
}
