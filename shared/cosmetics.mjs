const crews = [
  ['Crimson Corsair', 0xc93740, 0x331e28], ['Jade Smuggler', 0x269c6a, 0x132e29],
  ['Gilded Admiral', 0xe1ac43, 0x52342c], ['Moonlit Marauder', 0x6455ba, 0x262244],
  ['Reef Raider', 0x35afbb, 0x17394d], ['Ember Cook', 0xe37843, 0x472923],
  ['Ink Navigator', 0x3656a0, 0x192941], ['Rose Buccaneer', 0xd657a7, 0x4c2351],
  ['Ghost Quartermaster', 0xa5c9c9, 0x284450], ['Brine Bandit', 0x8ab342, 0x343e1c],
];
const hats = [['Captain', 0, 0xffcf73], ['Deckhand', 1, 0xf6e3c5], ['Privateer', 2, 0x9dd8f3]];
const pets = [
  ['Parrot', 'parrot', 0xe8423a, 0x44b55f], ['Crab', 'crab', 0xf66542, 0x8e69d4],
  ['Octopus', 'octopus', 0xb954c2, 0x35c9c2], ['Cat', 'cat', 0xf4a147, 0x92a5c8],
  ['Bat', 'bat', 0x785cb5, 0xc6c9e0], ['Puffer', 'puffer', 0xf5c650, 0x46a7e7],
  ['Skull', 'skull', 0xeee1c3, 0x91ddcf], ['Turtle', 'turtle', 0x6ba350, 0xd48547],
  ['Frog', 'frog', 0x85d747, 0xe476a8], ['Rat', 'rat', 0x958b94, 0xe8b594],
];

export const COSMETICS = Object.freeze(Object.fromEntries([
  ...crews.flatMap(([crew, coat, hat], index) => hats.map(([title, shape, trim]) => {
    const id = 'pirate-' + index + '-' + shape;
    const price = shape === 0 ? ([2, 8].includes(index) ? 5500 : 1800) : shape === 2 ? 800 : 625;
    return [id, Object.freeze({ id, slot: 'pirate', label: crew + ' ' + title, color: coat, hat, trim, shape, price })];
  })),
  ...pets.flatMap(([label, species, first, second]) => [first, second].map((color, variant) => {
    const id = 'pet-' + species + '-' + variant;
    const price = variant ? (species === 'octopus' ? 5500 : 1800) : 800;
    return [id, Object.freeze({ id, slot: 'pet', label: (variant ? 'Moon ' : 'Dock ') + label, color, species, price })];
  })),
]));

export const COSMETIC_CHEST_PRICE = 900;
export const LOOT_POOL = Object.freeze(Object.keys(COSMETICS));

const decorations = [
  ['chest-ghost', 'chest', 'Ghostlight Chest', 0x38aea1, 0xaeeacc, 420],
  ['chest-royal', 'chest', 'Royal Plunder', 0x923db2, 0xf7c75b, 510],
  ['chest-ember', 'chest', 'Powder Cache', 0xbc4235, 0xf0b25d, 460],
  ['arena-ghost', 'arena', 'Ghost Reef', 0x63cbb6, 0xb4f5db, 760],
  ['arena-ember', 'arena', 'Ember Wharf', 0xe5754c, 0xffa852, 760],
  ['arena-royal', 'arena', 'Midnight Regatta', 0xb387d5, 0xecd17a, 760],
  ['house', 'home', 'Captain’s Trim', 0x597e70, 0xc07b4f, 1200],
  ['seat-red', 'seat', 'Crimson Bunk', 0xac3e43, 0xe8b069, 480],
  ['seat-blue', 'seat', 'Tidal Bunk', 0x448aa6, 0xd8bc79, 480],
  ['rug-ink', 'rug', 'Kraken Rug', 0x684f97, 0xe28799, 310],
  ['rug-jade', 'rug', 'Jade Compass Rug', 0x368e75, 0xe6c26e, 310],
  ['ornament-gold', 'ornament', 'Gilded Figurehead', 0xe4b24d, 0x9a583c, 510],
  ['ornament-ghost', 'ornament', 'Ghost Lantern', 0x55cfb6, 0x5e4d82, 510],
  ['chest-storm', 'chest', 'Stormbound Strongbox', 0x416481, 0xd0c29b, 520],
  ['arena-lagoon', 'arena', 'Smuggler’s Lagoon', 0x389989, 0xf4c96b, 760],
  ['seat-captain', 'seat', 'Captain’s Berth', 0x615085, 0xeeb64a, 560],
  ['rug-sunset', 'rug', 'Sunset Sail Rug', 0xc16e46, 0xffcc74, 350],
  ['ornament-compass', 'ornament', 'Corsair Compass', 0x486d81, 0xf1b357, 540],
  ['ornament-pearl', 'ornament', 'Pearl of the Shoals', 0x8e7da5, 0xd7f1f0, 570],
];

