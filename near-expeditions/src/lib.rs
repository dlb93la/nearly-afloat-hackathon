use near_sdk::{AccountId, PanicOnDefault, env, near, require, store::LookupMap};

const TARGET: u64 = 30_000;
const STARTER_GOLD: u64 = 300_000;
const MIN_SUPPORTERS: usize = 2;
const MAX_SUPPORTERS: usize = 16;
const MIN_CONTRIBUTION: u64 = 100;
const BID_STEP: u64 = 100;
const FEE_PERCENT: u64 = 5;
const MAX_WINDOW_MS: u64 = 7 * 24 * 60 * 60 * 1_000;

#[near(serializers = [borsh])]
#[derive(Clone, Default)]
struct Account {
    balance: u64,
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

#[near(serializers = [json])]
pub struct CampaignView {
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
}

#[near(serializers = [json])]
pub struct AccountView {
    registered: bool,
    balance: u64,
    contribution: u64,
    contribution_nonce: u64,
    min_contribution: u64,
    max_contribution: u64,
    refund: u64,
    payout: u64,
    award: Option<String>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Expeditions {
    operator: AccountId,
    item_type: String,
    funding_ends_at: u64,
    sailing_ms: u64,
    auction_ms: u64,
    sails_at: Option<u64>,
    funded: u64,
    contributors: Vec<AccountId>,
    accounts: LookupMap<AccountId, Account>,
    highest_bid: Option<Bid>,
    treasury: u64,
    outcome: Outcome,
}

#[near]
impl Expeditions {
    #[init]
    #[private]
    pub fn new(
        operator: AccountId,
        funding_ms: u64,
        sailing_ms: u64,
        auction_ms: u64,
        item_type: String,
    ) -> Self {
        require!(
            [funding_ms, sailing_ms, auction_ms]
                .into_iter()
                .all(|window| (1..=MAX_WINDOW_MS).contains(&window)),
            "Invalid campaign window"
        );
        require!(
            (1..=64).contains(&item_type.len())
                && item_type
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-'),
            "Invalid item type"
        );
        Self {
            operator,
            item_type,
            funding_ends_at: env::block_timestamp_ms() + funding_ms,
            sailing_ms,
            auction_ms,
            sails_at: None,
            funded: 0,
            contributors: Vec::new(),
            accounts: LookupMap::new(b"a"),
            highest_bid: None,
            treasury: 0,
            outcome: Outcome::Open,
        }
    }

    pub fn grant_test_gold(&mut self, player: AccountId) -> AccountView {
        require!(
            env::predecessor_account_id() == self.operator,
            "Operator only"
        );
        if !self.accounts.contains_key(&player) {
            self.accounts.insert(
                player.clone(),
                Account {
                    balance: STARTER_GOLD,
                    ..Account::default()
                },
            );
        }
        self.account(player)
    }

    pub fn campaign(&self) -> CampaignView {
        let now = env::block_timestamp_ms();
        let highest_bid = self.highest_bid.as_ref().map_or(0, |bid| bid.amount);
        let highest_bidder = self.highest_bid.as_ref().map(|bid| bid.bidder.clone());
        let settled = self.outcome == Outcome::Settled;
        let sale = if settled { highest_bid } else { 0 };
        let fee = Self::sale_fee(sale);
        CampaignView {
            status: self.status(now),
            item_type: self.item_type.clone(),
            target: TARGET,
            funded: self.funded,
            contributor_count: self.contributors.len(),
            min_supporters: MIN_SUPPORTERS,
            funding_ends_at: self.funding_ends_at,
            sails_at: self.sails_at,
            auction_starts_at: self.auction_starts_at(),
            auction_ends_at: self.auction_ends_at(),
            minimum_bid: highest_bid + BID_STEP,
            highest_bid,
            winner: highest_bidder.clone().filter(|_| settled),
            highest_bidder,
            sale,
            fee,
            net: sale - fee,
            treasury: self.treasury,
            needs_advance: self.outcome == Outcome::Open && self.deadline_reached(now),
        }
    }

    pub fn account(&self, player: AccountId) -> AccountView {
        let now = env::block_timestamp_ms();
        let account = self.accounts.get(&player);
        let max_contribution = account.map_or(0, |entry| self.contribution_limit(entry, now));
        AccountView {
            registered: account.is_some(),
            balance: account.map_or(0, |entry| entry.balance),
            contribution: account.map_or(0, |entry| entry.contribution),
            contribution_nonce: account.map_or(0, |entry| entry.contribution_nonce),
            min_contribution: max_contribution.min(MIN_CONTRIBUTION),
            max_contribution,
            refund: account.map_or(0, |entry| entry.refund),
            payout: account.map_or(0, |entry| entry.payout),
            award: self
                .highest_bid
                .as_ref()
                .filter(|bid| self.outcome == Outcome::Settled && bid.bidder == player)
                .map(|_| self.item_type.clone()),
        }
    }

