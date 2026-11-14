import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildPirateBird, flapBird } from './pirate-bird.js';

function createRoundedPieces() {
  const geometry = new RoundedBoxGeometry(1, 1, 1, 2, .16);
  const materials = new Map();
  return (parent, color, x, y, z, w, h, d) => {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: .86 }));
    const mesh = new THREE.Mesh(geometry, materials.get(color));
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    parent.add(mesh);
    return mesh;
  };
}

function captainModel(root, piece) {
  const coat = 0x923a45;
  const cuffs = 0x583348;
  const gold = 0xe9b45c;
  const skin = 0xde9b6f;
  const leather = 0x30252d;
  const beard = 0x4a2b2d;
  const hat = 0x30283c;

  function joint(parent, x, y, z) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    parent.add(group);
    return group;
  }

  const boots = [-1, 1].map(side => {
    const leg = joint(root, side * .255, .61, 0);
    piece(leg, 0x47445b, 0, -.18, 0, .33, .41, .38);
    piece(leg, leather, 0, -.42, .12, .37, .28, .58);
    piece(leg, 0x51404a, 0, -.53, .15, .39, .095, .58);
    piece(leg, cuffs, 0, -.29, 0, .36, .11, .43);
    return leg;
  });
  const torso = joint(root, 0, .75, 0);
  piece(torso, coat, 0, .43, 0, .92, .78, .67);
  piece(torso, 0x37635e, 0, .48, .327, .57, .63, .12);
  piece(torso, 0xe8d4ac, 0, .72, .37, .33, .29, .07);
  piece(torso, 0x66453c, 0, .11, 0, .94, .17, .72);
  piece(torso, gold, .04, .11, .39, .26, .21, .10).rotation.z = -.09;
  piece(torso, leather, .04, .11, .445, .13, .105, .028);
  for (const side of [-1, 1]) {
    piece(torso, coat, side * .253, -.12, -.035, .47, .46, .64).rotation.z = side * .12;
    piece(torso, 0xa34d57, side * .27, .50, .353, .18, .48, .09).rotation.z = side * .31;
    piece(torso, gold, side * .27, .60, .406, .043, .29, .035).rotation.z = side * .31;
    for (const y of [.28, .42, .56]) piece(torso, gold, side * .16, y, .402, .059, .054, .036);
  }

  const arms = [-1, 1].map(side => {
    const shoulder = joint(torso, side * .47, .67, -.015);
    piece(shoulder, coat, side * .058, -.16, 0, .32, .41, .39);
    piece(shoulder, gold, side * .075, .06, 0, .35, .12, .42);
    for (const z of [-.12, 0, .12]) piece(shoulder, gold, side * .229, .015, z, .055, .13, .056);
    const elbow = joint(shoulder, side * .064, -.32, .015);
    piece(elbow, coat, 0, -.12, .008, .28, .32, .32);
    piece(elbow, cuffs, 0, -.243, .03, .32, .16, .35);
    piece(elbow, gold, 0, -.302, .031, .33, .048, .36);
    piece(elbow, skin, 0, -.39, .067, .23, .18, .24);
    piece(elbow, skin, -side * .104, -.35, .146, .101, .118, .115);
    return { shoulder, elbow };
  });

  const head = joint(torso, 0, .77, .015);
  piece(head, 0xba795b, 0, .05, 0, .33, .22, .34);
  piece(head, skin, 0, .41, 0, .74, .73, .68);
  piece(head, beard, 0, .405, -.27, .79, .62, .27);
  for (const side of [-1, 1]) {
    piece(head, skin, side * .355, .35, 0, .17, .24, .22);
    piece(head, 0xc77c66, side * .244, .316, .327, .185, .132, .08);
    piece(head, beard, side * .326, .245, .14, .16, .32, .39);
    piece(head, 0x69413b, side * .17, .197, .375, .29, .122, .14).rotation.z = side * .24;
  }
  piece(head, gold, .421, .233, .06, .095, .18, .115);
  piece(head, skin, 0, .399, .385, .174, .20, .197);
  piece(head, leather, -.178, .476, .348, .245, .175, .102).rotation.z = -.14;
  piece(head, leather, 0, .548, .337, .741, .045, .039).rotation.z = .15;
  const eye = joint(head, .197, .474, .347);
  piece(eye, 0xffe6c7, 0, 0, 0, .161, .129, .06);
  piece(eye, 0x453332, .027, -.008, .038, .052, .076, .021);
  piece(eye, 0xfff1db, .037, .01, .051, .018, .018, .014);
  piece(head, beard, .203, .569, .358, .187, .061, .055).rotation.z = -.15;
  const jaw = joint(head, 0, .143, .088);
  piece(jaw, beard, 0, -.068, .025, .65, .25, .60);
  piece(jaw, beard, 0, -.205, .143, .42, .215, .47);
  piece(jaw, 0x5f3834, .03, -.201, .361, .23, .137, .057);
  const mouth = piece(head, 0x301c25, 0, .145, .407, .209, .046, .046);
  piece(head, 0xf2d6a7, -.045, .159, .433, .047, .031, .018);

  piece(head, hat, 0, .77, -.035, 1.28, .147, .91).rotation.z = -.07;
  piece(head, 0x4c354c, 0, .89, -.04, .77, .28, .67);
  for (const side of [-1, 1]) {
    const brim = joint(head, side * .388, .84, .23);
    brim.rotation.z = side * .32;
    brim.rotation.y = -side * .17;
    piece(brim, hat, 0, .031, 0, .64, .22, .34);
    piece(brim, gold, 0, .122, .148, .55, .043, .055);
  }
  piece(head, gold, 0, .893, .438, .208, .151, .045);
  piece(head, 0xf9ddb5, 0, .913, .464, .116, .078, .022);
  for (const x of [-.024, .024]) piece(head, hat, x, .916, .478, .016, .023, .012);
  piece(head, 0xb84e54, -.445, .959, -.121, .11, .42, .15).rotation.z = .53;
  piece(head, 0xd77865, -.566, 1.117, -.115, .13, .17, .13).rotation.z = .67;

  return { boots, torso, arms, head, jaw, mouth, eye };
}

