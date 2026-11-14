export function crowdReaction(event) {
  if (event.type === 'fall' || event.type === 'hazard-grab') return 1;
  if (event.type === 'hit' && event.force >= 8.5 && (event.impulse ?? event.force) >= 9) return .85;
  if (event.type === 'hazard-hit' && event.force >= 8.8) return .75;
  return 0;
}
