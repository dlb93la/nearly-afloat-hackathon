import { DEFAULT_RIG, PATCH_PRICE, PATCH_SCRAP_COST, RIG_USES, RIGS, rigFor } from '../shared/rigs.mjs';
import { COSMETIC_CHEST_PRICE, ITEMS, LOOT_POOL } from '../shared/cosmetics.mjs';
import { RARITIES, rarityFor, lootRarityOdds } from '../shared/rarities.mjs';
import { goldLabel } from './harbor.js';
import { itemThumbnail } from './item-thumbnail.js';
import { gameIcon } from './game-icons.js';
import { signNearWorkshop, usesNearSocialAccount, requiresGameSessionRenewal } from './near-wallet.js';
import { createPlayerMarkerControls } from './player-markers.js';
import { availableGold, holdGold } from './pending-gold.js';
import './near-workshop.css';

const HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const CHECK_INTERVAL_MS = 3_000;
const VIEW_TIMEOUT_MS = 30_000;
const RIG_PREVIEWS = Object.fromEntries(Object.entries(RIGS).map(([id, config]) => [id, { ...config, id }]));

function element(tag, text, className) {
  const result = document.createElement(tag);
  if (text) result.textContent = text;
  if (className) result.className = className;
  return result;
}

export function createNearWorkshop(send, connectAccount) {
  const get = id => document.getElementById('near-workshop' + (id ? '-' + id : ''));
  const dialog = get();
  const shop = document.getElementById('workshop');
  const dialogHome = dialog.parentElement;
  let shopVisible = false;
  const review = get('review');
  const open = get('open');
  const connect = get('connect');
  const items = get('items');
  const status = get('status');
  const receipt = get('receipt');
  let contract = '';
  let account = '';
  let connecting = false;
  let connectionPending = false;
  let renewalRequired = false;
  let connectionVersion = 0;
  let viewDeadline = 0;
  let offerWindow = -1;
  let workshop = null;
  let mode = 'shop';
  let category = 'rigs';
  let trade = 'buy';
  const trading = get('trade');
  const categories = get('categories');
  const lockerNav = element('nav', '', 'locker-nav');
  lockerNav.setAttribute('aria-label', 'Your gear');
  const lockerBody = element('div', '', 'locker-body');
  dialog.dataset.lockerSection = 'paint';
  const lockerSections = Object.fromEntries([
    ['paint', 'Barrel colors', 'barrel'], ['equip', 'Equip your gear', 'shirt'], ['repair', 'Repairs', 'repair'],
  ].map(([id, label, icon]) => {
    const section = element('section', '', 'locker-section');
    section.id = 'locker-' + id;
    const heading = element('h3');
    heading.append(gameIcon(icon), label);
    section.append(heading);
    const button = element('button', '', 'symbol-button');
    button.type = 'button';
    button.append(gameIcon(icon), id === 'paint' ? 'Colors' : id === 'equip' ? 'Equip' : 'Repair');
    button.setAttribute('aria-controls', section.id);
    button.setAttribute('aria-pressed', String(id === 'paint'));
    button.addEventListener('click', () => {
      dialog.dataset.lockerSection = id;
      for (const tab of lockerNav.children) tab.setAttribute('aria-pressed', String(tab === button));
      if (document.body.dataset.uiLayout === 'mobile') {
        lockerBody.scrollTop = 0;
        return;
      }
      const scrollArea = lockerBody.scrollHeight > lockerBody.clientHeight ? lockerBody : document.getElementById('cottage');
      scrollArea.scrollTo({ top: section.getBoundingClientRect().top - scrollArea.getBoundingClientRect().top + scrollArea.scrollTop,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    });
    lockerNav.append(button);
    lockerBody.append(section);
    return [id, section];
  }));
  const markerColors = createPlayerMarkerControls();
  const markerOptions = element('details', '', 'locker-marker-options');
  markerOptions.append(element('summary', 'Player markers'), markerColors);
  let markerLayout = document.body.dataset.uiLayout;
  markerOptions.open = markerLayout !== 'mobile';
  window.addEventListener('resize', () => window.requestAnimationFrame(() => {
    const nextLayout = document.body.dataset.uiLayout;
    if (nextLayout === markerLayout) return;
    markerLayout = nextLayout;
    markerOptions.open = nextLayout !== 'mobile';
  }), { passive: true });
  lockerSections.paint.append(markerOptions);
  const repairs = element('div', '', 'workshop-items');
  lockerSections.repair.append(element('small', 'Optional. Barrels with uses left can be equipped without repairing.'), repairs);
  items.before(lockerNav, lockerBody);
  let homeSnapshot = null;
  let reserveData = null;
  let reserveCheckedAt = 0;
  const reserveNotice = element('details', '', 'merchant-reserve');
  reserveNotice.hidden = true;
  reserveNotice.append(element('summary', 'Merchant reserve'));
  const reserveDetail = element('p');
  const reserveReceipt = element('a', 'View trade receipt ↗');
  reserveReceipt.target = '_blank'; reserveReceipt.rel = 'noopener noreferrer'; reserveReceipt.hidden = true;
  reserveNotice.append(reserveDetail, reserveReceipt);
  get('balance').parentElement.after(reserveNotice);
  let collection = null;
  let quotes = [];
  let online = false;
  let busy = false;
  let approved = null;
  let hash = null;
  let receiptUrl = null;
  let checking = false;
  let message = '';
  let chestItem = null;
  let releaseGold;
  const spendableGold = () => availableGold(account, workshop?.gold ?? 0);
  const info = element('dialog', '', 'pier-card workshop-info near-item-info');
  info.setAttribute('aria-labelledby', 'near-item-info-title');
  const infoTitle = element('h3');
  infoTitle.id = 'near-item-info-title';
  const infoArt = element('div');
  const infoDetail = element('p');
  const infoStats = element('div');
  const infoActions = element('div', '', 'workshop-actions');
  const infoForm = element('form');
  infoForm.method = 'dialog';
  const infoClose = element('button', 'Close');
  infoClose.autofocus = true;
  infoForm.append(infoClose);
  info.append(infoTitle, infoArt, infoDetail, infoStats, infoActions, infoForm);
  dialogHome.append(info);
  const reviewArt = element('div', '', 'near-review-art');
  get('review-detail').before(reviewArt);
  const lootChest = { slot: 'loot', label: 'Castaway Chest', color: 0xb07738 };
  const statKeys = [['force', 'Acceleration', 'drive'], ['impact', 'Impact weight', 'mass'], ['control', 'Turning control', 'turn'], ['speed', 'Top speed', 'speed']];
  const descriptions = {
    pirate: 'Wear this pirate outfit and hat in the arena.',
    pet: 'This companion rides on your pirate’s head in the arena.',
    barrelPaint: 'Changes your barrel’s colors and crest. Handling stays the same.',
    chest: 'Changes the appearance of your treasure chest.',
    arena: 'Changes the scenery of the arena you host.',
    home: 'Adds trim and a pennant to your cottage.',
    seat: 'A new bunk for your cottage. Equip it in Your Cottage.',
    rug: 'A decorative rug for your cottage. Equip it in Your Cottage.',
    ornament: 'A keepsake for your cottage. Equip it in Your Cottage.',
    loot: 'Contains one random outfit or head pet from the available shop stock.',
  };

  function statsFor(config) {
    const stats = element('div', '', 'item-stats');
    for (const [icon, label, key] of statKeys) {
      const value = Math.round(config[key] * 100);
      const badge = element('span', '', 'item-number');
      badge.setAttribute('aria-label', label + ': ' + value + '% of the standard barrel');
      badge.title = label;
      badge.append(gameIcon(icon), String(value));
      stats.append(badge);
    }
    return stats;
  }

  function showInfo(config) {
    infoTitle.textContent = config.label;
    infoArt.replaceChildren(itemThumbnail(config));
    infoDetail.textContent = config.slot ? descriptions[config.slot] : config.description ?? 'A balanced barrel with no wear.';
    if (config.free) infoDetail.textContent += ' Free to use; cannot be sold.';
    if (config.expeditionOnly) infoDetail.textContent += ' Earned through Expeditions.';
    infoDetail.textContent += ' ' + RARITIES[rarityFor(config)].label + '.';
    const supply = config.slot ? quotes.find(quote => quote.item === config.id) : workshop?.stock.find(quote => quote.rig === config.id);
    if (supply?.stock_limit != null) {
      infoDetail.textContent += ' Shop stock: ' + supply.count + '/' + supply.stock_limit + '.';
      if (supply.commercial_supply != null) infoDetail.textContent += ' Commercial edition: ' + supply.commercial_supply + ' units; '
        + (supply.circulating ?? 0) + ' circulating' + (supply.destroyed ? ', ' + supply.destroyed + ' recycled' : '') + '.';
      if (supply.legacy_circulation_untracked) infoDetail.textContent += ' Earlier player holdings are preserved; their total circulation is not tracked.';
      infoDetail.textContent += ' No timed stock refill.';
    }
    if (config.slot === 'loot') infoDetail.textContent += ' ' + chestOdds() + ' Chances follow available stock; duplicate items are possible.';
    if (!config.slot) {
      const owned = workshop?.items.find(item => item.rig === config.id);
      if (owned) infoDetail.textContent += ' ' + owned.uses + '/' + RIG_USES + ' uses remaining.'
        + (owned.locked ? ' Reserved for a round.' : '') + (owned.patched ? ' Already repaired.' : '');
    }
    infoStats.replaceChildren(...(config.slot ? [] : [statsFor(config)]));
    const source = dialog.querySelector('[data-item="' + config.id + '"] .workshop-actions');
    infoActions.replaceChildren();
    if (source) for (const original of source.querySelectorAll('button')) {
      if (!/^(Equip|Unequip)/.test(original.textContent)) continue;
      const action = element('button', original.textContent, 'item-action primary');
      action.type = 'button';
      action.disabled = original.disabled;
      action.addEventListener('click', () => { info.close(); original.click(); });
      infoActions.append(action);
    }
    if (!infoActions.children.length && workshop) {
      const gear = workshop.items.find(item => item.rig === config.id);
      const owned = config.slot ? config.free || collection?.owned[config.id] > 0 || collection?.award?.id === config.id
        : config.id === DEFAULT_RIG || gear?.uses > 0;
      const selected = config.slot ? collection?.equipped[config.slot] === config.id : workshop.equipped === config.id;
      if (owned && !selected) {
        const equip = element('button', 'Equip', 'item-action primary');
        equip.type = 'button';
        equip.disabled = !online || busy || checking || Boolean(gear?.locked);
        equip.addEventListener('click', () => {
          info.close();
          if (!config.slot) { showReview('Equip', config.id, 'equip', 'Use this barrel in your next round.', {}); return; }
          approved = config.expeditionOnly ? { method: 'equip_voyage_award', item: config.id, equipped: true }
            : { method: 'collection_action', action: 'equip', item: config.id };
          get('review-title').textContent = 'Equip ' + config.label;
          get('review-detail').textContent = 'Use this item.';
          reviewArt.replaceChildren(itemThumbnail(config));
          review.returnValue = '';
          review.showModal();
        });
        infoActions.append(equip);
      }
    }
    info.showModal();
  }

  function rarityCard(card, item) {
    const rarity = rarityFor(item);
    card.style.setProperty('--item-rarity', RARITIES[rarity].color);
    card.dataset.rarity = rarity;
    card.append(element('small', RARITIES[rarity].label, 'rarity-label'));
  }

  function showReserve(reserve) {
    reserveData = reserve;
    reserveNotice.hidden = !reserve || mode !== 'shop';
    if (reserve) {
      const stale = !Number.isFinite(reserve.at) || Date.now() - reserve.at > 180_000;
      const paused = !reserve.policy?.enabled || reserve.policy.expires_at <= Date.now();
      let activity = 'Watching supplies.';
      if (reserve.status === 'unavailable') activity = 'Reserve unavailable. Showing the last update.';
      else if (stale) activity = 'Reserve update expired. Showing past activity.';
      else if (paused) activity = 'Reserve paused.';
      else if (reserve.unresolved) activity = 'Checking the previous trade.';
      else if (reserve.last?.action === 'sell') activity = 'Replenishing stock.';
      else if (reserve.last?.action === 'buy') activity = 'Building the reserve.';
      reserveDetail.textContent = activity + ' Spent ' + goldLabel(reserve.policy?.spent ?? 0)
        + ' · Returned ' + goldLabel(reserve.policy?.revenue ?? 0)
        + ' · Budget ' + goldLabel(reserve.policy?.budget ?? 0) + ' gold.'
        + (Number.isFinite(reserve.at) ? ' Updated ' + new Date(reserve.at).toLocaleTimeString() + '.' : '');
    }
    reserveReceipt.hidden = reserve?.lastTrade?.network !== 'testnet' || !HASH.test(reserve?.lastTrade?.hash ?? '');
    if (!reserveReceipt.hidden) reserveReceipt.href = 'https://testnet.nearblocks.io/txns/' + reserve.lastTrade.hash;
    else reserveReceipt.removeAttribute('href');
  }

  function refreshReserve() {
    if (mode !== 'shop' || !online || !contract || Date.now() - reserveCheckedAt <= 60_000) return;
    reserveCheckedAt = Date.now();
    const expectedContract = contract;
    void fetch('/merchant-reserve.json', {cache:'no-store'}).then(reply => reply.ok ? reply.json() : null).then(reserve => {
      if (contract !== expectedContract) return;
      if (!reserve?.policy || reserve.contract !== contract || !Number.isFinite(reserve.at)) {
        if (reserveData) showReserve({ ...reserveData, status: 'unavailable' });
        return;
      }
      showReserve(reserve); render();
    }).catch(() => {
      if (contract === expectedContract && reserveData) showReserve({ ...reserveData, status: 'unavailable' });
    });
  }

  function chestOdds() {
    return lootRarityOdds(LOOT_POOL, ITEMS, quotes).map(({ rarity, percent }) =>
      RARITIES[rarity].label + ' ' + (percent < .01 ? '<0.01' : percent.toFixed(percent < .1 ? 2 : 1)) + '%').join(' · ') || 'Sold out';
  }

  const chestPrice = () => quotes.find(quote => Number.isSafeInteger(quote.chest_price))?.chest_price ?? COSMETIC_CHEST_PRICE;

  function artFor(config, { stock, equipped } = {}) {
    const art = element('div', '', 'item-art');
    const image = element('button', '', 'item-info');
    image.type = 'button';
    image.setAttribute('aria-label', 'About ' + config.label);
    image.setAttribute('aria-haspopup', 'dialog');
    const indicator = element('span', 'i');
    indicator.setAttribute('aria-hidden', 'true');
    image.append(itemThumbnail(config), indicator);
    image.addEventListener('click', () => showInfo(config));
    art.append(image);
    if (stock !== undefined) {
      const count = element('span', '', 'item-count');
      count.append(gameIcon('bag'), String(stock));
      count.setAttribute('aria-label', stock + ' in stock');
      art.append(count);
    }
    if (equipped) {
      const mark = element('span', '', 'item-mark');
      mark.append(gameIcon('check'));
      mark.setAttribute('aria-label', 'Equipped');
      art.append(mark);
    }
    return art;
  }

  function priceFor(price, previous, scrap = false) {
    const row = element('div', '', 'trade-price');
    row.append(gameIcon(scrap ? 'repair' : 'coin'));
    if (previous != null && previous !== price) row.append(element('s', goldLabel(previous)));
    row.append(element('strong', scrap ? String(price) : goldLabel(price)));
    row.setAttribute('aria-label', (scrap ? price + ' scrap' : goldLabel(price) + ' gold') + (previous != null && previous !== price ? ', normally ' + goldLabel(previous) : ''));
    return row;
  }

  function refresh() {
    if (!online || !contract || !account) return false;
    const now = Date.now();
    refreshReserve();
    if (now < viewDeadline) return true;
    const sent = send({
      type: 'near-workshop-view', account,
      ...(checking && hash ? { transactionHash: hash } : {}),
    });
    if (sent) viewDeadline = now + VIEW_TIMEOUT_MS;
    return sent;
  }

  function showReview(title, rig, action, detail, fields) {
    if (!online || busy || checking || !workshop) return;
    approved = { action, rig, ...fields };
    review.returnValue = '';
    get('review-title').textContent = title + ' ' + rigFor(rig).label;
    get('review-detail').textContent = detail;
    reviewArt.replaceChildren(itemThumbnail(rigFor(rig)));
    review.showModal();
  }

  function control(label, title, rig, action, detail, fields, blocked = false) {
    const button = element('button', '', 'item-action');
    button.type = 'button';
    const compact = /^(Buy|Sell) \d/.test(label) ? label.split(' ')[0] : label;
    if (compact === label) button.textContent = label;
    else {
      const shortLabel = element('span', compact, 'item-action-compact');
      shortLabel.setAttribute('aria-hidden', 'true');
      button.append(element('span', label, 'item-action-full'), shortLabel);
    }
    button.setAttribute('aria-label', title + ' ' + rigFor(rig).label + '. ' + detail);
    button.disabled = !online || busy || checking || blocked;
    button.addEventListener('click', () => showReview(title, rig, action, detail, fields));
    return button;
  }

  function card(rig, maintenance = false) {
    const config = RIG_PREVIEWS[rig];
    const item = workshop.items.find(entry => entry.rig === rig);
    const quote = workshop.stock.find(entry => entry.rig === rig);
    const selected = workshop.equipped === rig;
    const article = element('article', '', 'workshop-item' + (selected ? ' equipped' : ''));
    const subtitle = item?.locked ? 'Reserved for a round' : selected ? 'Equipped' : item ? 'In your locker' : mode === 'shop' && trade === 'sell' ? 'None owned' : 'Shop';
    const detail = item ? item.uses + '/' + RIG_USES + ' uses' + (item.patched ? ' · Repaired' : '')
      : quote ? quote.count + ' in stock' : 'Free barrel';
    const actions = element('div', '', 'workshop-actions');
    const selling = mode === 'shop' && trade === 'sell';
    article.dataset.item = rig;
    rarityCard(article, config);
    article.setAttribute('aria-label', config.label);
    article.append(artFor(config, { stock: mode === 'shop' ? quote?.count : undefined, equipped: selected }),
      element('strong', config.label), element('small', subtitle + ' · ' + detail, 'item-meta'));
    if (quote && mode === 'shop') article.append(priceFor(selling ? quote.sell : quote.buy, selling && quote.wanted ? quote.normal_sell : !selling && quote.discount ? quote.buy + quote.discount : null));
    if (selling && quote?.wanted) article.append(element('small', 'Wanted', 'near-wanted-badge'));
    if (!maintenance && !selling && !selected && mode !== 'shop' && (rig === DEFAULT_RIG || item?.uses > 0)) {
      actions.append(control('Equip', 'Equip', rig, 'equip', 'Use this barrel in your next round.', {}, item?.locked));
    }
    if (!maintenance && quote && !item && !selling && mode === 'shop') {
      const price = goldLabel(quote.buy);
      if (quote.discount && quote.count > 0) article.append(element('small', 'On sale', 'near-sale-badge'));
      actions.append(control('Buy ' + price, 'Buy', rig, 'buy', 'Pay ' + price + ' gold.',
        { expected_price: quote.buy }, !quote.count || spendableGold() < quote.buy));
    }
    if (item && (quote || mode !== 'shop')) {
      const price = goldLabel(quote?.sell ?? 0);
      if (selling && !item.starter) actions.append(control('Sell ' + price, selected ? 'Unequip and sell' : 'Sell', rig, 'sell',
        'Receive ' + price + ' gold.', { expected_price: quote.sell }, item.locked || !item.uses));
      if (!selling && (mode === 'shop' || maintenance) && item.uses < RIG_USES && !item.patched) {
        const cost = goldLabel(PATCH_PRICE);
        actions.append(control('Repair ' + cost, 'Repair', rig, 'repair', 'Restore one use for ' + cost + ' gold.',
          { expected_price: PATCH_PRICE }, item.locked || spendableGold() < PATCH_PRICE));
        if (workshop.scrap >= PATCH_SCRAP_COST) {
          actions.append(control('Repair with scrap', 'Repair', rig, 'repair', 'Restore one use for ' + PATCH_SCRAP_COST + ' scrap.',
            { use_scrap: true }, item.locked));
        }
      }
      if (!selling && (mode === 'shop' || maintenance) && !item.uses && item.patched) {
        actions.append(control('Recycle', 'Recycle', rig, 'recycle', item.starter ? 'Remove the spent starter barrel.' : 'Recycle the spent barrel for scrap.', {}, item.locked));
      }
    }
    article.append(actions);
    return article;
  }

  function renderCollection() {
    const pane = get('collection');
    pane.hidden = !collection || !workshop || (mode === 'shop' && category === 'rigs');
    if (pane.hidden) return;
    const selling = mode === 'shop' && trade === 'sell';
    const available = Object.values(ITEMS).filter(entry => {
      if (mode === 'shop' && entry.free) return false;
      if (selling && (!entry.price || (!collection.owned[entry.id] && !quotes.find(q => q.item === entry.id)?.wanted))) return false;
      if (entry.expeditionOnly && collection.award?.id !== entry.id && !collection.owned[entry.id]) return false;
      const wearable = entry.slot === 'pirate' || entry.slot === 'pet';
      if (mode === 'shop') return category === 'paint' ? entry.slot === 'barrelPaint'
        : category === 'outfits' ? entry.slot === 'pirate'
        : category === 'pets' ? entry.slot === 'pet'
        : category === 'chests' ? false
        : !wearable && entry.slot !== 'barrelPaint';
      return (mode === 'gear' ? wearable || entry.slot === 'barrelPaint' : !wearable && entry.slot !== 'barrelPaint')
        && (entry.free || collection.owned[entry.id] > 0 || collection.award?.id === entry.id);
    });
    if (!available.length && !(mode === 'shop' && !selling && category === 'chests')) {
      pane.replaceChildren(element('p', selling ? 'No items in this category to sell.' : mode === 'gear' ? 'No outfits or pets owned yet.' : 'No furnishings owned yet.'));
      return;
    }
    const makeAction = (label, action, detail, disabled, args = {}, method = 'collection_action', config) => {
      const button = element('button', label, 'item-action');
      button.type = 'button';
      button.disabled = !online || busy || checking || disabled;
      button.addEventListener('click', () => {
        approved = { method, ...(action ? { action } : {}), ...args };
        review.returnValue = '';
        get('review-title').textContent = config?.label ?? label;
        get('review-detail').textContent = detail;
        reviewArt.replaceChildren(...(config ? [itemThumbnail(config)] : []));
        review.showModal();
      });
      return button;
    };
    const grid = element('div', '', 'workshop-items near-collection-grid');
    grid.setAttribute('aria-label', mode === 'decor' ? 'Your furnishings' : mode === 'gear' ? 'Your outfits and paints' : category === 'outfits' ? 'Outfits' : category === 'pets' ? 'Pets' : category === 'chests' ? 'Chests' : category === 'paint' ? 'Barrel paints' : 'Decorations');
    if (mode === 'shop' && !selling && category === 'chests') {
      const chest = element('article', '', 'workshop-item near-chest-card');
      chest.dataset.item = 'castaway-chest';
      const actions = element('div', '', 'workshop-actions');
      actions.append(makeAction('Open chest', 'open_chest', 'Pay ' + goldLabel(chestPrice()) + ' gold for one random outfit or pet. ' + chestOdds() + '. Chances follow available stock; duplicate items are possible.',
        spendableGold() < chestPrice() || !quotes.some(q => LOOT_POOL.includes(q.item) && q.count > 0), { expected_price: chestPrice() }, 'collection_action', lootChest));
      rarityCard(chest, { rarity: 'rare' });
      chest.append(artFor(lootChest), element('strong', lootChest.label), element('small', 'Open · 1 random outfit or pet', 'item-meta'), element('small', chestOdds(), 'chest-odds'), priceFor(chestPrice()), actions);
      grid.append(chest);
    }
    for (const item of available) {
      const count = item.free ? 1 : collection.owned[item.id] ?? (collection.award?.id === item.id ? 1 : 0);
      const equipped = item.expeditionOnly ? collection.award?.id === item.id && collection.award?.equipped : collection.equipped[item.slot] === item.id;
      const quote = quotes.find(entry => entry.item === item.id);
      const cost = quote?.buy ?? item.price;
      const row = element('article', '', 'workshop-item' + (equipped ? ' equipped' : ''));
      row.dataset.item = item.id;
      rarityCard(row, item);
      row.setAttribute('aria-label', item.label);
      row.append(artFor(item, { stock: mode === 'shop' ? quote?.count : undefined, equipped }), element('strong', item.label));
      row.append(element('small', item.slot === 'chest' ? 'Chest appearance · does not open' : item.free ? 'Free paint' : item.expeditionOnly ? 'Expedition treasure · ' + count + ' owned' : count ? count + ' owned' : '', 'item-meta'));
      const actions = element('div', '', 'workshop-actions');
      if (mode === 'shop' && !selling && !item.expeditionOnly && !item.free) {
        row.append(priceFor(cost || item.scrapCost, quote?.discount ? cost + quote.discount : null, !cost));
        if (quote?.discount && quote.count > 0) row.append(element('small', 'On sale', 'near-sale-badge'));
        const price = cost ? goldLabel(cost) + ' gold' : item.scrapCost + ' scrap';
        actions.append(makeAction('Buy', 'buy', 'Buy ' + item.label + ' for ' + price + '.',
          cost > spendableGold() || item.scrapCost > workshop.scrap || quote?.count === 0,
          { item: item.id, ...(quote ? { expected_price: cost } : {}) }, 'collection_action', item));
      }
      if (selling && item.price) {
        const sell = quote?.sell ?? Math.floor(item.price / 2);
        row.append(priceFor(sell, quote?.wanted ? quote.normal_sell : null));
        if (quote?.wanted) row.append(element('small', 'Wanted', 'near-wanted-badge'));
        if (count) {
          actions.append(makeAction('Sell', 'sell', (equipped ? 'Unequip and sell ' : 'Sell ') + item.label + ' for ' + goldLabel(sell) + ' gold.', quote?.count >= (quote?.stock_limit ?? 8),
            { item: item.id, ...(quote ? { expected_price: sell } : {}) }, 'collection_action', item));
        } else {
          row.append(element('small', 'None owned'));
        }
      }
      if (item.expeditionOnly && mode !== 'shop') {
        actions.append(makeAction(equipped ? 'Unequip' : 'Equip', null, (equipped ? 'Unequip ' : 'Equip ') + item.label + '.', false,
          { equipped: !equipped, item: item.id }, 'equip_voyage_award', item));
      } else if (count) {
        if (mode !== 'shop') actions.append(makeAction(equipped ? 'Unequip' : 'Equip', equipped ? 'unequip' : 'equip',
          (equipped ? 'Unequip ' : 'Equip ') + item.label + '.', false,
          equipped ? { slot: item.slot } : { item: item.id }, 'collection_action', item));
      }
      row.append(actions);
      grid.append(row);
    }
    if (mode === 'gear') {
      const paints = [...grid.children].filter(row => ITEMS[row.dataset.item]?.slot === 'barrelPaint');
      if (paints.length) {
        const carousel = element('section', '', 'paint-carousel');
        carousel.setAttribute('aria-label', 'Barrel paints');
        const previous = element('button', '‹');
        const next = element('button', '›');
        const stage = element('div', '', 'paint-carousel-stage');
        const count = element('small');
        previous.type = next.type = 'button';
        previous.setAttribute('aria-label', 'Previous paint');
        next.setAttribute('aria-label', 'Next paint');
        let selected = Math.max(0, paints.findIndex(row => row.classList.contains('equipped')));
        const show = offset => {
          selected = (selected + offset + paints.length) % paints.length;
          stage.replaceChildren(paints[selected]);
          count.textContent = (selected + 1) + ' / ' + paints.length;
        };
        for (const paint of paints) paint.remove();
        previous.addEventListener('click', () => show(-1));
        next.addEventListener('click', () => show(1));
        let startX = null;
        stage.addEventListener('pointerdown', event => { startX = event.clientX; });
        stage.addEventListener('pointerup', event => {
          if (startX !== null && Math.abs(event.clientX - startX) > 45) show(event.clientX < startX ? 1 : -1);
          startX = null;
        });
        stage.addEventListener('pointercancel', () => { startX = null; });
        carousel.append(previous, stage, next, count);
        show(0);
        grid.prepend(carousel);
      }
    }
    pane.replaceChildren(grid);
  }

  function render() {
    if (!dialog.open) return;
    reserveNotice.hidden = !reserveData || mode !== 'shop';
    connect.hidden = Boolean(account && (workshop || checking) && !renewalRequired);
    connect.disabled = busy || connecting || connectionPending || !online;
    connect.textContent = renewalRequired ? 'Continue playing' : account ? 'Refresh' : 'Join the crew';
    get('account').hidden = true;
    get('balance').textContent = workshop ? goldLabel(spendableGold()) + ' gold · ' + workshop.scrap + ' scrap' : '';
    status.textContent = online ? message : 'Reconnecting to the bay…';
    status.hidden = !status.textContent;
    const award = get('award');
    award.hidden = !chestItem;
    award.replaceChildren(...(chestItem ? [itemThumbnail(chestItem), element('strong', chestItem.label)] : []));
    receipt.hidden = !hash || !receiptUrl;
    if (!receipt.hidden) receipt.href = receiptUrl;
    else receipt.removeAttribute('href');
    trading.hidden = mode !== 'shop' || !workshop;
    for (const button of trading.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.nearTrade === trade));
    }
    categories.hidden = mode !== 'shop' || !collection || !workshop;
    lockerNav.hidden = lockerBody.hidden = mode !== 'gear' || !workshop;
    dialog.dataset.mode = mode;
    if (mode === 'gear') {
      lockerSections.equip.append(items, get('collection'));
    } else {
      dialog.append(items, get('collection'));
    }
    for (const button of categories.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.nearCategory === category));
    }
    const showRigs = mode === 'gear' || (mode === 'shop' && category === 'rigs');
    const selling = mode === 'shop' && trade === 'sell';
    const rigs = !workshop || !showRigs ? [] : selling
      ? [...new Set([...workshop.items.filter(entry => !entry.starter && entry.uses > 0).map(entry => entry.rig), ...workshop.stock.filter(entry => entry.wanted).map(entry => entry.rig)])]
      : [...(mode === 'shop' ? [] : [DEFAULT_RIG]), ...(mode === 'shop' ? workshop.stock : workshop.items).map(entry => entry.rig)];
    items.hidden = !showRigs;
    items.replaceChildren(...rigs.map(rig => card(rig)));
    if (workshop && showRigs && selling && !rigs.length) items.append(element('p', 'No barrels available to sell.'));
    renderCollection();
    if (mode === 'gear') {
      const previousPaints = lockerSections.paint.querySelector('.paint-carousel');
      previousPaints?.remove();
      const paints = get('collection').querySelector('.paint-carousel');
      if (paints) markerOptions.before(paints);
      const worn = (workshop?.items ?? []).filter(item => item.uses < RIG_USES);
      repairs.replaceChildren(...worn.map(item => card(item.rig, true)));
      if (!worn.length) repairs.append(element('p', 'All barrels are ready to roll.'));
    }
    if (mode === 'shop') {
      // Stable sorting keeps the usual catalogue order within both groups,
      // including the chest card, while matching the visible sale badges.
      for (const grid of [items, get('collection').querySelector('.near-collection-grid')]) {
        if (!grid) continue;
        const cards = [...grid.children];
        const badge = selling ? '.near-wanted-badge' : '.near-sale-badge';
        cards.sort((a, b) => Number(Boolean(b.querySelector(badge))) - Number(Boolean(a.querySelector(badge))));
        grid.replaceChildren(...cards);
      }
    }
  }

  async function submit({ method, ...args }) {
    if (!online || !contract || !account || busy || checking) return;
    const social = usesNearSocialAccount(account);
    const cost = Number.isSafeInteger(args.expected_price) &&
      (args.action === 'buy' || args.action === 'open_chest' || (args.action === 'repair' && !args.use_scrap)) ? args.expected_price : 0;
    if (social && cost > 0) {
      releaseGold = holdGold(account, workshop?.gold, cost);
      if (!releaseGold) { message = 'Check your available gold or wait for your current action.'; render(); return; }
    }
    const version = connectionVersion;
    busy = true;
    hash = null;
    receiptUrl = null;
    chestItem = null;
    message = social ? (cost > 0 ? `−${goldLabel(cost)} GOLD · Confirmation pending` : 'Saving your change…') : 'Confirming your action…';
    render();
    try {
      const result = await signNearWorkshop(contract, account, args, method);
      if (version !== connectionVersion) return;
      if (result.accountChanged) {
        account = '';
        message = 'The account changed. Sign in to the account you want to use.';
        return;
      }
      hash = HASH.test(result.hash ?? '') ? result.hash : null;
      checking = Boolean(hash && !result.failed);
      if (result.failed) message = 'The transaction failed. Check the current quote and try again.';
      else if (checking) { if (!releaseGold) message = 'Saving your items…'; }
      else message = 'Confirmation is still pending. Check your Logbook before retrying.';
    } catch (error) {
      if (version === connectionVersion) message = usesNearSocialAccount(account) ? error.message
        : 'The action was not confirmed. Check your Logbook before retrying.';
      if (version === connectionVersion && requiresGameSessionRenewal(error)) {
        renewalRequired = true;
        message = 'Continue playing to renew your session, then review this action again.';
        connectAccount({ renew: true });
      }
    } finally {
      if (version === connectionVersion) {
        // Refresh finalized balances before enabling another purchase or sale.
        if (!checking) { releaseGold?.(); releaseGold = null; }
        busy = false;
        viewDeadline = 0;
        refresh();
        render();
      }
    }
  }

  function openPanel(nextMode) {
    if (!online || !contract) return;
    if (dialog.open && mode === nextMode) return;
    if (dialog.open) dialog.close();
    if (review.open) review.close('cancel');
    if (info.open) info.close();
    mode = nextMode;
    get('title').textContent = mode === 'shop' ? 'Barrel Works' : mode === 'gear' ? 'Your Gear' : 'Your Furnishings';
    const embedded = document.body.classList.contains('unified-near-economy');
    dialog.dataset.embedded = String(embedded);
    const target = !embedded ? dialogHome : mode === 'shop' ? shop : document.getElementById('cottage-content');
    if (embedded && mode !== 'shop') target.replaceChildren(dialog);
    else target.append(dialog);
    workshop = null;
    if (embedded) dialog.show();
    else dialog.showModal();
    refresh();
    render();
  }
  open.addEventListener('click', () => openPanel('shop'));
  trading.addEventListener('click', event => {
    const button = event.target.closest('button[data-near-trade]');
    if (!button) return;
    trade = button.dataset.nearTrade;
    render();
  });
  categories.addEventListener('click', event => {
    const button = event.target.closest('button[data-near-category]');
    if (!button) return;
    category = button.dataset.nearCategory;
    render();
  });
  connect.addEventListener('click', async () => {
    if (connecting || connectionPending || busy || !online) return;
    if (account && !renewalRequired) {
      refresh();
      return;
    }
    connectionPending = true;
    message = 'Opening sign-in…';
    render();
    try {
      // Invoke synchronously inside the click so browsers permit the provider popup.
      const opened = connectAccount();
      if (await opened === false && connectionPending) {
        connectionPending = false;
        message = 'Sign-in is not ready. Reconnect to the bay and try again.';
        render();
      }
    } catch {
      connectionPending = false;
      message = 'Could not open sign-in. Try again.';
      render();
    }
  });
  for (const modal of [dialog, review, info]) {
    modal.addEventListener('click', event => {
      if (event.target !== modal) return;
      const bounds = modal.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom) modal.close('cancel');
    });
  }
  review.addEventListener('close', () => {
    const args = approved;
    approved = null;
    if (args && review.returnValue === 'confirm') void submit(args);
  });
  window.setInterval(() => {
    if (!dialog.open && !checking) return;
    if (dialog.open) {
      if (reserveData) showReserve(reserveData);
      refreshReserve();
    }
    if (checking || (offerWindow >= 0 && offerWindow !== Math.floor(Date.now() / 600_000))) refresh();
  }, CHECK_INTERVAL_MS);

  return {
    homeState: () => homeSnapshot,
    isBusy: () => busy || checking || review.open,
    sessionRestored() {
      renewalRequired = false;
      connectionPending = false;
      if (dialog.open) render();
    },
    openInventory: tab => openPanel(tab === 'decor' ? 'decor' : 'gear'),
    closeInventory() {
      if (mode === 'shop') return;
      if (review.open) review.close('cancel');
      if (info.open) info.close();
      if (dialog.open) dialog.close();
      // Keep the shared widget attached while Logbook replaces the cottage content.
      dialogHome.append(dialog);
    },
    configure(next) {
      if (next === contract) return;
      connectionVersion++;
      viewDeadline = 0;
      contract = next;
      releaseGold?.(); releaseGold = null;
      reserveData = null;
      homeSnapshot = null;
      shopVisible = false;
      if (review.open) review.close('cancel');
      if (info.open) info.close();
      if (dialog.open) dialog.close();
      account = '';
      connectionPending = false;
      workshop = null;
      hash = null;
      busy = false;
      checking = false;
      chestItem = null;
      message = '';
    },
    connectionFailed(detail) {
      if (!connectionPending) return;
      connectionPending = false;
      message = detail;
      render();
    },
    update(connected, visible, authenticatedAccount, cottageVisible, connectionBusy) {
      const reconnected = !online && connected;
      const connectionChanged = connecting !== connectionBusy;
      connecting = connectionBusy;
      online = connected;
      if (!online) viewDeadline = 0;
      const unified = document.body.classList.contains('unified-near-economy');
      open.hidden = !contract || unified;
      open.disabled = !online;
      if (!(mode === 'shop' ? visible : cottageVisible) || !contract) {
        if (review.open) review.close('cancel');
        if (info.open) info.close();
        if (dialog.open) dialog.close();
      }
      if ((online || authenticatedAccount) && (authenticatedAccount ?? '') !== account && !(account && (busy || checking) && !authenticatedAccount)) {
        connectionVersion++;
        connectionPending = false;
        account = authenticatedAccount ?? '';
        releaseGold?.(); releaseGold = null;
        homeSnapshot = null;
        viewDeadline = 0;
        workshop = null;
        hash = null;
        busy = false;
        checking = false;
        chestItem = null;
        message = '';
        if (review.open) review.close('cancel');
        if (info.open) info.close();
        if (dialog.open) refresh();
      }
      const enteringShop = visible && !shopVisible;
      shopVisible = visible;
      if (enteringShop && unified && contract) openPanel('shop');
      if (dialog.open && reconnected) {
        if (!busy && !checking) workshop = null;
        refresh();
      }
      if (dialog.open && (!online || reconnected || connectionChanged)) render();
    },
    receive(reply) {
      if (!contract || !account || reply.account !== account) return;
      receiptUrl = typeof reply.receiptUrl === 'string' && reply.receiptUrl.startsWith('https://testnet.nearblocks.io/txns/') ? reply.receiptUrl : null;
      viewDeadline = 0;
      if (reply.error) {
        workshop = null;
        message = reply.error;
        render();
        return;
      }
      if (reply.workshop?.registered === false || !reply.workshop) {
        workshop = null;
        message = 'Finish your first Quick Brawl and claim a barrel with this account to unlock the workshop.';
        render();
        return;
      }
      if (!Array.isArray(reply.workshop.items) || !Array.isArray(reply.workshop.stock)) return;
      workshop = reply.workshop;
      collection = reply.collection ?? null;
      quotes = reply.quotes ?? [];
      const reserve = reply.merchantReserve;
      if (reserve) showReserve(reserve);
      homeSnapshot = { account, rigs: workshop.items.map(item => item.rig),
        owned: Object.entries(collection?.owned ?? {}).filter(([, count]) => count > 0).map(([id]) => id),
        ownedCounts: collection?.owned ?? {},
        equipped: collection?.equipped ?? {}, rig: workshop.equipped };
      offerWindow = Math.floor(Date.now() / 600_000);
      if (checking && reply.transactionStatus === 'finalized') {
        checking = false;
        releaseGold?.(); releaseGold = null;
        chestItem = ITEMS[reply.chestItem] ?? null;
        message = chestItem ? 'Chest opened!' : 'Saved.';
      } else if (checking && reply.transactionStatus === 'failed') {
        checking = false;
        releaseGold?.(); releaseGold = null;
        message = 'The transaction failed. Review the current quote before retrying.';
      }
      render();
    },
  };
}