export const EXPEDITION_ITEM = 'pet-expedition-parrot';

const barrelPaints = [
  ['paint-red', 'Signal Red', 0xc34440], ['paint-blue', 'Harbor Blue', 0x3c77be],
  ['paint-green', 'Reef Green', 0x3c986b], ['paint-yellow', 'Sun Yellow', 0xdbb643],
  ['paint-tide', 'Tide Stripes', 0x187c91, 0xf4d68a, 'wave', 840],
  ['paint-comet', 'Comet Trail', 0x7c54b6, 0xf0a555, 'star', 980],
  ['paint-royal', 'Royal Compass', 0x242b60, 0xeab642, 'compass', 1120],
  ['paint-anchor', 'Rusty Anchor', 0x665347, 0xdbc598, 'anchor', 880],
  ['paint-heart', 'Heartbreaker', 0x713945, 0xf3b8b1, 'heart', 940],
  ['paint-crossbones', 'Crossbones', 0x36414a, 0xf3e3be, 'crossbones', 1080],
];

export const ITEMS = Object.freeze({
  ...COSMETICS,
  ...Object.fromEntries(barrelPaints.map(([id, label, color, trim, crest, price]) =>
    [id, Object.freeze({ id, label, slot: 'barrelPaint', color, trim, crest, price, free: !price })])),
  ...Object.fromEntries(decorations.map(([id, slot, label, color, trim, price]) =>
    [id, Object.freeze({ id, slot, label, color, trim, price })])),
  'ornament-scrap': Object.freeze({
    id: 'ornament-scrap', slot: 'ornament', label: 'Salvaged Lantern',
    color: 0x826a53, trim: 0xf7bc66, scrapCost: 1,
  }),
  'pet-expedition-kraken': Object.freeze({
    id: 'pet-expedition-kraken', slot: 'pet', label: 'Moonwake Kraken',
    species: 'octopus', color: 0x9872dc, trim: 0x5ef0ce, expeditionOnly: true,
  }),
  'ornament-expedition-astrolabe': Object.freeze({
    id: 'ornament-expedition-astrolabe', slot: 'ornament', label: 'Sunken Astrolabe',
    color: 0x497e83, trim: 0xffd471, expeditionOnly: true,
  }),
  [EXPEDITION_ITEM]: Object.freeze({
    id: EXPEDITION_ITEM, slot: 'pet', label: 'Gilded Parrot',
    species: 'parrot', color: 0xffc358, trim: 0x42c8de, expeditionOnly: true,
  }),
});
export const ITEM_SLOTS = Object.freeze([...new Set(Object.values(ITEMS).map(item => item.slot))]);
export const FURNITURE_SLOTS = Object.freeze(['seat', 'rug', 'ornament']);

export function cosmeticFor(id) {
  return Object.hasOwn(ITEMS, id) ? ITEMS[id] : null;
}
