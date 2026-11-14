import * as THREE from 'three';

const { lerp, smoothstep } = THREE.MathUtils;
const waterline = -1.17;

export function createBayLife(scene, west, east, block, planks, crew) {
  const [firstRider, secondRider, diver, firstBrawler, secondBrawler, ...runners] = crew;

  function burst(parent, colors, count) {
    const root = new THREE.Group();
    parent.add(root);
    const sparks = Array.from({ length: count }, (_, i) =>
      block(root, colors[i % colors.length], 0, 0, 0, .13, .36, .13));
    return (age, x, y, z, spread, lift) => {
      root.visible = age >= 0 && age < 1;
      if (!root.visible) return;
      root.position.set(x, y, z);
      for (const [i, spark] of sparks.entries()) {
        const angle = i * Math.PI * 2 / count;
        const reach = (.2 + age * spread) * (i % 2 ? .68 : 1);
        spark.position.set(Math.cos(angle) * reach, Math.sin(Math.PI * age) * lift, Math.sin(angle) * reach);
        spark.rotation.z = angle + age * 2;
        spark.scale.set(.16, .42, .16).multiplyScalar(1 - age * .79);
      }
    };
  }

  function splash(parent) {
    const spray = burst(parent, [0xc4efe2, 0x6dc4bd, 0xedf5cf], 10);
    const ring = new THREE.Mesh(new THREE.RingGeometry(.78, 1, 14),
      new THREE.MeshBasicMaterial({ color: 0xb5e3c9, transparent: true, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    parent.add(ring);
    return (age, x, z, size) => {
      ring.visible = age >= 0 && age < 1;
      spray(age * 1.45, x, waterline, z, size, size * 1.12);
      if (!ring.visible) return;
      ring.position.set(x, waterline, z);
      ring.scale.setScalar(size * lerp(.24, 1.57, age));
      ring.material.opacity = (1 - age) * .95;
    };
  }

  const clash = burst(west, [0xffdc69, 0xff9254, 0xfff2c5], 8);
  const scuffle = burst(east, [0xfaba71, 0xffca60, 0xef7960], 6);
  const diverSplash = splash(east);
  const cannonSplash = splash(west);
  const swear = new THREE.Group();
  swear.rotation.y = .42;
  east.add(swear);
  block(swear, 0xffe0a6, 0, 0, 0, .67, .40, .072);
  block(swear, 0xffe0a6, .18, -.19, 0, .14, .14, .072).rotation.z = .5;
  for (const n of [-.064, .064]) {
    block(swear, 0x6a3636, -.095 + n, 0, .045, .037, .24, .025).rotation.z = -.19;
    block(swear, 0x6a3636, -.095, n, .045, .25, .033, .025);
  }
  block(swear, 0x6a3636, .168, .042, .045, .059, .137, .025).rotation.z = -.13;
  block(swear, 0x6a3636, .154, -.082, .045, .054, .051, .025);

  function barrelDuel(time) {
    const phase = time % 4.6;
    const charge = smoothstep(phase, .40, 1.64);
    const bounce = smoothstep(phase, 1.64, 2.54);
    const air = Math.sin(Math.PI * bounce);
    const spacing = lerp(1.55, .34, charge) + bounce * 1.21;
    const spin = bounce * Math.PI * 2;
    for (const [i, { hand, drum, limbs, legs }] of [firstRider, secondRider].entries()) {
      const side = i * 2 - 1;
      hand.position.set(-5.02 + side * air * .23, -.045 + air * .94, 4.73 + side * spacing);
      hand.rotation.set(-air * .44, i * Math.PI + side * spin, side * air * .40);
      drum.rotation.x = charge * 5.9 - bounce * 6.1;
      const stride = Math.sin(time * 17 + i) * smoothstep(phase, .40, .65) * (1 - smoothstep(phase, 1.46, 1.67)) * .61;
      legs[0].rotation.x = -.09 + stride + air * .31;
      legs[1].rotation.x = -.09 - stride - air * .48;
      limbs[0].rotation.x = -.19 - stride - air * 1.55;
      limbs[1].rotation.x = -.19 + stride - air * 1.72;
      limbs[0].rotation.z = .26 - air * .58;
      limbs[1].rotation.z = -.26 + air * .58;
    }
    clash((phase - 1.64) / .62, -5.02, .47, 4.73, .94, .85);
  }

  function dockBrawl(time) {
    const phase = time % 3.9;
    const bell = phase % 1.95;
    const lead = phase < 1.95 ? 0 : 1;
    const swing = smoothstep(bell, .25, .74) * (1 - smoothstep(bell, .78, 1.43));
    const stagger = smoothstep(bell, .69, .98) * (1 - smoothstep(bell, 1.05, 1.59));
    for (const [i, { hand, limbs }] of [firstBrawler, secondBrawler].entries()) {
      const side = i * 2 - 1;
      const hits = i === lead ? swing : 0;
      const reels = i === lead ? 0 : stagger;
      hand.position.set(6.23 + side * (.64 - hits * .56 + reels * .50), -.065 + reels * .28, 3.39 + side * .14);
      hand.rotation.set(hits * .27 - reels * .57, -side * (Math.PI / 2 + reels * .31), side * reels * .40);
      limbs[0].rotation.x = .18 - hits * .77 + reels * .48;
      limbs[1].rotation.x = -.15 + hits * .26 - reels * .54;
      limbs[2].rotation.set(-.92 - hits * .69 - reels * .88, 0, -.23 - reels * .46);
      limbs[3].rotation.set(-.71 - hits * 1.17 - reels * 1.04, 0, .25 + reels * .45);
    }
    scuffle((bell - .76) / .35, 6.23, .69, 3.39, .44, .63);
    const shout = (bell - .78) / .61;
    swear.visible = shout >= 0 && shout < 1;
    if (swear.visible) {
      swear.position.set(6.23 + (lead ? -1 : 1) * (.63 + shout * .49), 1.53 + shout * .53, 3.43);
      swear.scale.setScalar(smoothstep(shout, 0, .21) * (1 - smoothstep(shout, .63, 1)));
    }
  }

  function barrelDive(time) {
    const laneZ = 1.48;
    const phase = time % 7.3;
    const rush = smoothstep(phase, 2.35, 3.4);
    const flight = smoothstep(phase, 3.4, 4.12);
    const hop = Math.sin(Math.PI * flight);
    const { hand, limbs, legs, drum } = diver;
    hand.visible = phase < 4.18 || phase > 6.66;
    hand.position.set(6.44 - 2.09 * rush - 1.64 * flight, -.06 + hop * .57 - flight ** 3 * 1.53, laneZ);
    hand.rotation.set(flight * 1.27, -Math.PI / 2 - hop * .24, hop * .37);
    drum.rotation.x = rush * 7.8 + flight * 3;
    const stride = Math.sin(time * 19) * smoothstep(phase, 2.35, 2.63) * (1 - smoothstep(phase, 3.26, 3.45)) * .68;
    legs[0].rotation.x = -.08 + stride + hop * .44;
    legs[1].rotation.x = -.08 - stride - hop * .55;
    limbs[0].rotation.x = -rush * .60 - stride - flight;
    limbs[1].rotation.x = -rush * .60 + stride - flight * 1.4;
    limbs[0].rotation.z = -.36 - hop * .38;
    limbs[1].rotation.z = .36 + hop * .38;
    const returnSize = smoothstep(phase, 6.66, 7.12);
    if (phase > 6.66) {
      hand.position.set(6.44, -.06, laneZ);
      hand.rotation.set(0, -Math.PI / 2, 0);
      limbs[0].rotation.x = 0;
      limbs[1].rotation.x = 0;
    }
    hand.scale.setScalar(1.2 * (phase > 6.66 ? returnSize : 1));
    diverSplash((phase - 4.03) / 1.12, 2.77, laneZ, .91);
  }

  const routes = [
    { x: -4.94, z: .48, dx: .05, dz: .55, speed: 1.30, y: -.065 },
    { x: 0, z: -2.34, dx: 2.45, dz: .13, speed: .96, y: -.065 },
    { x: 5.42, z: 5.56, dx: .12, dz: .92, speed: 1.04, y: -.065 },
  ];
  function run(time) {
    for (const [i, { hand, limbs }] of runners.entries()) {
      const route = routes[i];
      const phase = time * route.speed + i * 1.67;
      const stride = Math.sin(time * 13 + i * 1.4);
      hand.position.set(route.x + Math.sin(phase) * route.dx, route.y + Math.abs(stride) * .08,
        route.z + Math.cos(phase) * route.dz);
      hand.rotation.set(.24, Math.atan2(Math.cos(phase) * route.dx, -Math.sin(phase) * route.dz), stride * .12);
      for (const [j, limb] of limbs.entries()) limb.rotation.x = (j % 2 ? 1 : -1) * stride * .92;
      limbs[3].rotation.x -= .71;
    }
  }

  const skiff = new THREE.Group();
  scene.add(skiff);
  for (const [i, width] of [.54, .94, 1.13, 1.09, .84, .38].entries()) {
    const z = (i - 2.5) * .33;
    block(skiff, 0x774a3b, 0, .07, z, width, .32, .35);
    block(skiff, planks, 0, .24, z, width * .90, .05, .33);
    for (const side of [-1, 1]) block(skiff, 0x477e74, side * width * .47, .28, z, .09, .11, .35);
  }
  block(skiff, 0xab583c, 0, .44, -.03, .32, .33, .28);
  block(skiff, 0xb57856, 0, .69, -.05, .27, .27, .26);
  block(skiff, 0x4b373c, 0, .82, -.05, .36, .10, .31);
  const oars = [-1, 1].map(side => {
    const oar = new THREE.Group();
    oar.position.set(side * .29, .48, -.02);
    skiff.add(oar);
    block(oar, 0x966244, side * .55, 0, 0, 1.16, .05, .065);
    block(oar, 0xba8254, side * 1.09, 0, 0, .36, .07, .17);
    return oar;
  });
  const wake = [-1, 1].flatMap(side => [0, 1, 2].map(i => {
    const foam = block(skiff, i % 2 ? 0x8dccba : 0xb8dfc5, side * (.32 + .17 * i),
      -.07, -1.0 - i * .33, .055, .018, .38 - .05 * i);
    foam.rotation.y = -side * .49;
    return foam;
  }));

  function row(time, spread) {
    const route = time * .49 + .22;
    const stroke = time * 6.3;
    const reach = Math.min(.55 + spread * .065, .9);
    skiff.position.set(reach * Math.cos(route), -1.07 + Math.sin(stroke) * .05, 13.75 + .72 * Math.sin(route));
    skiff.rotation.set(Math.sin(stroke) * .052,
      Math.atan2(-reach * Math.sin(route), .72 * Math.cos(route)), Math.cos(stroke) * .092);
    for (const [i, oar] of oars.entries()) {
      const side = i * 2 - 1;
      oar.rotation.set(0, side * Math.sin(stroke) * .62, -side * (.25 + Math.cos(stroke) * .17));
    }
    for (const [i, foam] of wake.entries()) foam.scale.z = .27 + .11 * Math.sin(stroke + i);
  }

  const cannonX = -5.34;
  const cannonZ = 7.36;
  block(west, 0x8e5c42, cannonX, .16, cannonZ, .84, .42, .71);
  for (const side of [-1, 1]) block(west, 0x523d37, cannonX + side * .41, .13, cannonZ + .10, .15, .36, .37);
  const tube = new THREE.Group();
  tube.position.set(cannonX, .55, cannonZ);
  tube.rotation.x = -.17;
  west.add(tube);
  block(tube, 0x45424b, 0, 0, 0, .38, .34, .87);
  block(tube, 0x635b5c, 0, 0, .47, .47, .42, .20);
  block(tube, 0x2d313a, 0, 0, .58, .29, .26, .024);
  const flash = burst(west, [0xffb952, 0xffe69b, 0xed8850], 7);
  const shot = block(west, 0x34313a, 0, 0, 0, .27, .27, .27);
  const smoke = Array.from({ length: 6 }, (_, i) =>
    block(west, i % 2 ? 0xa4998d : 0xb5a594, 0, 0, 0, .3, .3, .3));

  function fire(time) {
    const phase = time % 8.35 - 2.13;
    const recoil = (1 - smoothstep(phase, .04, .60)) * smoothstep(phase, 0, .09);
    tube.position.z = cannonZ - recoil * .26;
    flash(phase / .31, cannonX, .65, cannonZ + .76, .52, .44);
    const flight = phase / .76;
    shot.visible = flight >= 0 && flight < 1;
    if (shot.visible) shot.position.set(cannonX, .65 + Math.sin(Math.PI * flight) * 1.31 - flight ** 3 * 1.82,
      cannonZ + .69 + flight * 6.1);
    cannonSplash((phase - .76) / 1.19, cannonX, cannonZ + 6.79, 1.03);
    for (const [i, puff] of smoke.entries()) {
      const age = phase - i * .063;
      puff.visible = age >= 0 && age < .86;
      if (!puff.visible) continue;
      puff.position.set(cannonX + age * (.46 + i * .15), .67 + age * (1.45 + i * .12), cannonZ + .68 + age * .74);
      puff.rotation.set(i + age, i * .7, i * .83);
      puff.scale.setScalar((.30 + age * .62) * (1 - smoothstep(age, .42, .86)));
    }
  }

  const gulls = Array.from({ length: 3 }, () => {
    const bird = new THREE.Group();
    scene.add(bird);
    block(bird, 0xffe8c6, 0, 0, 0, .13, .095, .25);
    const wings = [-1, 1].map(side => {
      const wing = new THREE.Group();
      bird.add(wing);
      block(wing, 0xffe8c6, side * .18, 0, -.03, .34, .044, .19);
      block(wing, 0xa28375, side * .38, 0, -.076, .14, .039, .11);
      return wing;
    });
    return { bird, wings };
  });
  function fly(time, spread) {
    const reach = 8.9 + spread * .72;
    for (const [i, { bird, wings }] of gulls.entries()) {
      const phase = time * .39 + i * .53;
      bird.position.set(-1.28 + Math.sin(phase) * reach, 3.65 + Math.cos(phase * 2) * .45 + i * .24,
        9.38 + Math.cos(phase) * 3.53);
      bird.rotation.y = Math.atan2(Math.cos(phase) * reach, -Math.sin(phase) * 3.53);
      const flap = .15 + Math.sin(time * 9 + i * 1.8) * .67;
      wings[0].rotation.z = -flap;
      wings[1].rotation.z = flap;
    }
  }

  return (time, spread) => {
    barrelDuel(time);
    dockBrawl(time + .43);
    barrelDive(time);
    run(time);
    row(time, spread);
    fire(time);
    fly(time, spread);
  };
}
