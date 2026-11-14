import { goldLabel } from './harbor.js';
import { RIG_USES, rigFor } from '../shared/rigs.mjs';
import { ITEMS, FURNITURE_SLOTS, COSMETIC_CHEST_PRICE, cosmeticFor } from '../shared/cosmetics.mjs';
import { RARITIES, rarityFor } from '../shared/rarities.mjs';
import { itemThumbnail } from './item-thumbnail.js';
import { gameIcon } from './game-icons.js';

const LOOT_CHEST = { slot: 'loot', label: 'Castaway Chest', color: 0xb07738 };
const STATS = [
  ['force', 'Acceleration', 'drive'], ['impact', 'Impact weight', 'mass'],
  ['control', 'Turning control', 'turn'], ['speed', 'Top speed', 'speed'],
];
const tabs = ['stock', 'sell'];
const cosmeticDescriptions = {
  pirate: 'Changes the outfit and hat your pirate wears in matches.',
  pet: 'Rides on your pirate’s head during matches.',
  arena: 'Changes the look of the arena when you host a match.',
  home: 'Adds copper trim and a pennant to your cottage. Applies automatically.',
  seat: 'Replaces the bunk in your cottage. Place it from the Decor tab.',
  rug: 'Changes the rug in your cottage. Place it from the Decor tab.',
  ornament: 'Adds a keepsake to your cottage. Place it from the Decor tab.',
  chest: 'Changes the look of your treasure chest.',
  loot: 'Contains one random pirate outfit or head pet. Each of the 50 items has a 2% chance.',
};
const barrelDescriptions = {
  oak: 'The standard barrel, with balanced handling and no wear.',
  iron: 'Heavy hoop bands hit harder and make tight turns harder.',
  ram: 'Quick acceleration for straight-line charges, with wider turns.',
  shield: 'Extra weight helps you hold your ground, with slower acceleration and turns.',
  scout: 'Light wheels turn quickly and build speed fast. Heavier barrels can knock them away more easily.',
};

function categoryFor(item) {
  if (!item) return 'rig';
  if (item.slot === 'home' || FURNITURE_SLOTS.includes(item.slot)) return 'home';
  if (item.slot === 'chest' || item.slot === 'arena') return 'decor';
  return item.slot;
}

function preview(type) {
  return type === 'chest' ? LOOT_CHEST : cosmeticFor(type) ?? rigFor(type);
}

function readout(icon, value, label, className = 'item-number') {
  const badge = document.createElement('span');
  badge.className = className;
  badge.title = label;
  badge.setAttribute('role', 'img');
  badge.setAttribute('aria-label', label);
  badge.append(gameIcon(icon), value);
  return badge;
}

