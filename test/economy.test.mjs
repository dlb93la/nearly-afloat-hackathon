import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ARENA_EXPIRY_MS, openEconomy, RAID_EXPIRY_MS } from '../economy.mjs';
import { evaluateRoute, validDefense } from '../shared/vault.mjs';
import { COSMETICS, COSMETIC_CHEST_PRICE } from '../shared/cosmetics.mjs';

function fixture(t) {
  let now = 1_000;
  const ledger = openEconomy(':memory:', () => now);
  t.after(() => ledger.close());
  const account = () => ledger.findAccount(ledger.createAccount());
  const a = account();
  const b = account();
  const seats = [
    { id: 'a', accountId: a },
    { id: 'b', accountId: b },
    ...Array.from({ length: 6 }, (_, slot) => ({ id: 'bot-' + slot, accountId: null })),
  ];
  return { ledger, a, b, seats, account, advance: (ms) => { now += ms; } };
}

test('eight entries reserve once and pay the human winner exactly once', (t) => {
  const { ledger, a, b, seats } = fixture(t);
  const roundId = randomUUID();
  const reserved = ledger.reserveRound(roundId, seats);
  assert.deepEqual([reserved.entry, reserved.fee, reserved.pot, reserved.bonus], [200, 160, 1440, 200]);
  assert.deepEqual([ledger.wallet(a).gold, ledger.wallet(b).gold, ledger.wallet(a).botBank], [9800, 9800, 18800]);
  assert.throws(() => ledger.reserveRound(roundId, seats), /already registered/);
  assert.throws(() => ledger.finishRound(roundId, 'unknown'), /reserved roster/);
  const result = ledger.finishRound(roundId, 'a');
  assert.deepEqual(ledger.finishRound(roundId, 'b'), result);
  assert.deepEqual(ledger.finishRound(roundId), result);
  assert.deepEqual([ledger.wallet(a).gold, ledger.wallet(b).gold, ledger.wallet(a).treasury], [11440, 9800, 9960]);
});

test('bot payout, failed reservation and both refund paths conserve gold', (t) => {
  const { ledger, a, b, seats, advance } = fixture(t);
  const starting = ledger.wallet(a);
  const id = randomUUID();
  assert.throws(() => ledger.reserveRound(id, [...seats.slice(0, 7), { id: 'another-seat', accountId: a }]), /separate test wallet/);
  assert.deepEqual(ledger.wallet(a), starting);
  const expired = randomUUID();
  ledger.reserveRound(id, seats);
  ledger.reserveRound(expired, seats);
  assert.equal(ledger.finishRound(id).status, 'cancelled');
  advance(ARENA_EXPIRY_MS);
  assert.equal(ledger.sweep(), true);
  assert.equal(ledger.finishRound(expired, 'a').status, 'cancelled');
  assert.deepEqual(ledger.wallet(a), starting);
  assert.equal(ledger.wallet(b).gold, starting.gold);

  const botRound = randomUUID();
  ledger.reserveRound(botRound, seats);
  assert.equal(ledger.finishRound(botRound, 'bot-0').paid, 1440);
  assert.deepEqual([ledger.wallet(a).gold, ledger.wallet(a).botBank, ledger.wallet(a).treasury], [9800, 20240, 10160]);
});

test('separate ledger connections share reservations and retain receipts after reopen', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'barrel-ledger-'));
  const filename = join(directory, 'ledger.sqlite');
  const first = openEconomy(filename);
  const second = openEconomy(filename);
  t.after(() => {
    first.close();
    second.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(filename + suffix, { force: true });
    rmdirSync(directory);
  });
  const token = first.createAccount();
  const a = second.findAccount(token);
  assert.ok(a);
  first.saveVault(a, { ...first.wallet(a).vault, gold: 9800 });
  const seats = [
    { id: 'a', accountId: a },
    ...Array.from({ length: 5 }, (_, slot) => ({ id: 'bot-' + slot, accountId: null })),
  ];
  const roundId = randomUUID();
  first.reserveRound(roundId, seats);
  assert.throws(() => second.reserveRound(randomUUID(), seats), /needs more test gold/);
  const result = second.finishRound(roundId, 'a');
  const reopened = openEconomy(filename);
  try {
    assert.deepEqual(reopened.finishRound(roundId, 'bot-0'), result);
    assert.deepEqual([reopened.wallet(a).gold, reopened.wallet(a).vault.gold], [1280, 9800]);
  } finally {
    reopened.close();
  }
});

