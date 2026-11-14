import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openEconomy } from '../economy.mjs';
import { EXPEDITION_ITEM, LOOT_POOL } from '../shared/cosmetics.mjs';

const durations = { fundingMs: 60, sailingMs: 20, auctionMs: 40 };

function createProfile(economy) {
  return economy.findAccount(economy.createAccount());
}

function action(campaign, type, amount) {
  return { type: 'expedition-' + type, campaignId: campaign.id, actionId: randomUUID(), amount };
}

test('a funded voyage reserves bids and settles proceeds and cargo once across a restart', t => {
  const directory = mkdtempSync(join(tmpdir(), 'barrel-bay-expedition-'));
  const filename = join(directory, 'economy.sqlite');
  let now = 1_000;
  const open = () => openEconomy(filename, () => now, { expedition: durations });
  let economy = open();
  t.after(() => {
    economy.close();
    for (const suffix of ['', '-shm', '-wal']) rmSync(filename + suffix, { force: true });
    rmdirSync(directory);
  });
  const first = createProfile(economy);
  const second = createProfile(economy);
  const bidder = createProfile(economy);
  const winner = createProfile(economy);
  const start = economy.wallet(first);
  const initial = economy.openExpedition(first);
  assert.equal(start.expeditions, null);
  assert.equal(initial.maxContribution, 2_900);
  assert.equal(initial.deadline, null);
  assert.equal(economy.wallet(first).workshop.dock.quotes[EXPEDITION_ITEM], undefined);
  assert.ok(!LOOT_POOL.includes(EXPEDITION_ITEM));
  assert.throws(() => economy.workshopAction(first, {
    type: 'gear-buy-cosmetic', cosmetic: EXPEDITION_ITEM, id: randomUUID(),
  }), /awarded in Expeditions/);
  now += 1_000;
  assert.equal(economy.sweep(), false);
  assert.equal(economy.openExpedition(second).id, initial.id);
  assert.throws(() => economy.expeditionAction(first, action(initial, 'contribute', 3_000)), /funding limit/);

  const support = action(initial, 'contribute', 600);
  const partial = economy.expeditionAction(first, support);
  assert.deepEqual(economy.expeditionAction(first, support), partial);
  assert.throws(() => economy.expeditionAction(first, { ...support, amount: 700 }), /already been used/);
  assert.equal(partial.fundingEndsAt, now + durations.fundingMs);
  assert.equal(partial.supporters, 1);
  assert.equal(economy.wallet(first).gold, start.gold - 600);
  const sailing = economy.expeditionAction(second, action(initial, 'contribute', 2_400));
  assert.equal(sailing.status, 'sailing');
  assert.equal(sailing.departedAt, now);
  assert.equal(economy.wallet(second).treasury, start.treasury + 3_000);
  assert.throws(() => economy.expeditionAction(bidder, action(initial, 'bid', 100)), /auction window/);

  economy.close();
  economy = open();
  now = sailing.arrivalAt;
  assert.equal(economy.sweep(), true);
  const auction = economy.openExpedition();
  assert.equal(auction.status, 'auction');
  assert.equal(auction.deadline, now + durations.auctionMs);
  assert.equal(auction.nextBid, 100);

  economy.expeditionAction(bidder, action(initial, 'bid', 1_300));
  const raise = economy.expeditionAction(bidder, action(initial, 'bid', 1_600));
  assert.equal(raise.myBid, 1_600);
  assert.equal(economy.wallet(bidder).gold, start.gold - 1_600);
  assert.throws(() => economy.expeditionAction(winner, action(initial, 'bid', 1_650)), /minimum bid changed/);
  assert.throws(() => economy.expeditionAction(winner, action(initial, 'bid', 10_001)), /more local test gold/);
  const winningBid = action(initial, 'bid', 2_103);
  economy.expeditionAction(winner, winningBid);
  assert.equal(economy.wallet(bidder).gold, start.gold);
  assert.equal(economy.wallet(winner).gold, start.gold - 2_103);

  now = auction.deadline;
  assert.throws(() => economy.expeditionAction(bidder, action(initial, 'bid', 2_300)), /auction window/);
  assert.equal(economy.sweep(), true);
  assert.equal(economy.sweep(), false);
  const receipt = economy.expedition(winner);
  assert.deepEqual(receipt.sale, { price: 2_103, fee: 106, distributed: 1_997 });
  assert.equal(receipt.status, 'settled');
  assert.equal(receipt.won, true);
  assert.deepEqual(economy.expeditionAction(winner, winningBid), receipt);
  assert.equal(economy.expedition(first).myPayout, 399);
  assert.equal(economy.expedition(second).myPayout, 1_598);
  assert.equal(economy.wallet(first).gold, start.gold - 600 + 399);
  assert.equal(economy.wallet(second).gold, start.gold - 2_400 + 1_598);
  assert.equal(economy.wallet(first).treasury, start.treasury + 3_106);
  const items = economy.wallet(winner).workshop.inventory;
  assert.deepEqual(items.map(item => item.type), [EXPEDITION_ITEM]);
  economy.workshopAction(winner, { type: 'gear-style', slot: 'pet', id: items[0].id });
  assert.equal(economy.appearance(winner).pet, EXPEDITION_ITEM);
});

