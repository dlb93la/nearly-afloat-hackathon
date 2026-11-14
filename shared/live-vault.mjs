import { rigFor } from './rigs.mjs';
import { moveBarrel } from './simulation.mjs';

export const FORT_COLUMNS = 13;
export const FORT_ROWS = 19;
export const FORT_TILE = 2.55;
export const FORT_CELLS = FORT_COLUMNS * FORT_ROWS;
export const FORT_ENTRY = (FORT_ROWS - 1) * FORT_COLUMNS + 6;
const DEFAULT_CHEST = 19;
const TIME_LIMIT = 82;
const MAX_PIECES = 68;

export const FORT_PIECES = Object.freeze({
  wall: { name: 'Barricade', glyph: '▦', color: 0x955b40, hint: 'Stops barrels. A breaching rig can break one at speed.' },
  pit: { name: 'Broken deck', glyph: '≈', color: 0x136981, hint: 'Drops the barrel into the sea.' },
  cannon: { name: 'Cannon', glyph: '✷', color: 0x6d637a, hint: 'Fires in a cross when the warning tiles light up.' },
  gull: { name: 'Dive gull', glyph: '⌁', color: 0xd6d8e2, hint: 'Swoops across its tile in bursts and knocks barrels sideways.' },
  parrot: { name: 'Lift parrots', glyph: '↑', color: 0x43bd86, hint: 'Carry a barrel two tiles north, even across a gap.' },
  spikes: { name: 'Spring spikes', glyph: '▲', color: 0xad6372, hint: 'Rise and retract on a timer.' },
  powder: { name: 'Powder charge', glyph: '✹', color: 0xeb7852, hint: 'Fuses on approach, then blasts the tile once.' },
  tide: { name: 'Sea jet', glyph: '»', color: 0x43a9bb, hint: 'Pushes barrels east across the deck.' },
  plate: { name: 'Pressure plate', glyph: '◉', color: 0xf4c66f, hint: 'Roll over it to open every linked gate for this run.' },
  gate: { name: 'Iron gate', glyph: '╫', color: 0x8d97ae, hint: 'Blocks passage until a pressure plate is pressed.' },
  anchor: { name: 'Mooring bell', glyph: '⚓', color: 0x75d6c2, hint: 'Checkpoint. Falls return you here with one less heart.' },
});

const index = (column, row) => row * FORT_COLUMNS + column;
const inBounds = cell => Number.isInteger(cell) && cell >= 0 && cell < FORT_CELLS;
const solid = kind => kind === 'wall' || kind === 'gate' || kind === 'cannon';
const danger = new Set(['pit', 'gull', 'spikes', 'powder', 'tide']);
const timed = new Set(['cannon', 'gull', 'spikes']);
export const fortCellCenter = cell => ({
  x: (cell % FORT_COLUMNS + .5 - FORT_COLUMNS / 2) * FORT_TILE,
  z: (Math.floor(cell / FORT_COLUMNS) + .5 - FORT_ROWS / 2) * FORT_TILE,
});

function cellAt(x, z) {
  const column = Math.floor(x / FORT_TILE + FORT_COLUMNS / 2);
  const row = Math.floor(z / FORT_TILE + FORT_ROWS / 2);
  return column >= 0 && column < FORT_COLUMNS && row >= 0 && row < FORT_ROWS ? index(column, row) : -1;
}

function neighbors(cell) {
  const column = cell % FORT_COLUMNS;
  return [cell - FORT_COLUMNS, cell + FORT_COLUMNS, column > 0 ? cell - 1 : -1,
    column < FORT_COLUMNS - 1 ? cell + 1 : -1].filter(inBounds);
}

export function cannonLanes(cell, pieces) {
  const result = [];
  const { x, z } = fortCellCenter(cell);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let i = 1; i <= 2; i++) {
      const next = cellAt(x + dx * i * FORT_TILE, z + dz * i * FORT_TILE);
      if (next === -1 || solid(pieces.get(next))) break;
      result.push(next);
    }
  }
  return result;
}

