import { createMatch } from './simulation.mjs';
import { hazardTiming, placeArenaHazard } from './arena-hazards.mjs';
import { createExperimentalTrap, EXPERIMENTAL_TRAPS, turnCrane } from './experimental-traps.mjs';

export function createTrapTrial(kind, { scale = 1, offset = 0, multiple = false, fleet = false,
  heading = 0, warning = 1, reach = 1, count = null, approachSpeed = 1, fuse = null, tilt = null } = {}) {
  const roster = Array.from({ length: 4 }, (_, slot) => ({ id: 'target-' + slot, name: slot ? 'Target ' + slot : 'You', slot }));
  const match = createMatch(roster, 4211);
  match.phase = 'playing';
  match.arenaMap = 'harbor';
  match.adaptiveTide = false;
  match.tideSchedule = [[0, 9], [200, 9], [500, 9]];
  match.hazardPlan = [];
  match.labKnockbackScale = scale;
  let first = true;
  match.placedTrap = EXPERIMENTAL_TRAPS.has(kind) ? createExperimentalTrap(kind) : null;
  if (match.placedTrap) {
    if (kind === 'seesaw' && tilt !== null) match.placedTrap.tiltX = tilt;
    for (const key of ['anchors', 'crates']) {
      if (!match.placedTrap[key]) continue;
      if (count !== null) match.placedTrap[key] = match.placedTrap[key].slice(0, count);
      for (const crane of match.placedTrap[key]) crane.turnRate *= approachSpeed;
    }
  } else {
    const timing = hazardTiming(kind, .25);
    const delay = (timing.fireAt - timing.warnAt) * (warning - 1);
    for (const key of ['fireAt', 'end', 'exit']) timing[key] += delay;
    match.hazard = placeArenaHazard(timing, 9, () => {
      if (first) { first = false; return heading / 360; }
      return .5;
    });
    const hazard = match.hazard;
    if (hazard.lanes) {
      const limit = count ?? (kind === 'barrel-roll' || fleet ? hazard.lanes.length : 1);
      hazard.lanes = hazard.lanes.slice(0, limit);
      hazard.end = Math.max(...hazard.lanes.map(lane => lane.end));
      if (hazard.lanes.every(lane => lane.exit !== undefined)) hazard.exit = Math.max(...hazard.lanes.map(lane => lane.exit));
      for (const lane of hazard.lanes) lane.width *= reach;
    } else if (hazard.drops) {
      if (count !== null) hazard.drops = hazard.drops.slice(0, count);
      for (const drop of hazard.drops) if (fuse !== null) drop.labFuse = fuse;
    } else hazard.width *= reach;
  }
  if (['powder', 'collapse', 'anchor-drop'].includes(kind)) {
    match.hazard.x = match.hazard.z = 0;
  }

  const positions = multiple && ['powder', 'collapse'].includes(kind)
    ? [[.7, offset], [-.7, offset], [0, 1.4 + offset], [0, 5.7]]
    : multiple ? [[-4, offset], [0, offset], [4, offset], [0, 4.2]]
    : [[kind === 'powder' ? .7 : 0, offset], [-4.5, 3.7], [4.5, -3.7], [0, 5.7]];
  for (const [i, [x, z]] of positions.entries()) {
    Object.assign(match.players[i], { x, z, angle: Math.PI / 2 });
  }
  if (kind === 'crate-drop') {
    const target = match.hazard.drops[0];
    Object.assign(match.players[0], { x: target.x, z: target.z + offset });
  }
  if (kind === 'anchor') {
    const setups = [[-2.65, offset, 7.4], [2.32, 0, 0], [-4.5, 5.5, 0], [5.6, 3.3, 0]];
    if (multiple) setups[2] = [3.9, .3, 0];
    for (const [i, [x, z, vx]] of setups.entries()) Object.assign(match.players[i], { x, z, vx });
  }
  if (kind === 'crate') {
    const [center, left, right] = match.placedTrap.crates.map(crate => {
      const target = { ...crate };
      turnCrane(target, 0, target.fireAt - .95);
      return target;
    });
    const setups = [[center.x, center.z + offset], [left?.x ?? -4.5, (left?.z ?? 3.8) - (multiple ? 0 : 2.05)],
      [right?.x ?? 4.5, (right?.z ?? -3.8) + (multiple ? 0 : 2.05)], [0, 5.7]];
    for (const [i, [x, z]] of setups.entries()) Object.assign(match.players[i], { x, z });
  }
  if (kind === 'seesaw') {
    const loads = multiple ? [[3, 2 + offset], [4.5, .6], [2.2, 4.7], [-3, -1]] : [[2.4, offset], [-4, -2.5], [4, 2.5], [0, -4]];
    for (const [i, [x, z]] of loads.entries()) Object.assign(match.players[i], { x, z });
  }
  return match;
}
