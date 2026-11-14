import './style.css';
import './pirate-ui.css';
import './judges-expeditions.css';
import { itemThumbnail } from './item-thumbnail.js';
import { cosmeticFor } from '../shared/cosmetics.mjs';

const get = id => document.getElementById(id);
const money = cents => (cents / 100).toFixed(2);
const receiptUrl = hash => 'https://testnet.nearblocks.io/txns/' + encodeURIComponent(hash);
const key = 'afloat:judges-expedition:pending';
let state, pending = null, submitting = false, polling = false;
let readNotBefore = 0;
function applyBackoff(response, result) {
  const delay = Number(result?.retryAfterMs) || Number(response.headers.get('Retry-After')) * 1000;
  if (Number.isFinite(delay) && delay > 0) readNotBefore = Date.now() + Math.min(120000, delay);
}
try { pending = JSON.parse(localStorage.getItem(key)); } catch {}
const status = text => { get('rehearsal-status').textContent = text; };
function remember(value) { pending = value; try { if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key); } catch {} }
function button(label, action, options = {}, disabled = false) {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
  b.disabled = submitting || Boolean(pending) || Date.now() < readNotBefore || disabled;
  b.addEventListener('click', () => submit({ id: crypto.randomUUID(), action, campaignId: state.campaign.id, ...options }));
  return b;
}
function render() {
  if (!state?.available) return;
  const c = state.campaign;
  for (const el of document.querySelectorAll('[data-stage]')) el.toggleAttribute('aria-current', el.dataset.stage === c.status);
  get('stage-title').textContent = { funding: 'Fund the voyage', sailing: 'Ready to find treasure', auction: 'Auction open', settled: 'Treasure sold!' }[c.status] ?? c.status;
  get('stage-help').textContent = { funding: 'Two crews, one target. No deadline.', sailing: 'The ship is ready. Open the auction whenever you want.', auction: 'Try bidding with both crews to see the losing bid refunded. No countdown.', settled: 'The highest bidder owns the cargo. Crew shares are already paid; equip whenever you want.' }[c.status] ?? '';
  get('voyage-progress').textContent = c.status === 'funding' ? `${money(c.funded)} / ${money(c.target)} demo GOLD · ${c.contributor_count}/2 crews` :
    c.status === 'settled' ? `${money(c.sale)} sale − ${money(c.fee)} house = ${money(c.net)} crew proceeds` : c.status === 'auction' ? `Highest bid: ${money(c.highest_bid)} · Next: ${money(c.minimum_bid)}` : '';
  const actions = get('rehearsal-actions'); actions.replaceChildren();
  if (['funding', 'sailing', 'auction'].includes(c.status)) actions.append(button(
    { funding: 'Sail →', sailing: 'Open auction →', auction: 'Close & split →' }[c.status], 'advance', { expectedStatus: c.status },
    c.status === 'funding' ? c.funded !== c.target || c.contributor_count < 2 : c.status === 'auction' && !c.highest_bid));
  if (c.status === 'settled') actions.append(button('Start another rehearsal', 'restart', { expectedStatus: 'settled' }));
  get('demo-crews').replaceChildren(...state.crews.map((crew, i) => {
    const card = document.createElement('section'); card.className = 'rehearsal-card demo-crew';
    const h = document.createElement('h2'); h.textContent = crew.name;
    const data = document.createElement('p'); data.textContent = `${money(crew.balance)} GOLD available · ${money(crew.contribution)} funded · ${money(crew.payout)} paid back`;
    card.append(h, data);
    if (c.status === 'funding') card.append(button(`Fund ${i === 0 ? '20' : '10'} GOLD`, 'fund', { crew: i }, crew.contribution > 0 || !crew.max_contribution));
    if (c.status === 'auction') {
      const b = i === 0 ? 7000 : 8000;
      card.append(button(`Bid ${money(b)} GOLD`, 'bid', { crew: i, amount: b }, b < c.minimum_bid || b - (c.highest_bidder === crew.id ? c.highest_bid : 0) > crew.balance));
      const note = document.createElement('small'); note.textContent = c.highest_bidder === crew.id ? 'Leading · bid reserved' : 'Previous bid released when outbid'; card.append(note);
    }
    if (crew.awards?.includes(c.item_type)) {
      card.append(button(crew.award_equipped ? 'Parrot equipped ✓' : c.status === 'settled' && c.winner === crew.id ? 'Equip the treasure' : 'Equip owned parrot', 'equip', { crew: i }, crew.award_equipped));
      if (crew.award_equipped) card.append(itemThumbnail(cosmeticFor('pet-expedition-parrot')));
    }
    return card;
  }));
  get('rehearsal-receipts').replaceChildren(...state.receipts.slice().reverse().map(r => {
    const link = document.createElement('a'); link.href = receiptUrl(r.hash); link.target = '_blank'; link.rel = 'noopener';
    link.textContent = `${r.action} · ${r.success ? 'confirmed' : 'rejected'} ↗`; return link;
  }));
  const contracts = get('rehearsal-contracts'); contracts.replaceChildren();
  for (const [name, id] of [['Contract', state.contract], ['Demo GOLD', state.token]]) {
    const link = document.createElement('a'); link.href = 'https://testnet.nearblocks.io/address/' + id; link.target = '_blank'; link.rel = 'noopener'; link.textContent = `${name}: ${id}`; contracts.append(link, document.createElement('br'));
  }
  get('retry-confirmation').hidden = !pending || submitting;
  get('retry-confirmation').disabled = Date.now() < readNotBefore;
}
async function refresh() {
  if (polling || Date.now() < readNotBefore || document.hidden) return;
  polling = true;
  try {
    const r = await fetch('/judges-expedition/state', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const result = await r.json();
    if (!r.ok) {
      applyBackoff(r, result);
      render();
      throw new Error(result.message ?? 'The rehearsal is temporarily unavailable. Updates will resume automatically.');
    }
    state = result; render();
    if (!submitting && !pending) status(state.pending ? 'Another judge has an action pending. Your next click will check its confirmation first.' : `Finalized block ${state.block}. No timers: continue whenever you want.`);
  } catch (error) { if (!submitting) status(error.message); }
  finally { polling = false; }
}
async function submit(input = pending) {
  if (submitting || !input || Date.now() < readNotBefore) return;
  remember(input); submitting = true; render(); status('Confirming on NEAR testnet… You can wait here; no stage will expire.');
  try {
    const r = await fetch('/judges-expedition/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(90000) });
    const result = await r.json();
    if (!r.ok) {
      applyBackoff(r, result);
      // Keep the same request ID on ambiguous receipt/network failures.
      if (r.status < 500 && r.status !== 429 && !/confirmation|confirming|unavailable/i.test(result.message ?? '')) remember(null);
      throw new Error(result.message ?? 'Please retry confirmation.');
    }
    remember(null); state = result.state;
    status(result.receipt.success ? 'Confirmed on testnet ✓' : 'Rejected on testnet. Refresh and try the current action.');
  } catch (error) { status(error.name === 'TimeoutError' ? 'Still waiting for confirmation. Retry safely with the same request.' : error.message); }
  finally { submitting = false; render(); await refresh(); }
}
get('retry-confirmation').addEventListener('click', () => submit());
get('cargo-picture').append(itemThumbnail(cosmeticFor('pet-expedition-parrot')));
await refresh();
if (pending) await submit();
setInterval(refresh, 4000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
