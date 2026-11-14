export const ARENA_MAPS = {
  harbor: { label: 'Tidebreak Harbor', sea: [0x1d4b59, 0x2c8689, 0x87bfb6] },
  jungle: { label: 'Canopy Ruins', sea: [0x154634, 0x3d926a, 0xb1d789], color: 0xd8e5b3, trim: 0xb5b976 },
  wreck: { label: 'Blackflag Graveyard', sea: [0x252d49, 0x496082, 0x99afce], color: 0xd2bab5, trim: 0xd37c64 },
};

export function arenaMapFor(id) {
  return Object.hasOwn(ARENA_MAPS, id) ? ARENA_MAPS[id] : ARENA_MAPS.harbor;
}