test('funding timeouts return the exact reserved gold and leave a persistent receipt', t => {
  let now = 1_000;
  const economy = openEconomy(':memory:', () => now, { expedition: durations });
  t.after(() => economy.close());
  const account = createProfile(economy);
  const start = economy.wallet(account);
  const initial = economy.openExpedition(account);
  const support = action(initial, 'contribute', 700);
  const partial = economy.expeditionAction(account, support);
  now = partial.deadline;
  assert.equal(economy.sweep(), true);
  assert.equal(economy.sweep(), false);
  const receipt = economy.openExpedition(account);
  assert.equal(receipt.id, initial.id);
  assert.equal(receipt.status, 'refunded');
  assert.equal(receipt.myRefund, 700);
  assert.equal(receipt.myPayout, 0);
  assert.deepEqual(economy.expeditionAction(account, support), receipt);
  assert.equal(economy.wallet(account).gold, start.gold);
  assert.equal(economy.wallet(account).treasury, start.treasury);
});

test('the last cents can fund a voyage and an empty auction earns no payout', t => {
  let now = 1_000;
  const economy = openEconomy(':memory:', () => now, { expedition: durations });
  t.after(() => economy.close());
  const first = createProfile(economy);
  const second = createProfile(economy);
  const start = economy.wallet(first);
  const initial = economy.openExpedition(first);
  economy.expeditionAction(first, action(initial, 'contribute', 2_750));
  const partial = economy.expeditionAction(second, action(initial, 'contribute', 200));
  assert.equal(partial.minimumContribution, 50);
  assert.equal(partial.maxContribution, 50);
  const sailing = economy.expeditionAction(second, action(initial, 'contribute', 50));
  now = sailing.arrivalAt;
  economy.sweep();
  now = economy.expedition(first).auctionEndsAt;
  assert.equal(economy.sweep(), true);
  assert.equal(economy.expedition(first).status, 'unsold');
  assert.equal(economy.expedition(first).myPayout, 0);
  assert.equal(economy.wallet(first).gold, start.gold - 2_750);
  assert.equal(economy.wallet(second).gold, start.gold - 250);
  assert.equal(economy.wallet(first).treasury, start.treasury + 3_000);
});

test('a verified NEAR cargo delivery can be retried and cannot be duplicated after resale', t => {
  const economy = openEconomy(':memory:');
  t.after(() => economy.close());
  const winner = createProfile(economy);
  const buyer = createProfile(economy);
  const contract = 'expeditions.testnet';
  assert.equal(economy.hasNearExpeditionClaim(winner, contract), false);
  const award = economy.claimNearExpedition(winner, contract);
  assert.equal(award.granted, true);
  assert.deepEqual(economy.claimNearExpedition(winner, contract), { ...award, granted: false });
  assert.throws(() => economy.claimNearExpedition(buyer, contract), /claimed by another profile/);
  economy.workshopAction(winner, { type: 'gear-list', id: award.itemId, price: 100 });
  const item = economy.wallet(buyer).workshop.market.find(entry => entry.id === award.itemId);
  economy.workshopAction(buyer, { type: 'gear-buy-market', id: item.id, listing: item.listing.id });
  assert.deepEqual(economy.claimNearExpedition(winner, contract), { ...award, granted: false });
  assert.equal(economy.hasNearExpeditionClaim(winner, contract), true);
  assert.equal(economy.hasNearExpeditionClaim(buyer, contract), false);
  assert.equal(economy.wallet(winner).workshop.inventory.length, 0);
  assert.equal(economy.wallet(buyer).workshop.inventory[0].type, EXPEDITION_ITEM);
});
