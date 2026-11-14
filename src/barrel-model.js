import * as THREE from 'three';

const solid = color => new THREE.MeshLambertMaterial({ color });
function piece(parent, width, height, depth, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

export function buildBarrelModel(roll, color = 0xa26842, hoopColor = 0x3c3038) {
  const painted = solid(color);
  const dark = solid(0x3c3038);
  const cap = solid(0xc4935b);
  const capSide = solid(0x7e553f);
  const enamel = solid(0xf3e1b7);
  const brass = solid(0xdfad72);
  const hoopMaterial = solid(hoopColor);
  const accent = solid(color);
  const skull = [];
  const crests = [];
  const dimensions = [[0.5, 0.61, 0.41, -0.49], [0.61, 0.61, 0.57, 0], [0.61, 0.5, 0.41, 0.49]];
  for (const [left, right, width, x] of dimensions) {
    const stave = new THREE.Mesh(new THREE.CylinderGeometry(left, right, width, 10), [x === 0 ? painted : accent, capSide, capSide]);
    stave.rotation.z = Math.PI / 2;
    stave.position.x = x;
    roll.add(stave);
  }
  for (const x of [-0.49, 0.49]) {
    const hoop = new THREE.Mesh(new THREE.CylinderGeometry(0.603, 0.603, 0.13, 10, 1, true), hoopMaterial);
    hoop.rotation.z = Math.PI / 2;
    hoop.position.x = x;
    roll.add(hoop);
    for (let rivet = 0; rivet < 5; rivet++) {
      const angle = (rivet + 0.5) * Math.PI * 0.4;
      piece(roll, 0.065, 0.065, 0.065, brass, x, Math.cos(angle) * 0.607, Math.sin(angle) * 0.607);
    }
  }
  for (const side of [-1, 1]) {
    const end = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.03, 10), cap);
    end.rotation.z = Math.PI / 2;
    end.position.x = side * 0.704;
    roll.add(end);
    const crestX = side * 0.726;
    skull.push(piece(roll, 0.025, 0.24, 0.28, dark, crestX, 0.055, 0));
    skull.push(piece(roll, 0.025, 0.115, 0.16, dark, crestX, -0.11, 0));
    skull.push(piece(roll, 0.025, 0.054, 0.055, enamel, crestX + side * 0.018, 0.057, -0.062));
    skull.push(piece(roll, 0.025, 0.054, 0.055, enamel, crestX + side * 0.018, 0.057, 0.062));
  }

  const grain = solid(new THREE.Color(color).multiplyScalar(.59));
  for (let stave = 0; stave < 10; stave++) {
    const angle = (stave + .5) * Math.PI / 5;
    const y = Math.cos(angle), z = Math.sin(angle);
    piece(roll, .57, .015, .023, grain, 0, y * .584, z * .584).rotation.x = angle;
  }
  function setStyle(style) {
    accent.color.copy(painted.color);
    if (style?.trim) accent.color.set(style.trim);
    const mark = style?.crest;
    for (const part of skull) part.visible = !mark;
    if (mark && !crests.length) for (const side of [-1, 1]) {
      const end = new THREE.Group();
      end.position.x = side * .749;
      for (let index = 0; index < 3; index++) piece(end, .018, 1, 1, accent, 0, 0, 0);
      roll.add(end);
      crests.push(end);
    }
    for (const end of crests) {
      end.visible = Boolean(mark);
      if (!mark) continue;
      const [first, second, third] = end.children;
      for (const part of end.children) {
        part.scale.set(1, .045, .33);
        part.rotation.x = 0;
        part.position.y = 0;
      }
      third.visible = mark !== 'compass';
      if (mark === 'anchor') {
        first.rotation.x = Math.PI / 2;
        first.scale.z = .48;
        second.position.y = -.15;
        second.scale.z = .35;
        third.position.y = .17;
        third.scale.z = .22;
      } else if (mark === 'heart') {
        first.rotation.x = -.55;
        first.position.z = -.09;
        second.rotation.x = .55;
        second.position.z = .09;
        third.visible = false;
        first.scale.y = second.scale.y = .12;
      } else if (mark === 'crossbones') {
        first.rotation.x = -.65;
        second.rotation.x = .65;
        first.scale.z = second.scale.z = .49;
        third.visible = false;
      } else if (mark === 'wave') {
        first.position.y = -.105;
        third.position.y = .105;
        second.scale.z = .23;
      } else {
        second.rotation.x = Math.PI / 2;
        third.rotation.x = Math.PI / 4;
        if (mark === 'compass') first.rotation.x = -Math.PI / 4;
      }
    }
  }
  return { painted, hoopMaterial, grain, setStyle };
}
