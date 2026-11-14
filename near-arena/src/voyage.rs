use super::{ArenaLedger, ArenaLedgerExt};
use crate::workshop::economic_event;
use near_sdk::{AccountId, env, near, require, serde_json::json, store::LookupMap};

const DEFAULT_TARGET: u64 = 3_000;
const MIN_SUPPORTERS: usize = 2;
const MAX_SUPPORTERS: usize = 16;
const MIN_CONTRIBUTION: u64 = 100;
const BID_STEP: u64 = 100;
const FEE_PERCENT: u64 = 5;
const MAX_WINDOW_MS: u64 = 7 * 24 * 60 * 60 * 1_000;
const PRIZE: &str = "pet-expedition-parrot";

#[near(serializers = [borsh, json])]
#[derive(Clone, Default)]
pub struct VoyageAccount {
    contribution: u64,
    contribution_nonce: u64,
    last_contribution: u64,
    refund: u64,
    payout: u64,
}

#[near(serializers = [borsh])]
struct Bid {
    bidder: AccountId,
    amount: u64,
}

#[near(serializers = [borsh])]
#[derive(Clone, Copy, PartialEq, Eq)]
enum Outcome {
    Open,
    Refunded,
    Unsold,
    Settled,
}

#[near(serializers = [json])]
#[derive(Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Status {
    Funding,
    Sailing,
    Auction,
    Refunded,
    Unsold,
    Settled,
}

#[near(serializers = [borsh])]
struct Voyage {
    target: u64,
    funding_ends_at: u64,
    sailing_ms: u64,
    auction_ms: u64,
    sails_at: Option<u64>,
    funded: u64,
    contributors: Vec<AccountId>,
    highest_bid: Option<Bid>,
    outcome: Outcome,
}

