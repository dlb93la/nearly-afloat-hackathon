import * as THREE from 'three';

const { smoothstep } = THREE.MathUtils;
const arms = [
  { x: -4.65, z: .10, height: 5.1, width: .79, delay: .25, curl: 1.3 },
  { x: 4.55, z: -.9, height: 5.9, width: .94, delay: 1.12, curl: 1.9 },
  { x: 4.4, z: 4.04, height: 4.15, width: .81, delay: 1.9, curl: 1.65 },
  { x: -4.5, z: -4.44, height: 4.94, width: .72, delay: 2.4, curl: 1.25 },
];
const links = 10;
const battlePhase = time => (time + 3.8) % 13.8;

function createDeckCrew(boat, block, batchBlocks) {
  const crew = [0xe3a048, 0x5cad9f].map((coat, i) => {
    const pirate = new THREE.Group();
    pirate.scale.setScalar(.84);
    boat.add(pirate);
    block(pirate, coat, 0, .48, 0, .32, .32, .23);
    block(pirate, 0x513335, 0, .37, .02, .34, .075, .25);
    block(pirate, 0xf6ce77, 0, .37, .156, .074, .07, .033);
    block(pirate, i ? 0xab7459 : 0xe1a477, 0, .755, .018, .27, .244, .246);
    for (const x of [-.068, .068]) block(pirate, 0x322531, x, .77, .146, .038, .045, .025);
    block(pirate, 0x48333a, 0, .891, .01, .41, .071, .30);
    block(pirate, i ? 0x553d54 : 0x713e36, 0, .954, .005, .275, .10, .215);
    const limbs = [-1, 1].map(side => {
      const arm = new THREE.Group(), leg = new THREE.Group();
      arm.position.set(side * .205, .59, 0);
      leg.position.set(side * .089, .32, 0);
      pirate.add(arm, leg);
      block(arm, coat, 0, -.09, 0, .102, .19, .13);
      block(arm, 0xd59b71, 0, -.211, .009, .095, .086, .107);
      block(leg, 0x4b3942, 0, -.116, 0, .109, .235, .126);
      block(leg, 0x382d37, 0, -.276, .035, .13, .087, .188);
      batchBlocks(arm);
      batchBlocks(leg);
      return { arm, leg, side };
    });
    batchBlocks(pirate);
    return { pirate, limbs };
  });
  return time => {
    const phase = battlePhase(time);
    for (const [i, { pirate, limbs }] of crew.entries()) {
      const start = arms[i].delay + .8;
      const elapsed = Math.max(0, phase - start);
      const run = smoothstep(elapsed, 0, .42) * (1 - smoothstep(phase, 8.55, 10.5));
      const lap = (1 - Math.cos(elapsed * 2.85)) / 2;
      const stride = Math.sin(time * 16 + i) * run;
      pirate.position.set(i ? -.81 : .84, .87 + Math.abs(stride) * .082,
        (i ? 2.22 : -2.63) + (i ? -4.72 : 4.96) * lap * run);
      const facing = Math.sin(elapsed * 2.85) * (i ? -1 : 1);
      pirate.rotation.set(run * .19, run > .12 ? (facing < 0 ? Math.PI : 0) : (i ? -.9 : .92), stride * .065);
      for (const { arm, leg, side } of limbs) {
        arm.rotation.set(-run * .84 + side * stride * .68, 0, side * (run * .54 + .08));
        leg.rotation.x = -side * stride * .77;
      }
    }
  };
}

