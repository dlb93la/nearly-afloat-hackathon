import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { openEconomy } from '../economy.mjs';
import { advanceMerchant, merchantOrder, MERCHANT_RESTOCK_MS, MERCHANT_RETRY_MS,
  MERCHANT_TREASURY_RESERVE } from '../shared/merchant.mjs';

test('the shared merchant reprices, replenishes from the treasury and rejects old offers', (t) => {
  let now = 1_000;
  const ledger = openEconomy(':memory:', () => now);
  t.after(() => ledger.close());
  const seller = ledger.findAccount(ledger.createAccount());
  const neighbor = ledger.findAccount(ledger.createAccount());
  const order = id => ledger.wallet(id).workshop.merchant;
  const buyRig = (id, type = 'iron') => {
    const stock = ledger.wallet(id).workshop.stock.find(item => item.type === type);
    const item = randomUUID();
    ledger.workshopAction(id, { type: 'gear-buy-stock', id: item, rig: stock.type, price: stock.price });
    return item;
  };
  const quote = (id, item) => {
    const { order: currentOrder, price } = order(id);
    return { type: 'gear-sell-merchant', id: item, order: currentOrder, price };
  };

  const first = buyRig(seller);
  const second = buyRig(neighbor);
  ledger.workshopAction(seller, { type: 'gear-equip', id: first });
  const oldQuote = quote(neighbor, second);
  const delivery = quote(seller, first);
  const cashBefore = ledger.wallet(seller).gold + order(seller).budget;
  const stockBefore = ledger.wallet(neighbor).workshop.stock.find(item => item.type === 'iron');
  ledger.workshopAction(seller, delivery);
  assert.equal(ledger.wallet(seller).gold + order(seller).budget, cashBefore);
  assert.equal(ledger.wallet(seller).rig, 'oak');
  assert.equal(ledger.wallet(seller).workshop.inventory.length, 0);
  const stockAfter = ledger.wallet(neighbor).workshop.stock.find(item => item.type === 'iron');
  assert.equal(stockAfter.count, stockBefore.count + 1);
  assert.ok(stockAfter.price < stockBefore.price);
  assert.ok(order(neighbor).price < oldQuote.price);
  assert.throws(() => ledger.workshopAction(neighbor, oldQuote), /offer changed/);
  ledger.workshopAction(seller, delivery);
  assert.equal(order(neighbor).received, 1);
  assert.equal(ledger.wallet(seller).gold + order(seller).budget, cashBefore);

  ledger.workshopAction(neighbor, quote(neighbor, second));
  for (let i = 0; i < 2; i++) {
    const item = buyRig(seller);
    ledger.workshopAction(seller, quote(seller, item));
  }
  assert.equal(order(neighbor).remaining, 0);
  assert.equal(order(neighbor).budget, 0);
  assert.equal(order(neighbor).restockAt, now + MERCHANT_RESTOCK_MS);
  const extra = buyRig(neighbor);
  const previousCycle = { ...quote(neighbor, extra), price: delivery.price };
  assert.throws(() => ledger.workshopAction(neighbor, quote(neighbor, extra)), /filled this order/);
  assert.ok(ledger.wallet(neighbor).workshop.inventory.some(item => item.id === extra));

  const treasury = ledger.wallet(neighbor).treasury;
  now += MERCHANT_RESTOCK_MS - 1;
  assert.equal(ledger.sweep(), false);
  assert.equal(order(neighbor).remaining, 0);
  now++;
  assert.equal(ledger.sweep(), true);
  assert.equal(order(neighbor).itemType, 'cork');
  assert.equal(order(neighbor).remaining, 4);
  assert.equal(order(neighbor).restockAt, null);
  assert.equal(ledger.wallet(neighbor).treasury + order(neighbor).budget, treasury);
  assert.equal(ledger.sweep(), false);

  for (let i = 0; i < 4; i++) {
    ledger.workshopAction(seller, quote(seller, buyRig(seller, 'cork')));
  }
  now += MERCHANT_RESTOCK_MS;
  assert.equal(ledger.sweep(), true);
  assert.equal(order(neighbor).itemType, 'iron');
  assert.equal(order(neighbor).price, previousCycle.price);
  assert.notEqual(order(neighbor).order, previousCycle.order);
  assert.throws(() => ledger.workshopAction(neighbor, previousCycle), /offer changed/);
  const sellerBeforeRetry = ledger.wallet(seller);
  ledger.workshopAction(seller, delivery);
  assert.deepEqual(ledger.wallet(seller), sellerBeforeRetry);
  ledger.workshopAction(neighbor, quote(neighbor, extra));
  assert.equal(order(neighbor).remaining, 3);
});