#[near(serializers = [json])]
pub struct CampaignView {
    id: u64,
    status: Status,
    item_type: String,
    target: u64,
    funded: u64,
    contributor_count: usize,
    min_supporters: usize,
    funding_ends_at: u64,
    sails_at: Option<u64>,
    auction_starts_at: Option<u64>,
    auction_ends_at: Option<u64>,
    minimum_bid: u64,
    highest_bid: u64,
    highest_bidder: Option<AccountId>,
    winner: Option<AccountId>,
    sale: u64,
    fee: u64,
    net: u64,
    treasury: u64,
    needs_advance: bool,
    prize_rarity: String,
    prize_units: u8,
    prize_supply_scope: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct AwardEdition {
    campaign_id: u64,
    item_type: String,
}

#[near(serializers = [json])]
pub struct AccountView {
    awards: Vec<String>,
    award_counts: std::collections::BTreeMap<String, u32>,
    award_editions: Vec<AwardEdition>,
    legacy_award_counts_untracked: bool,
    registered: bool,
    balance: u64,
    contribution: u64,
    contribution_nonce: u64,
    min_contribution: u64,
    max_contribution: u64,
    refund: u64,
    payout: u64,
    award: Option<String>,
    award_equipped: bool,
}

fn voyages() -> LookupMap<u8, Voyage> {
    LookupMap::new(b"unified-voyage".as_slice())
}

fn accounts() -> LookupMap<AccountId, VoyageAccount> {
    LookupMap::new(b"unified-voyage-accounts".as_slice())
}

// Presence establishes ownership. The value records whether the prize is equipped.
fn cargo() -> LookupMap<u8, String> {
    LookupMap::new(b"unified-voyage-cargo".as_slice())
}

fn prize() -> String {
    cargo()
        .get(&0)
        .cloned()
        .unwrap_or_else(|| PRIZE.to_string())
}

fn awards() -> LookupMap<AccountId, bool> {
    LookupMap::new(b"unified-voyage-awards".as_slice())
}

fn campaign_id() -> u64 {
    LookupMap::<u8, u64>::new(b"voyage-sequence".as_slice()).get(&0).copied().unwrap_or(0)
}

pub(crate) fn owned_awards(player: &AccountId) -> Vec<String> {
    LookupMap::<AccountId, Vec<String>>::new(b"voyage-owned-prizes".as_slice()).get(player).cloned()
        .unwrap_or_else(|| if awards().contains_key(player) { vec![prize()] } else { vec![] })
}

pub(crate) fn owned_award_counts(player: &AccountId) -> std::collections::BTreeMap<String, u32> {
    LookupMap::<AccountId, std::collections::BTreeMap<String, u32>>::new(b"voyage-award-counts-v2".as_slice()).get(player).cloned()
        .unwrap_or_else(|| owned_awards(player).into_iter().map(|id| (id, 1)).collect())
}

fn award_editions(player: &AccountId) -> Vec<AwardEdition> {
    LookupMap::<AccountId, Vec<AwardEdition>>::new(b"voyage-award-editions-v2".as_slice()).get(player).cloned().unwrap_or_default()
}

fn selected_award(player: &AccountId) -> Option<String> {
    LookupMap::<AccountId, String>::new(b"voyage-selected-prize".as_slice()).get(player).cloned()
        .or_else(|| owned_awards(player).last().cloned())
}

fn check_campaign(expected: Option<u64>) {
    let id = campaign_id();
    let deadline = voyages().get(&0).map(|v| v.funding_ends_at);
    require!(expected == Some(id) || (expected.is_some() && expected == deadline) || (id == 0 && expected.is_none()), "Campaign changed");
}

fn sale_fee(gross: u64) -> u64 {
    (u128::from(gross) * u128::from(FEE_PERCENT)).div_ceil(100) as u64
}

// Separate storage and an opt-in build keep the live contract's layout and
// deadlines unchanged. This flag is never present in an ordinary deployment.
fn judges_stage() -> Option<u8> {
    #[cfg(feature = "judges-demo")]
    { LookupMap::<u8, u8>::new(b"judges-manual-stage".as_slice()).get(&0).copied() }
    #[cfg(not(feature = "judges-demo"))]
    { None }
}

impl Voyage {
    fn auction_starts_at(&self) -> Option<u64> {
        if self.outcome == Outcome::Open && judges_stage().is_some() { return None; }
        self.sails_at.map(|time| time + self.sailing_ms)
    }

    fn auction_ends_at(&self) -> Option<u64> {
        self.auction_starts_at().map(|time| time + self.auction_ms)
    }

    fn status(&self, now: u64) -> Status {
        match self.outcome {
            Outcome::Refunded => Status::Refunded,
            Outcome::Unsold => Status::Unsold,
            Outcome::Settled => Status::Settled,
            Outcome::Open => match judges_stage() {
                Some(0) => Status::Funding,
                Some(1) => Status::Sailing,
                Some(_) => Status::Auction,
                None => match self.auction_starts_at() {
                None => Status::Funding,
                Some(time) if now < time => Status::Sailing,
                Some(_) => Status::Auction,
                },
            },
        }
    }

    fn deadline_reached(&self, now: u64) -> bool {
        if let Some(stage) = judges_stage() { return stage == 3; }
        now >= self.auction_ends_at().unwrap_or(self.funding_ends_at)
    }

    fn contribution_limit(&self, account: &VoyageAccount, balance: u64, now: u64) -> u64 {
        if self.status(now) != Status::Funding
            || self.deadline_reached(now)
            || (account.contribution == 0 && self.contributors.len() >= MAX_SUPPORTERS)
        {
            return 0;
        }
        let supporter_count = self.contributors.len() + usize::from(account.contribution == 0);
        let quorum_reserve = if supporter_count < MIN_SUPPORTERS {
            MIN_CONTRIBUTION
        } else {
            0
        };
        (self.target - self.funded)
            .saturating_sub(quorum_reserve)
            .min(balance)
    }