function createKraken(scene, box) {
  const body = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial(), arms.length * links * 3);
  body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  body.frustumCulled = false;
  scene.add(body);
  const spray = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial(), arms.length * 9);
  spray.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  spray.frustumCulled = false;
  scene.add(spray);
  const rings = arms.map(() => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(.79, 1, 18),
      new THREE.MeshBasicMaterial({ color: 0xb2f3de, transparent: true, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    scene.add(ring);
    return ring;
  });
  const tint = new THREE.Color();
  const skin = [0x695276, 0x765883, 0x835a88, 0x946092, 0x835482];
  for (let i = 0; i < body.count / 3; i++) {
    body.setColorAt(i * 3, tint.setHex(skin[i % skin.length]));
    body.setColorAt(i * 3 + 1, tint.setHex(0xc9979f));
    body.setColorAt(i * 3 + 2, tint.setHex(0x83526f));
  }
  for (let i = 0; i < spray.count; i++) spray.setColorAt(i, tint.setHex(i % 3 ? 0x99ded0 : 0xedf7d7));
  const stamp = new THREE.Object3D();
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const axis = new THREE.Vector3();
  const cup = new THREE.Vector3();
  const view = new THREE.Vector3(.4, .12, 1);
  const side = new THREE.Vector3();
  const direction = new THREE.Matrix4();

  function joint(target, u, boat, cos, sin, arm, lift, swing) {
    const bend = u ** 2 * arm.curl * lift;
    const lateral = Math.sign(arm.x) * Math.max(2.75, Math.abs(arm.x) - bend * 1.55);
    const along = arm.z + Math.sin(u * Math.PI * .91) * swing;
    target.set(boat.position.x + lateral * cos + along * sin,
      -1.8 + arm.height * lift * Math.sin(u * 1.94), boat.position.z - lateral * sin + along * cos);
  }

  return (boat, time) => {
    const battle = battlePhase(time);
    let strain = 0;
    const heading = boat.rotation.y;
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    for (const [i, arm] of arms.entries()) {
      const stage = battle - arm.delay;
      const rise = smoothstep(stage, .25, 2.40);
      const fall = smoothstep(stage, 6.15, 9.5);
      const lifted = rise * (1 - fall);
      const lift = lifted * (.93 + Math.sin(time * 2.2 + i * 1.48) * .07);
      const swing = Math.sin(time * 2.02 + i * 1.3) * .53 + (i % 2 ? -.92 : .71);
      const x = boat.position.x + arm.x * cos + arm.z * sin;
      const z = boat.position.z - arm.x * sin + arm.z * cos;
      strain += lifted * Math.sin(time * 2.2 + i * 1.29);
      joint(start, 0, boat, cos, sin, arm, lift, swing);
      for (let link = 0; link < links; link++) {
        const u = (link + 1) / links;
        joint(end, u, boat, cos, sin, arm, lift, swing);
        axis.subVectors(end, start);
        const segmentLength = axis.length();
        axis.normalize();
        side.crossVectors(axis, view).normalize();
        cup.crossVectors(side, axis);
        direction.makeBasis(side, axis, cup);
        stamp.quaternion.setFromRotationMatrix(direction);
        stamp.position.copy(start).lerp(end, .5);
        const radius = arm.width * (1 - u * .81) * (.70 + lift * .30);
        const index = (i * links + link) * 3;
        stamp.scale.set(radius, segmentLength + radius * .28, radius * .90);
        stamp.updateMatrix();
        body.setMatrixAt(index, stamp.matrix);
        stamp.position.addScaledVector(cup, radius * .45);
        stamp.scale.set(radius * .62, radius * .56, radius * .24);
        stamp.updateMatrix();
        body.setMatrixAt(index + 1, stamp.matrix);
        stamp.position.addScaledVector(cup, radius * .124);
        stamp.scale.set(radius * .27, radius * .24, radius * .04);
        stamp.updateMatrix();
        body.setMatrixAt(index + 2, stamp.matrix);
        if (lifted <= .001) {
          stamp.scale.setScalar(0);
          stamp.updateMatrix();
          for (let detail = 0; detail < 3; detail++) body.setMatrixAt(index + detail, stamp.matrix);
        }
        start.copy(end);
      }
      const wash = (time * 1.28 + i * .29) % 1;
      const foam = rings[i];
      foam.visible = lifted > .07;
      foam.position.set(x, -1.163, z);
      foam.scale.setScalar(.48 + wash * 1.47);
      foam.material.opacity = .75 * lifted * (1 - wash);
      for (let particle = 0; particle < 9; particle++) {
        const age = (wash + (particle % 3) * .19) % 1;
        const angle = particle * 2.4 + i * .9;
        const reach = .35 + age * 1.05;
        const eruption = Math.sin(age * Math.PI) * (.24 + (1 - rise + fall) * .95);
        stamp.position.set(x + Math.cos(angle) * reach, -1.18 + eruption, z + Math.sin(angle) * reach);
        stamp.rotation.set(angle, 0, angle - age);
        stamp.scale.setScalar(.15 * (1 - age) * lifted);
        stamp.updateMatrix();
        spray.setMatrixAt(i * 9 + particle, stamp.matrix);
      }
    }
    body.instanceMatrix.needsUpdate = true;
    spray.instanceMatrix.needsUpdate = true;
    return strain;
  };
}