export function certifiedRoute(map) {
  if (!map || map.layout !== 'live' || !inBounds(map.chest) || Math.floor(map.chest / FORT_COLUMNS) > 5
    || !Array.isArray(map.pieces) || map.pieces.length > MAX_PIECES) return null;
  const pieces = new Map();
  let cannons = 0;
  for (const piece of map.pieces) {
    if (!piece || !inBounds(piece.cell) || piece.cell === map.chest || piece.cell === FORT_ENTRY
      || pieces.has(piece.cell) || !Object.hasOwn(FORT_PIECES, piece.kind)) return null;
    if (piece.kind === 'cannon' && ++cannons > 6) return null;
    pieces.set(piece.cell, piece.kind);
  }
  const fire = new Set([...pieces].flatMap(([cell, kind]) => kind === 'cannon' ? cannonLanes(cell, pieces) : []));
  if (fire.has(FORT_ENTRY)) return null;
  for (const [cell, kind] of pieces) {
    if (kind !== 'parrot') continue;
    const landing = cell - FORT_COLUMNS * 2;
    if (!inBounds(landing) || solid(pieces.get(landing)) || pieces.get(landing) === 'pit') return null;
  }
  const passable = (cell, opened) => inBounds(cell) && !fire.has(cell) && !danger.has(pieces.get(cell))
    && (!solid(pieces.get(cell)) || (opened && pieces.get(cell) === 'gate'));
  const queue = [{ cell: FORT_ENTRY, opened: false, path: [FORT_ENTRY] }];
  const seen = new Set([FORT_ENTRY * 2]);
  for (const { cell, opened, path } of queue) {
    if (cell === map.chest) return verifyOakRoute(map, path) ? path : null;
    // Keep a generous time margin for a new player using the basic oak barrel.
    if (path.length >= 54) continue;
    const lift = pieces.get(cell) === 'parrot';
    for (const next of lift ? [cell - FORT_COLUMNS * 2] : neighbors(cell)) {
      if (!passable(next, opened)) continue;
      const active = opened || pieces.get(next) === 'plate';
      const key = next * 2 + Number(active);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ cell: next, opened: active, path: [...path, next] });
    }
  }
  return null;
}

const row = (y, columns, kind) => columns.map(x => [x, y, kind]);
const createMap = entries => ({ layout: 'live', chest: DEFAULT_CHEST,
  pieces: entries.map(([x, y, kind]) => ({ cell: index(x, y), kind })) });

export const FORT_PRESETS = {
  dock: { label: 'Cannon Alley', map: createMap([
    ...row(14, [2, 3, 4, 8, 9, 10], 'wall'), ...row(10, [1, 2, 3, 9, 10, 11], 'pit'),
    [6, 15, 'anchor'], [5, 12, 'powder'], [7, 12, 'tide'], [3, 8, 'cannon'],
    [9, 8, 'cannon'], [4, 5, 'gull'], [8, 5, 'spikes'], [6, 6, 'anchor'],
  ]) },
  rookery: { label: 'Parrot Pass', map: createMap([
    ...row(9, Array.from({ length: FORT_COLUMNS }, (_, i) => i), 'pit'),
    [6, 10, 'parrot'], [6, 11, 'anchor'], [4, 12, 'gull'], [8, 13, 'gull'],
    [3, 7, 'tide'], [9, 7, 'spikes'], [7, 6, 'powder'], [3, 5, 'cannon'],
  ]) },
  lock: { label: 'Smuggler’s Lock', map: createMap([
    ...row(8, [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12], 'wall'), [6, 8, 'gate'],
    [10, 11, 'plate'], [6, 12, 'anchor'], ...row(11, [5, 6, 7], 'spikes'),
    [8, 10, 'gull'], [3, 6, 'cannon'], [10, 4, 'powder'], [4, 4, 'tide'],
  ]) },
};

export function liveFort(defense) {
  if (defense?.layout === 'live') return defense;
  if (!Array.isArray(defense?.barricades) || (defense.chest === 2 && defense.cannon === 8 && defense.barricades.length === 0)) {
    return FORT_PRESETS.dock.map;
  }
  const translate = cell => index(2 + (cell % 5) * 2, 2 + Math.floor(cell / 5) * 3);
  const migrated = {
    layout: 'live', chest: index(2 + (defense.chest % 5) * 2, 1 + Math.floor(defense.chest / 5)),
    pieces: [{ cell: translate(defense.cannon), kind: 'cannon' },
      ...defense.barricades.map(cell => ({ cell: translate(cell), kind: 'wall' }))],
  };
  return certifiedRoute(migrated) ? migrated : FORT_PRESETS.dock.map;
}