export function createWorkshop(send) {
  const get = id => document.getElementById(id);
  const panel = get('workshop');
  const items = get('workshop-items');
  const notice = get('workshop-notice');
  const categories = get('workshop-category');
  const info = document.createElement('dialog');
  info.className = 'pier-card workshop-info';
  info.setAttribute('aria-labelledby', 'workshop-info-title');
  const infoTitle = document.createElement('h3');
  infoTitle.id = 'workshop-info-title';
  const infoArt = document.createElement('div');
  const infoText = document.createElement('p');
  const infoStats = document.createElement('div');
  const infoForm = document.createElement('form');
  infoForm.method = 'dialog';
  const closeInfo = document.createElement('button');
  closeInfo.textContent = 'Close';
  closeInfo.autofocus = true;
  infoForm.append(closeInfo);
  info.append(infoTitle, infoArt, infoText, infoStats, infoForm);
  panel.append(info);

  function showInfo(type, item) {
    infoTitle.textContent = item.label;
    infoArt.replaceChildren(itemThumbnail(item));
    infoText.textContent = item.slot ? cosmeticDescriptions[item.slot] : barrelDescriptions[type] ?? item.description;
    if (item.scrapCost) infoText.textContent += ' Craft it with ' + item.scrapCost + ' scrap.';
    infoStats.replaceChildren();
    if (!item.slot) {
      const stats = document.createElement('dl');
      for (const [icon, label, key] of STATS) {
        const name = document.createElement('dt');
        name.append(gameIcon(icon), label);
        const value = document.createElement('dd');
        value.textContent = Math.round(item[key] * 100) + '%';
        stats.append(name, value);
      }
      stats.setAttribute('aria-label', 'Barrel stats relative to oak');
      infoStats.append(stats);
    }
    info.showModal();
  }

  const loadout = get('workshop-loadout');
  const order = document.createElement('section');
  order.className = 'workshop-order';
  order.setAttribute('aria-label', 'Quartermaster demand');
  order.hidden = true;
  items.before(order);
  let tab = 'stock';
  let category = 'rig';
  let wallet;
  let online;
  let pending;
  let merchantPayout;
  let feedback;
  let rendered = '';
  let shownFeedback = '';
  let wasVisible = false;

  const trade = document.createElement('dialog');
  trade.className = 'pier-card workshop-info';
  trade.setAttribute('aria-labelledby', 'trade-title');
  const tradeTitle = document.createElement('h3');
  tradeTitle.id = 'trade-title';
  const tradeArt = document.createElement('div');
  const tradePrice = document.createElement('p');
  const tradeNote = document.createElement('p');
  const tradeButtons = document.createElement('form');
  tradeButtons.method = 'dialog';
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  cancel.autofocus = true;
  const confirm = document.createElement('button');
  confirm.type = 'button';
  tradeButtons.append(cancel, confirm);
  trade.append(tradeTitle, tradeArt, tradePrice, tradeNote, tradeButtons);
  panel.append(trade);

  function pricePair(current, previous, prefix = '') {
    const result = document.createElement('span');
    result.className = 'trade-price';
    if (Number.isFinite(previous) && previous !== current) {
      const old = document.createElement('del');
      old.textContent = prefix + goldLabel(previous);
      result.append(old, ' → ');
    }
    const price = document.createElement('strong');
    price.textContent = prefix + goldLabel(current);
    result.append(price);
    return result;
  }

  function review(type, data, itemType, amount, previous, { selling = false, equipped = false, blocked = '', scrap = false } = {}) {
    const item = preview(itemType);
    tradeTitle.textContent = (selling ? 'Sell ' : scrap ? 'Craft ' : 'Buy ') + item.label;
    tradeArt.replaceChildren(itemThumbnail(item));
    tradePrice.replaceChildren(scrap ? amount + ' scrap' : pricePair(amount, previous, selling ? '+' : ''), scrap ? '' : ' gold');
    tradeNote.textContent = blocked || (equipped ? 'This item will be unequipped.' : 'Review the item and price.');
    confirm.textContent = 'Continue';
    confirm.disabled = Boolean(blocked) || !online || Boolean(pending);
    confirm.onclick = () => {
      tradeTitle.textContent = 'Confirm ' + (selling ? 'sale' : scrap ? 'craft' : 'purchase');
      tradeNote.textContent = equipped ? item.label + ' will be unequipped and sold.' : item.label;
      confirm.textContent = selling ? 'Confirm sale' : scrap ? 'Confirm craft' : 'Confirm purchase';
      confirm.onclick = () => {
        trade.close();
        action(type, data);
      };
    };
    trade.showModal();
  }

  function action(type, data = {}) {
    if (!online || pending || !send({ type, ...data })) return;
    pending = type;
    merchantPayout = type === 'gear-sell-merchant' ? data.price : undefined;
    feedback = null;
    render();
  }

  function control(icon, label, run, { disabled = false, value = '', primary = false } = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'item-action' + (primary ? ' item-primary' : '');
    button.title = label;
    button.setAttribute('aria-label', label);
    button.append(gameIcon(icon), value);
    button.disabled = disabled || !online || Boolean(pending);
    if (run) button.addEventListener('click', run);
    return button;
  }

  function purchase(icon, label, amount, run, disabled) {
    return control(icon, label + ' · ' + goldLabel(amount) + ' gold', run,
      { disabled, value: goldLabel(amount), primary: true });
  }

  function rigStats(rig) {
    const current = rigFor(wallet.rig);
    const stats = document.createElement('div');
    stats.className = 'item-stats';
    for (const [icon, label, key] of STATS) {
      const value = Math.round(rig[key] * 100);
      const equipped = Math.round(current[key] * 100);
      const direction = Math.sign(value - equipped);
      const number = readout(icon, String(value), label + ' ' + value + ' · equipped ' + equipped + ' · oak 100');
      if (direction) {
        number.dataset.direction = direction > 0 ? 'up' : 'down';
        const arrow = document.createElement('span');
        arrow.textContent = direction > 0 ? '↑' : '↓';
        number.append(arrow);
      }
      stats.append(number);
    }
    return stats;
  }

  function itemCard(type, controls, { id, status, count, uses, patched, equipped = false, quote } = {}) {
    const item = preview(type);
    const row = document.createElement('article');
    row.className = 'workshop-item';
    row.dataset.rarity = rarityFor({ ...item, id: type });
    row.style.setProperty('--item-rarity', RARITIES[row.dataset.rarity].color);
    const rarity = document.createElement('small');
    rarity.className = 'rarity-label';
    rarity.textContent = RARITIES[row.dataset.rarity].label;
    row.append(rarity);
    row.title = item.label;
    row.setAttribute('aria-label', item.label);
    if (id) row.dataset.item = id;
    if (equipped) row.classList.add('equipped');
    const art = document.createElement('div');
    art.className = 'item-art';
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'item-info';
    const indicator = document.createElement('span');
    indicator.textContent = 'i';
    indicator.setAttribute('aria-hidden', 'true');
    more.append(itemThumbnail(item), indicator);
    more.setAttribute('aria-label', 'About ' + item.label);
    more.setAttribute('aria-haspopup', 'dialog');
    more.addEventListener('click', () => showInfo(type, item));
    art.append(more);
    if (equipped || status) {
      art.append(readout(status ?? 'check', '', status === 'lock' ? 'Reserved' : status === 'tag' ? 'Listed' : 'Equipped', 'item-mark'));
    }
    if (count !== undefined) art.append(readout('bag', String(count), count + ' in stock', 'item-count'));
    row.append(art);
    if (quote) {
      const changes = document.createElement('div');
      changes.className = 'item-trends';
      const selling = tab === 'sell';
      const delta = selling ? (quote.wanted ? quote.bid - quote.normalBid : quote.bidDelta) : quote.askDelta;
      if (selling && quote.wanted) changes.append(readout('flag', 'Wanted', 'High NPC demand'));
      if (!selling && quote.discount) changes.append(readout('tag', '−' + goldLabel(quote.discount), 'Discount'));
      if (delta) changes.append(readout('trade',
        (delta > 0 ? '↑ ' : '↓ ') + goldLabel(Math.abs(delta)), delta > 0 ? 'Price rose' : 'Price fell'));
      const amount = selling ? quote.bid : quote.ask;
      row.append(pricePair(amount, delta ? amount - delta : null, selling ? '+' : ''), changes);
    }
    if (!item.slot) {
      row.append(rigStats(item));
      const extras = document.createElement('div');
      extras.className = 'item-extras';
      if (uses !== undefined) extras.append(readout('barrel', uses + '/' + RIG_USES, uses + ' of ' + RIG_USES + ' uses'));
      if (patched) extras.append(readout('repair', '', 'Already patched'));
      row.append(extras);
    }
    if (type === 'chest') {
      row.classList.add('loot-card');
      const odds = document.createElement('div');
      odds.className = 'loot-odds';
      odds.setAttribute('role', 'img');
      odds.setAttribute('aria-label', 'One random pirate or head pet. Each item has a 2 percent chance.');
      odds.title = odds.getAttribute('aria-label');
      odds.append(gameIcon('arrow'), '×1', gameIcon('shirt'), '/', gameIcon('parrot'), '2%');
      row.append(odds);
    }
    const actions = document.createElement('div');
    actions.className = 'workshop-actions';
    actions.append(...controls);
    row.append(actions);
    return row;
  }

  function equippedItem(item) {
    const cosmetic = cosmeticFor(item.type);
    return item.id === (cosmetic ? wallet.workshop.cosmetics?.[cosmetic.slot] : wallet.workshop.equipped);
  }

  function styleControl(item, cosmetic, toggle = false) {
    const selected = equippedItem(item);
    const furniture = FURNITURE_SLOTS.includes(cosmetic.slot);
    return control(selected ? (toggle ? 'remove' : 'check') : 'equip',
      selected ? (toggle ? 'Remove ' + cosmetic.label : 'Equipped') : (furniture ? 'Place ' : 'Equip ') + cosmetic.label,
      () => action('gear-style', { slot: cosmetic.slot, id: selected ? null : item.id }),
      { disabled: selected && !toggle, primary: !selected });
  }

  function sellCard(item, dock) {
    const equipped = equippedItem(item);
    const quote = dock?.quotes[item.type];
    let controls;
    if (item.locked) controls = [control('lock', 'Reserved', null, { disabled: true })];
    else if (item.listing) controls = [control('unlist', 'Remove old listing', () =>
      action('gear-unlist', { id: item.id, listing: item.listing.id }), { value: 'Unlist' })];
    else {
      const label = equipped ? 'Unequip & sell' : 'Sell';
      controls = [control('coin', label + ' ' + preview(item.type).label, () =>
        review('gear-sell-merchant', { id: item.id, order: quote.order, price: quote.bid },
          item.type, quote.bid, quote.wanted ? quote.normalBid : quote.bid - quote.bidDelta, { selling: true, equipped }),
        { disabled: !quote || dock.available < quote.bid,
          value: quote ? label + ' +' + goldLabel(quote.bid) : '', primary: true })];
    }
    return itemCard(item.type, controls, { ...item, equipped, quote });
  }

  function emptyShelf() {
    const shelf = document.createElement('div');
    shelf.className = 'empty-shelf';
    shelf.textContent = tab === 'sell' ? 'No sellable items here' : 'No items available';
    return shelf;
  }

  function renderFeedback(workshop) {
    const status = !online ? { icon: 'clock', label: 'Reconnecting to the dock' }
      : !workshop ? { icon: 'lock', label: 'The shop is unavailable' } : feedback;
    const key = JSON.stringify(status);
    if (shownFeedback === key) return;
    shownFeedback = key;
    notice.hidden = !status;
    notice.replaceChildren();
    if (!status) return;
    notice.classList.toggle('error', Boolean(status.error));
    if (status.type) notice.append(itemThumbnail(preview(status.type)));
    notice.append(readout(status.icon, status.value ?? '', status.label));
    if (status.error) notice.append(status.label);
  }

  function renderMerchant(dock) {
    order.hidden = !dock;
    if (!dock) return;
    const allQuotes = Object.entries(dock.quotes);
    if (!allQuotes.length) return;
    const quotes = allQuotes.filter(([type]) => category === 'all' || categoryFor(cosmeticFor(type)) === category);
    const wanted = quotes.filter(([, quote]) => quote.wanted);
    const discounts = quotes.filter(([, quote]) => quote.discount && quote.count > 0)
      .sort((a, b) => b[1].discount - a[1].discount).slice(0, 2);
    const clock = document.createElement('time');
    clock.className = 'workshop-restock';
    clock.dataset.restockAt = String(allQuotes[0][1].nextAt);
    clock.title = 'Time until prices refresh';
    clock.append(gameIcon('clock'), document.createElement('span'));
    const posters = document.createElement('div');
    posters.className = 'merchant-posters';
    const selling = tab === 'sell';
    for (const [type, quote] of selling ? wanted : discounts) {
      const poster = document.createElement('button');
      poster.type = 'button';
      poster.className = 'merchant-poster';
      const item = preview(type);
      const price = selling ? quote.bid : quote.ask;
      const delta = selling ? (quote.wanted ? quote.bid - quote.normalBid : quote.bidDelta) : quote.askDelta;
      const heading = document.createElement('strong');
      heading.className = 'merchant-poster-heading';
      heading.textContent = selling ? 'Wanted' : 'On sale';
      const reward = pricePair(price, price - delta, selling ? '+' : '');
      poster.append(itemThumbnail(item), heading, item.label, reward);
      poster.addEventListener('click', () => {
        if (selling) {
          const owned = wallet.workshop.inventory.filter(candidate =>
            candidate.type === type && !candidate.starter && !candidate.locked && !candidate.listing);
          const sale = owned.find(candidate => !equippedItem(candidate)) ?? owned[0];
          review('gear-sell-merchant', { id: sale?.id, order: quote.order, price }, type, price, price - delta,
            { selling: true, equipped: sale && equippedItem(sale),
              blocked: !sale ? 'You have none available to sell.' : dock.available < price ? 'The merchant is short on gold.' : '' });
        } else {
          const stock = wallet.workshop.stock.find(part => part.type === type);
          review(stock ? 'gear-buy-stock' : 'gear-buy-cosmetic',
            { id: crypto.randomUUID(), price, ...(stock ? { rig: type } : { cosmetic: type }) },
            type, price, price - delta,
            { blocked: quote.count === 0 ? 'Out of stock.' : wallet.gold < price ? 'Not enough gold.' : '' });
        }
      });
      posters.append(poster);
    }
    order.replaceChildren(clock);
    if (posters.childElementCount) order.append(posters);
    updateRestockClock();
  }

  function updateRestockClock() {
    const clock = order.querySelector('time[data-restock-at]');
    if (panel.hidden || !clock) return;
    const seconds = Math.max(0, Math.ceil((Number(clock.dataset.restockAt) - Date.now()) / 1000));
    clock.lastElementChild.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  }

  function render() {
    if (panel.hidden) return;
    const workshop = wallet?.workshop;
    get('workshop-gold').textContent = wallet ? goldLabel(wallet.gold) : '—';
    get('workshop-scrap').hidden = !workshop?.scrap;
    get('workshop-scrap-value').textContent = workshop?.scrap ?? 0;
    renderFeedback(workshop);
    for (const chip of categories.children) {
      chip.hidden = (tab === 'sell' && chip.dataset.category === 'loot') || (tab !== 'sell' && chip.dataset.category === 'all');
      chip.setAttribute('aria-pressed', String(chip.dataset.category === category));
    }
    const next = JSON.stringify([tab, category, workshop, wallet?.rig, wallet?.gold, online, pending]);
    if (rendered === next) return;
    rendered = next;
    renderMerchant(workshop?.dock);
    items.dataset.category = category;
    if (!workshop) {
      items.replaceChildren();
      loadout.replaceChildren();
      return;
    }
    const current = [preview(wallet.rig), cosmeticFor(workshop.appearance?.pirate), cosmeticFor(workshop.appearance?.pet)];
    loadout.replaceChildren(...current.filter(Boolean).map(item => {
      const image = itemThumbnail(item);
      image.alt = item.label;
      image.title = item.label;
      return image;
    }));
    const rows = [];
    const dock = workshop.dock;
    if (tab === 'stock' && category === 'loot') {
      rows.push(itemCard('chest', [purchase('chest', 'Open chest', COSMETIC_CHEST_PRICE,
        () => review('gear-open-chest', { id: crypto.randomUUID() }, 'chest', COSMETIC_CHEST_PRICE), wallet.gold < COSMETIC_CHEST_PRICE)]));
    } else if (tab === 'stock' && category !== 'rig') {
      for (const cosmetic of Object.values(ITEMS).filter(item => categoryFor(item) === category && item.slot !== 'chest' && !item.expeditionOnly)) {
        const owned = cosmetic.free ? { id: cosmetic.id, type: cosmetic.id }
          : workshop.inventory.find(item => item.type === cosmetic.id && !item.listing);
        const quote = dock?.quotes[cosmetic.id];
        const price = quote?.ask ?? cosmetic.price;
        const makeOrder = () => review('gear-buy-cosmetic', { cosmetic: cosmetic.id, price, id: crypto.randomUUID() },
          cosmetic.id, cosmetic.scrapCost ?? price, quote && price - quote.askDelta, { scrap: Boolean(cosmetic.scrapCost) });
        const controls = owned ? [cosmetic.slot === 'home'
          ? control('check', 'Cottage owned', null, { disabled: true }) : styleControl(owned, cosmetic)]
          : cosmetic.scrapCost
            ? [control('break', 'Craft ' + cosmetic.label + ' for ' + cosmetic.scrapCost + ' scrap', makeOrder,
              { disabled: workshop.scrap < cosmetic.scrapCost, value: String(cosmetic.scrapCost), primary: true })]
            : [purchase('buy', 'Buy ' + cosmetic.label, price, makeOrder, wallet.gold < price || quote?.count === 0)];
        rows.push(itemCard(cosmetic.id, controls, { equipped: owned && (equippedItem(owned) || cosmetic.slot === 'home'), quote }));
      }
    } else if (tab === 'stock') {
      for (const part of workshop.stock) {
        rows.push(itemCard(part.type, [purchase('buy', 'Buy ' + preview(part.type).label, part.price,
          () => review('gear-buy-stock', { rig: part.type, price: part.price, id: crypto.randomUUID() },
            part.type, part.price, dock?.quotes[part.type] && part.price - dock.quotes[part.type].askDelta),
          !part.count || wallet.gold < part.price)], { count: part.count, quote: dock?.quotes[part.type] }));
      }
    } else {
      rows.push(...workshop.inventory.filter(item => !item.starter && (dock?.quotes[item.type] || item.listing)
        && (category === 'all' || categoryFor(cosmeticFor(item.type)) === category))
        .sort((a, b) => Number(Boolean(dock?.quotes[b.type]?.wanted)) - Number(Boolean(dock?.quotes[a.type]?.wanted)))
        .map(item => sellCard(item, dock)));
    }
    items.replaceChildren(...(rows.length ? rows : [emptyShelf()]));
  }

  function selectTab(mode) {
    tab = mode;
    category = mode === 'sell' ? 'all' : 'rig';
    for (const name of tabs) get('shop-' + name).setAttribute('aria-pressed', String(name === mode));
    items.scrollTop = 0;
  }
  for (const mode of tabs) get('shop-' + mode).addEventListener('click', () => {
    selectTab(mode);
    render();
  });
  for (const chip of categories.children) chip.addEventListener('click', () => {
    category = chip.dataset.category;
    items.scrollTop = 0;
    render();
  });
  window.setInterval(() => {
    if (!panel.hidden && online && !pending) send({ type: 'gear-refresh' });
  }, 5_000);
  window.setInterval(updateRestockClock, 1_000);

  return {
    update(next, connected) {
      if (panel.hidden && info.open) info.close();
      if (panel.hidden && trade.open) trade.close();
      if (!connected) pending = null;
      wallet = next;
      online = connected;
      if (!panel.hidden && !wasVisible) {
        category = 'rig';
        selectTab('stock');
        feedback = null;
        if (online) send({ type: 'gear-refresh' });
      }
      wasVisible = !panel.hidden;
      render();
    },
    acknowledge(type, id) {
      if (type !== pending) return;
      pending = null;
      const awarded = type === 'gear-open-chest' && wallet?.workshop?.inventory.find(item => item.id === id);
      feedback = type === 'gear-sell-merchant'
        ? { icon: 'coin', label: 'Quartermaster payment', value: '+' + goldLabel(merchantPayout) }
        : { icon: 'check', label: awarded ? preview(awarded.type).label + ' unlocked' : 'Done', type: awarded?.type };
      if (awarded) {
        category = categoryFor(cosmeticFor(awarded.type));
        selectTab('stock');
      }
      render();
      if (awarded) items.querySelector(`[data-item="${CSS.escape(id)}"]`)?.classList.add('unlocked');
    },
    error(detail) {
      if (!pending) return false;
      pending = null;
      feedback = { icon: 'close', label: detail, error: true };
      render();
      return true;
    },
  };
}
