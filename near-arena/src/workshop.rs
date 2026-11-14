use super::*;
use near_sdk::serde_json::{self, json};
use std::collections::BTreeMap;

const PRICE_REFERENCE_STOCK: u8 = 8;
const USES: u8 = 3;
const REPAIR_PRICE: u64 = 175;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Rig {
    Oak,
    Iron,
    Cork,
    Anchor,
    Rocket,
    Swivel,
    Ram,
    Shield,
    Scout,
}

impl Rig {
    fn stock_limit(self) -> u8 {
        if self == Self::Oak { 0 } else { crate::catalog_data::RIG_CAP[self.index()] }
    }
    fn rarity(self) -> &'static str {
        if self == Self::Oak { "common" } else { crate::catalog_data::RIG_RARITY[self.index()] }
    }

    fn index(self) -> usize {
        match self {
            Self::Iron => 0,
            Self::Cork => 1,
            Self::Anchor => 2,
            Self::Rocket => 3,
            Self::Swivel => 4,
            Self::Ram => 5,
            Self::Shield => 6,
            Self::Scout => 7,
            Self::Oak => env::panic_str("Oak is the free barrel"),
        }
    }

    fn discount(self, price: u64) -> u64 {
        let cycle = env::block_timestamp_ms() / 600_000;
        if (self.index() as u64 + cycle) % 7 == 0 {
            price / 10
        } else {
            0
        }
    }

    fn price(self, count: u8) -> u64 {
        let (base, scarcity) = [
            (720, 65),
            (520, 50),
            (940, 80),
            (890, 80),
            (670, 55),
            (1020, 80),
            (980, 80),
            (810, 70),
        ][self.index()];
        base + u64::from(PRICE_REFERENCE_STOCK - count.min(PRICE_REFERENCE_STOCK)) * scarcity
    }

    fn sale_quote(self, count: u8) -> (u64, bool) {
        let next = self.price((count + 1).min(self.stock_limit()));
        crate::merchant::offer(self.price(count) / 2, count, self.index(), next - self.discount(next), self.stock_limit())
    }
}

#[near(serializers = [borsh])]
struct Gear {
    starter: bool,
    uses: u8,
    patched: bool,
    round: Option<u64>,
}

#[near(serializers = [borsh])]
struct Locker {
    equipped: Rig,
    items: [Option<Gear>; 8],
    scrap: u64,
}

impl Default for Locker {
    fn default() -> Self {
        Self {
            equipped: Rig::Oak,
            items: std::array::from_fn(|_| None),
            scrap: 0,
        }
    }
}

#[near(serializers = [json])]
struct GearView {
    starter: bool,
    rig: Rig,
    uses: u8,
    patched: bool,
    locked: bool,
}

#[near(serializers = [json])]
struct Quote {
    rig: Rig,
    count: u8,
    buy: u64,
    sell: u64,
    discount: u64,
    normal_sell: u64,
    wanted: bool,
    stock_limit: u8,
    rarity: String,
    commercial_supply: Option<u32>,
    circulating: Option<u32>,
    destroyed: u32,
    legacy_circulation_untracked: bool,
    retired_legacy_stock: u8,
    supply_version: u8,
}

#[near(serializers = [json])]
pub struct Workshop {
    registered: bool,
    gold: u64,
    scrap: u64,
    equipped: Rig,
    items: Vec<GearView>,
    stock: Vec<Quote>,
}

#[near(serializers = [json])]
#[serde(rename_all = "snake_case")]
pub enum WorkshopAction {
    Buy,
    Sell,
    Equip,
    Repair,
    Recycle,
}

fn starter_rewards() -> LookupMap<AccountId, Rig> {
    LookupMap::new(b"first-brawl-rewards".as_slice())
}

fn lockers() -> LookupMap<AccountId, Locker> {
    LookupMap::new(b"workshop-lockers".as_slice())
}

fn stock() -> LookupMap<u8, u8> {
    LookupMap::new(b"workshop-stock".as_slice())
}

fn reservations() -> LookupMap<u64, BTreeMap<AccountId, Rig>> {
    LookupMap::new(b"workshop-reservations".as_slice())
}

fn destroyed() -> LookupMap<u8, u32> { LookupMap::new(b"workshop-destroyed-v2".as_slice()) }
fn retired_stock() -> LookupMap<u8, u8> { LookupMap::new(b"workshop-retired-unsold-v2".as_slice()) }
fn stock_count(stock: &LookupMap<u8, u8>, rig: Rig) -> u8 {
    stock.get(&(rig.index() as u8)).copied().unwrap_or(if crate::collection::supply_known() { rig.stock_limit() } else { 6 }).min(rig.stock_limit())
}

pub(crate) fn economic_event(event: &str, data: serde_json::Value) {
    crate::logbook::record(event, &data);
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({
            "standard": "nearly_afloat",
            "version": "1.0.0",
            "event": event,
            "data": [data],
        })
    ));
}

