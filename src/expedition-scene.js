import { Group, MathUtils } from 'three';

export function decorateExpeditionOffice(office, { block, planks, flag, batchBlocks }) {
  office.name = 'Expeditions';
  const blue = 0x426b87;
  const blueLight = 0x6192a7;
  const blueDark = 0x324f67;
  const frame = 0x6b4c3b;
  const brass = 0xc8975d;
  block(office, 0x8d6950, 0, 1.18, -.10, 3.52, 1.95, 2.82);
  for (let row = 0; row < 6; row++) {
    block(office, row % 2 ? blueDark : blue, 0, 2.22 + row * .16, -.12, 4.08 - row * .54, .18, 3.43);
  }
  block(office, blueLight, 0, 3.14, -.10, 1.31, .12, 3.48);
  block(office, frame, 0, .96, 1.35, 1.06, 1.48, .16);
  block(office, 0x4c3831, 0, .94, 1.44, .84, 1.34, .10);
  block(office, brass, .23, .90, 1.51, .08, .09, .055);
  block(office, planks, 0, .26, 1.70, 1.14, .16, .54);
  for (const side of [-1, 1]) {
    const x = side * 1.20;
    block(office, frame, x, 1.22, 1.38, .75, .67, .15);
    block(office, 0xf3c47c, x, 1.22, 1.47, .54, .45, .07);
    block(office, blueDark, x, 1.22, 1.52, .065, .49, .041);
    block(office, brass, x, .91, 1.52, .79, .075, .26);
  }
  for (const side of [-1, 1]) {
    block(office, frame, 1.75, 1.06, side * .99, .12, 1.78, .15);
    block(office, frame, side * 1.2, 2.95, 1.57, .15, 2.43, .18);
  }
  for (const [x, y, z, w, h] of [[-1.72, .39, 1.66, .55, .40], [-1.69, .67, 1.67, .37, .21], [1.58, .40, -.79, .53, .39]]) {
    block(office, 0xa87a4e, x, y, z, w, h, .46);
    block(office, frame, x, y, z + .235, w * .14, h, .045);
  }
  block(office, frame, 1.43, 2.57, -.83, .16, 2.87, .16);
  block(office, frame, 1.43, 3.89, -.08, .15, .18, 1.72);
  block(office, brass, 1.43, 3.89, .73, .23, .24, .24);
  block(office, frame, 1.43, 3.34, .73, .043, 1.02, .043);
  block(office, brass, 1.43, 2.82, .73, .12, .16, .13);
  flag(office, -1.08, 2.91, -.66, 0x337170, 'expeditions');
  batchBlocks(office);
}

export function createExpeditionVoyage(boat, dock, block, batchBlocks) {
  boat.name = 'Expedition ship';
  const cargo = new Group();
  cargo.position.set(0, 1.14, -1.72);
  boat.add(cargo);
  block(cargo, 0x76513d, 0, 0, 0, .96, .49, .76);
  block(cargo, 0xac754b, 0, .25, 0, .99, .12, .79);
  for (const x of [-.30, .30]) block(cargo, 0xdbad65, x, .06, 0, .10, .55, .80);
  block(cargo, 0xeac36a, 0, .09, .403, .16, .18, .06);
  batchBlocks(cargo);

  return (time, now, campaign, viewHalfWidth) => {
    const { status, departedAt, arrivalAt } = campaign ?? {};
    const sailing = status === 'sailing' && Number.isFinite(departedAt) && arrivalAt > departedAt;
    let distance = 0;
    let returning = Boolean(arrivalAt && now >= arrivalAt);
    boat.visible = true;
    if (sailing) {
      const crossing = Math.min(6500, (arrivalAt - departedAt) / 3);
      const departure = MathUtils.smoothstep(now - departedAt, 0, crossing);
      const arrival = MathUtils.smoothstep(arrivalAt - now, 0, crossing);
      distance = Math.min(departure, arrival);
      returning ||= arrival < departure;
      boat.visible = distance < 1;
    }
    cargo.visible = status === 'auction' || (sailing && returning);
    const runout = Math.max(38, viewHalfWidth * 1.1);
    const turn = Math.max(0, (distance - .62) / .38);
    const fairway = MathUtils.smoothstep(distance, 0, .34);
    const channelOffset = MathUtils.lerp(2.6, 1.22, MathUtils.smoothstep(-dock.position.z, .6, 10.1));
    boat.position.x = dock.position.x - 3.68 + channelOffset * fairway - runout * turn ** 2;
    boat.position.z = dock.position.z + 10.50 + 34 * distance;
    const progress = Math.min(distance / .34, 1);
    const fairwayTangent = channelOffset * 6 * progress * (1 - progress) / .34;
    boat.rotation.y = Math.atan2(fairwayTangent - 2 * runout * turn / .38, 34) + (returning ? Math.PI : 0);
    boat.position.y = -.86 + Math.sin(time * 1.15) * .11;
    boat.rotation.x = Math.sin(time * 1.01) * .044;
    boat.rotation.z = Math.sin(time * 1.41) * .054;
  };
}
