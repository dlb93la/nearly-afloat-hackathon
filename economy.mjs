import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ARENA_ENTRY, wagerFee } from './shared/arena-entry.mjs';
import { evaluateRoute, validDefense } from './shared/vault.mjs';
import { certifiedRoute, liveFort } from './shared/live-vault.mjs';
import { DEFAULT_RIG, FIRST_BRAWL_RIGS, MARKET_PERCENT, PATCH_PRICE, PATCH_SCRAP_COST, RIG_USES, rigFor, STOCK_RIGS } from './shared/rigs.mjs';
import { COSMETIC_CHEST_PRICE, cosmeticFor, ITEMS, ITEM_SLOTS, LOOT_POOL } from './shared/cosmetics.mjs';
import { dockQuote, MERCHANT_TREASURY_RESERVE, advanceMerchant, merchantOrder, merchantRestockDue, MERCHANT_RESTOCK_MS } from './shared/merchant.mjs';
import { advanceExpedition, applyExpeditionAction, awardExpeditionCargo, createExpedition,
  expeditionDue, expeditionRules, expeditionSnapshot, hasReservedExpeditionSlot } from './shared/expeditions.mjs';

export { ARENA_ENTRY };
export const ARENA_BONUS = 200;
export const RAID_FEE = 100;
export const ARENA_EXPIRY_MS = 90_000;
export const RAID_EXPIRY_MS = 120_000;
const STARTER_GOLD = 10_000;
const BOT_BANK = 20_000;
const TREASURY = 10_000;
const MAX_EXPOSED_GOLD = 10_000;
const HEX_TOKEN = /^[a-f0-9]{64}$/;
const VAULT_CODE = /^[A-F0-9]{8}$/;
const RECORD_ID = /^[a-f0-9-]{36}$/;
const STOCK_CAP = 8;
const RESTOCK_MS = 600_000;
const INVENTORY_CAP = 80;
const MARKET_CAP = 100;

export class EconomyError extends Error {}

function requireRule(condition, message) {
  if (!condition) throw new EconomyError(message);
}

function digest(token) {
  return createHash('sha256').update(token).digest('hex');
}

function publicRound(round) {
  return { status: round.status, entry: round.entry ?? ARENA_ENTRY, pot: round.pot, fee: round.fee,
    bonus: round.bonus, winnerId: round.winnerId, paid: round.paid, expiresAt: round.expiresAt,
    wagers: Object.fromEntries(round.seats.map(seat => [seat.id, seat.wager ?? ARENA_ENTRY])),
    rigs: Object.fromEntries(round.seats.map(seat => [seat.id, seat.rig ?? DEFAULT_RIG])) };
}

function finishGear(state, id, uses) {
  const item = id ? state.gear?.[id] : null;
  if (!item) return;
  item.lock = null;
  if (uses) item.uses--;
}

function refundRound(state, round) {
  if (round.status !== 'reserved') return;
  for (const { accountId, gearId, wager = ARENA_ENTRY } of round.seats) {
    if (accountId) state.accounts[accountId].gold += wager;
    else state.botBank += wager;
    finishGear(state, gearId, false);
  }
  state.treasury += round.bonus;
  round.status = 'cancelled';
}

function stockAt(state, type, now) {
  const stock = state.shop?.[type];
  if (!stock) return { count: STOCK_CAP, since: now };
  const intervals = Math.max(0, Math.floor((now - stock.since) / RESTOCK_MS));
  const count = Math.min(STOCK_CAP, stock.count + intervals);
  return { count, since: count === STOCK_CAP ? now : stock.since + intervals * RESTOCK_MS };
}

function stockPrice(type, count) {
  const rig = rigFor(type);
  return rig.price + (STOCK_CAP - count) * rig.scarcity;
}

function quoteAt(state, type, now) {
  const { count } = stockAt(state, type, now);
  const markup = STOCK_RIGS.includes(type) ? stockPrice(type, count) - rigFor(type).price : 0;
  const quote = dockQuote(type, now, markup, STOCK_CAP - count);
  return quote && { ...quote, count };
}

function equippedGear(state, id) {
  const item = state.gear?.[state.accounts[id]?.equipped];
  return item && item.owner === id && item.uses > 0 && !item.listing && !item.lock ? item : null;
}

function publicGear(item) {
  return { id: item.id, type: item.type, uses: item.uses, patched: item.patched, locked: Boolean(item.lock),
    ...(item.starter ? { starter: true } : {}),
    listing: item.listing ? { id: item.listing.id, price: item.listing.price } : null };
}

function hasInventoryRoom(state, id, ownedCount = Object.values(state.gear ?? {}).filter(item => item.owner === id).length) {
  return ownedCount + Number(hasReservedExpeditionSlot(state.expedition, id)) < INVENTORY_CAP;
}

