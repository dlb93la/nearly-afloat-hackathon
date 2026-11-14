use super::*;
use near_sdk::serde_json::json;
use std::collections::BTreeMap;

use crate::catalog_data::{CHEST_PRICE, ITEMS, LOOT_COUNT, ITEM_RARITY, ITEM_CAP, ITEM_LOOT_WEIGHT};
use crate::workshop::economic_event;

#[near(serializers = [borsh, json])]
#[derive(Default, Clone)]
pub struct Collection {
    pub(crate) owned: BTreeMap<String, u32>,
    equipped: BTreeMap<String, String>,
}

const ROTATION_MS: u64 = 600_000;

#[near(serializers = [json])]
pub struct CollectionQuote {
    item: String,
    count: u8,
    buy: u64,
    sell: u64,
    discount: u64,
    normal_sell: u64,
    wanted: bool,
    stock_limit: u8,
    rarity: String,
    loot_weight: u32,
    commercial_supply: Option<u32>,
    circulating: Option<u32>,
    legacy_circulation_untracked: bool,
    retired_legacy_stock: u8,
    supply_version: u8,
    chest_price: u64,
}

fn merchant_stock() -> LookupMap<String, u8> {
    LookupMap::new(b"collection-merchant-stock".as_slice())
}

pub(crate) fn initialize_supply() {
    LookupMap::<u8, bool>::new(b"commercial-supply-v2".as_slice()).insert(0, true);
}

pub(crate) fn supply_known() -> bool {
    LookupMap::<u8, bool>::new(b"commercial-supply-v2".as_slice()).get(&0).copied().unwrap_or(false)
}

fn retired_stock() -> LookupMap<String, u8> {
    LookupMap::new(b"collection-retired-unsold-v2".as_slice())
}

fn stock_count(stock: &LookupMap<String, u8>, index: usize) -> u8 {
    stock.get(ITEMS[index].0).copied().unwrap_or(if supply_known() { ITEM_CAP[index] } else { 8 }).min(ITEM_CAP[index])
}

fn quote(index: usize, count: u8) -> CollectionQuote {
    let (item, _, price, _) = ITEMS[index];
    let cycle = env::block_timestamp_ms() / ROTATION_MS;
    let discount = if (index as u64 + cycle) % 7 == 0 {
        price / 10
    } else {
        0
    };
    let (sell, wanted) = crate::merchant::offer(price / 2, count, index, price - discount, ITEM_CAP[index]);
    CollectionQuote {
        item: item.to_string(),
        count,
        buy: price - discount,
        sell,
        discount,
        normal_sell: price / 2,
        wanted,
        stock_limit: ITEM_CAP[index],
        rarity: ITEM_RARITY[index].to_string(),
        loot_weight: ITEM_LOOT_WEIGHT[index],
        commercial_supply: supply_known().then_some(u32::from(ITEM_CAP[index])),
        circulating: supply_known().then_some(u32::from(ITEM_CAP[index] - count)),
        legacy_circulation_untracked: !supply_known(),
        retired_legacy_stock: retired_stock().get(item).copied().unwrap_or(0),
        supply_version: 2,
        chest_price: CHEST_PRICE,
    }
}

fn collections() -> LookupMap<AccountId, Collection> {
    LookupMap::new(b"cosmetic-collections".as_slice())
}

#[near]
impl ArenaLedger {
    pub fn chest_price(&self) -> u64 {
        let stock = merchant_stock();
        // Cover expected immediate resale, including the post-draw stock quote.
        // Rare jackpots remain possible; exhausting cheap prizes cannot turn
        // the remaining pool into a guaranteed/positive-expectation gold faucet.
        let mut total = 0u64;
        let mut value = 0u64;
        for index in 0..LOOT_COUNT {
            let count = stock_count(&stock,index);
            if count == 0 { continue; }
            let weight = u64::from(count) * u64::from(ITEM_LOOT_WEIGHT[index]);
            total += weight;
            value += weight * quote(index,count-1).sell;
        }
        if total == 0 { return CHEST_PRICE; }
        ((value * 110 + total * 100 - 1) / (total * 100)).max(CHEST_PRICE)
    }
    pub fn collection(&self, player: AccountId) -> Collection {
        let mut collection = collections().get(&player).cloned().unwrap_or_default();
        for (item, count) in crate::voyage::owned_award_counts(&player) { collection.owned.insert(item, count); }
        collection
    }

    pub fn collection_quotes(&self) -> Vec<CollectionQuote> {
        let stock = merchant_stock();
        let chest_price = self.chest_price();
        ITEMS
            .iter()
            .enumerate()
            .filter(|(_, entry)| entry.2 > 0 || entry.3 > 0)
            .map(|(index, entry)| {
                let raw = stock.get(entry.0).copied().unwrap_or(if supply_known() { ITEM_CAP[index] } else { 8 });
                let mut current = quote(index, stock_count(&stock, index));
                current.chest_price = chest_price;
                current.retired_legacy_stock = current.retired_legacy_stock.max(raw.saturating_sub(ITEM_CAP[index]));
                current
            })
            .collect()
    }