    pub fn contribute(&mut self, amount: u64, nonce: u64) -> CampaignView {
        let player = env::predecessor_account_id();
        let now = env::block_timestamp_ms();
        let account = self.accounts.get(&player).expect("No test gold account");
        if nonce != 0 && nonce == account.contribution_nonce && amount == account.last_contribution
        {
            return self.campaign();
        }
        require!(
            nonce == account.contribution_nonce + 1,
            "Contribution nonce changed"
        );
        let limit = self.contribution_limit(account, now);
        require!(
            amount > 0 && (limit.min(MIN_CONTRIBUTION)..=limit).contains(&amount),
            "Contribution unavailable"
        );

        if account.contribution == 0 {
            self.contributors.push(player.clone());
        }
        let account = self
            .accounts
            .get_mut(&player)
            .expect("No test gold account");
        account.balance -= amount;
        account.contribution += amount;
        account.contribution_nonce = nonce;
        account.last_contribution = amount;
        self.funded += amount;
        if self.funded == TARGET {
            self.treasury += self.funded;
            self.sails_at = Some(now);
        }
        self.campaign()
    }

    pub fn bid(&mut self, amount: u64) -> CampaignView {
        let now = env::block_timestamp_ms();
        require!(
            self.status(now) == Status::Auction && !self.deadline_reached(now),
            "Auction is closed"
        );
        let player = env::predecessor_account_id();
        let previous = self.highest_bid.as_ref();
        let highest = previous.map_or(0, |bid| bid.amount);
        let same_bidder = previous.is_some_and(|bid| bid.bidder == player);
        if same_bidder && amount == highest {
            return self.campaign();
        }
        require!(amount >= highest + BID_STEP, "Bid is too low");

        let reserved = if same_bidder { highest } else { 0 };
        let account = self
            .accounts
            .get_mut(&player)
            .expect("No test gold account");
        require!(
            account.balance >= amount - reserved,
            "Insufficient test gold"
        );
        account.balance -= amount - reserved;
        if let Some(bid) = previous.filter(|_| !same_bidder) {
            self.accounts
                .get_mut(&bid.bidder)
                .expect("Missing bidder")
                .balance += bid.amount;
        }
        self.highest_bid = Some(Bid {
            bidder: player,
            amount,
        });
        self.campaign()
    }

    pub fn advance(&mut self) -> CampaignView {
        let now = env::block_timestamp_ms();
        if self.outcome != Outcome::Open || !self.deadline_reached(now) {
            return self.campaign();
        }

        if self.sails_at.is_none() {
            for player in &self.contributors {
                let account = self.accounts.get_mut(player).expect("Missing contributor");
                account.balance += account.contribution;
                account.refund = account.contribution;
            }
            self.outcome = Outcome::Refunded;
        } else if let Some(bid) = self.highest_bid.as_ref() {
            self.treasury += Self::sale_fee(bid.amount);
            self.distribute_sale(bid.amount);
            self.outcome = Outcome::Settled;
        } else {
            self.outcome = Outcome::Unsold;
        }
        self.campaign()
    }
}

impl Expeditions {
    fn auction_starts_at(&self) -> Option<u64> {
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
            Outcome::Open => match self.auction_starts_at() {
                None => Status::Funding,
                Some(time) if now < time => Status::Sailing,
                Some(_) => Status::Auction,
            },
        }
    }

    fn deadline_reached(&self, now: u64) -> bool {
        now >= self.auction_ends_at().unwrap_or(self.funding_ends_at)
    }

    fn contribution_limit(&self, account: &Account, now: u64) -> u64 {
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
        (TARGET - self.funded - quorum_reserve).min(account.balance)
    }

    fn sale_fee(gross: u64) -> u64 {
        (gross * FEE_PERCENT).div_ceil(100)
    }

    fn distribute_sale(&mut self, gross: u64) {
        let net = gross - Self::sale_fee(gross);
        let mut shares: Vec<_> = self
            .contributors
            .iter()
            .map(|player| {
                let amount = self
                    .accounts
                    .get(player)
                    .expect("Missing contributor")
                    .contribution;
                let weighted = u128::from(net) * u128::from(amount);
                let divisor = u128::from(self.funded);
                (player, (weighted / divisor) as u64, weighted % divisor)
            })
            .collect();
        shares.sort_by(|a, b| b.2.cmp(&a.2));
        let dust = net - shares.iter().map(|(_, share, _)| share).sum::<u64>();
        for (index, (player, share, _)) in shares.into_iter().enumerate() {
            let account = self.accounts.get_mut(player).expect("Missing contributor");
            account.payout = share + u64::from((index as u64) < dust);
            account.balance += account.payout;
        }
    }
}
