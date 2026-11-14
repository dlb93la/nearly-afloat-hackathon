import * as THREE from 'three';

export function buildFortEntrance(root, box) {
  const wood = 0x634239;
  const iron = 0x525665;
  for (const side of [-1, 1]) {
    const x = side * .94;
    box(root, 0x4a5355, x, .16, 0, .50, .32, .58);
    box(root, wood, x, 1.23, 0, .27, 2.35, .30);
    for (const y of [.52, 1.87]) box(root, iron, x, y, 0, .35, .11, .38);
    box(root, 0xd79c5d, x, 2.45, 0, .43, .13, .50);
    box(root, 0xeabe6a, x, 2.6, -.02, .19, .24, .23);
  }
  box(root, wood, 0, 2.25, 0, 2.28, .23, .31);
  box(root, 0x568b86, 0, 1.98, .03, .73, .43, .14);
  box(root, 0xe9c37c, 0, 2.00, .11, .21, .19, .035).rotation.z = Math.PI / 4;
}

export function buildFortWatchtower(root, box, tall, banner) {
  const height = tall ? 4.3 : 3.1;
  const wood = 0x6b483c;
  for (const x of [-.82, .82]) for (const z of [-.78, .78]) {
    box(root, 0x515658, x, -.52, z, .47, 1.28, .47);
    box(root, wood, x, height / 2 - .22, z, .25, height + .44, .27);
    for (const y of [.35, height - .4]) box(root, 0xb38659, x, y, z, .36, .16, .36);
  }
  for (const z of [-.79, .79]) {
    for (const angle of [-.53, .53]) box(root, wood, 0, height * .49, z, .15, height * .72, .15).rotation.z = angle;
    box(root, 0x835d48, 0, height - .52, z, 1.94, .24, .20);
  }
  box(root, 0xa2714c, 0, height, 0, 2.13, .23, 1.99);
  box(root, 0x385759, 0, height + .49, -.09, 1.73, .85, 1.54);
  for (const x of [-.43, .43]) {
    box(root, 0x27333c, x, height + .53, .697, .39, .34, .045);
    box(root, 0xeab666, x, height + .48, .73, .31, .16, .040);
  }
  for (let i = 0; i < 4; i++) box(root, i % 2 ? 0x4c6664 : 0x365252, 0, height + .94 + i * .12, -.10,
    2.14 - i * .39, .16, 1.97 - i * .30);
  box(root, 0xb99a64, 0, height + 1.65, -.07, .08, 1.0, .08);
  box(root, banner, .33, height + 2.0, -.05, .64, .37, .05);
  box(root, 0xf3d298, .28, height + 2.0, -.014, .18, .18, .023);
}

export function buildFortTreasure(root, box, style) {
  const wood = style?.color ?? 0x995e3d;
  const metal = style?.trim ?? 0xe2ad62;
  box(root, 0x515b58, 0, .15, 0, 1.91, .28, 1.76);
  box(root, 0x79817a, 0, .29, 0, 1.71, .12, 1.55);
  box(root, wood, 0, .60, 0, 1.22, .52, .87);
  box(root, wood, 0, .90, -.02, 1.27, .14, .88);
  box(root, wood, 0, 1.00, -.025, 1.05, .09, .68);
  for (const side of [-1, 1]) {
    const x = side * .42;
    box(root, metal, x, .67, .45, .13, .56, .065);
    box(root, metal, x, .981, -.018, .12, .065, .83);
    box(root, 0xf1d09a, x, .78, .49, .046, .046, .026);
    box(root, 0xaa7950, side * .84, .42, -.57, .20, .29, .21);
    box(root, 0xfac86f, side * .84, .59, -.57, .12, .17, .13);
  }
  box(root, metal, 0, .66, .47, .27, .25, .085);
  box(root, 0x322831, 0, .66, .53, .055, .12, .018);
}

export function buildFortObstacle(root, kind, tint, box, tube) {
  if (kind === 'wall') {
    for (let i = 0; i < 6; i++) {
      const y = .16 + i * .152;
      box(root, i % 2 ? tint : 0xab754e, 0, y, 0, 2.33, .14, 2.28);
    }
    for (const x of [-.90, .90]) {
      for (const z of [-.93, .93]) {
        box(root, 0x69483b, x, .49, z, .23, 1.10, .24);
        box(root, 0x5d6570, x, .99, z, .25, .14, .26);
      }
      box(root, 0x684d3e, x * .77, .52, 1.16, .13, 1.00, .105).rotation.z = x * .58;
    }
    return;
  }
  if (kind === 'gate') {
    box(root, 0x52535d, 0, .16, 0, 2.36, .32, 2.36);
    box(root, 0x6c707b, 0, 1.25, 0, 2.43, .17, 2.43);
    for (const i of [-2, -1, 0, 1, 2]) for (const side of [-1, 1]) {
      box(root, tint, i * .44, .74, side * 1.10, .13, 1.04, .13);
      box(root, tint, side * 1.10, .74, i * .44, .13, 1.04, .13);
    }
    return;
  }
  box(root, 0x78543d, 0, .21, 0, 1.79, .42, 1.79);
  box(root, 0xad7852, 0, .44, 0, 1.52, .13, 1.49);
  tube(root, 0x545663, 0, .72, 0, .48, .53).rotation.z = Math.PI / 2;
  const turret = new THREE.Group();
  turret.position.y = .83;
  root.add(turret);
  tube(turret, tint, 0, 0, .25, .27, 1.49).rotation.x = Math.PI / 2;
  for (const z of [-.35, .44, .84]) tube(turret, 0x3e414c, 0, 0, z, .30, .12).rotation.x = Math.PI / 2;
  tube(turret, 0x242630, 0, 0, .91, .19, .045).rotation.x = Math.PI / 2;
  return turret;
}