    pub fn collection_action(
        &mut self,
        action: String,
        item: Option<String>,
        slot: Option<String>,
        expected_price: Option<u64>,
    ) -> Collection {
        let player = env::predecessor_account_id();
        require!(
            self.registered(player.clone()),
            "Test gold account required"
        );
        let mut collections = collections();
        let mut collection = collections.remove(&player).unwrap_or_default();
        let mut item = item;
        let mut stock = merchant_stock();
        let mut gold_delta = 0i64;
        let mut scrap_delta = 0i64;
        if action == "open_chest" {
            require!(item.is_none() && slot.is_none(), "Invalid chest request");
            require!(expected_price == Some(self.chest_price()), "Chest quote changed");
            let seed = env::random_seed_array();
            let total: u64 = (0..LOOT_COUNT).map(|index|
                u64::from(stock_count(&stock, index)) * u64::from(ITEM_LOOT_WEIGHT[index])).sum();
            require!(total > 0, "Chest sold out");
            let mut ticket = u64::from_le_bytes(seed[..8].try_into().expect("Random seed")) % total;
            for index in 0..LOOT_COUNT {
                let weight = u64::from(stock_count(&stock, index)) * u64::from(ITEM_LOOT_WEIGHT[index]);
                if ticket < weight { item = Some(ITEMS[index].0.to_string()); break; }
                ticket -= weight;
            }
        }
        if action == "unequip" {
            let slot = slot.unwrap_or_default();
            require!(ITEMS.iter().any(|entry| entry.1 == slot), "Unknown slot");
            collection.equipped.remove(&slot);
        } else {
            let id = item.as_deref().unwrap_or_default();
            let index = ITEMS
                .iter()
                .position(|entry| entry.0 == id)
                .unwrap_or_else(|| env::panic_str("Item unavailable"));
            let (_, item_slot, price, scrap) = ITEMS[index];
            let raw_stock = stock.get(id).copied().unwrap_or(if supply_known() { ITEM_CAP[index] } else { 8 });
            let in_stock = stock_count(&stock, index);
            if raw_stock > ITEM_CAP[index] {
                retired_stock().insert(id.to_string(), raw_stock - ITEM_CAP[index]);
            }
            let current = quote(index, in_stock);
            let count = collection.owned.get(id).copied().unwrap_or(0);
            match action.as_str() {
                "buy" | "open_chest" => {
                    let (cost, material) = if action == "open_chest" {
                        (self.chest_price(), 0)
                    } else {
                        require!(price > 0 || scrap > 0, "This paint is already available");
                        require!(
                            expected_price.is_none_or(|expected| expected == current.buy),
                            "Purchase quote changed"
                        );
                        (current.buy, scrap)
                    };
                    if price > 0 || scrap > 0 {
                        require!(in_stock > 0, "Item out of stock");
                        stock.insert(id.to_string(), in_stock - 1);
                    }
                    let balance = self.balances.get_mut(&player).expect("Registered");
                    require!(*balance >= cost, "Insufficient test gold");
                    *balance -= cost;
                    self.treasury += cost;
                    if material > 0 {
                        crate::workshop::spend_scrap(&player, material);
                    }
                    gold_delta = -(cost as i64);
                    scrap_delta = -(material as i64);
                    collection
                        .owned
                        .insert(id.to_string(), count.checked_add(1).expect("Item limit"));
                }
                "sell" => {
                    require!(count > 0 && price > 0, "Item cannot be sold");
                    let payout = current.sell;
                    require!(in_stock < ITEM_CAP[index], "Merchant stock is full");
                    require!(
                        expected_price.is_none_or(|expected| expected == payout),
                        "Sale quote changed"
                    );
                    stock.insert(id.to_string(), in_stock + 1);
                    require!(self.treasury >= payout, "Merchant budget unavailable");
                    self.treasury -= payout;
                    *self.balances.get_mut(&player).expect("Registered") += payout;
                    gold_delta = payout as i64;
                    if count == 1 {
                        collection.owned.remove(id);
                        if collection
                            .equipped
                            .get(item_slot)
                            .is_some_and(|equipped| equipped == id)
                        {
                            collection.equipped.remove(item_slot);
                        }
                    } else {
                        collection.owned.insert(id.to_string(), count - 1);
                    }
                }
                "equip" => {
                    require!(count > 0 || (price == 0 && scrap == 0), "Item not owned");
                    collection
                        .equipped
                        .insert(item_slot.to_string(), id.to_string());
                }
                _ => env::panic_str("Unknown collection action"),
            }
        }
        collections.insert(player.clone(), collection.clone());
        economic_event(
            "collection_action",
            json!({
                "player": player, "action": action, "item": item,
                "gold_delta": gold_delta, "scrap_delta": scrap_delta,
            }),
        );
        collection
    }
}