    fn view(&self, now: u64, treasury: u64) -> CampaignView {
        let highest_bid = self.highest_bid.as_ref().map_or(0, |bid| bid.amount);
        let highest_bidder = self.highest_bid.as_ref().map(|bid| bid.bidder.clone());
        let settled = self.outcome == Outcome::Settled;
        let sale = if settled { highest_bid } else { 0 };
        let fee = sale_fee(sale);
        CampaignView {
            id: campaign_id(),
            status: self.status(now),
            item_type: prize(),
            target: self.target,
            funded: self.funded,
            contributor_count: self.contributors.len(),
            min_supporters: MIN_SUPPORTERS,
            funding_ends_at: if self.outcome == Outcome::Open && judges_stage().is_some() { 0 } else { self.funding_ends_at },
            sails_at: self.sails_at,
            auction_starts_at: self.auction_starts_at(),
            auction_ends_at: self.auction_ends_at(),
            minimum_bid: highest_bid.saturating_add(BID_STEP),
            highest_bid,
            winner: highest_bidder.clone().filter(|_| settled),
            highest_bidder,
            sale,
            fee,
            net: sale - fee,
            treasury,
            needs_advance: self.outcome == Outcome::Open && self.deadline_reached(now),
            prize_rarity: "mythic".to_string(),
            prize_units: 1,
            prize_supply_scope: "one_per_campaign_not_globally_unique".to_string(),
        }
    }
}

#[near]
impl ArenaLedger {
    /// Testnet-only rehearsal ABI, absent from the ordinary game binary.
    #[cfg(feature = "judges-demo")]
    pub fn open_judges_voyage(&mut self) -> CampaignView {
        self.require_referee();
        require!(env::current_account_id().as_str().ends_with(".testnet"), "Judges rehearsal requires testnet");
        require!(self.gold_config().is_some(), "Judges rehearsal requires isolated GOLD backing");
        self.new_voyage(1, 1, 1, Some(DEFAULT_TARGET), Some(PRIZE.to_string()));
        LookupMap::<u8, u8>::new(b"judges-manual-stage".as_slice()).insert(0, 0);
        economic_event("judges_rehearsal_open", json!({ "campaign_id": campaign_id(), "manual": true }));
        self.campaign()
    }

    #[cfg(feature = "judges-demo")]
    pub fn advance_judges_voyage(&mut self, campaign_id: u64, expected_status: String) -> CampaignView {
        check_campaign(Some(campaign_id));
        let stage = judges_stage().expect("Not a judges rehearsal");
        let current = self.campaign();
        let expected = match current.status {
            Status::Funding => "funding", Status::Sailing => "sailing", Status::Auction => "auction", _ => return current,
        };
        // Concurrent clicks/retries must not skip two phases or pay twice.
        if expected_status != expected { return current; }
        let store = voyages();
        let voyage = store.get(&0).expect("Campaign");
        match stage {
            0 => require!(voyage.funded == voyage.target && voyage.contributors.len() >= MIN_SUPPORTERS, "Complete funding with two crews first"),
            1 => {},
            2 => require!(voyage.highest_bid.is_some(), "Place a bid before settlement"),
            _ => return current,
        }
        drop(store);
        LookupMap::<u8, u8>::new(b"judges-manual-stage".as_slice()).insert(0, stage + 1);
        economic_event("judges_rehearsal_advanced", json!({ "campaign_id": campaign_id, "stage": stage + 1 }));
        if stage == 2 { self.advance(Some(campaign_id)) } else { self.campaign() }
    }

    #[cfg(feature = "judges-demo")]
    pub fn judges_rehearsal(&self) -> bool { judges_stage().is_some() }

    #[cfg(feature = "judges-demo")]
    pub fn restart_judges_voyage(&mut self, campaign_id: u64) -> CampaignView {
        self.require_referee();
        check_campaign(Some(campaign_id));
        require!(judges_stage().is_some() && self.campaign().status == Status::Settled, "Finish the current rehearsal first");
        let players = voyages().get(&0).expect("Campaign").contributors.clone();
        let next = campaign_id.checked_add(1).expect("Campaign limit");
        for (i, player) in players.into_iter().enumerate() {
            let amount = 10_000u64.saturating_sub(self.balance(player.clone()));
            if amount > 0 {
                self.grant_gold_reward(player, near_sdk::json_types::U64(100_000 + next * 100 + i as u64), near_sdk::json_types::U64(amount));
            }
        }
        // One atomic function call also works with a restricted NEAR access key.
        self.open_judges_voyage()
    }