function trapPattern(cell, seed) {
  const mixed = Math.imul((seed ^ Math.imul(cell + 1, 0x9e3779b1)) >>> 0, 0x85ebca6b);
  return (mixed ^ (mixed >>> 13)) >>> 0;
}

export function trapPhase(time, cell, seed = 0) {
  return (time + (seed ? trapPattern(cell, seed) % 310 / 100 : (cell % 7) * .31)) % 3.1;
}

export function gullPosition(cell, time, seed = 0) {
  const { x, z } = fortCellCenter(cell);
  const pattern = trapPattern(cell, seed);
  const vertical = Boolean(seed && (pattern & 1));
  const swing = Math.sin(trapPhase(time, cell, seed) * 3.7) * (pattern & 2 ? -.83 : .83);
  return { x: x + (vertical ? 0 : swing), z: z + (vertical ? swing : 0), vertical };
}

export function createFortRun(map, rig = 'oak', appearance = null, seed = 0) {
  const profile = rigFor(rig);
  const pieces = new Map(map.pieces.map(({ cell, kind }) => [cell, kind]));
  const clocked = [...pieces].filter(([, kind]) => timed.has(kind))
    .map(([cell, kind]) => ({ cell, kind, lanes: kind === 'cannon' ? new Set(cannonLanes(cell, pieces)) : null }));
  return {
    map, pieces, clocked, rig, appearance, seed, time: 0, limit: TIME_LIMIT + (profile.raidMoves ?? 0) * 4,
    player: { ...fortCellCenter(FORT_ENTRY), vx: 0, vz: 0, angle: Math.PI, profile },
    hearts: 3, armor: profile.armor ?? 0, opened: false, checkpoint: FORT_ENTRY, breach: null,
    immuneUntil: 0, lift: null, powder: new Map(), status: 'running', event: '', eventAt: 0,
  };
}

function signal(run, event) {
  run.event = event;
  run.eventAt = run.time;
}

function hit(run, kind, x, z) {
  if (kind !== 'fall' && run.time < run.immuneUntil) return;
  run.immuneUntil = run.time + 1.2;
  if (kind !== 'fall' && run.armor) {
    run.armor--;
    signal(run, 'Shield blocked a hit');
    return;
  }
  run.hearts--;
  signal(run, kind === 'fall' ? 'Overboard!' : kind);
  if (run.hearts <= 0) {
    run.status = 'failed';
    return;
  }
  if (kind === 'fall') {
    Object.assign(run.player, fortCellCenter(run.checkpoint), { vx: 0, vz: 0 });
  } else {
    run.player.vx += x;
    run.player.vz += z;
    run.player.recoilUntil = run.time + .28;
  }
}

function blocked(run, x, z) {
  const cell = cellAt(x, z);
  const kind = run.pieces.get(cell);
  if (kind === 'wall' && cell === run.breach) return false;
  if (kind === 'gate' && run.opened) return false;
  if (kind === 'wall' && run.player.profile.breach && run.breach === null
    && Math.hypot(run.player.vx, run.player.vz) > 3.3) {
    run.breach = cell;
    signal(run, 'Barricade smashed');
    return false;
  }
  return solid(kind);
}

