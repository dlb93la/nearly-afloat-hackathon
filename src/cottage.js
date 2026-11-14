import { DEFAULT_RIG, PATCH_PRICE, PATCH_SCRAP_COST, RIG_USES, rigFor } from '../shared/rigs.mjs';
import { ITEMS, cosmeticFor } from '../shared/cosmetics.mjs';
import { goldLabel } from './harbor.js';
import { gameIcon } from './game-icons.js';
import { itemThumbnail } from './item-thumbnail.js';
import { createPlayerMarkerControls } from './player-markers.js';

const gearSlots = [['barrelPaint', 'Barrel colors', 'barrel'], ['rig', 'Equip your barrel', 'barrel'], ['pirate', 'Outfit', 'shirt'], ['pet', 'Pet', 'parrot']];
const decorSlots = [['seat', 'Bunk', 'home'], ['rug', 'Rug', 'flag'], ['ornament', 'Keepsake', 'chest'], ['arena', 'Arena theme', 'flag']];

export function createCottage(send, openNearInventory, closeNearInventory = () => {}, homeState = () => null) {
  const panel = document.getElementById('cottage');
  const content = document.getElementById('cottage-content');
  const notice = document.getElementById('cottage-notice');
  const brawl = document.getElementById('cottage-brawl');
  const shop = document.getElementById('cottage-shop');
  const tabs = Array.from(panel.querySelectorAll('[data-cottage-tab]'));
  let tab = 'home';
  let nearAccount;
  let activity;
  let receiptAccount;
  let receipts = [];
  let wallet;
  let online;
  let ready;
  let pending;
  let rendered;

  function selectTab(next) {
    tab = next;
    if (tab === 'log' && nearAccount) send({ type: 'near-logbook-view' });
    notice.hidden = true;
    render();
  }

  function quarters() {
    const state = homeState();
    const section = document.createElement('section');
    section.className = 'cottage-quarters';
    const heading = document.createElement('h3');
    heading.append(gameIcon('flag'), 'Your spoils. Your space.');
    const detail = document.createElement('p');
    detail.textContent = 'Bring home the loot. Make it yours.';
    section.append(heading, detail);
    const display = document.createElement('div');
    display.className = 'cottage-display';
    const trophy = document.createElement('div');
    trophy.className = 'cottage-milestone';
    const earned = wallet?.firstBrawl?.status === 'claimed';
    trophy.append(gameIcon(earned ? 'trophy' : 'sword'));
    const title = document.createElement('strong');
    title.textContent = earned ? 'First Brawl' : 'Your story starts here';
    const note = document.createElement('small');
    note.textContent = earned ? 'Starter barrel earned' : 'Finish your first brawl';
    trophy.append(title, note);
    display.append(trophy);
    const treasures = (state?.owned ?? []).map(id => ITEMS[id]).filter(item => item?.expeditionOnly);
    for (const item of treasures) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'cottage-treasure';
      const name = document.createElement('strong');
      name.textContent = item.label;
      tile.append(itemThumbnail(item), name);
      tile.addEventListener('click', () => selectTab(item.slot === 'pet' ? 'gear' : 'decor'));
      display.append(tile);
    }
    section.append(display);
    const actions = document.createElement('div');
    actions.className = 'cottage-home-actions';
    for (const [next, label, icon, value] of [
      ['gear', 'Your locker', 'barrel', state ? state.rigs.length + 1 : null],
      ['decor', 'Furnish your quarters', 'home', state ? state.owned.filter(id => ITEMS[id] && !['pirate', 'pet', 'barrelPaint'].includes(ITEMS[id].slot)).length : null],
      ['log', 'Your logbook', 'trophy', null],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.append(gameIcon(icon), label);
      if (value != null) {
        const count = document.createElement('small');
        count.textContent = String(value);
        button.append(count);
      }
      button.addEventListener('click', () => selectTab(next));
      actions.append(button);
    }
    section.append(actions);
    return section;
  }

  function finish(message) {
    pending = null;
    notice.textContent = message;
    notice.hidden = !message;
    render();
  }

  function act(type, data) {
    if (!online || pending || !send({ type, ...data })) return;
    pending = type;
    notice.hidden = true;
    render();
  }

  function option(slot, item, label, icon, selected) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.option = slot + '/' + (item?.id ?? '');
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('aria-disabled', String(!online || Boolean(pending) || selected || (slot === 'rig' && item?.uses === 0)));
    const preview = slot === 'rig' ? rigFor(item?.type ?? DEFAULT_RIG) : cosmeticFor(item?.type);
    button.append(preview ? itemThumbnail(preview) : gameIcon(icon), preview?.label ?? label);
    if (selected) button.append(gameIcon('check'));
    if (slot === 'rig' && item) {
      const uses = document.createElement('small');
      uses.append(gameIcon('durability'), String(item.uses));
      uses.title = item.uses + ' uses left';
      button.append(uses);
    }
    button.addEventListener('click', () => {
      if (!selected && !(slot === 'rig' && item?.uses === 0)) {
        act(slot === 'rig' ? 'gear-equip' : 'gear-style', { slot, id: item?.id ?? null });
      }
    });
    return button;
  }

  function slotRow([slot, label, icon]) {
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    heading.append(gameIcon(icon), label);
    const options = document.createElement('div');
    options.className = 'cottage-options';
    const gear = wallet.workshop;
    const equipped = slot === 'rig' ? gear.equipped : gear.cosmetics?.[slot];
    const owned = gear.inventory.filter(item => !item.listing && !item.locked &&
      (slot === 'rig' ? !cosmeticFor(item.type) : cosmeticFor(item.type)?.slot === slot));
    if (slot === 'barrelPaint') for (const paint of Object.values(ITEMS)) {
      if (paint.free) owned.push({ id: paint.id, type: paint.id });
    }
    const fallback = slot === 'pet' ? 'No pet' : 'Original';
    options.append(option(slot, null, fallback, icon, !equipped));
    for (const item of owned) {
      const button = option(slot, item, label, icon, equipped === item.id);
      if (slot !== 'rig' || item.uses === RIG_USES || (item.patched && item.uses)) {
        options.append(button);
        continue;
      }
      const tile = document.createElement('div');
      tile.className = 'cottage-maintenance';
      tile.append(button);
      const repair = document.createElement('button');
      repair.type = 'button';
      const scrap = gear.scrap >= PATCH_SCRAP_COST;
      repair.disabled = !online || Boolean(pending) || (!item.patched && !scrap && wallet.gold < PATCH_PRICE);
      repair.append(gameIcon(item.patched ? 'trash' : 'repair'), item.patched
        ? 'Recycle' : 'Patch · ' + (scrap ? PATCH_SCRAP_COST + ' scrap' : goldLabel(PATCH_PRICE)));
      repair.addEventListener('click', () => act(item.patched ? 'gear-discard' : 'gear-patch', {
        id: item.id, payment: scrap ? 'scrap' : undefined,
      }));
      tile.append(repair);
      options.append(tile);
    }
    section.append(heading, options);
    return section;
  }

  function logbook() {
    const entry = document.createElement('div');
    entry.className = 'cottage-entry';
    const completed = wallet.firstBrawl?.status;
    const title = document.createElement('strong');
    title.textContent = 'First Brawl';
    const detail = document.createElement('span');
    detail.textContent = completed === 'claimed' ? rigFor(wallet.firstBrawl.rig).label + ' earned'
      : completed === 'ready' ? 'Starter barrel ready at Barrel Works' : 'Finish a Quick Brawl';
    entry.append(gameIcon(completed ? 'trophy' : 'sword'), title, detail);
    if (!nearAccount) return entry;
    const section = document.createElement('section');
    const refresh = document.createElement('button');
    refresh.textContent = 'Refresh activity';
    refresh.type = 'button';
    refresh.disabled = !online;
    refresh.addEventListener('click', () => send({ type: 'near-logbook-view' }));
    section.append(entry, refresh);
    if (activity?.error) {
      const message = document.createElement('p');
      message.textContent = activity.error;
      section.append(message);
    }
    for (const item of [...(activity?.entries ?? [])].reverse()) {
      const row = document.createElement('div');
      row.className = 'cottage-entry';
      const label = document.createElement('strong');
      label.textContent = [item.event, item.action, item.item].filter(Boolean).join(' · ').replaceAll('_', ' ');
      const detail = document.createElement('span');
      const delta = (amount, format, unit) => amount ? (amount > 0 ? '+' : '−') + format(Math.abs(amount)) + ' ' + unit : '';
      detail.textContent = [new Date(item.at).toLocaleString(), delta(item.gold_delta, goldLabel, 'gold'),
        delta(item.scrap_delta, String, 'scrap')].filter(Boolean).join(' · ');
      row.append(label, detail);
      section.append(row);
    }
    if (receiptAccount === nearAccount) for (const receipt of receipts) {
      const publicReceipt = receipt.network === 'testnet' && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(receipt.hash);
      const row = document.createElement(publicReceipt ? 'a' : 'small');
      row.textContent = publicReceipt ? receipt.label + ' ↗' : receipt.label + ' · ' + receipt.hash.slice(0, 8);
      if (publicReceipt) {
        row.href = 'https://testnet.nearblocks.io/txns/' + receipt.hash;
        row.target = '_blank';
        row.rel = 'noopener noreferrer';
      }
      section.append(row, document.createElement('br'));
    }
    return section;
  }

  function colorControls() {
    const { pirateColor, barrelColor } = wallet.workshop.appearance;
    const section = document.createElement('details');
    const heading = document.createElement('summary');
    heading.textContent = 'Personal colors';
    const form = document.createElement('form');
    form.className = 'cottage-colors';
    const pick = (name, initial, fallback) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'color';
      input.value = initial ?? fallback;
      input.disabled = !online || Boolean(pending);
      label.append(name, input);
      form.append(label);
      return input;
    };
    const pirate = pick('Pirate', pirateColor, '#e35c4c');
    const barrel = pick('Barrel', barrelColor, '#e35c4c');
    const note = document.createElement('small');
    note.textContent = 'Equipped gear can change your look.';
    const save = document.createElement('button');
    save.type = 'submit';
    save.disabled = !online || Boolean(pending);
    save.textContent = 'Save colors';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.disabled = !online || Boolean(pending) || (!pirateColor && !barrelColor);
    reset.textContent = 'Reset';
    reset.addEventListener('click', () => act('gear-colors', { pirate: null, barrel: null }));
    form.addEventListener('submit', event => {
      event.preventDefault();
      act('gear-colors', { pirate: pirate.value, barrel: barrel.value });
    });
    form.append(save, reset, note);
    section.append(heading, form);
    return section;
  }

  function render() {
    if (panel.hidden) return;
    brawl.disabled = shop.disabled = !ready || Boolean(pending);
    const chainOnly = document.body.classList.contains('unified-near-economy');
    const next = JSON.stringify([chainOnly, tab, wallet?.firstBrawl, wallet?.workshop?.inventory, wallet?.workshop?.equipped,
      wallet?.workshop?.cosmetics, wallet?.workshop?.appearance, wallet?.workshop?.scrap, wallet?.gold, online, pending, nearAccount, activity, receipts, homeState()]);
    if (next === rendered) return;
    rendered = next;
    for (const button of tabs) button.setAttribute('aria-pressed', String(button.dataset.cottageTab === tab));
    const focus = document.activeElement?.dataset.option;
    if (!wallet?.workshop) {
      content.textContent = 'Loading your gear and logbook…';
    } else {
      if (chainOnly && (tab === 'gear' || tab === 'decor')) {
        openNearInventory(tab);
        return;
      }
      closeNearInventory();
      const sections = tab === 'home' ? [quarters()] : tab === 'log' ? [logbook()] : (tab === 'gear' ? gearSlots : decorSlots).map(slotRow);
      if (tab === 'gear') sections.splice(1, 0, colorControls(), createPlayerMarkerControls());
      content.replaceChildren(...sections);
      if (focus) Array.from(content.querySelectorAll('[data-option]'))
        .find(button => button.dataset.option === focus)?.focus({ preventScroll: true });
    }
  }

  for (const button of tabs) button.addEventListener('click', () => {
    selectTab(button.dataset.cottageTab);
  });

  return {
    refresh: render,
    update(nextWallet, connected, canPlay, visible, account) {
      if (visible && connected && account && (panel.hidden || account !== nearAccount)) send({ type: 'near-workshop-view', account });
      if (panel.hidden && visible) rendered = null;
      const fetchActivity = connected && visible && tab === 'log' && account && (panel.hidden || account !== nearAccount);
      if (account !== nearAccount) activity = null;
      nearAccount = account;
      if (fetchActivity) send({ type: 'near-logbook-view' });
      wallet = nextWallet;
      online = connected;
      panel.hidden = !visible;
      ready = canPlay;
      if (!connected && pending) finish('Connection lost. Try again when online.');
      render();
    },
    receiveActivity(message) {
      if (message.account !== nearAccount) return;
      activity = message;
      if (message.receipts) {
        receiptAccount = message.account;
        receipts = message.receipts.map(receipt => ({ ...receipt, network: message.receiptNetwork }));
      }
      render();
    },
    rememberReceipt(account, hash, label, network) {
      if (!account || typeof hash !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash)) return;
      if (receiptAccount !== account) receipts = [];
      receiptAccount = account;
      if (receipts.some(receipt => receipt.hash === hash)) return;
      receipts = [{ hash, label, network }, ...receipts].slice(0, 12);
      render();
    },
    acknowledge(action) {
      if (pending !== action) return false;
      finish(action === 'gear-equip' ? 'Barrel equipped' : 'Saved');
      return true;
    },
    error(message) {
      if (!pending) return false;
      finish(message);
      return true;
    },
  };
}
