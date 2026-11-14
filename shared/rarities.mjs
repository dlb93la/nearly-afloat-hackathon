export const RARITIES = Object.freeze({
  common: { label: 'Common', color: '#b7aea1' },
  uncommon: { label: 'Uncommon', color: '#76c977' },
  rare: { label: 'Rare', color: '#64aafa' },
  epic: { label: 'Epic', color: '#c68aef' },
  legendary: { label: 'Legendary', color: '#ffad48' },
  mythic: { label: 'Mythic', color: '#ff719d' },
});

export function rarityFor(item) {
  if (item.rarity) return item.rarity;
  if (item.expeditionOnly) return 'mythic';
  if (item.free || item.id === 'oak' || item.label === 'Oak barrel') return 'common';
  if (item.slot === 'pirate') {
    const [, crew, hat] = item.id.split('-').map(Number);
    if (hat === 0 && [2, 8].includes(crew)) return 'legendary';
    if (hat === 0) return 'epic';
    return hat === 2 ? 'rare' : 'uncommon';
  }
  if (item.slot === 'pet') {
    if (item.id === 'pet-octopus-1') return 'legendary';
    return item.id.endsWith('-1') ? 'epic' : 'rare';
  }
  if (item.slot === 'barrelPaint') return item.price >= 1000 ? 'epic' : 'rare';
  if (item.slot === 'chest' || item.slot === 'arena') return 'epic';
  if (!item.slot) {
    if (['ram', 'shield'].includes(item.id) || ['Boar ram', 'Cannon shield'].includes(item.label)) return 'epic';
    return item.price >= 800 ? 'rare' : 'uncommon';
  }
  return item.price >= 500 ? 'rare' : 'uncommon';
}

export function lootRarityOdds(pool, items, quotes) {
  const counts = Object.fromEntries(Object.keys(RARITIES).map(key => [key, 0]));
  let total = 0;
  for (const id of pool) {
    const quote = quotes.find(quote => quote.item === id && quote.count > 0);
    if (!quote) continue;
    const rarity = quote.rarity ?? rarityFor(items[id]);
    // Older contracts draw uniformly by available item type. Only confirmed
    // metadata switches the UI to the new unit-weighted contract algorithm.
    const weight = quote.loot_weight == null ? 1 : quote.count * quote.loot_weight;
    counts[rarity] += weight;
    total += weight;
  }
  return Object.entries(counts).filter(([, count]) => count).map(([rarity, count]) => ({ rarity, percent: count * 100 / total }));
}
