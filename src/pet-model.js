import * as THREE from 'three';

export function buildPetModel(root, pet, block) {
  const color = pet.color;
  const dark = new THREE.Color(color).multiplyScalar(.57).getHex();
  const light = new THREE.Color(color).lerp(new THREE.Color(0xffe5bd), .36).getHex();
  const trim = pet.trim ?? light;
  const ink = 0x282530;
  const ivory = 0xffeacb;
  const part = (c, x, y, z, w, h, d) => block(root, c, x, y, z, w, h, d);
  const eyes = (x, y, z) => {
    for (const side of [-1, 1]) {
      part(ivory, side * x, y, z, .058, .065, .025);
      part(ink, side * x + .008, y, z + .018, .029, .043, .017);
    }
  };
  switch (pet.species) {
    case 'parrot':
      part(color, 0, .16, 0, .24, .26, .29);
      part(light, 0, .18, .135, .16, .20, .07);
      part(color, 0, .33, .075, .20, .16, .20);
      part(trim, -.036, .427, .03, .11, .045, .13);
      part(0xe6a449, 0, .305, .202, .094, .073, .11);
      part(0xa76437, 0, .278, .24, .066, .049, .05);
      eyes(.061, .35, .176);
      for (const side of [-1, 1]) {
        part(dark, side * .124, .172, -.029, .086, .19, .245);
        part(trim, side * .162, .123, -.084, .043, .13, .17);
        part(0xc89053, side * .064, .025, .094, .072, .05, .14);
      }
      part(trim, 0, .083, -.206, .11, .075, .24).rotation.x = -.40;
      break;
    case 'crab':
      part(color, 0, .116, 0, .29, .17, .27);
      part(light, 0, .206, -.005, .23, .05, .20);
      for (const side of [-1, 1]) {
        part(dark, side * .106, .211, .11, .039, .118, .044);
        part(color, side * .25, .115, .12, .19, .10, .12).rotation.y = -side * .28;
        part(light, side * .304, .136, .213, .076, .11, .094);
        part(dark, side * .218, .109, .211, .049, .071, .084);
        for (const z of [-.11, -.022, .056]) part(dark, side * .164, .044, z, .142, .057, .042).rotation.z = side * .24;
      }
      eyes(.103, .248, .129);
      break;
    case 'octopus':
      part(dark, 0, .091, 0, .24, .13, .24);
      part(color, 0, .205, .004, .257, .227, .251);
      part(light, 0, .31, -.01, .192, .069, .185);
      eyes(.068, .209, .132);
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4;
        const x = Math.cos(angle), z = Math.sin(angle);
        part(i % 2 ? color : dark, x * .143, .056, z * .143, .154, .082, .066).rotation.y = -angle;
        part(trim, x * .214, .061, z * .214, .061, .094, .061);
      }
      break;
    case 'cat':
    case 'rat': {
      const cat = pet.species === 'cat';
      part(color, 0, .124, -.055, .213, .20, .31);
      part(light, 0, .232, .09, .202, .174, .176);
      for (const side of [-1, 1]) {
        part(color, side * .074, .338, .063, .076, cat ? .112 : .085, .081).rotation.z = -side * .17;
        part(0xe7a39b, side * .074, .343, .109, .045, .052, .018);
        for (const z of [-.12, .092]) part(dark, side * .071, .029, z, .066, .058, .102);
      }
      eyes(.052, .248, .182);
      part(cat ? ivory : light, 0, .186, .188, .086, .066, .085);
      part(0xd98990, 0, .202, .234, .051, .037, .023);
      part(cat ? dark : 0xc38a86, .056, .095, -.237, .053, .055, .19).rotation.x = .33;
      part(cat ? color : 0xc38a86, .088, .169, -.31, .047, .135, .049).rotation.z = -.31;
      break;
    }
    case 'bat':
      part(color, 0, .168, 0, .186, .202, .178);
      part(light, 0, .25, .075, .188, .149, .144);
      eyes(.054, .263, .151);
      for (const side of [-1, 1]) {
        part(dark, side * .074, .353, .065, .063, .109, .063).rotation.z = -side * .26;
        part(color, side * .195, .198, .003, .24, .075, .175).rotation.z = side * .28;
        part(trim, side * .278, .225, -.022, .135, .061, .12).rotation.z = side * .55;
        part(dark, side * .229, .156, -.059, .076, .057, .15);
        part(ivory, side * .035, .194, .162, .025, .035, .024);
      }
      break;
    case 'puffer':
      part(color, 0, .197, 0, .27, .243, .266);
      part(light, 0, .108, .043, .221, .083, .22);
      part(ink, 0, .169, .145, .048, .046, .022);
      eyes(.078, .227, .136);
      part(trim, 0, .167, -.17, .073, .113, .113);
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4;
        part(light, Math.cos(angle) * .141, i % 2 ? .269 : .137, Math.sin(angle) * .13, .058, .082, .053).rotation.z = Math.cos(angle) * -.55;
      }
      part(trim, 0, .338, 0, .079, .058, .092);
      break;
    case 'skull':
      part(color, 0, .205, 0, .256, .213, .236);
      part(trim, 0, .297, -.008, .212, .046, .192);
      part(light, 0, .091, .054, .17, .089, .161);
      for (const side of [-1, 1]) {
        part(ink, side * .067, .205, .123, .065, .061, .023);
        part(color, side * .044, .118, .143, .044, .065, .028);
      }
      part(ink, 0, .159, .128, .038, .038, .027);
      break;
    case 'turtle':
      part(dark, 0, .102, -.031, .272, .108, .314);
      part(color, 0, .168, -.035, .283, .121, .296);
      part(trim, 0, .243, -.036, .203, .060, .225);
      part(dark, 0, .276, -.036, .088, .012, .092).rotation.y = Math.PI / 4;
      part(light, 0, .135, .184, .135, .117, .145);
      eyes(.043, .152, .259);
      for (const side of [-1, 1]) for (const z of [-.14, .079]) {
        part(light, side * .152, .042, z, .084, .075, .095).rotation.y = side * .25;
      }
      break;
    case 'frog':
      part(color, 0, .116, 0, .257, .168, .258);
      part(light, 0, .146, .109, .213, .116, .10);
      part(dark, 0, .131, .165, .131, .023, .022);
      for (const side of [-1, 1]) {
        part(color, side * .086, .217, .058, .104, .115, .113);
        part(dark, side * .145, .065, -.037, .126, .112, .145);
        part(trim, side * .13, .034, .118, .099, .058, .139);
      }
      eyes(.084, .234, .118);
      break;
  }
}
