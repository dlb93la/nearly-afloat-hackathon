export const ARENA_ENTRY = 200;
export const TREASURY_PERCENT = 20;
export const GOLD_WAGER_PERCENT = 10;

export function wagerBand(entry) {
  return { min: Math.ceil(entry * .75), max: Math.floor(entry * 1.25) };
}

export function wagerFee(entry) {
  return Math.round(entry * GOLD_WAGER_PERCENT / 100);
}