export function createBayHostScene(block) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-3, 3, 2.7, -2.7, .1, 30);
  camera.position.z = 10;
  scene.add(new THREE.HemisphereLight(0xffedd5, 0x786981, 1.65));
  const key = new THREE.DirectionalLight(0xffd8ad, 2.45);
  key.position.set(-5, 7, 5);
  const rim = new THREE.DirectionalLight(0x9ac9ff, 1.6);
  rim.position.set(4, 3, -4);
  scene.add(key, rim);

  // Blend over the bay before drawing the opaque models.
  const shadeMaterial = new THREE.MeshBasicMaterial({ color: 0x111b29, blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, depthWrite: false, depthTest: false });
  const shade = block(scene, shadeMaterial, 0, 0, -4, 1, 1, .01);
  shade.renderOrder = -1;
  const captain = new THREE.Group();
  const pip = new THREE.Group();
  scene.add(captain, pip);
  const piece = createRoundedPieces();
  const body = captainModel(captain, piece);
  const bird = buildPirateBird(pip, piece, {
    body: 0xd64d3f, wings: 0x4b9b63, chest: 0xf3d3a0, tail: 0x368b91,
  });
  bird.model.scale.setScalar(1.83);
  piece(bird.model, 0x352733, 0, .307, -.24, .40, .07, .33);
  piece(bird.model, 0x352733, 0, .376, -.22, .26, .10, .24);
  piece(bird.model, 0xeab25b, 0, .350, -.345, .27, .035, .04);
  for (const side of [-1, 1]) {
    const cheek = piece(bird.model, 0xffdcaa, side * .125, .174, -.360, .081, .108, .060);
    cheek.rotation.y = side * .35;
    piece(bird.model, 0x34222a, side * .130, .189, -.397, .047, .056, .024);
    piece(bird.model, 0xfff4d5, side * .134, .202, -.410, .017, .018, .011);
  }
  captain.rotation.y = .20;
  pip.rotation.y = Math.PI - .42;

  let captainEntry = 0;
  let pipEntry = 0;
  let pipIntroduced = false;
  let voice = 0;
  let gesture = 0;
  let flightTime = 0;
  let aspect;
  let span;

  function pop(progress, show, dt, reduced) {
    if (reduced) return Number(show);
    return THREE.MathUtils.clamp(progress + dt * (show ? 1.9 : -3.2), 0, 1);
  }

  function pose(actor, progress, rest, start, reduced, bounceHeight) {
    const lift = THREE.MathUtils.smootherstep(progress, 0, .72);
    const bounce = reduced ? 0 : Math.sin(Math.PI * THREE.MathUtils.smoothstep(progress, .38, .99));
    actor.visible = progress > 0;
    actor.position.y = THREE.MathUtils.lerp(start, rest, lift) + bounce * bounceHeight;
    actor.scale.set(1 + bounce * .11, 1 - bounce * .16, 1 + bounce * .11);
  }

  return (renderer, hosts, width, height, time, dt, reduced) => {
    const speaker = hosts?.speaker;
    if (speaker === 'parrot') pipIntroduced = true;
    if (speaker && pipIntroduced) flightTime += dt * (reduced ? .55 : 1);
    captainEntry = pop(captainEntry, Boolean(speaker), dt, reduced);
    pipEntry = pop(pipEntry, Boolean(speaker) && pipIntroduced, dt, reduced);
    if (!captainEntry && !pipEntry) {
      pipIntroduced = false;
      flightTime = 0;
      return;
    }

    if (aspect !== width / height) {
      aspect = width / height;
      span = Math.max(5.4, 3.9 / aspect);
      const across = span * aspect;
      camera.left = -across / 2;
      camera.right = across / 2;
      camera.top = span / 2;
      camera.bottom = -span / 2;
      camera.updateProjectionMatrix();
      shade.scale.set(across, span, .01);
    }
    shadeMaterial.opacity = .48 * THREE.MathUtils.smoothstep(captainEntry, 0, .65);
    const floor = -span * .28;
    const spread = THREE.MathUtils.smoothstep(pipEntry, 0, .85);
    const motion = reduced ? .42 : 1;
    const movement = time * (reduced ? .62 : 1);
    const sway = Math.sin(movement * 2.65) * motion;
    captain.position.x = -.86 * spread + sway * .05;
    pose(captain, captainEntry, floor, -span / 2 - 2.8, reduced, .43);
    captain.rotation.y = .30 + sway * .16 + spread * .18;

    if (voice !== hosts.voice) {
      voice = hosts.voice;
      gesture = .64;
    }
    gesture = Math.max(0, gesture - dt);
    const captainTalking = speaker === 'captain' ? gesture * motion : 0;
    const pipTalking = speaker === 'parrot' ? gesture * motion : 0;
    const flourish = Math.sin(Math.PI * captainEntry);
    const wave = captainTalking * (.7 + .3 * Math.sin(time * 17));
    body.torso.rotation.z = sway * .071 + wave * .12;
    body.torso.position.y = .75 + Math.abs(sway) * .041;
    for (const [i, { shoulder, elbow }] of body.arms.entries()) {
      const side = i ? 1 : -1;
      shoulder.rotation.z = side * (.22 + flourish * 1.10 + Math.sin(movement * 3.5 + i) * .13 * motion) + (i ? wave * 1.65 : 0);
      shoulder.rotation.x = sway * side * .16 - wave * .55;
      elbow.rotation.x = -.24 - Math.abs(sway) * .18 - wave * (i ? 1.2 : .4);
      body.boots[i].rotation.x = sway * side * .12;
    }
    body.head.rotation.set(sway * .052 - wave * .19, -sway * .22 + spread * .16,
      sway * .10 + flourish * .22);
    const syllable = Math.abs(Math.sin(captainTalking * 32) * captainTalking);
    body.jaw.rotation.x = syllable * .52;
    body.mouth.scale.y = .046 + syllable * .22;
    const blink = Math.max(0, 1 - Math.abs((time % 4.2) - 3.8) * 13);
    body.eye.scale.y = 1 - blink * .93;

    const loop = flightTime * 3;
    const arc = Math.sin(loop) * motion;
    const entryOffset = (1 - THREE.MathUtils.smoothstep(pipEntry, .12, .90)) * .8;
    const flightRoom = THREE.MathUtils.smoothstep(aspect, .42, .83);
    pip.position.x = .87 + flightRoom * .13 + arc * (.16 + flightRoom * .21) + entryOffset;
    pose(pip, pipEntry, floor + 1.42 + Math.cos(loop * 2) * .16 * motion + pipTalking * .28,
      -span / 2 - 1.35, reduced, .66);
    pip.scale.multiplyScalar(.78 + flightRoom * .22);
    pip.position.z = Math.cos(loop) * .46 * motion;
    pip.rotation.set(Math.sin(loop * 2) * .16 * motion,
      Math.PI - .36 + arc * .46, -Math.cos(loop) * .23 * motion + pipTalking * .12);
    flapBird(bird, flightTime * 23, .92 * motion + pipTalking * .35);
    bird.wings[0].rotation.z += .18;
    bird.wings[1].rotation.z -= .18;

    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(scene, camera);
    renderer.autoClear = autoClear;
    if (speaker && (speaker === 'captain' ? captainEntry : pipEntry) >= .82) hosts.place();
  };
}