export function stepFortRun(run, dt, input) {
  if (run.status !== 'running') return;
  run.time += dt;
  if (run.time >= run.limit) {
    run.status = 'failed';
    signal(run, 'Time ran out');
    return;
  }
  const p = run.player;
  if (run.lift) {
    const t = Math.min(1, (run.time - run.lift.at) / .95);
    const { from, to } = run.lift;
    p.x = from.x + (to.x - from.x) * t;
    p.z = from.z + (to.z - from.z) * t;
    if (t < 1) return;
    run.lift = null;
    p.vx = p.vz = 0;
    run.immuneUntil = run.time + .45;
  }
  const x = p.x;
  const z = p.z;
  moveBarrel(p, input, dt, run.time);
  const radius = .45;
  if (blocked(run, p.x + Math.sign(p.x - x) * radius, z)) {
    p.x = x;
    p.vx *= -.37;
  }
  if (blocked(run, p.x, p.z + Math.sign(p.z - z) * radius)) {
    p.z = z;
    p.vz *= -.37;
  }
  const cell = cellAt(p.x, p.z);
  const kind = run.pieces.get(cell);
  if (cell === -1 || kind === 'pit') {
    hit(run, 'fall');
    return;
  }
  if (cell === run.map.chest) {
    run.status = 'won';
    signal(run, 'Treasure secured!');
    return;
  }
  if (kind === 'anchor' && run.checkpoint !== cell) {
    run.checkpoint = cell;
    signal(run, 'Mooring checkpoint');
  }
  if (kind === 'plate' && !run.opened) {
    run.opened = true;
    signal(run, 'Iron gates unlocked');
  }
  if (kind === 'parrot' && inBounds(cell - FORT_COLUMNS * 2)) {
    run.lift = { at: run.time, from: { x: p.x, z: p.z }, to: fortCellCenter(cell - FORT_COLUMNS * 2) };
    signal(run, 'Parrot express!');
    return;
  }
  if (kind === 'tide') p.vx = Math.min(10, p.vx + 16 * dt);
  if (kind === 'powder' && !run.powder.has(cell)) run.powder.set(cell, run.time);
  for (const [charge, at] of run.powder) {
    if (run.time - at >= .7 && run.time - at < .7 + dt && charge === cell) hit(run, 'Powder blast', 4, 4);
  }
  for (const { cell: trap, kind: type, lanes } of run.clocked) {
    const phase = trapPhase(run.time, trap, run.seed);
    if (phase < 1.5 || phase > 1.91) continue;
    if (lanes?.has(cell)) hit(run, 'Cannon hit', 3.5, 4);
    if (type === 'spikes' && trap === cell) hit(run, 'Spring spikes', 0, 4);
    if (type === 'gull' && trap === cell) {
      const gull = gullPosition(trap, run.time, run.seed);
      if (Math.hypot(p.x - gull.x, p.z - gull.z) < .9) {
        hit(run, 'Gull strike', gull.vertical ? 0 : Math.sign(gull.x - p.x || 1) * -5.8,
          gull.vertical ? Math.sign(gull.z - p.z || 1) * -5.8 : 0);
      }
    }
  }
}

export function readFortRun(run) {
  const { x, z, vx, vz, angle } = run.player;
  const lift = run.lift ? Math.sin(Math.PI * Math.min(1, (run.time - run.lift.at) / .95)) : 0;
  return {
    x, z, vx, vz, angle, lift, time: run.time, seconds: Math.max(0, Math.ceil(run.limit - run.time)),
    hearts: run.hearts, armor: run.armor, opened: run.opened, breach: run.breach,
    checkpoint: run.checkpoint, powder: [...run.powder], status: run.status,
    event: run.status !== 'running' || run.time - run.eventAt < 2 ? run.event : '',
  };
}

// Certify a continuous run using the same movement, collisions and traps as a real raid.
function verifyOakRoute(map, path) {
  const run = createFortRun(map);
  const still = { x: 0, z: 0 };
  let waypoint = 1;
  let lifting = false;
  while (run.status === 'running' && run.hearts === 3 && run.time < run.limit * .75) {
    if (run.lift) {
      if (!lifting && path[waypoint + 1] === path[waypoint] - FORT_COLUMNS * 2) waypoint++;
      lifting = true;
      stepFortRun(run, 1 / 30, still);
      continue;
    }
    lifting = false;
    const player = run.player;
    let { x, z } = fortCellCenter(path[waypoint]);
    if (waypoint < path.length - 1 && Math.hypot(x - player.x, z - player.z) < .29) {
      ({ x, z } = fortCellCenter(path[++waypoint]));
    }
    const dx = (x - player.x) * 2.8 - player.vx * .45;
    const dz = (z - player.z) * 2.8 - player.vz * .45;
    const length = Math.max(1, Math.hypot(dx, dz));
    stepFortRun(run, 1 / 30, { x: dx / length, z: dz / length });
  }
  return run.status === 'won';
}
