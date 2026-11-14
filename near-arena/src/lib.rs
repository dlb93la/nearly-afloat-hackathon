use std::collections::BTreeSet;

use near_sdk::{AccountId, PanicOnDefault, env, json_types::U64, near, require, store::LookupMap};

mod catalog_data;
mod economic_agent;
mod gold;
mod collection;
mod logbook;
mod merchant;
mod voyage;
mod workshop;

const ENTRY: u64 = 200;
const BONUS_CAP: u64 = 200;
const STARTER_GOLD: u64 = 10_000;
const ROUND_WINDOW_MS: u64 = 90_000;
const CONSENT_WINDOW_MS: u64 = 180_000;
const SESSION_WINDOW_MS: u64 = 600_000;
const MAX_SESSION_ENTRIES: u8 = 3;

#[near(serializers = [borsh])]
struct Consent {
    round_id: u64,
    expires_at: u64,
}

#[near(serializers = [borsh])]
#[derive(Clone, Copy)]
struct EntrySession {
    scope: u64,
    remaining: u8,
    expires_at: u64,
}

impl EntrySession {
    fn permits(&self, scope: u64, now: u64) -> bool {
        self.scope == scope && self.remaining > 0 && now < self.expires_at
    }
}

#[near(serializers = [json])]
pub struct EntrySessionStatus {
    remaining: u8,
    expires_at: u64,
}