    pub fn new_voyage(
        &mut self,
        funding_ms: u64,
        sailing_ms: u64,
        auction_ms: u64,
        target: Option<u64>,
        item_type: Option<String>,
    ) -> CampaignView {
        self.require_referee();
        let mut voyages = voyages();
        if let Some(previous) = voyages.get(&0) {
            require!(previous.outcome != Outcome::Open, "Previous voyage must settle first");
        }
        #[cfg(feature = "judges-demo")]
        LookupMap::<u8, u8>::new(b"judges-manual-stage".as_slice()).remove(&0);
        require!(
            [funding_ms, sailing_ms, auction_ms]
                .into_iter()
                .all(|window| (1..=MAX_WINDOW_MS).contains(&window)),
            "Invalid campaign window"
        );
        let target = target.unwrap_or(DEFAULT_TARGET);
        require!(
            target >= MIN_CONTRIBUTION * MIN_SUPPORTERS as u64,
            "Invalid campaign target"
        );
        let now = env::block_timestamp_ms();
        let funding_ends_at = now.checked_add(funding_ms).expect("Campaign deadline limit");
        // Old clients identify a voyage by its funding deadline. A voyage that
        // sails early can finish before that deadline, so prevent reuse of the
        // alias even when a referee chooses a different funding window.
        let mut aliases = LookupMap::<u64, bool>::new(b"voyage-deadline-aliases".as_slice());
        require!(
            !aliases.contains_key(&funding_ends_at)
                && voyages.get(&0).is_none_or(|old| old.funding_ends_at != funding_ends_at),
            "Campaign deadline already used; choose another funding window"
        );
        if let Some(ref item) = item_type {
            require!(
                crate::catalog_data::VOYAGE_ITEMS.contains(&item.as_str()),
                "Unknown voyage cargo"
            );
        }
        if let Some(previous) = voyages.remove(&0) {
            aliases.insert(previous.funding_ends_at, true);
            let id = campaign_id();
            let old_prize = prize();
            // Freeze legacy prize identity before changing the advertised cargo.
            if let Some(bid) = previous.highest_bid.as_ref().filter(|_| previous.outcome == Outcome::Settled) {
                let owned = owned_awards(&bid.bidder);
                LookupMap::<AccountId, Vec<String>>::new(b"voyage-owned-prizes".as_slice()).insert(bid.bidder.clone(), owned);
                if selected_award(&bid.bidder).is_some() {
                    let selected = selected_award(&bid.bidder).unwrap();
                    LookupMap::<AccountId, String>::new(b"voyage-selected-prize".as_slice()).insert(bid.bidder.clone(), selected);
                }
            }
            let mut ledger = accounts();
            for player in &previous.contributors {
                if let Some(account) = ledger.get_mut(player) {
                    LookupMap::<(u64, AccountId), VoyageAccount>::new(b"voyage-past-accounts".as_slice()).insert((id, player.clone()), account.clone());
                    account.contribution = 0;
                    account.last_contribution = 0;
                    account.refund = 0;
                    account.payout = 0;
                }
            }
            LookupMap::<u64, Voyage>::new(b"voyage-history".as_slice()).insert(id, previous);
            LookupMap::<u64, String>::new(b"voyage-history-cargo".as_slice()).insert(id, old_prize);
            LookupMap::<u8, u64>::new(b"voyage-sequence".as_slice()).insert(0, id.checked_add(1).expect("Campaign limit"));
        }
        cargo().insert(0, item_type.unwrap_or_else(|| PRIZE.to_string()));
        aliases.insert(funding_ends_at, true);
        let voyage = Voyage {
            target,
            funding_ends_at,
            sailing_ms,
            auction_ms,
            sails_at: None,
            funded: 0,
            contributors: Vec::new(),
            highest_bid: None,
            outcome: Outcome::Open,
        };
        let view = voyage.view(now, self.treasury);
        voyages.insert(0, voyage);
        economic_event(
            "voyage_open",
            json!({ "target": target, "item_type": prize(), "funding_ends_at": view.funding_ends_at }),
        );
        view
    }