function createCrane(scene, block) {
  const root = new THREE.Group();
  root.position.set(8.6, -.05, 6.37);
  scene.add(root);
  block(root, 0x897655, 0, .13, 0, .81, .28, .83);
  block(root, 0x7d523b, 0, 1.67, 0, .27, 3.32, .29);
  block(root, 0x4d4340, 0, 2.9, 0, .34, .13, .35);
  const boom = new THREE.Group();
  boom.position.y = 3.21;
  root.add(boom);
  block(boom, 0xa57445, 0, 0, .83, .24, .22, 2.83);
  block(boom, 0x78543d, 0, -.57, .62, .13, .14, 1.71).rotation.x = -.72;
  block(boom, 0x6c5745, 0, .06, -.49, .54, .43, .42);
  block(boom, 0x51463c, 0, -.16, 2.12, .31, .26, .24);
  const hook = new THREE.Group();
  boom.add(hook);
  hook.position.set(0, -.24, 2.12);
  const rope = block(hook, 0xd6ad72, 0, -1, 0, .047, 2, .047);
  const crate = new THREE.Group();
  hook.add(crate);
  block(crate, 0xa57248, 0, -.30, 0, .70, .56, .64);
  block(crate, 0xd29d61, 0, -.06, 0, .73, .11, .66);
  for (const x of [-.23, .23]) block(crate, 0x594a3d, x, -.30, .005, .073, .60, .69);
  block(crate, 0xe4bb7c, 0, .037, 0, .20, .13, .18);
  return time => {
    const sweep = time * .83;
    const reach = 1.45 + Math.sin(time * 1.23 + .32) * .61;
    boom.rotation.y = -.69 + Math.sin(sweep) * .75;
    hook.rotation.z = Math.cos(sweep - .45) * .23;
    hook.rotation.x = Math.sin(time * 1.9) * .083;
    rope.position.y = -reach / 2;
    rope.scale.y = reach;
    crate.position.y = -reach;
    crate.rotation.y = Math.sin(time * 2.7) * .41;
  };
}

function createShark(scene, block) {
  const swimmer = new THREE.Group();
  const x = .25, z = 19.1;
  scene.add(swimmer);
  block(swimmer, 0x4d7879, 0, -.17, 0, .31, .32, .24);
  block(swimmer, 0xd49a6c, 0, .065, 0, .26, .25, .24);
  block(swimmer, 0x5a3440, 0, .21, 0, .33, .08, .28);
  block(swimmer, 0x412731, .034, .035, .124, .073, .047, .025);
  const arms = [-1, 1].map(side => {
    const arm = new THREE.Group();
    arm.position.x = side * .21;
    swimmer.add(arm);
    block(arm, 0xd49a6c, 0, .15, 0, .095, .31, .1);
    return arm;
  });
  const ripples = [-1, 1].map(side => block(scene, 0xb2e6dc, x + side * .36, -1.165, z, .12, .015, .48));
  const shark = new THREE.Group();
  scene.add(shark);
  const profile = new THREE.Shape();
  profile.moveTo(-.54, 0);
  profile.lineTo(.37, 0);
  profile.lineTo(-.22, .58);
  profile.lineTo(-.39, .64);
  profile.lineTo(-.34, .31);
  profile.closePath();
  const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(profile, { depth: .095, bevelEnabled: false }),
    new THREE.MeshLambertMaterial({ color: 0x344d58 }));
  fin.rotation.y = -Math.PI / 2;
  shark.add(fin);
  const wake = [-1, 1].flatMap(side => [0, 1, 2].map(i => {
    const foam = block(shark, 0x96cebe, side * (.14 + i * .15), .005, -.37 - i * .44, .049, .018, .54);
    foam.rotation.y = -side * .32;
    return foam;
  }));
  return time => {
    const route = time * .53 + .48;
    const slip = Math.sin(time * 5.8);
    shark.position.set(x + 1.45 * Math.sin(route), -1.17, z + 1.25 * Math.cos(route));
    shark.rotation.y = Math.atan2(1.45 * Math.cos(route), -1.25 * Math.sin(route));
    swimmer.position.set(x, -1.13 + Math.sin(time * 3.2) * .085, z);
    swimmer.rotation.set(.12 * slip, Math.sin(route) * .65, .17 * slip);
    arms.forEach((arm, i) => { arm.rotation.z = (i ? -1 : 1) * (.38 + .48 * Math.sin(time * 6.8 + i * 2)); });
    ripples.forEach((foam, i) => { foam.scale.z = .32 + .17 * Math.sin(time * 5 + i); });
    fin.position.y = slip * .07;
    for (const [i, foam] of wake.entries()) foam.scale.z = .45 + Math.sin(time * 6.2 + i) * .15;
  };
}

export function createBaySpectacle(scene, east, box, block, ship, batchBlocks) {
  const kraken = createKraken(scene, box);
  const crane = createCrane(east, block);
  const shark = createShark(scene, block);
  const animateCrew = createDeckCrew(ship, block, batchBlocks);
  return (ship, time) => {
    crane(time);
    shark(time);
    animateCrew(time);
    return kraken(ship, time);
  };
}