#[near(serializers = [json])]
pub struct SessionReservation {
    scope: U64,
    players: Vec<AccountId>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Reserved,
    Settled,
    Cancelled,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Round {
    status: Status,
    players: Vec<AccountId>,
    bots: u8,
    pot: u64,
    fee: u64,
    bonus: u64,
    expires_at: u64,
    winner: Option<AccountId>,
    paid: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct ArenaLedger {
    referee: AccountId,
    balances: LookupMap<AccountId, u64>,
    consents: LookupMap<AccountId, Consent>,
    rounds: LookupMap<u64, Round>,
    treasury: u64,
    bot_bank: u64,
}

#[near]
impl ArenaLedger {
    #[init]
    #[private]
    pub fn new(referee: AccountId) -> Self {
        Self::initialize(referee, 10_000, 20_000)
    }

    fn initialize(referee: AccountId, treasury: u64, bot_bank: u64) -> Self {
        collection::initialize_supply();
        Self {
            referee,
            balances: LookupMap::new(b"b".as_slice()),
            consents: LookupMap::new(b"c".as_slice()),
            rounds: LookupMap::new(b"r".as_slice()),
            treasury,
            bot_bank,
        }
    }

    pub fn grant_test_gold(&mut self, player: AccountId) {
        self.require_referee();
        require!(
            !self.balances.contains_key(&player),
            "Test gold already granted"
        );
        let grant = self.allocate_starter_gold();
        self.balances.insert(player.clone(), grant);
        workshop::economic_event(
            "test_gold_granted",
            near_sdk::serde_json::json!({ "player": player, "gold": grant }),
        );
    }

    pub fn balance(&self, player: AccountId) -> u64 {
        self.balances.get(&player).copied().unwrap_or(0)
    }

    pub fn registered(&self, player: AccountId) -> bool {
        self.balances.contains_key(&player)
    }

    pub fn entry_consent(&self, player: AccountId, round_id: U64) -> Option<u64> {
        let now = env::block_timestamp_ms();
        self.consents
            .get(&player)
            .filter(|consent| consent.round_id == round_id.0 && consent.expires_at > now)
            .map(|consent| consent.expires_at)
    }

    pub fn pools(&self) -> (u64, u64) {
        (self.treasury, self.bot_bank)
    }

    pub fn round(&self, round_id: U64) -> Option<Round> {
        self.rounds.get(&round_id.0).cloned()
    }

    pub fn authorize_entry(&mut self, round_id: U64) {
        let player = env::predecessor_account_id();
        require!(
            round_id.0 > 0 && !self.rounds.contains_key(&round_id.0),
            "Round ID unavailable"
        );
        require!(
            self.balance(player.clone()) >= ENTRY,
            "Insufficient test gold"
        );
        self.consents.insert(
            player,
            Consent {
                round_id: round_id.0,
                expires_at: env::block_timestamp_ms() + CONSENT_WINDOW_MS,
            },
        );
    }

    pub fn revoke_entry(&mut self) {
        self.consents.remove(&env::predecessor_account_id());
    }

    pub fn entry_session(&self, player: AccountId, scope: U64) -> Option<EntrySessionStatus> {
        Self::sessions()
            .get(&player)
            .filter(|session| session.permits(scope.0, env::block_timestamp_ms()))
            .map(|session| EntrySessionStatus {
                remaining: session.remaining,
                expires_at: session.expires_at,
            })
    }

    pub fn authorize_session(&mut self, scope: U64, entries: u8) {
        let player = env::predecessor_account_id();
        require!(
            scope.0 > 0 && (1..=MAX_SESSION_ENTRIES).contains(&entries),
            "Invalid session allowance"
        );
        require!(
            self.balance(player.clone()) >= ENTRY,
            "Insufficient test gold"
        );
        Self::sessions().insert(
            player,
            EntrySession {
                scope: scope.0,
                remaining: entries,
                expires_at: env::block_timestamp_ms() + SESSION_WINDOW_MS,
            },
        );
    }

    pub fn revoke_session(&mut self, scope: U64) {
        let player = env::predecessor_account_id();
        let mut sessions = Self::sessions();
        if sessions
            .get(&player)
            .is_some_and(|session| session.scope == scope.0)
        {
            sessions.remove(&player);
        }
    }

    pub fn reserve_round(
        &mut self,
        round_id: U64,
        players: Vec<AccountId>,
        slots: u8,
        session: Option<SessionReservation>,
    ) -> Round {
        self.require_referee();
        require!(
            round_id.0 > 0 && !self.rounds.contains_key(&round_id.0),
            "Round ID unavailable"
        );
        require!(
            (6..=8).contains(&slots) && !players.is_empty() && players.len() <= usize::from(slots),
            "Invalid roster"
        );
        require!(
            players.iter().collect::<BTreeSet<_>>().len() == players.len(),
            "Duplicate players"
        );
        let now = env::block_timestamp_ms();
        let bots = slots - players.len() as u8;
        let bot_entry = u64::from(bots) * ENTRY;
        require!(self.bot_bank >= bot_entry, "Bot bank cannot cover entry");
        let mut sessions = Self::sessions();
        let session_players: BTreeSet<&AccountId> = match session.as_ref() {
            Some(session) => {
                let members: BTreeSet<_> = session.players.iter().collect();
                require!(
                    session.scope.0 > 0
                        && !members.is_empty()
                        && members.len() == session.players.len()
                        && members.iter().all(|player| players.contains(player)),
                    "Invalid session roster"
                );
                members
            }
            None => BTreeSet::new(),
        };

        for player in &players {
            if session_players.contains(player) {
                let scope = session.as_ref().expect("Validated session roster").scope.0;
                require!(
                    sessions
                        .get(player)
                        .is_some_and(|permission| permission.permits(scope, now)),
                    "Entry session unavailable"
                );
            } else {
                let consent = self
                    .consents
                    .get(player)
                    .unwrap_or_else(|| env::panic_str("Missing entry consent"));
                require!(
                    consent.round_id == round_id.0 && consent.expires_at > now,
                    "Entry consent has expired or is for another round"
                );
            }
            require!(
                self.balances.get(player).copied().unwrap_or(0) >= ENTRY,
                "Insufficient test gold"
            );
        }
        workshop::lock_rigs(round_id.0, &players);
        for player in &players {
            *self.balances.get_mut(player).expect("Validated balance") -= ENTRY;
            if session_players.contains(player) {
                let permission = sessions.get_mut(player).expect("Validated session");
                permission.remaining -= 1;
                if permission.remaining == 0 {
                    sessions.remove(player);
                }
            } else {
                self.consents.remove(player);
            }
        }
        self.bot_bank -= bot_entry;
        let bonus = self.treasury.min(BONUS_CAP);
        self.treasury -= bonus;
        let total = u64::from(slots) * ENTRY;
        let fee = total / 5;
        let round = Round {
            status: Status::Reserved,
            players,
            bots,
            pot: total - fee,
            fee,
            bonus,
            expires_at: now + ROUND_WINDOW_MS,
            winner: None,
            paid: 0,
        };
        self.rounds.insert(round_id.0, round.clone());
        workshop::economic_event(
            "arena_reserved",
            near_sdk::serde_json::json!({ "round_id": round_id, "entry": ENTRY, "round": round }),
        );
        round
    }

    pub fn settle_round(&mut self, round_id: U64, winner: Option<AccountId>) -> Round {
        self.require_referee();
        let mut round = self.load_round(round_id.0);
        if round.status != Status::Reserved {
            return round;
        }
        if env::block_timestamp_ms() >= round.expires_at {
            return self.refund(round_id.0, round);
        }

        if let Some(player) = winner.as_ref() {
            require!(
                round.players.contains(player),
                "Winner is outside the reserved roster"
            );
            round.paid = round.pot + round.bonus;
            *self.balances.get_mut(player).expect("Reserved player") += round.paid;
            self.treasury += round.fee;
        } else {
            require!(round.bots > 0, "No bot seat in this round");
            round.paid = round.pot;
            self.bot_bank += round.pot;
            self.treasury += round.fee + round.bonus;
        }
        workshop::release_rigs(round_id.0, true);
        round.status = Status::Settled;
        round.winner = winner;
        self.rounds.insert(round_id.0, round.clone());
        workshop::economic_event(
            "arena_settled",
            near_sdk::serde_json::json!({ "round_id": round_id, "round": round }),
        );
        round
    }

    pub fn cancel_round(&mut self, round_id: U64) -> Round {
        self.require_referee();
        let round = self.load_round(round_id.0);
        self.refund(round_id.0, round)
    }

    pub fn expire_round(&mut self, round_id: U64) -> Round {
        let round = self.load_round(round_id.0);
        require!(
            round.status != Status::Reserved || env::block_timestamp_ms() >= round.expires_at,
            "Reservation still active"
        );
        self.refund(round_id.0, round)
    }
}

impl ArenaLedger {
    fn sessions() -> LookupMap<AccountId, EntrySession> {
        // Independent storage prefix preserves the existing root state layout.
        LookupMap::new(b"entry-sessions".as_slice())
    }

    fn require_referee(&self) {
        require!(
            env::predecessor_account_id() == self.referee,
            "Only the referee"
        );
    }

    fn load_round(&self, id: u64) -> Round {
        self.rounds
            .get(&id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Unknown round"))
    }

    fn refund(&mut self, id: u64, mut round: Round) -> Round {
        if round.status != Status::Reserved {
            return round;
        }
        for player in &round.players {
            *self.balances.get_mut(player).expect("Reserved player") += ENTRY;
        }
        self.bot_bank += u64::from(round.bots) * ENTRY;
        self.treasury += round.bonus;
        workshop::release_rigs(id, false);
        round.status = Status::Cancelled;
        self.rounds.insert(id, round.clone());
        workshop::economic_event(
            "arena_refunded",
            near_sdk::serde_json::json!({ "round_id": id.to_string(), "entry": ENTRY, "round": round }),
        );
        round
    }
}