    pub fn has_voyage(&self) -> bool {
        voyages().contains_key(&0)
    }

    pub fn campaign_history(&self, before: Option<u64>, limit: Option<u64>) -> Vec<CampaignView> {
        let end = before.unwrap_or(campaign_id()).min(campaign_id());
        let history = LookupMap::<u64, Voyage>::new(b"voyage-history".as_slice());
        let cargo = LookupMap::<u64, String>::new(b"voyage-history-cargo".as_slice());
        (end.saturating_sub(limit.unwrap_or(10).min(20))..end).rev().filter_map(|id| {
            history.get(&id).map(|voyage| {
                let mut view = voyage.view(env::block_timestamp_ms(), self.treasury);
                view.id = id;
                view.item_type = cargo.get(&id).cloned().unwrap_or_else(|| PRIZE.to_string());
                view
            })
        }).collect()
    }

    pub fn campaign_participation(&self, campaign_id: u64, player: AccountId) -> VoyageAccount {
        if campaign_id == crate::voyage::campaign_id() {
            return accounts().get(&player).cloned().unwrap_or_default();
        }
        LookupMap::<(u64, AccountId), VoyageAccount>::new(b"voyage-past-accounts".as_slice())
            .get(&(campaign_id, player)).cloned().unwrap_or_default()
    }

    pub fn campaign(&self) -> CampaignView {
        voyages()
            .get(&0)
            .unwrap_or_else(|| env::panic_str("No voyage configured"))
            .view(env::block_timestamp_ms(), self.treasury)
    }

    pub fn voyage_award(&self, player: AccountId) -> Option<String> {
        selected_award(&player)
    }

    pub fn equip_voyage_award(&mut self, equipped: bool, item: Option<String>) -> AccountView {
        let player = env::predecessor_account_id();
        let selected = item.or_else(|| selected_award(&player)).unwrap_or_else(|| env::panic_str("Prize not owned"));
        require!(owned_awards(&player).contains(&selected), "Prize not owned");
        let previous = selected_award(&player);
        LookupMap::<AccountId, String>::new(b"voyage-selected-prize".as_slice()).insert(player.clone(), selected.clone());
        let mut awards = awards();
        let appearance = awards
            .get_mut(&player)
            .unwrap_or_else(|| env::panic_str("Prize not owned"));
        if *appearance != equipped || previous.as_ref() != Some(&selected) {
            *appearance = equipped;
            awards.flush();
            economic_event(
                "voyage_award_equipped",
                json!({ "player": player, "item_type": selected, "equipped": equipped }),
            );
        }
        self.account(player)
    }

    pub fn account(&self, player: AccountId) -> AccountView {
        let now = env::block_timestamp_ms();
        let voyages = voyages();
        let accounts = accounts();
        let fallback = VoyageAccount::default();
        let account = accounts.get(&player).unwrap_or(&fallback);
        let registered = self.registered(player.clone());
        let balance = self.balance(player.clone());
        let max_contribution = voyages
            .get(&0)
            .map_or(0, |voyage| voyage.contribution_limit(account, balance, now));
        let awards = awards();
        let award = awards.get(&player);
        AccountView {
            awards: owned_awards(&player),
            award_counts: owned_award_counts(&player),
            award_editions: award_editions(&player),
            legacy_award_counts_untracked: !crate::collection::supply_known(),
            registered,
            balance,
            contribution: account.contribution,
            contribution_nonce: account.contribution_nonce,
            min_contribution: max_contribution.min(MIN_CONTRIBUTION),
            max_contribution,
            refund: account.refund,
            payout: account.payout,
            award: award.and_then(|_| selected_award(&player)),
            award_equipped: award.copied().unwrap_or(false),
        }
    }