test('variable wagers charge ten percent each and refund the original amounts', t => {
  const { ledger, a, b } = fixture(t);
  const seats = [{ id: 'a', accountId: a, wager: 305 }, { id: 'b', accountId: b, wager: 348 },
    { id: 'npc', accountId: null, wager: 271 }];
  const id = randomUUID();
  const reserved = ledger.reserveRound(id, seats, 305);
  assert.deepEqual(reserved.wagers, { a: 305, b: 348, npc: 271 });
  assert.equal(reserved.fee, 31 + 35 + 27);
  assert.equal(reserved.pot, 831);
  assert.deepEqual([ledger.wallet(a).gold, ledger.wallet(b).gold, ledger.wallet(a).botBank], [9695, 9652, 19729]);
  ledger.finishRound(id);
  assert.deepEqual([ledger.wallet(a).gold, ledger.wallet(b).gold, ledger.wallet(a).botBank], [10000, 10000, 20000]);
  const settledId = randomUUID();
  ledger.reserveRound(settledId, seats, 305);
  assert.equal(ledger.finishRound(settledId, 'b').paid, 1031);
  assert.equal(ledger.wallet(b).gold, 10683);
});

const safeRoute = [22, 21, 16, 11, 6, 1, 2];
const riskyRoute = [22, 23, 18, 17, 12, 11, 6, 1, 2];

test('cosmetic chests charge once and resale removes an equipped look', (t) => {
  const { ledger, a, b } = fixture(t);
  const catalog = Object.values(COSMETICS);
  assert.equal(catalog.filter(item => item.slot === 'pirate').length, 30);
  assert.equal(catalog.filter(item => item.slot === 'pet').length, 20);
  const id = randomUUID();
  const chest = { type: 'gear-open-chest', id };
  ledger.workshopAction(a, chest);
  ledger.workshopAction(a, chest);
  assert.equal(ledger.wallet(a).gold, 10_000 - COSMETIC_CHEST_PRICE);
  const [item] = ledger.wallet(a).workshop.inventory;
  const { slot } = COSMETICS[item.type];
  const equip = { type: 'gear-style', slot, id };
  ledger.workshopAction(a, equip);
  assert.equal(ledger.appearance(a)[slot], item.type);
  assert.equal(ledger.rig(a), 'oak');
  ledger.workshopAction(a, { type: 'gear-list', id, price: 400 });
  assert.equal(ledger.appearance(a)[slot], null);
  const [offer] = ledger.wallet(b).workshop.market;
  ledger.workshopAction(b, { type: 'gear-buy-market', id, listing: offer.listing.id });
  assert.throws(() => ledger.workshopAction(a, equip), /your rack/);
  assert.throws(() => ledger.workshopAction(a, chest), /already been used/);
  ledger.workshopAction(b, equip);
  assert.equal(ledger.appearance(b)[slot], item.type);
  assert.equal(ledger.wallet(a).gold, 10_000 - COSMETIC_CHEST_PRICE + 380);
  assert.equal(ledger.wallet(b).gold, 9_600);
});

test('raid equipment changes breaches, armor and the move allowance', () => {
  const defense = { chest: 2, cannon: 8, barricades: [17] };
  const breach = [22, 17, 12, 7, 2];
  assert.equal(evaluateRoute(defense, breach, 'oak'), null);
  assert.deepEqual(evaluateRoute(defense, breach, 'ram'), { won: true, hits: 1 });
  const open = { ...defense, barricades: [] };
  const underFire = [22, 17, 12, 7, 6, 1, 2];
  assert.equal(evaluateRoute(open, underFire, 'oak')?.won, false);
  assert.deepEqual(evaluateRoute(open, underFire, 'shield'), { won: true, hits: 1 });
  const long = [22, 21, 22, 21, 22, 21, 22, 21, 16, 11, 6, 1, 2];
  assert.equal(evaluateRoute(open, long, 'oak'), null);
  assert.equal(evaluateRoute(open, long, 'scout')?.won, true);
});

