import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createMatch, stepMatch } from '../shared/simulation.mjs';
import { BARREL_COLLIDER_RADIUS } from '../shared/contact-geometry.mjs';
import { powderFlightHeight } from '../shared/arena-hazards.mjs';

// CPU-only stress audit: this measures simulation, never GPU/rendered FPS.
const rates = (process.env.AFLOAT_AUDIT_RATES ?? '30').split(',').map(Number);
assert.ok(rates.every(rate => Number.isFinite(rate) && rate >= 10 && rate <= 240));
const results = [];
for (const rate of rates) {
  const result = { rate, matches: 0, winners: 0, invalid: 0, overlapFrames: 0, maxPenetration: 0, ticks: 0 };
  const start = performance.now();
  for (const count of [2, 6, 8]) for (let seed = 0; seed < 120; seed++) {
    const roster = Array.from({ length: count }, (_, slot) => ({ id: 'audit-' + slot, slot, bot: true, rig: ['oak', 'iron', 'cork'][slot % 3] }));
    const match = createMatch(roster, 'audit/' + seed);
    for (let tick = 0; match.phase !== 'results' && tick < 60 * rate; tick++) {
      stepMatch(match, 1 / rate); result.ticks++;
      const alive = match.players.filter(p => p.alive && !p.grab);
      let overlap = false;
      for (const p of alive) if (![p.x, p.z, p.vx, p.vz].every(Number.isFinite)) result.invalid++;
      for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
        const height = powderFlightHeight(alive[i].powderHop, match.elapsed) - powderFlightHeight(alive[j].powderHop, match.elapsed);
        const depth = BARREL_COLLIDER_RADIUS * 2 - Math.hypot(alive[i].x - alive[j].x, alive[i].z - alive[j].z, height);
        result.maxPenetration = Math.max(result.maxPenetration, depth);
        if (depth > .02) overlap = true;
      }
      if (overlap) result.overlapFrames++;
    }
    result.matches++;
    if (match.phase === 'results' && match.players.filter(p => p.alive).length === 1 && match.winnerId) result.winners++;
  }
  result.elapsedMs = performance.now() - start;
  results.push(result);
}
console.log(JSON.stringify(results, null, 2));
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(results, null, 2));
assert.ok(results.every(r => r.winners === r.matches && !r.invalid && !r.overlapFrames), 'Arena audit failed');
