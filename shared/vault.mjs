import { rigFor } from './rigs.mjs';

export const VAULT_WIDTH = 5;
export const VAULT_ENTRANCE = 22;
export const RAID_MOVES = 10;
export const raidMoveLimit = rig => RAID_MOVES + (rigFor(rig).raidMoves ?? 0);
const TILES = VAULT_WIDTH ** 2;
const SHOT_RANGE = 3;

function tile(index) {
  return Number.isInteger(index) && index >= 0 && index < TILES;
}

export function adjacent(a, b) {
  return tile(a) && tile(b) && Math.abs(a % VAULT_WIDTH - b % VAULT_WIDTH)
    + Math.abs(Math.floor(a / VAULT_WIDTH) - Math.floor(b / VAULT_WIDTH)) === 1;
}

export function cannonCoverage({ cannon, barricades }) {
  const covered = new Set();
  for (const step of [-VAULT_WIDTH, -1, 1, VAULT_WIDTH]) {
    let cell = cannon;
    for (let distance = 1; distance <= SHOT_RANGE; distance++) {
      const next = cell + step;
      if (!adjacent(cell, next) || barricades.includes(next)) break;
      covered.add(next);
      cell = next;
    }
  }
  return covered;
}

export function validDefense(defense) {
  if (!defense || !Array.isArray(defense.barricades) || defense.barricades.length > 2) return false;
  const { cannon, chest, barricades } = defense;
  const occupied = [VAULT_ENTRANCE, cannon, chest, ...barricades];
  if (!occupied.every(tile) || new Set(occupied).size !== occupied.length) return false;

  const danger = cannonCoverage(defense);
  const queue = [{ cell: VAULT_ENTRANCE, hits: 0, moves: 0 }];
  const seen = new Set();
  for (const { cell, hits, moves } of queue) {
    if (cell === chest) return true;
    if (moves === RAID_MOVES) continue;
    for (const next of [cell - VAULT_WIDTH, cell - 1, cell + 1, cell + VAULT_WIDTH]) {
      if (!adjacent(cell, next) || next === cannon || barricades.includes(next)) continue;
      const nextHits = hits + Number(danger.has(next));
      const key = next * 2 + nextHits;
      if (nextHits >= 2 || seen.has(key)) continue;
      seen.add(key);
      queue.push({ cell: next, hits: nextHits, moves: moves + 1 });
    }
  }
  return false;
}

export function traceRaid(defense, path, rig) {
  if (!Array.isArray(path) || !path.length || path.length > raidMoveLimit(rig) + 1 || path[0] !== VAULT_ENTRANCE) return null;
  const { breach: canBreach, armor = 0 } = rigFor(rig);
  let danger = cannonCoverage(defense);
  let hits = 0;
  let breach = null;
  let stoppedAt = null;
  for (let index = 1; index < path.length; index++) {
    const cell = path[index];
    const previous = path[index - 1];
    if (!adjacent(previous, cell) || previous === defense.chest || cell === defense.cannon) return null;
    if (defense.barricades.includes(cell) && cell !== breach) {
      if (!canBreach || breach !== null) return null;
      breach = cell;
      danger = cannonCoverage({ ...defense, barricades: defense.barricades.filter(tile => tile !== breach) });
    }
    if (danger.has(cell)) {
      hits++;
      if (hits === 2 + armor) stoppedAt = index;
    }
  }
  return { hits: Math.min(2, Math.max(0, hits - armor)), breach, danger, stoppedAt };
}

export function evaluateRoute(defense, path, rig) {
  if (!Array.isArray(path) || path.length < 2 || path.at(-1) !== defense.chest) return null;
  const trace = traceRaid(defense, path, rig);
  return trace ? { won: trace.hits < 2, hits: trace.hits } : null;
}