test('a cottage has independent furniture slots and raids retain the chest skin at entry', (t) => {
  const { ledger, a, b } = fixture(t);
  const buy = (cosmetic) => {
    const id = randomUUID();
    ledger.workshopAction(a, { type: 'gear-buy-cosmetic', cosmetic, id });
    return id;
  };
  const rug = buy('rug-ink');
  const place = { type: 'gear-style', slot: 'rug', id: rug };
  ledger.workshopAction(a, place);
  assert.equal(ledger.appearance(a).rug, 'rug-ink');
  assert.throws(() => ledger.workshopAction(b, place), /Choose a cosmetic from your rack/);
  const home = buy('house');
  assert.throws(() => buy('house'), /already own/);
  assert.throws(() => ledger.workshopAction(a, { type: 'gear-list', id: home, price: 1200 }), /stays with its owner/);
  ledger.workshopAction(a, place);
  ledger.workshopAction(a, { type: 'gear-style', slot: 'seat', id: buy('seat-red') });
  assert.deepEqual([ledger.appearance(a).home, ledger.appearance(a).rug, ledger.appearance(a).seat],
    ['house', 'rug-ink', 'seat-red']);
  const chest = buy('chest-ghost');
  ledger.workshopAction(a, { type: 'gear-style', slot: 'chest', id: chest });
  const vault = ledger.wallet(a).vault;
  ledger.saveVault(a, { ...vault, gold: 600 });
  ledger.startRaid(b, vault.code);
  ledger.workshopAction(a, { type: 'gear-style', slot: 'chest', id: null });
  assert.equal(ledger.wallet(a).vault.skin, null);
  assert.equal(ledger.wallet(b).raid.skin, 'chest-ghost');
});

test('raid locks a reachable defense and gold, and releases the chest only once', (t) => {
  const { ledger, a, b, account } = fixture(t);
  const owner = ledger.wallet(a).vault;
  assert.equal(validDefense(owner.defense), true);
  assert.equal(evaluateRoute(owner.defense, safeRoute).won, true);
  assert.equal(evaluateRoute(owner.defense, riskyRoute).won, false);
  assert.equal(evaluateRoute(owner.defense, [22, 2]), null);
  ledger.saveVault(a, { ...owner, gold: 750 });
  const saved = ledger.wallet(a).vault;
  assert.throws(() => ledger.startRaid(a, saved.code), /another player/);
  ledger.startRaid(b, saved.code);
  const raid = ledger.wallet(b).raid;
  assert.equal(raid.version, saved.version);
  assert.equal(raid.gold, 750);
  assert.equal(ledger.wallet(a).vault.locked, true);
  assert.throws(() => ledger.startRaid(account(), saved.code), /available/);
  assert.throws(() => ledger.saveVault(a, { ...saved, gold: 0 }), /locked/);
  assert.throws(() => ledger.finishRaid(a, raid.id, safeRoute), /this wallet/);
  assert.throws(() => ledger.finishRaid(b, raid.id, [22, 2]), /walkable route/);
  assert.equal(ledger.wallet(b).raid.status, 'open');
  ledger.finishRaid(b, raid.id, safeRoute);
  ledger.finishRaid(b, raid.id, safeRoute);
  assert.deepEqual([ledger.wallet(a).gold, ledger.wallet(a).vault.gold, ledger.wallet(b).gold], [9250, 0, 10650]);
  assert.equal(ledger.wallet(b).raid.status, 'won');
  assert.equal(ledger.wallet(a).vault.locked, false);
  assert.throws(() => ledger.saveVault(a, saved), /changed/);
});

