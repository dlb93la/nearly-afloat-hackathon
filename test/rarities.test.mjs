import test from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, LOOT_POOL, COSMETIC_CHEST_PRICE } from '../shared/cosmetics.mjs';
import { RARITIES, rarityFor, lootRarityOdds } from '../shared/rarities.mjs';
import { RIGS } from '../shared/rigs.mjs';
import { RARITY_STOCK, LOOT_WEIGHT } from '../shared/economy-policy.mjs';

test('catalogue rarities cover every item and chest odds match the available pool', () => {
  for (const item of Object.values(ITEMS)) assert.ok(RARITIES[rarityFor(item)]);
  for (const [id, rig] of Object.entries(RIGS)) assert.ok(RARITIES[rarityFor({ ...rig, id })]);
  assert.equal(rarityFor(ITEMS['paint-red']), 'common');
  assert.equal(rarityFor(ITEMS['pet-expedition-parrot']), 'mythic');
  assert.equal(COSMETIC_CHEST_PRICE, 900);
  const quotes = LOOT_POOL.map(item => ({ item, count: 8 }));
  const odds = lootRarityOdds(LOOT_POOL, ITEMS, quotes);
  assert.ok(Math.abs(odds.reduce((sum, row) => sum + row.percent, 0) - 100) < 1e-9);
  assert.equal(odds.find(row => row.rarity === 'legendary').percent, 6);
  assert.deepEqual(lootRarityOdds(LOOT_POOL, ITEMS, quotes.map(q => ({ ...q, count: 0 }))), []);
  assert.deepEqual(lootRarityOdds(LOOT_POOL, ITEMS, [{ item: 'pet-octopus-1', count: 1 }]), [{ rarity: 'legendary', percent: 100 }]);
});

test('confirmed unit weights follow rarity supply, and legacy quotes keep their old odds', () => {
  const quotes = LOOT_POOL.map(item => ({ item, count: RARITY_STOCK[rarityFor(ITEMS[item])],
    rarity: rarityFor(ITEMS[item]), loot_weight: LOOT_WEIGHT[rarityFor(ITEMS[item])] }));
  const odds = lootRarityOdds(LOOT_POOL, ITEMS, quotes);
  assert.ok(odds.find(row => row.rarity === 'legendary').percent < 1);
  assert.ok(odds.find(row => row.rarity === 'epic').percent < odds.find(row => row.rarity === 'rare').percent);
  assert.ok(Math.abs(odds.reduce((sum, row) => sum + row.percent, 0) - 100) < 1e-9);
  assert.deepEqual(lootRarityOdds(LOOT_POOL, ITEMS, quotes.map(q => ({ ...q, count: 0 }))), []);
  const onlyLegendary = quotes.map(q => ({ ...q, count: q.rarity === 'legendary' ? q.count : 0 }));
  assert.deepEqual(lootRarityOdds(LOOT_POOL, ITEMS, onlyLegendary), [{ rarity: 'legendary', percent: 100 }]);
  assert.equal(RARITY_STOCK.legendary, 1);
  assert.ok(ITEMS['pirate-2-0'].price > ITEMS['pirate-0-0'].price);
  assert.ok(ITEMS['pirate-0-0'].price > ITEMS['pirate-0-1'].price);
});
