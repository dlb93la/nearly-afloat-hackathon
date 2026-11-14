export const DEFAULT_RIG = 'oak';
export const RIG_USES = 3;
export const MARKET_PERCENT = 5;
export const PATCH_PRICE = 175;
export const PATCH_SCRAP_COST = 1;

export const RIGS = Object.freeze({
  oak: Object.freeze({ label: 'Oak barrel', mass: 1, drive: 1, turn: 1, speed: 1 }),
  iron: Object.freeze({ label: 'Iron hoop', mass: 1.22, drive: .94, turn: .78, speed: .95,
    price: 720, scarcity: 65, color: 0x838e9e, breach: true, description: 'Hits harder. Slower turns. Breaks one barricade.' }),
  cork: Object.freeze({ label: 'Cork runner', mass: .85, drive: 1.09, turn: 1.19, speed: 1.05,
    price: 520, scarcity: 50, color: 0xe0bc79, description: 'Turns faster. Easier to knock away.' }),
  anchor: Object.freeze({ label: 'Anchor bands', mass: 1.45, drive: .86, turn: .71, speed: .84,
    price: 940, scarcity: 80, color: 0x304c71, description: 'Heavy and hard to dislodge, with the slowest top speed.' }),
  rocket: Object.freeze({ label: 'Powder staves', mass: .81, drive: 1.26, turn: .81, speed: 1.19,
    price: 890, scarcity: 80, color: 0xf35b36, description: 'Fast straight-line charges. Light and awkward in a turn.' }),
  swivel: Object.freeze({ label: 'Swivel axle', mass: .96, drive: .98, turn: 1.38, speed: .91,
    price: 670, scarcity: 55, color: 0x36b7a2, description: 'Sharpest turns, lower top speed.' }),
  ram: Object.freeze({ label: 'Boar ram', mass: 1.08, drive: 1.16, turn: .67, speed: 1.07, breach: true,
    price: 1020, scarcity: 80, color: 0xc77643, description: 'Quick charges and wide turns. Breaks one barricade.' }),
  shield: Object.freeze({ label: 'Cannon shield', mass: 1.30, drive: .83, turn: .85, speed: .89, armor: 1,
    price: 980, scarcity: 80, color: 0x8b7de3, description: 'Slow and sturdy. Absorbs the first cannon hit in a raid.' }),
  scout: Object.freeze({ label: 'Scout wheels', mass: .89, drive: 1.05, turn: 1.16, speed: 1.08, raidMoves: 2,
    price: 810, scarcity: 70, color: 0x9fcf53, description: 'Nimble and light. Gives eight extra seconds in a fort raid.' }),
});

export const STOCK_RIGS = Object.freeze(Object.keys(RIGS).filter(id => id !== DEFAULT_RIG));
export const FIRST_BRAWL_RIGS = Object.freeze(['iron', 'cork']);

export function rigFor(id) {
  return Object.hasOwn(RIGS, id) ? RIGS[id] : RIGS[DEFAULT_RIG];
}