test('a legacy completed order waits for funding while keeping the treasury reserve', () => {
  const nextBudget = merchantOrder({ cycle: 1 }).budget;
  const state = { treasury: MERCHANT_TREASURY_RESERVE + nextBudget - 1,
    merchant: { received: 4, budget: 0 } };
  advanceMerchant(state, 0);
  assert.equal(merchantOrder(state.merchant).restockAt, MERCHANT_RESTOCK_MS);
  advanceMerchant(state, MERCHANT_RESTOCK_MS);
  assert.equal(merchantOrder(state.merchant).waitingForFunds, true);
  assert.equal(merchantOrder(state.merchant).restockAt, MERCHANT_RESTOCK_MS + MERCHANT_RETRY_MS);
  assert.equal(state.treasury, MERCHANT_TREASURY_RESERVE + nextBudget - 1);
  state.treasury++;
  advanceMerchant(state, MERCHANT_RESTOCK_MS + MERCHANT_RETRY_MS);
  assert.equal(merchantOrder(state.merchant).waitingForFunds, false);
  assert.equal(merchantOrder(state.merchant).itemType, 'cork');
  assert.equal(state.treasury, MERCHANT_TREASURY_RESERVE);
});

test('the initial equipment reward cannot be converted into merchant gold', (t) => {
  const ledger = openEconomy(':memory:');
  t.after(() => ledger.close());
  const id = ledger.findAccount(ledger.createAccount());
  ledger.completeFirstBrawl(id);
  ledger.claimFirstBrawl(id, 'iron');
  const before = ledger.wallet(id);
  const { order, price } = before.workshop.merchant;
  assert.throws(() => ledger.workshopAction(id, {
    type: 'gear-sell-merchant', id: before.workshop.equipped, order, price,
  }), /tradeable iron hoop/);
  assert.deepEqual(ledger.wallet(id), before);
});

test('dock prices rotate and selling equipped goods clears the loadout exactly once', (t) => {
  let now = MERCHANT_RESTOCK_MS - 1_000;
  const ledger = openEconomy(':memory:', () => now);
  t.after(() => ledger.close());
  const id = ledger.findAccount(ledger.createAccount());
  const wallet = () => ledger.wallet(id);
  const quote = type => wallet().workshop.dock.quotes[type];
  const item = randomUUID();
  const type = 'iron';
  ledger.workshopAction(id, { type: 'gear-buy-stock', id: item, rig: type, price: quote(type).ask });
  ledger.workshopAction(id, { type: 'gear-equip', id: item });
  const sell = () => ({ type: 'gear-sell-merchant', id: item, order: quote(type).order, price: quote(type).bid });
  const stale = sell();
  now += 1_000;
  assert.equal(quote(type).wanted, true);
  assert.ok(quote(type).bid > quote(type).normalBid);
  assert.notEqual(quote(type).bid, stale.price);
  assert.throws(() => ledger.workshopAction(id, stale), /offer changed/);
  const accepted = sell();
  const before = wallet();
  ledger.workshopAction(id, accepted);
  ledger.workshopAction(id, accepted);
  const after = wallet();
  assert.equal(after.rig, 'oak');
  assert.equal(quote(type).wanted, false);
  assert.equal(quote(type).bid, quote(type).normalBid);
  assert.equal(quote(type).count, before.workshop.dock.quotes[type].count + 1);
  assert.equal(after.workshop.inventory.length, 0);
  assert.equal(after.gold, before.gold + accepted.price);
  assert.equal(after.treasury, before.treasury - accepted.price);
});