#[near]
impl ArenaLedger {
    pub fn workshop(&self, player: AccountId) -> Workshop {
        let lockers = lockers();
        let fallback = Locker::default();
        let locker = lockers.get(&player).unwrap_or(&fallback);
        let stock = stock();
        let rigs = [
            Rig::Iron,
            Rig::Cork,
            Rig::Anchor,
            Rig::Rocket,
            Rig::Swivel,
            Rig::Ram,
            Rig::Shield,
            Rig::Scout,
        ];
        Workshop {
            registered: self.registered(player.clone()),
            gold: self.balance(player),
            scrap: locker.scrap,
            equipped: locker.equipped,
            items: rigs
                .iter()
                .filter_map(|&rig| {
                    locker.items[rig.index()].as_ref().map(|gear| GearView {
                        rig,
                        uses: gear.uses,
                        starter: gear.starter,
                        patched: gear.patched,
                        locked: gear.round.is_some(),
                    })
                })
                .collect(),
            stock: rigs
                .into_iter()
                .map(|rig| {
                    let count = stock_count(&stock, rig);
                    let base = rig.price(count);
                    let discount = rig.discount(base);
                    Quote {
                        rig,
                        count,
                        buy: base - discount,
                        sell: rig.sale_quote(count).0,
                        normal_sell: base / 2,
                        wanted: rig.sale_quote(count).1,
                        discount,
                        stock_limit: rig.stock_limit(),
                        rarity: rig.rarity().to_string(),
                        commercial_supply: crate::collection::supply_known().then_some(u32::from(rig.stock_limit())),
                        circulating: crate::collection::supply_known().then_some(u32::from(rig.stock_limit() - count).saturating_sub(destroyed().get(&(rig.index() as u8)).copied().unwrap_or(0))),
                        destroyed: destroyed().get(&(rig.index() as u8)).copied().unwrap_or(0),
                        legacy_circulation_untracked: !crate::collection::supply_known(),
                        retired_legacy_stock: retired_stock().get(&(rig.index() as u8)).copied().unwrap_or(0).max(stock.get(&(rig.index() as u8)).copied().unwrap_or(if crate::collection::supply_known() { rig.stock_limit() } else { 6 }).saturating_sub(rig.stock_limit())),
                        supply_version: 2,
                    }
                })
                .collect(),
        }
    }

    pub fn workshop_action(
        &mut self,
        action: WorkshopAction,
        rig: Rig,
        expected_price: Option<u64>,
        use_scrap: Option<bool>,
    ) -> Workshop {
        let player = env::predecessor_account_id();
        require!(
            self.registered(player.clone()),
            "Test gold account required"
        );
        let mut lockers = lockers();
        let mut locker = lockers.remove(&player).unwrap_or_default();
        let mut stock = stock();
        let mut gold_delta = 0i64;
        let mut scrap_delta = 0i64;

        if matches!(action, WorkshopAction::Equip) && rig == Rig::Oak {
            locker.equipped = Rig::Oak;
        } else {
            let index = rig.index();
            let item = &mut locker.items[index];
            let count = stock_count(&stock, rig);
            let raw = stock.get(&(index as u8)).copied().unwrap_or(if crate::collection::supply_known() { rig.stock_limit() } else { 6 });
            if raw > rig.stock_limit() { retired_stock().insert(index as u8, raw - rig.stock_limit()); }
            match action {
                WorkshopAction::Buy => {
                    let base = rig.price(count);
                    let price = base - rig.discount(base);
                    require!(expected_price == Some(price), "Purchase quote changed");
                    require!(item.is_none() && count > 0, "Barrel unavailable");
                    let balance = self.balances.get_mut(&player).expect("Registered");
                    require!(*balance >= price, "Insufficient test gold");
                    *balance -= price;
                    self.treasury += price;
                    gold_delta = -(price as i64);
                    stock.insert(index as u8, count - 1);
                    *item = Some(Gear {
                        uses: USES,
                        starter: false,
                        patched: false,
                        round: None,
                    });
                }
                _ => {
                    let gear = item
                        .as_mut()
                        .unwrap_or_else(|| env::panic_str("Barrel not owned"));
                    require!(gear.round.is_none(), "Barrel reserved for a round");
                    match action {
                        WorkshopAction::Buy => unreachable!(),
                        WorkshopAction::Sell => {
                            require!(!gear.starter, "The starter barrel is bound to your wallet");
                            let price = rig.sale_quote(count).0;
                            require!(expected_price == Some(price), "Sale quote changed");
                            require!(
                                gear.uses > 0 && count < rig.stock_limit(),
                                "Merchant cannot accept this barrel"
                            );
                            require!(self.treasury >= price, "Merchant budget unavailable");
                            self.treasury -= price;
                            *self.balances.get_mut(&player).expect("Registered") += price;
                            gold_delta = price as i64;
                            stock.insert(index as u8, count + 1);
                            *item = None;
                        }
                        WorkshopAction::Equip => {
                            require!(gear.uses > 0, "Barrel worn out");
                            locker.equipped = rig;
                        }
                        WorkshopAction::Repair => {
                            require!(
                                !gear.patched && gear.uses < USES,
                                "Barrel cannot be repaired"
                            );
                            if use_scrap.unwrap_or(false) {
                                require!(locker.scrap > 0, "Insufficient scrap");
                                locker.scrap -= 1;
                                scrap_delta = -1;
                            } else {
                                require!(
                                    expected_price == Some(REPAIR_PRICE),
                                    "Repair quote changed"
                                );
                                let balance = self.balances.get_mut(&player).expect("Registered");
                                require!(*balance >= REPAIR_PRICE, "Insufficient test gold");
                                *balance -= REPAIR_PRICE;
                                self.treasury += REPAIR_PRICE;
                                gold_delta = -(REPAIR_PRICE as i64);
                            }
                            gear.patched = true;
                            gear.uses += 1;
                        }
                        WorkshopAction::Recycle => {
                            require!(gear.patched && gear.uses == 0, "Barrel cannot be recycled");
                            if !gear.starter {
                                let burned = destroyed().get(&(index as u8)).copied().unwrap_or(0);
                                destroyed().insert(index as u8, burned.checked_add(1).expect("Destroyed unit limit"));
                                locker.scrap += 1;
                                scrap_delta = 1;
                            }
                            *item = None;
                        }
                    }
                }
            }
            if item.is_none() && locker.equipped == rig {
                locker.equipped = Rig::Oak;
            }
        }

        lockers.insert(player.clone(), locker);
        lockers.flush();
        stock.flush();
        economic_event(
            "workshop_action",
            json!({
                "player": player, "action": action, "rig": rig,
                "gold_delta": gold_delta, "scrap_delta": scrap_delta,
            }),
        );
        self.workshop(player)
    }

