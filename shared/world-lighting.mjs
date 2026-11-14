const BAY_CYCLE_MS = 8 * 60 * 1000;

// A shared clock keeps the bay on the same cycle after a reload or a match.
export function bayDarkness(now = Date.now()) {
  const phase = (now % BAY_CYCLE_MS + BAY_CYCLE_MS) % BAY_CYCLE_MS / BAY_CYCLE_MS;
  const twilight = Math.max(0, Math.min(1, (.19 - Math.cos(phase * Math.PI * 2)) / .38));
  return twilight * twilight * (3 - 2 * twilight);
}