    pub fn contribute(&mut self, amount: u64, nonce: u64, campaign_id: Option<u64>) -> CampaignView {
        check_campaign(campaign_id);
        let player = env::predecessor_account_id();
        let now = env::block_timestamp_ms();
        let mut voyages = voyages();
        let voyage = voyages
            .get_mut(&0)
            .unwrap_or_else(|| env::panic_str("No voyage configured"));
        let mut accounts = accounts();
        let mut account = accounts.get(&player).cloned().unwrap_or_default();
        if nonce != 0 && nonce == account.contribution_nonce && amount == account.last_contribution
        {
            return voyage.view(now, self.treasury);
        }
        require!(
            account.contribution_nonce.checked_add(1) == Some(nonce),
            "Contribution nonce changed"
        );
        let balance = self
            .balances
            .get_mut(&player)
            .unwrap_or_else(|| env::panic_str("No test gold account"));
        let limit = voyage.contribution_limit(&account, *balance, now);
        require!(
            amount > 0 && (limit.min(MIN_CONTRIBUTION)..=limit).contains(&amount),
            "Contribution unavailable"
        );
        if account.contribution == 0 {
            voyage.contributors.push(player.clone());
        }
        *balance -= amount;
        account.contribution += amount;
        account.contribution_nonce = nonce;
        account.last_contribution = amount;
        accounts.insert(player.clone(), account);
        voyage.funded += amount;
        economic_event(
            "voyage_contribution",
            json!({ "player": player, "amount": amount, "nonce": nonce, "funded": voyage.funded }),
        );
        if voyage.funded == voyage.target {
            self.treasury += voyage.funded;
            voyage.sails_at = Some(now);
            economic_event(
                "voyage_sailed",
                json!({ "cost": voyage.funded, "sails_at": now }),
            );
        }
        voyage.view(now, self.treasury)
    }

    pub fn bid(&mut self, amount: u64, campaign_id: Option<u64>) -> CampaignView {
        check_campaign(campaign_id);
        let now = env::block_timestamp_ms();
        let mut voyages = voyages();
        let voyage = voyages
            .get_mut(&0)
            .unwrap_or_else(|| env::panic_str("No voyage configured"));
        let player = env::predecessor_account_id();
        let previous = voyage.highest_bid.as_ref();
        let highest = previous.map_or(0, |bid| bid.amount);
        let same_bidder = previous.is_some_and(|bid| bid.bidder == player);
        if same_bidder && amount == highest {
            return voyage.view(now, self.treasury);
        }
        require!(
            voyage.status(now) == Status::Auction && !voyage.deadline_reached(now),
            "Auction is closed"
        );
        require!(
            highest
                .checked_add(BID_STEP)
                .is_some_and(|minimum| amount >= minimum),
            "Bid is too low"
        );
        let reserved = if same_bidder { highest } else { 0 };
        let balance = self
            .balances
            .get_mut(&player)
            .unwrap_or_else(|| env::panic_str("No test gold account"));
        require!(*balance >= amount - reserved, "Insufficient test gold");
        *balance -= amount - reserved;
        if let Some(bid) = previous.filter(|_| !same_bidder) {
            *self.balances.get_mut(&bid.bidder).expect("Reserved bidder") += bid.amount;
            economic_event(
                "voyage_bid_refund",
                json!({ "player": bid.bidder, "amount": bid.amount }),
            );
        }
        economic_event(
            "voyage_bid",
            json!({ "player": player, "amount": amount, "reserved": amount - reserved }),
        );
        voyage.highest_bid = Some(Bid {
            bidder: player,
            amount,
        });
        voyage.view(now, self.treasury)
    }

