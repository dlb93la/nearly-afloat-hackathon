import * as THREE from 'three';

export function buildPirateBird(root, box, { body, wings, chest, tail = wings, beak = 0xf5ad49 }) {
  const model = new THREE.Group();
  root.add(model);
  box(model, body, 0, 0, 0, .34, .29, .54);
  box(model, chest, 0, -.042, -.16, .24, .23, .26);
  box(model, body, 0, .14, -.26, .31, .29, .28);
  box(model, chest, 0, .21, -.37, .29, .14, .08);
  box(model, beak, 0, .13, -.45, .145, .12, .17);
  box(model, 0xa56b41, 0, .071, -.49, .10, .075, .10);
  for (const side of [-1, 1]) {
    box(model, 0x2e2630, side * .159, .175, -.30, .025, .064, .070);
    box(model, beak, side * .095, -.17, .016, .065, .065, .14);
    box(model, tail, side * .066, -.06, .35, .12, .08, .38).rotation.y = side * .14;
  }
  const wingRoots = [-1, 1].map(side => {
    const wing = new THREE.Group();
    wing.position.set(side * .14, .025, -.045);
    model.add(wing);
    box(wing, body, side * .125, 0, 0, .26, .083, .31);
    for (let i = 0; i < 4; i++) {
      box(wing, i < 2 ? wings : tail, side * (.21 + i * .086), -.025, .056 + i * .046,
        .13, .055, .32 - i * .035).rotation.y = -side * .23;
    }
    return wing;
  });
  return { model, wings: wingRoots };
}

export function flapBird(bird, time, amplitude = .68) {
  for (const [index, wing] of bird.wings.entries()) {
    wing.rotation.z = Math.sin(time) * (index ? 1 : -1) * amplitude;
  }
}
