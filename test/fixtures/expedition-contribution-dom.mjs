import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { parseHTML } from 'linkedom';
const { window, document } = parseHTML(readFileSync(new URL('../../index.html', import.meta.url), 'utf8'));
Object.assign(globalThis, { window, document, Event: window.Event, CustomEvent: window.CustomEvent });
const intervals = [];
window.setInterval = (callback, ms) => { intervals.push({ callback, ms }); return intervals.length; };
registerHooks({ load(url, context, next) {
  if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: '' };
  if (url.endsWith('/item-thumbnail.js')) return { format: 'module', shortCircuit: true,
    source: 'export const itemThumbnail=()=>document.createElement("img");' };
  return next(url, context);
} });
const { createExpeditions } = await import('../../src/expeditions.js');
const { setNearSocialAccount } = await import('../../src/near-wallet.js');
const get = name => document.getElementById('expeditions-' + name);
const form = get('form');
const amount = get('amount');
const dialog = get('confirm');
Object.defineProperty(amount, 'valueAsNumber', { get() { return this.value === '' ? NaN : Number(this.value); } });
form.checkValidity = () => amount.valueAsNumber >= Number(amount.min) && amount.valueAsNumber <= Number(amount.max);
form.reportValidity = () => form.checkValidity();
dialog.showModal = () => { dialog.open = true; };
dialog.close = value => { dialog.returnValue = value; dialog.open = false; dialog.dispatchEvent(new window.Event('close')); };
const sent = [];
const submitted = [];
globalThis.fetch = async (url, options) => {
  submitted.push(JSON.parse(options.body));
  return Response.json({ status: { SuccessValue: '' }, transaction: { hash: 'test-receipt' } });
};
const account = 'a'.repeat(64);
setNearSocialAccount(account, 'arena.testnet', true);
const expeditions = createExpeditions(message => { sent.push(message); return true; }, () => true);
expeditions.setContract('arena.testnet', true);
expeditions.update({}, true, true);
const funding = { id: 'voyage-7', campaignId: 7, status: 'funding', target: 3000, funded: 2000,
  supporters: 1, minSupporters: 2, minimumContribution: 100, maxContribution: 1000,
  itemType: 'gilded-parrot', feePercent: 5, fundingEndsAt: Date.now() + 300000 };
const state = campaign => ({ account, gold: 20000, nonce: 0, registered: true, managedFinalization: true, campaign });
const submit = value => { amount.value = String(value); form.dispatchEvent(new window.Event('submit', { cancelable: true })); };
expeditions.setChain(state(funding));
submit(60);
assert.equal(Number(amount.value), 10);
assert.equal(dialog.open, true);
assert.match(get('confirm-title').textContent, /10\.00/);
// Another contributor changes the maximum while the confirmation is open.
expeditions.setChain(state({ ...funding, funded: 2500, maxContribution: 500 }));
dialog.close('confirm');
assert.equal(submitted.length, 0, 'a changed quote requires a fresh review before any payment');
assert.equal(Number(amount.value), 5);
expeditions.setChain(state(funding));
submit(60);
dialog.close('cancel');
assert.equal(submitted.length, 0, 'cancelled funding cannot be charged');
submit(60);
dialog.close('confirm');
const beforePoll = sent.length;
intervals.find(timer => timer.ms === 5000).callback();
assert.equal(sent.length, beforePoll + 1, 'campaign polling continues while the signing request is pending');
await new Promise(setImmediate);
assert.equal(submitted.length, 1);
assert.equal(submitted[0].method, 'contribute');
assert.equal(submitted[0].args.amount, 1000, 'only the missing 10 GOLD is signed, not the entered 60');
assert.equal(submitted[0].args.campaign_id, 7);
expeditions.setChain({ ...state({ ...funding, status: 'auction', nextBid: 100, highestBid: 0, auctionEndsAt: Date.now() + 300000 }),
  nonce: 1, transactionHash: 'test-receipt', transactionStatus: 'finalized' });
submit(60);
assert.match(get('confirm-title').textContent, /60\.00/);
dialog.close('confirm');
await new Promise(setImmediate);
assert.equal(submitted[1].method, 'bid');
assert.equal(submitted[1].args.amount, 6000, 'auction bids keep the amount the player reviewed');
console.log('PASS contribution cap, stale review, cancellation, exact debit and independent bid amount');