    pub fn advance(&mut self, campaign_id: Option<u64>) -> CampaignView {
        check_campaign(campaign_id);
        let now = env::block_timestamp_ms();
        let mut voyages = voyages();
        let voyage = voyages
            .get_mut(&0)
            .unwrap_or_else(|| env::panic_str("No voyage configured"));
        if voyage.outcome != Outcome::Open || !voyage.deadline_reached(now) {
            return voyage.view(now, self.treasury);
        }
        let mut accounts = accounts();
        if voyage.sails_at.is_none() {
            for player in &voyage.contributors {
                let account = accounts.get_mut(player).expect("Reserved contributor");
                account.refund = account.contribution;
                *self.balances.get_mut(player).expect("Reserved contributor") += account.refund;
                economic_event(
                    "voyage_contribution_refund",
                    json!({ "player": player, "amount": account.refund }),
                );
            }
            voyage.outcome = Outcome::Refunded;
        } else if let Some(bid) = &voyage.highest_bid {
            let fee = sale_fee(bid.amount);
            self.treasury += fee;
            self.distribute_voyage_sale(voyage, bid.amount - fee, &mut accounts);
            let mut owned = owned_awards(&bid.bidder);
            let item = prize();
            let mut counts = owned_award_counts(&bid.bidder);
            let count = counts.get(&item).copied().unwrap_or(0);
            counts.insert(item.clone(), count.checked_add(1).expect("Award count limit"));
            LookupMap::<AccountId, std::collections::BTreeMap<String, u32>>::new(b"voyage-award-counts-v2".as_slice()).insert(bid.bidder.clone(), counts);
            let mut editions = award_editions(&bid.bidder);
            editions.push(AwardEdition { campaign_id: crate::voyage::campaign_id(), item_type: item.clone() });
            LookupMap::<AccountId, Vec<AwardEdition>>::new(b"voyage-award-editions-v2".as_slice()).insert(bid.bidder.clone(), editions);
            if !owned.contains(&item) { owned.push(item.clone()); }
            LookupMap::<AccountId, Vec<String>>::new(b"voyage-owned-prizes".as_slice()).insert(bid.bidder.clone(), owned);
            LookupMap::<AccountId, String>::new(b"voyage-selected-prize".as_slice()).insert(bid.bidder.clone(), item.clone());
            awards().insert(bid.bidder.clone(), false);
            voyage.outcome = Outcome::Settled;
            economic_event(
                "voyage_settled",
                json!({ "winner": bid.bidder, "sale": bid.amount, "fee": fee, "item_type": item, "campaign_id": crate::voyage::campaign_id() }),
            );
        } else {
            voyage.outcome = Outcome::Unsold;
            economic_event("voyage_unsold", json!({ "cost": voyage.funded }));
        }
        voyage.view(now, self.treasury)
    }
}

impl ArenaLedger {
    fn distribute_voyage_sale(
        &mut self,
        voyage: &Voyage,
        net: u64,
        accounts: &mut LookupMap<AccountId, VoyageAccount>,
    ) {
        let divisor = u128::from(voyage.funded);
        let mut shares: Vec<_> = voyage
            .contributors
            .iter()
            .map(|player| {
                let amount = accounts
                    .get(player)
                    .expect("Reserved contributor")
                    .contribution;
                let weighted = u128::from(net) * u128::from(amount);
                (player, (weighted / divisor) as u64, weighted % divisor)
            })
            .collect();
        // Resolve equal remainders by original contribution order.
        shares.sort_by(|a, b| b.2.cmp(&a.2));
        let dust = net - shares.iter().map(|(_, share, _)| share).sum::<u64>();
        for (index, (player, share, _)) in shares.into_iter().enumerate() {
            let payout = share + u64::from((index as u64) < dust);
            accounts
                .get_mut(player)
                .expect("Reserved contributor")
                .payout = payout;
            *self.balances.get_mut(player).expect("Reserved contributor") += payout;
            economic_event(
                "voyage_payout",
                json!({ "player": player, "amount": payout }),
            );
        }
    }
}