test('failed, cancelled and expired raids release the lock with the correct fee', (t) => {
  const { ledger, a, b, advance } = fixture(t);
  const vault = ledger.wallet(a).vault;
  ledger.saveVault(a, { ...vault, gold: 500 });
  ledger.startRaid(b, vault.code);
  ledger.finishRaid(b, ledger.wallet(b).raid.id, riskyRoute);
  assert.deepEqual([ledger.wallet(b).raid.status, ledger.wallet(b).gold, ledger.wallet(a).vault.gold], ['failed', 9900, 500]);
  ledger.startRaid(b, vault.code);
  ledger.finishRaid(b, ledger.wallet(b).raid.id, null);
  assert.equal(ledger.wallet(b).gold, 9900);
  ledger.startRaid(b, vault.code);
  advance(RAID_EXPIRY_MS);
  ledger.finishRaid(b, ledger.wallet(b).raid.id, safeRoute);
  assert.deepEqual([ledger.wallet(b).raid.status, ledger.wallet(b).gold, ledger.wallet(a).treasury], ['expired', 9900, 10100]);
  assert.equal(ledger.wallet(a).vault.locked, false);
});

function buyIron(ledger, account) {
  const stock = ledger.wallet(account).workshop.stock.find(entry => entry.type === 'iron');
  const order = { type: 'gear-buy-stock', id: randomUUID(), rig: 'iron', price: stock.price };
  ledger.workshopAction(account, order);
  return order;
}

test('a reserved rig wears exactly once on settlement and can be patched only once', (t) => {
  const { ledger, a, b, seats } = fixture(t);
  const order = buyIron(ledger, a);
  ledger.workshopAction(a, order);
  assert.equal(ledger.wallet(a).gold, 10_000 - order.price);
  assert.equal(ledger.wallet(b).workshop.stock[0].count, 7);
  assert.ok(ledger.wallet(b).workshop.stock[0].price > order.price);
  const { id } = order;
  ledger.workshopAction(a, { type: 'gear-equip', id });
  const cancelled = randomUUID();
  assert.equal(ledger.reserveRound(cancelled, seats).rigs.a, 'iron');
  assert.throws(() => ledger.workshopAction(a, { type: 'gear-list', id, price: 500 }), /while in use/);
  ledger.finishRound(cancelled);
  assert.equal(ledger.wallet(a).workshop.inventory[0].uses, 3);

  const played = randomUUID();
  ledger.reserveRound(played, seats);
  ledger.finishRound(played, 'b');
  ledger.finishRound(played, 'a');
  assert.equal(ledger.wallet(a).workshop.inventory[0].uses, 2);
  const before = ledger.wallet(a).treasury;
  ledger.workshopAction(a, { type: 'gear-patch', id });
  assert.equal(ledger.wallet(a).workshop.inventory[0].uses, 3);
  assert.equal(ledger.wallet(a).treasury, before + 175);
  assert.throws(() => ledger.workshopAction(a, { type: 'gear-patch', id }), /once/);
});

test('recycling a spent rig yields one scrap for a single repair and starter rigs yield none', (t) => {
  const { ledger, a, seats } = fixture(t);
  const wear = (id, rounds) => {
    ledger.workshopAction(a, { type: 'gear-equip', id });
    for (let i = 0; i < rounds; i++) {
      const round = randomUUID();
      ledger.reserveRound(round, seats);
      ledger.finishRound(round, 'a');
    }
  };
  const consume = id => {
    wear(id, 3);
    ledger.workshopAction(a, { type: 'gear-patch', id });
    wear(id, 1);
  };
  const ordinary = buyIron(ledger, a).id;
  const repair = buyIron(ledger, a).id;
  const scrap = () => ledger.wallet(a).workshop.scrap;
  assert.equal(scrap(), 0);
  assert.throws(() => ledger.workshopAction(a, { type: 'gear-discard', id: ordinary }), /Only a spent barrel/);
  wear(repair, 1);
  const scrapPatch = { type: 'gear-patch', id: repair, payment: 'scrap' };
  assert.throws(() => ledger.workshopAction(a, scrapPatch), /need scrap/);
  consume(ordinary);
  const gold = ledger.wallet(a).gold;
  const treasury = ledger.wallet(a).treasury;
  const discard = { type: 'gear-discard', id: ordinary };
  ledger.workshopAction(a, discard);
  assert.equal(scrap(), 1);
  assert.throws(() => ledger.workshopAction(a, discard), /unavailable/);
  assert.equal(scrap(), 1);
  ledger.workshopAction(a, scrapPatch);
  assert.equal(scrap(), 0);
  assert.equal(ledger.wallet(a).workshop.inventory.find(item => item.id === repair).uses, 3);
  assert.equal(ledger.wallet(a).gold, gold);
  assert.equal(ledger.wallet(a).treasury, treasury);
  assert.throws(() => ledger.workshopAction(a, scrapPatch), /patched once/);

  ledger.completeFirstBrawl(a);
  ledger.claimFirstBrawl(a, 'iron');
  const starter = ledger.wallet(a).workshop.equipped;
  consume(starter);
  ledger.workshopAction(a, { type: 'gear-discard', id: starter });
  assert.equal(scrap(), 0);

  const craft = { type: 'gear-buy-cosmetic', cosmetic: 'ornament-scrap', id: randomUUID() };
  assert.throws(() => ledger.workshopAction(a, craft), /need scrap to craft/);
  const donor = buyIron(ledger, a).id;
  consume(donor);
  ledger.workshopAction(a, { type: 'gear-discard', id: donor });
  const beforeCraft = ledger.wallet(a).gold;
  ledger.workshopAction(a, craft);
  ledger.workshopAction(a, craft);
  assert.equal(scrap(), 0);
  assert.equal(ledger.wallet(a).gold, beforeCraft);
  assert.equal(ledger.wallet(a).workshop.inventory.find(item => item.id === craft.id).type, 'ornament-scrap');
});