function appearanceOf(state, account) {
  const equipped = Object.fromEntries(ITEM_SLOTS.map(slot => {
    const item = state.gear?.[account?.cosmetics?.[slot]];
    const free = cosmeticFor(account?.cosmetics?.[slot]);
    return [slot, item && !item.listing ? item.type : free?.free && free.slot === slot ? free.id : null];
  }));
  return { ...equipped, pirateColor: account?.colors?.pirate ?? null, barrelColor: account?.colors?.barrel ?? null };
}

function closeRaid(state, raid, status) {
  state.vaults[raid.vaultCode].lock = null;
  state.accounts[raid.attacker].activeRaid = null;
  raid.status = status;
  finishGear(state, raid.gearId, status === 'won' || status === 'failed');
  if (status === 'expired' || status === 'cancelled') state.accounts[raid.attacker].gold += RAID_FEE;
}

function expire(state, now) {
  for (const round of Object.values(state.rounds)) {
    if (round.expiresAt <= now) refundRound(state, round);
  }
  for (const raid of Object.values(state.raids)) {
    if (raid.status === 'open' && raid.expiresAt <= now) closeRaid(state, raid, 'expired');
  }
}

export function openEconomy(filename, clock = Date.now, { expedition: expeditionOverrides, starterGold = STARTER_GOLD } = {}) {
  const voyageRules = expeditionRules(expeditionOverrides);
  const db = new DatabaseSync(filename);
  db.exec('CREATE TABLE IF NOT EXISTS embedded_identities (identity TEXT PRIMARY KEY, account TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS remembered_logins (token_hash TEXT PRIMARY KEY, profile TEXT NOT NULL, account TEXT NOT NULL, expires INTEGER NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS pirate_profiles (account TEXT PRIMARY KEY, name TEXT NOT NULL, named INTEGER NOT NULL DEFAULT 0)');
  db.exec('CREATE TABLE IF NOT EXISTS pirate_first_matches (account TEXT PRIMARY KEY)');
  function rememberPirateMatch(account) {
    db.prepare('INSERT OR IGNORE INTO pirate_first_matches VALUES (?)').run(account);
  }
  function hasPirateMatch(account) {
    return Boolean(db.prepare('SELECT account FROM pirate_first_matches WHERE account = ?').get(account));
  }
  function useStarterAccount(id, wallet) {
    change(state => {
      const profile = state.accounts[id];
      if (!profile) return;
      const previous = profile.starterOwner ?? profile.firstBrawl?.wallet;
      if (previous && previous !== wallet) delete profile.firstBrawl;
      profile.starterOwner = wallet;
    });
  }
  function pirateProfile(account, name) {
    const names = ['Salty', 'Captain', 'Rusty', 'Mad', 'Lucky', 'Stormy', 'Crooked', 'Barnacle'];
    const pirates = ['Boots', 'Brine', 'Sparrow', 'Plank', 'Cork', 'Claw', 'Pearl', 'Squall'];
    const fallback = names[randomInt(names.length)] + ' ' + pirates[randomInt(pirates.length)] + ' ' + randomInt(10, 100);
    db.prepare('INSERT OR IGNORE INTO pirate_profiles (account, name) VALUES (?, ?)').run(account, fallback);
    if (name !== undefined) {
      const clean = [...String(name).replace(/[<>]|\p{C}/gu, '').trim().replace(/\s+/g, ' ')].slice(0, 20).join('');
      if (clean) db.prepare('UPDATE pirate_profiles SET name = ?, named = 1 WHERE account = ?').run(clean, account);
      else db.prepare('UPDATE pirate_profiles SET named = 1 WHERE account = ?').run(account);
    }
    const profile = db.prepare('SELECT name, named FROM pirate_profiles WHERE account = ?').get(account);
    return { name: profile.name, named: Boolean(profile.named) };
  }
  db.exec('PRAGMA busy_timeout = 2500; PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS economy (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL)');
  db.prepare('INSERT OR IGNORE INTO economy VALUES (1, ?)').run(JSON.stringify({
    accounts: {}, credentials: {}, rounds: {}, vaults: {}, raids: {}, gear: {}, shop: {}, treasury: TREASURY, botBank: BOT_BANK,
  }));
  const select = db.prepare('SELECT state FROM economy WHERE id = 1');
  const write = db.prepare('UPDATE economy SET state = ? WHERE id = 1');
  const read = () => JSON.parse(select.get().state);

  // Refund legacy race reservations once before removing their stored state.
  if (read().tideRaces) change(state => {
    for (const reservation of Object.values(state.tideRaces ?? {})) {
      if (reservation.status !== 'reserved') continue;
      state.accounts[reservation.accountId].gold += 200;
      state.treasury += 300;
    }
    for (const account of Object.values(state.accounts)) delete account.activeTide;
    delete state.tideRaces;
  });

  // Read and write under a single SQLite lock so simultaneous actions cannot spend the same gold.
  function change(action) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const state = read();
      const now = clock();
      expire(state, now);
      advanceMerchant(state, now);
      const result = action(state, now);
      write.run(JSON.stringify(state));
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function findAccount(token) {
    return typeof token === 'string' && HEX_TOKEN.test(token) ? read().credentials[digest(token)] ?? null : null;
  }

  function createAccount() {
    return change((state) => {
      const token = randomBytes(32).toString('hex');
      const id = randomUUID();
      let code;
      do { code = randomBytes(4).toString('hex').toUpperCase(); } while (state.vaults[code]);
      state.credentials[digest(token)] = id;
      state.accounts[id] = { gold: starterGold, vaultCode: code, activeRaid: null, lastRaid: null };
      state.vaults[code] = { code, owner: id, gold: 0, version: 1, lock: null, defense: { chest: 2, cannon: 8, barricades: [] } };
      return token;
    });
  }

  function issueProgressCode(id) {
    return change(state => {
      const account = state.accounts[id];
      requireRule(account, 'Open your local profile first.');
      const codes = state.progressCodes ??= {};
      if (account.progressCode) delete codes[account.progressCode];
      const code = randomBytes(24).toString('base64url');
      account.progressCode = digest(code);
      codes[account.progressCode] = id;
      return code;
    });
  }

  function restoreProgress(code, currentId) {
    return change(state => {
      requireRule(typeof code === 'string' && /^[A-Za-z0-9_-]{32}$/.test(code), 'Enter a valid progress code.');
      const key = digest(code);
      const id = state.progressCodes?.[key];
      requireRule(id && state.accounts[id]?.progressCode === key, 'That progress code is invalid or has already been used.');
      requireRule(currentId !== id, 'This profile is already open here.');
      const current = state.accounts[currentId];
      const hasProgress = current && (current.gold !== STARTER_GOLD || current.firstBrawl || current.lastRaid ||
        current.activeRaid || state.vaults[current.vaultCode]?.version > 1 ||
        Object.values(state.gear ?? {}).some(item => item.owner === currentId));
      requireRule(!hasProgress, 'Use a fresh browser profile so your current progress stays accessible.');
      const token = randomBytes(32).toString('hex');
      state.credentials[digest(token)] = id;
      delete state.progressCodes[key];
      delete state.accounts[id].progressCode;
      return token;
    });
  }

  function wallet(id) {
    const state = read();
    const account = state.accounts[id];
    if (!account) return null;
    const vault = state.vaults[account.vaultCode];
    const raid = state.raids[account.activeRaid ?? account.lastRaid];
    const gear = Object.values(state.gear ?? {});
    const now = clock();
    return {
      gold: account.gold, treasury: state.treasury, botBank: state.botBank,
      rig: equippedGear(state, id)?.type ?? DEFAULT_RIG,
      firstBrawl: account.firstBrawl ?? null,
      expeditions: expeditionSnapshot(state.expedition, id),
      workshop: {
        equipped: account.equipped ?? null,
        cosmetics: account.cosmetics ?? {},
        appearance: appearanceOf(state, account),
        merchant: merchantOrder(state.merchant),
        dock: {
          available: Math.max(0, state.treasury - MERCHANT_TREASURY_RESERVE),
          quotes: Object.fromEntries([...STOCK_RIGS, ...Object.keys(ITEMS)].flatMap(type => {
            const quote = quoteAt(state, type, now);
            return quote ? [[type, quote]] : [];
          })),
        },
        scrap: account.scrap ?? 0,
        inventory: gear.filter(item => item.owner === id).map(publicGear),
        stock: STOCK_RIGS.map(type => {
          const { count } = stockAt(state, type, now);
          return { type, count, price: quoteAt(state, type, now).ask };
        }),
        market: gear.filter(item => item.listing).map(item => ({ ...publicGear(item), own: item.owner === id })),
      },
      vault: { code: vault.code, gold: vault.gold, version: vault.version, defense: vault.defense,
        skin: appearanceOf(state, account).chest, locked: Boolean(vault.lock) },
      raid: raid ? {
        id: raid.id, status: raid.status, defense: raid.defense, vaultCode: raid.vaultCode,
        version: raid.version, gold: raid.gold, expiresAt: raid.expiresAt, hits: raid.hits, live: Boolean(raid.live),
        rig: raid.rig ?? DEFAULT_RIG, skin: raid.skin ?? null,
      } : null,
    };
  }

  function openExpedition(id) {
    return change((state, now) => {
      state.expedition ??= createExpedition(voyageRules, now);
      return expeditionSnapshot(state.expedition, id);
    });
  }

  function expedition(id) {
    return expeditionSnapshot(read().expedition, id);
  }

  function expeditionAction(id, action) {
    return change((state, now) => {
      advanceExpedition(state, now);
      return applyExpeditionAction(state, id, action, now, requireRule, hasInventoryRoom);
    });
  }

  // The server verifies the final contract winner and award before calling this method.
  function claimNearExpedition(id, contractId) {
    return change(state => {
      requireRule(state.accounts[id], 'Open your local profile first.');
      requireRule(typeof contractId === 'string' && contractId.length <= 64
        && /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(contractId), 'The expedition contract is invalid.');
      const claims = state.nearExpeditionClaims ??= {};
      const claim = Object.hasOwn(claims, contractId) ? claims[contractId] : null;
      if (claim) {
        requireRule(claim.accountId === id, 'That NEAR cargo was already claimed by another profile.');
        return { itemId: claim.itemId, granted: false };
      }
      requireRule(hasInventoryRoom(state, id), 'Make room in your inventory before claiming the cargo.');
      const itemId = awardExpeditionCargo(state, id, 'near-expedition:' + contractId);
      claims[contractId] = { accountId: id, itemId };
      return { itemId, granted: true };
    });
  }

  function hasNearExpeditionClaim(id, contractId) {
    const claims = read().nearExpeditionClaims ?? {};
    return Object.hasOwn(claims, contractId) && claims[contractId].accountId === id;
  }

  function workshopAction(id, action) {
    return change((state, now) => {
      const account = state.accounts[id];
      if (action.type === 'gear-colors') {
        requireRule([action.pirate, action.barrel].every(color => color === null ||
          (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))), 'Choose valid pirate and barrel colors.');
        account.colors = { pirate: action.pirate?.toLowerCase() ?? null, barrel: action.barrel?.toLowerCase() ?? null };
        return;
      }
      const gear = state.gear ??= {};
      const shop = state.shop ??= {};
      const owned = Object.values(gear).filter(item => item.owner === id);
      const item = typeof action.id === 'string' && Object.hasOwn(gear, action.id) ? gear[action.id] : null;
      const canBuy = () => requireRule(hasInventoryRoom(state, id, owned.length), 'Your barrel rack is full.');
      const pay = amount => {
        requireRule(account.gold >= amount, 'You need more test gold.');
        account.gold -= amount;
      };
      if (action.type === 'gear-buy-cosmetic' || action.type === 'gear-open-chest') {
        const chest = action.type === 'gear-open-chest';
        const offer = chest ? null : cosmeticFor(action.cosmetic);
        requireRule(typeof action.id === 'string' && RECORD_ID.test(action.id) && (chest || offer), 'Choose a cosmetic or a chest.');
        requireRule(!offer?.free, 'Free paints are already in your rack.');
        requireRule(!offer?.expeditionOnly, 'This item is awarded in Expeditions.');
        const order = chest ? 'chest' : offer.id;
        if (item?.owner === id && item.order === order) return;
        requireRule(!item, 'That order has already been used.');
        requireRule(offer?.slot !== 'home' || !account.cosmetics?.home, 'You already own this cottage.');
        canBuy();
        if (offer?.scrapCost) {
          requireRule((account.scrap ?? 0) >= offer.scrapCost, 'You need scrap to craft this item.');
          account.scrap -= offer.scrapCost;
        } else {
          const quote = quoteAt(state, offer?.id, now);
          const price = quote?.ask ?? offer?.price ?? COSMETIC_CHEST_PRICE;
          if (quote) {
            const stock = stockAt(state, offer.id, now);
            requireRule(stock.count > 0, 'That item is out of stock.');
            shop[offer.id] = { count: stock.count - 1, since: stock.since };
          }
          if (action.price !== undefined) requireRule(action.price === price, 'The shop price changed. Review the new price.');
          pay(price);
          state.treasury += price;
        }
        let type = offer?.id;
        if (chest) {
          const available = LOOT_POOL.filter(id => stockAt(state, id, now).count > 0);
          requireRule(available.length > 0, 'The chest is sold out.');
          type = available[randomInt(available.length)];
          const stock = stockAt(state, type, now);
          shop[type] = { count: stock.count - 1, since: stock.since };
        }
        gear[action.id] = { id: action.id, owner: id, type, order };
        if (offer?.slot === 'home') (account.cosmetics ??= {}).home = action.id;
        return;
      }
      if (action.type === 'gear-buy-stock') {
        requireRule(STOCK_RIGS.includes(action.rig) && typeof action.id === 'string' && RECORD_ID.test(action.id),
          'Choose a barrel from the quartermaster.');
        if (item?.owner === id && item.type === action.rig) return;
        requireRule(!item, 'That order has already been used.');
        canBuy();
        const stock = stockAt(state, action.rig, now);
        const price = quoteAt(state, action.rig, now).ask;
        requireRule(stock.count > 0 && action.price === price, 'The quartermaster stock changed. Review the new price.');
        pay(price);
        state.treasury += price;
        gear[action.id] = { id: action.id, owner: id, type: action.rig, uses: RIG_USES, patched: false };
        shop[action.rig] = { count: stock.count - 1, since: stock.since };
        return;
      }
      if (action.type === 'gear-buy-market') {
        requireRule(item?.listing && item.listing.id === action.listing && item.owner !== id,
          'That listing is no longer available.');
        canBuy();
        const { price } = item.listing;
        pay(price);
        const fee = Math.ceil(price * MARKET_PERCENT / 100);
        state.accounts[item.owner].gold += price - fee;
        state.treasury += fee;
        item.owner = id;
        item.listing = null;
        return;
      }
      if (action.type === 'gear-equip' && action.id === null) {
        account.equipped = null;
        return;
      }
      if (action.type === 'gear-style') {
        requireRule(ITEM_SLOTS.includes(action.slot) && action.slot !== 'home', 'Choose a cosmetic slot.');
        const free = cosmeticFor(action.id);
        requireRule(action.id === null || (free?.free && free.slot === action.slot) || (item?.owner === id && !item.listing && cosmeticFor(item.type)?.slot === action.slot),
          'Choose a cosmetic from your rack.');
        (account.cosmetics ??= {})[action.slot] = action.id;
        return;
      }
      if (action.type === 'gear-sell-merchant' && item?.merchantSale?.seller === id
          && item.merchantSale.order === action.order && item.merchantSale.price === action.price) return;
      requireRule(item?.owner === id && !item.lock, 'That barrel is unavailable while in use.');
      if (action.type === 'gear-unlist') {
        requireRule(item.listing?.id === action.listing, 'That listing has already changed.');
        item.listing = null;
        return;
      }
      requireRule(!item.listing, 'Unlist that barrel before changing it.');
      if (action.type === 'gear-sell-merchant' && String(action.order).startsWith('dock-')) {
        const quote = quoteAt(state, item.type, now);
        requireRule(quote && !item.starter, 'The quartermaster cannot buy this item.');
        requireRule(action.order === quote.order && action.price === quote.bid, 'The offer changed. Review the new price.');
        requireRule(state.treasury - MERCHANT_TREASURY_RESERVE >= quote.bid, 'The quartermaster is short on gold.');
        state.treasury -= quote.bid;
        account.gold += quote.bid;
        if (account.equipped === item.id) account.equipped = null;
        const slot = cosmeticFor(item.type)?.slot;
        if (slot && account.cosmetics?.[slot] === item.id) account.cosmetics[slot] = null;
        item.merchantSale = { seller: id, order: quote.order, price: quote.bid };
        item.owner = null;
        const stock = stockAt(state, item.type, now);
        if (stock.count < STOCK_CAP) shop[item.type] = { count: stock.count + 1, since: stock.since };
        return;
      }
      if (action.type === 'gear-sell-merchant') {
        const order = merchantOrder(state.merchant);
        requireRule(item.type === order.itemType && !item.starter,
          'The buyer wants a tradeable ' + rigFor(order.itemType).label.toLowerCase() + '.');
        requireRule(order.price > 0 && order.budget >= order.price, 'The buyer has filled this order.');
        requireRule(action.order === order.order && action.price === order.price, 'The buyer’s offer changed. Review the new price.');
        state.merchant = {
          cycle: state.merchant?.cycle ?? 0,
          budget: order.budget - order.price,
          received: order.received + 1,
          restockAt: order.remaining === 1 ? now + MERCHANT_RESTOCK_MS : null,
        };
        account.gold += order.price;
        if (account.equipped === item.id) account.equipped = null;
        item.merchantSale = { seller: id, order: order.order, price: order.price };
        item.owner = null;
        const stock = stockAt(state, item.type, now);
        if (stock.count < STOCK_CAP) shop[item.type] = { count: stock.count + 1, since: stock.since };
      } else if (action.type === 'gear-equip') {
        requireRule(item.uses > 0, 'That barrel is worn out.');
        account.equipped = item.id;
      } else if (action.type === 'gear-patch') {
        requireRule(!cosmeticFor(item.type) && !item.patched && item.uses < RIG_USES, 'A barrel can be patched once to restore one use.');
        if (action.payment === 'scrap') {
          requireRule((account.scrap ?? 0) >= PATCH_SCRAP_COST, 'You need scrap to patch this barrel.');
          account.scrap -= PATCH_SCRAP_COST;
        } else {
          requireRule(action.payment === undefined || action.payment === 'gold', 'Choose gold or scrap for the patch.');
          pay(PATCH_PRICE);
          state.treasury += PATCH_PRICE;
        }
        item.uses++;
        item.patched = true;
      } else if (action.type === 'gear-list') {
        requireRule(!item.starter, 'Your first barrel stays with you.');
        requireRule(cosmeticFor(item.type)?.slot !== 'home', 'The cottage deed stays with its owner.');
        const { price } = action;
        requireRule(item.uses > 0 || !item.patched, 'This barrel has no uses or repairs left.');
        requireRule(Number.isSafeInteger(price) && price >= 100 && price <= 10_000, 'List for 1.00 to 100.00 test gold.');
        requireRule(Object.values(gear).filter(entry => entry.listing).length < MARKET_CAP, 'The market is full.');
        if (account.equipped === item.id) account.equipped = null;
        const cosmetic = cosmeticFor(item.type);
        if (cosmetic && account.cosmetics?.[cosmetic.slot] === item.id) account.cosmetics[cosmetic.slot] = null;
        item.listing = { id: randomUUID(), price };
      } else if (action.type === 'gear-discard') {
        requireRule(item.uses === 0 && item.patched, 'Only a spent barrel can be scrapped.');
        if (account.equipped === item.id) account.equipped = null;
        if (!item.starter) account.scrap = (account.scrap ?? 0) + 1;
        delete gear[item.id];
      } else {
        throw new EconomyError('Unknown workshop action.');
      }
    });
  }

  function completeFirstBrawl(id) {
    if (!read().accounts[id] || read().accounts[id].firstBrawl) return false;
    return change(state => {
      const account = state.accounts[id];
      if (!account || account.firstBrawl) return false;
      account.firstBrawl = { status: 'ready' };
      return true;
    });
  }

  function claimFirstBrawl(id, rig) {
    return change(state => {
      const account = state.accounts[id];
      const reward = account?.firstBrawl;
      requireRule(FIRST_BRAWL_RIGS.includes(rig), 'Choose a starter barrel.');
      if (reward?.status === 'claimed' && reward.rig === rig) return;
      requireRule(reward?.status === 'ready' && !reward.pendingNear, 'Finish a quick brawl to choose your first barrel.');
      const gear = state.gear ??= {};
      requireRule(hasInventoryRoom(state, id), 'Make room in your barrel rack first.');
      const itemId = randomUUID();
      gear[itemId] = { id: itemId, owner: id, type: rig, uses: RIG_USES, patched: false, starter: true };
      account.equipped = itemId;
      account.firstBrawl = { status: 'claimed', rig };
    });
  }

  function prepareNearFirstBrawl(id, wallet, rig, contract) {
    return change(state => {
      const reward = state.accounts[id]?.firstBrawl;
      requireRule(FIRST_BRAWL_RIGS.includes(rig), 'Choose a starter barrel.');
      requireRule(reward?.status === 'ready', 'Finish a quick brawl to choose your first barrel.');
      const pending = reward.pendingNear;
      requireRule(!pending || (pending.wallet === wallet && pending.rig === rig && pending.contract === contract),
        'Resume the starter claim with the same wallet and barrel.');
      reward.pendingNear = { wallet, rig, contract };
    });
  }

  function completeNearFirstBrawl(id, wallet, rig, contract) {
    return change(state => {
      const account = state.accounts[id];
      const reward = account?.firstBrawl;
      if (reward?.status === 'claimed' && reward.wallet === wallet && reward.rig === rig && reward.contract === contract) return;
      const pending = reward?.pendingNear;
      requireRule(pending?.wallet === wallet && pending.rig === rig && pending.contract === contract,
        'The starter claim changed.');
      account.firstBrawl = { status: 'claimed', rig, wallet, contract };
    });
  }

  // Only the server calls this after reading the authenticated owner's contract
  // reward. Recover the onboarding marker; do not mint gear or grant currency.
  function restoreNearFirstBrawl(id, wallet, rig, contract) {
    return change(state => {
      const account = state.accounts[id];
      requireRule(account && FIRST_BRAWL_RIGS.includes(rig), 'Invalid confirmed starter.');
      const reward = account.firstBrawl;
      requireRule(!reward?.wallet || (reward.wallet === wallet && reward.contract === contract),
        'This introduction belongs to another account.');
      const pending = reward?.pendingNear;
      requireRule(!pending || (pending.wallet === wallet && pending.rig === rig && pending.contract === contract),
        'Resume the starter claim with the same wallet and barrel.');
      account.firstBrawl = { status: 'claimed', rig, wallet, contract };
    });
  }

  function rig(id) {
    return equippedGear(read(), id)?.type ?? DEFAULT_RIG;
  }

  function appearance(id) {
    const state = read();
    return appearanceOf(state, state.accounts[id]);
  }

  function rememberNearReceipt(contract, accounts, hash, label) {
    if (typeof hash !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash) || !accounts.length) return;
    change((state, now) => {
      const receipts = state.nearReceipts ??= {};
      for (const account of accounts) {
        const key = contract + ':' + account;
        const recent = receipts[key] ?? [];
        if (!recent.some(receipt => receipt.hash === hash)) {
          receipts[key] = [{ hash, label, at: now }, ...recent].slice(0, 12);
        }
      }
    });
  }

  function nearReceipts(contract, account) {
    return read().nearReceipts?.[contract + ':' + account] ?? [];
  }

  function rememberNearRound(id, intent) {
    change((state, now) => {
      const journal = state.nearRounds ??= {};
      journal[id] = { ...intent, updatedAt: now };
    });
  }

  function forgetNearRound(id) {
    change(state => { if (state.nearRounds) delete state.nearRounds[id]; });
  }

  function nearRounds() {
    return Object.entries(read().nearRounds ?? {});
  }

  function reserveRound(id, seats, entry = ARENA_ENTRY) {
    return change((state, now) => {
      requireRule(RECORD_ID.test(id) && !state.rounds[id], 'That round is already registered.');
      requireRule(seats.length >= 2 && seats.length <= 8 && new Set(seats.map(seat => seat.id)).size === seats.length,
        'A gold round needs two to eight separate seats.');
      const wagers = seats.map(seat => ({ ...seat, wager: seat.wager ?? entry }));
      requireRule(wagers.every(({ wager }) => Number.isSafeInteger(wager) && wager > 0), 'Enter a valid gold wager.');
      const humans = wagers.filter(({ accountId }) => accountId);
      requireRule(humans.length > 0 && new Set(humans.map(seat => seat.accountId)).size === humans.length,
        'Each player needs a separate test wallet.');
      requireRule(humans.every(({ accountId, wager }) => state.accounts[accountId]?.gold >= wager), 'A player needs more test gold.');
      const botEntry = wagers.filter(seat => !seat.accountId).reduce((sum, seat) => sum + seat.wager, 0);
      requireRule(state.botBank >= botEntry, 'The bot bank cannot cover these seats.');
      const total = wagers.reduce((sum, seat) => sum + seat.wager, 0);
      requireRule(Number.isSafeInteger(total), 'The combined wagers are too large.');
      const bonus = Math.min(ARENA_BONUS, state.treasury);
      for (const { accountId, wager } of humans) state.accounts[accountId].gold -= wager;
      state.botBank -= botEntry;
      state.treasury -= bonus;
      const fee = wagers.reduce((sum, seat) => sum + wagerFee(seat.wager), 0);
      const reservedSeats = wagers.map(seat => {
        const item = seat.accountId ? equippedGear(state, seat.accountId) : null;
        if (item) item.lock = id;
        return { ...seat, gearId: item?.id, rig: item?.type ?? DEFAULT_RIG };
      });
      const round = {
        status: 'reserved', expiresAt: now + ARENA_EXPIRY_MS, seats: reservedSeats,
        entry, fee, pot: total - fee, bonus, winnerId: null, paid: 0,
      };
      state.rounds[id] = round;
      return publicRound(round);
    });
  }

  function finishRound(id, winnerId = null) {
    return change((state) => {
      const round = RECORD_ID.test(id) ? state.rounds[id] : null;
      requireRule(round, 'Round reservation not found.');
      if (round.status !== 'reserved') return publicRound(round);
      if (winnerId === null) {
        refundRound(state, round);
        return publicRound(round);
      }
      const winner = round.seats.find((seat) => seat.id === winnerId);
      requireRule(winner, 'The winner must be in the reserved roster.');
      if (winner.accountId) {
        round.paid = round.pot + round.bonus;
        state.accounts[winner.accountId].gold += round.paid;
        state.treasury += round.fee;
      } else {
        round.paid = round.pot;
        state.botBank += round.paid;
        state.treasury += round.fee + round.bonus;
      }
      round.winnerId = winner.id;
      round.status = 'settled';
      for (const { gearId } of round.seats) finishGear(state, gearId, true);
      return publicRound(round);
    });
  }

  function saveVault(id, { version, defense, gold }) {
    return change((state) => {
      const account = state.accounts[id];
      const vault = state.vaults[account.vaultCode];
      requireRule(!vault.lock, 'Your vault is locked while a raid is open.');
      requireRule(version === vault.version, 'The vault changed. Review the latest defense.');
      requireRule(Number.isSafeInteger(gold) && gold >= 0 && gold <= MAX_EXPOSED_GOLD, 'Expose between 0 and 100 test gold.');
      requireRule(defense?.layout === 'live' ? certifiedRoute(defense) : validDefense(defense),
        'Leave an oak barrel a safe route from the gate to the chest.');
      const difference = gold - vault.gold;
      requireRule(difference <= account.gold, 'Your wallet cannot cover that amount.');
      account.gold -= difference;
      vault.gold = gold;
      vault.defense = defense.layout === 'live'
        ? { layout: 'live', chest: defense.chest, pieces: defense.pieces.map(({ cell, kind }) => ({ cell, kind })) }
        : { chest: defense.chest, cannon: defense.cannon, barricades: [...defense.barricades] };
      vault.version++;
    });
  }

  function startRaid(id, code, live = false) {
    return change((state, now) => {
      const account = state.accounts[id];
      const vault = typeof code === 'string' && VAULT_CODE.test(code) ? state.vaults[code] : null;
      requireRule(vault && vault.owner !== id, 'Enter another player’s vault code.');
      requireRule(!account.activeRaid, 'Finish or cancel your current raid first.');
      requireRule(!vault.lock && vault.gold > 0, 'That vault has no exposed gold available.');
      requireRule(account.gold >= RAID_FEE, 'You need 1.00 test gold to start a raid.');
      const raidId = randomUUID();
      const item = equippedGear(state, id);
      if (item) item.lock = raidId;
      account.gold -= RAID_FEE;
      account.activeRaid = account.lastRaid = raidId;
      vault.lock = raidId;
      state.raids[raidId] = {
        id: raidId, status: 'open', attacker: id, vaultCode: code, version: vault.version,
        defense: live ? liveFort(vault.defense) : vault.defense,
        live, skin: appearanceOf(state, state.accounts[vault.owner]).chest,
        gold: vault.gold, expiresAt: now + RAID_EXPIRY_MS,
        gearId: item?.id, rig: item?.type ?? DEFAULT_RIG,
      };
    });
  }

  function finishRaid(id, raidId, path) {
    return change((state) => {
      const raid = typeof raidId === 'string' && RECORD_ID.test(raidId) ? state.raids[raidId] : null;
      requireRule(raid && raid.attacker === id, 'Raid not found for this wallet.');
      if (raid.status !== 'open') return;
      if (path === null) {
        closeRaid(state, raid, 'cancelled');
        return;
      }
      requireRule(!raid.live, 'The server decides the result of a live raid.');
      const result = evaluateRoute(raid.defense, path, raid.rig);
      requireRule(result, 'Choose a walkable route from the gate to the chest.');
      settleRaid(state, raid, result.won, result.hits);
    });
  }

  function settleRaid(state, raid, won, hits) {
    const vault = state.vaults[raid.vaultCode];
    requireRule(vault.lock === raid.id && vault.version === raid.version && vault.gold === raid.gold, 'The raid reservation changed.');
    state.treasury += RAID_FEE;
    raid.hits = hits;
    if (won) {
      state.accounts[raid.attacker].gold += raid.gold;
      vault.gold = 0;
      vault.version++;
    }
    closeRaid(state, raid, won ? 'won' : 'failed');
  }

  function settleLiveRaid(id, raidId, won, hits) {
    return change(state => {
      const raid = state.raids[raidId];
      requireRule(raid?.live && raid.attacker === id, 'Live raid not found.');
      if (raid.status === 'open') settleRaid(state, raid, won, hits);
      return raid.status;
    });
  }

  function sweep() {
    const state = read();
    const now = clock();
    const due = Object.values(state.rounds).some((round) => round.status === 'reserved' && round.expiresAt <= now)
      || Object.values(state.raids).some((raid) => raid.status === 'open' && raid.expiresAt <= now)
      || merchantRestockDue(state.merchant, now)
      || expeditionDue(state.expedition, now);
    if (due) change(advanceExpedition);
    return due;
  }

  function bindEmbeddedIdentity(identity, account) {
    if (!HEX_TOKEN.test(identity) || !HEX_TOKEN.test(account)) throw new EconomyError('Invalid account binding.');
    db.prepare('INSERT OR IGNORE INTO embedded_identities (identity, account) VALUES (?, ?)').run(identity, account);
    return db.prepare('SELECT account FROM embedded_identities WHERE identity = ?').get(identity).account === account;
  }

  const rememberedLogins = {
    get(hash, profile) {
      return db.prepare('SELECT account FROM remembered_logins WHERE token_hash = ? AND profile = ? AND expires > ?')
        .get(hash, profile, clock())?.account;
    },
    replace(previous, hash, profile, account, expires) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM remembered_logins WHERE expires <= ? OR (token_hash = ? AND profile = ?)').run(clock(), previous, profile);
        db.prepare('INSERT INTO remembered_logins VALUES (?, ?, ?, ?)').run(hash, profile, account, expires);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    revoke(hash, profile) {
      db.prepare('DELETE FROM remembered_logins WHERE token_hash = ? AND profile = ?').run(hash, profile);
    },
  };

  return { useStarterAccount, rememberPirateMatch, hasPirateMatch, pirateProfile, bindEmbeddedIdentity, rememberedLogins, findAccount, createAccount, issueProgressCode, restoreProgress, wallet, workshopAction, completeFirstBrawl, claimFirstBrawl, prepareNearFirstBrawl, completeNearFirstBrawl, restoreNearFirstBrawl,
    openExpedition, expedition, expeditionAction, claimNearExpedition, hasNearExpeditionClaim,
    rig, appearance, nearReceipts, rememberNearReceipt, rememberNearRound, forgetNearRound, nearRounds,
    reserveRound, finishRound, saveVault,
    startRaid, finishRaid, settleLiveRaid, sweep, close: () => db.close() };
}