    pub fn first_brawl_reward(&self, player: AccountId) -> Option<Rig> {
        starter_rewards().get(&player).copied()
    }

    pub fn grant_first_brawl(&mut self, player: AccountId, rig: Rig) -> Workshop {
        self.require_referee();
        require!(
            matches!(rig, Rig::Iron | Rig::Cork),
            "Choose a starter barrel"
        );
        let index = rig.index();
        require!(
            self.registered(player.clone()),
            "Test gold account required"
        );
        let mut rewards = starter_rewards();
        if let Some(previous) = rewards.get(&player) {
            require!(*previous == rig, "Starter reward already chosen");
            return self.workshop(player);
        }
        let mut lockers = lockers();
        let mut locker = lockers.remove(&player).unwrap_or_default();
        require!(
            locker.items[index].is_none(),
            "Sell the commercial barrel or choose the other starter"
        );
        locker.items[index] = Some(Gear {
            starter: true,
            uses: USES,
            patched: false,
            round: None,
        });
        locker.equipped = rig;
        lockers.insert(player.clone(), locker);
        lockers.flush();
        rewards.insert(player.clone(), rig);
        economic_event(
            "first_brawl_reward",
            json!({ "player": player, "rig": rig }),
        );
        self.workshop(player)
    }

    pub fn round_rigs(&self, round_id: U64) -> Option<BTreeMap<AccountId, Rig>> {
        reservations().get(&round_id.0).cloned()
    }
}

pub(crate) fn lock_rigs(id: u64, players: &[AccountId]) {
    let mut lockers = lockers();
    let mut rigs = BTreeMap::new();
    for player in players {
        let rig = lockers.get_mut(player).map_or(Rig::Oak, |locker| {
            let rig = locker.equipped;
            if rig != Rig::Oak {
                let item = locker.items[rig.index()].as_mut().expect("Equipped barrel");
                require!(
                    item.uses > 0 && item.round.is_none(),
                    "Equipped barrel unavailable"
                );
                item.round = Some(id);
            }
            rig
        });
        rigs.insert(player.clone(), rig);
    }
    reservations().insert(id, rigs);
}

pub(crate) fn release_rigs(id: u64, settled: bool) {
    let Some(rigs) = reservations().get(&id).cloned() else {
        return;
    };
    let mut lockers = lockers();
    for (player, rig) in rigs {
        if rig == Rig::Oak {
            continue;
        }
        let locker = lockers.get_mut(&player).expect("Reserved locker");
        let gear = locker.items[rig.index()].as_mut().expect("Reserved barrel");
        require!(gear.round == Some(id), "Barrel reservation mismatch");
        gear.round = None;
        if settled {
            gear.uses -= 1;
            if gear.uses == 0 && locker.equipped == rig {
                locker.equipped = Rig::Oak;
            }
            economic_event(
                "barrel_wear",
                json!({
                    "player": player, "round_id": id.to_string(), "rig": rig, "uses": gear.uses,
                }),
            );
        }
    }
}

pub(crate) fn spend_scrap(player: &AccountId, cost: u64) {
    let mut lockers = lockers();
    let locker = lockers
        .get_mut(player)
        .unwrap_or_else(|| env::panic_str("Insufficient scrap"));
    require!(locker.scrap >= cost, "Insufficient scrap");
    locker.scrap -= cost;
}