test('market transfers the item once and rejects an outdated listing', (t) => {
  const { ledger, a, b, account } = fixture(t);
  const { id } = buyIron(ledger, a);
  ledger.workshopAction(a, { type: 'gear-list', id, price: 900 });
  const old = ledger.wallet(b).workshop.market[0].listing.id;
  ledger.workshopAction(a, { type: 'gear-unlist', id, listing: old });
  ledger.workshopAction(a, { type: 'gear-list', id, price: 1000 });
  assert.throws(() => ledger.workshopAction(b, { type: 'gear-buy-market', id, listing: old }), /no longer available/);
  const listing = ledger.wallet(b).workshop.market[0].listing.id;
  const balance = ledger.wallet(a).gold;
  const treasury = ledger.wallet(a).treasury;
  ledger.workshopAction(b, { type: 'gear-buy-market', id, listing });
  assert.equal(ledger.wallet(b).workshop.inventory[0].id, id);
  assert.equal(ledger.wallet(b).gold, 9000);
  assert.equal(ledger.wallet(a).gold, balance + 950);
  assert.equal(ledger.wallet(a).treasury, treasury + 50);
  assert.throws(() => ledger.workshopAction(account(), { type: 'gear-buy-market', id, listing }), /no longer available/);
});

test('iron opens one barricade per raid and expired reservations release the equipped rig', (t) => {
  const { ledger, a, b, advance } = fixture(t);
  const defense = { chest: 2, cannon: 8, barricades: [17, 11] };
  const shortcut = [22, 17, 12, 7, 2];
  assert.equal(validDefense(defense), true);
  assert.equal(evaluateRoute(defense, shortcut), null);
  assert.deepEqual(evaluateRoute(defense, shortcut, 'iron'), { won: true, hits: 1 });
  assert.equal(evaluateRoute(defense, [22, 17, 12, 11, 6, 1, 2], 'iron'), null);
  const vault = ledger.wallet(a).vault;
  ledger.saveVault(a, { ...vault, defense, gold: 650 });
  const { id } = buyIron(ledger, b);
  ledger.workshopAction(b, { type: 'gear-equip', id });
  ledger.startRaid(b, vault.code);
  assert.equal(ledger.wallet(b).raid.rig, 'iron');
  advance(RAID_EXPIRY_MS);
  assert.equal(ledger.sweep(), true);
  assert.equal(ledger.wallet(b).workshop.inventory[0].uses, 3);
  ledger.startRaid(b, vault.code);
  ledger.finishRaid(b, ledger.wallet(b).raid.id, shortcut);
  assert.equal(ledger.wallet(b).raid.status, 'won');
  assert.equal(ledger.wallet(b).workshop.inventory[0].uses, 2);
});
