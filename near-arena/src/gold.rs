use super::*;
use near_sdk::{
    Gas, NearToken, Promise, PromiseOrValue, assert_one_yocto, borsh, ext_contract,
    json_types::U128, serde_json::json,
};

const TRANSFER_GAS: Gas = Gas::from_tgas(12);
const RESOLVE_GAS: Gas = Gas::from_tgas(20);

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct GoldConfig {
    token: AccountId,
    funder: AccountId,
}

const GOLD_CONFIG_KEY: &[u8] = b"gold-config";

#[ext_contract(ext_gold)]
#[allow(dead_code)]
trait GoldToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[ext_contract(ext_arena)]
#[allow(dead_code)]
trait GoldWithdrawal {
    fn resolve_gold_withdrawal(&mut self, player: AccountId, amount: U64) -> bool;
}

#[near]
impl ArenaLedger {
    #[init]
    #[private]
    pub fn new_with_gold(referee: AccountId, token: AccountId, funder: AccountId) -> Self {
        require!(
            token != env::current_account_id(),
            "Use a separate token contract"
        );
        env::storage_write(
            GOLD_CONFIG_KEY,
            &borsh::to_vec(&GoldConfig { token, funder }).expect("GOLD config"),
        );
        Self::initialize(referee, 0, 0)
    }

    pub fn gold_config(&self) -> Option<GoldConfig> {
        env::storage_read(GOLD_CONFIG_KEY)
            .map(|data| borsh::from_slice(&data).expect("GOLD config"))
    }

    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let config = self.gold_config().expect("GOLD vault unavailable");
        require!(
            env::predecessor_account_id() == config.token,
            "Unrecognized GOLD contract"
        );
        let cents = u64::try_from(amount.0).expect("GOLD deposit exceeds ledger limit");
        require!(cents > 0, "Deposit must be positive");
        match msg.as_str() {
            "deposit" => {
                *self
                    .balances
                    .get_mut(&sender_id)
                    .expect("Sign in to register before depositing") += cents;
                workshop::economic_event(
                    "gold_deposited",
                    json!({ "player": sender_id, "gold_delta": cents }),
                );
            }
            "treasury" | "bot_bank" => {
                require!(
                    sender_id == config.funder,
                    "Only the GOLD funder can allocate reserves"
                );
                if msg == "treasury" {
                    self.treasury += cents;
                } else {
                    self.bot_bank += cents;
                }
                env::log_str(
                    &json!({ "event": "gold_reserve_funded", "pool": msg, "amount": amount })
                        .to_string(),
                );
            }
            _ => return PromiseOrValue::Value(amount),
        }
        PromiseOrValue::Value(U128(0))
    }

    #[payable]
    pub fn withdraw_gold(&mut self, amount: U64) -> Promise {
        assert_one_yocto();
        let config = self.gold_config().expect("GOLD vault unavailable");
        let player = env::predecessor_account_id();
        require!(
            amount.0 > 0 && self.balance(player.clone()) >= amount.0,
            "Insufficient available GOLD"
        );
        *self.balances.get_mut(&player).expect("Validated balance") -= amount.0;
        ext_gold::ext(config.token)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(TRANSFER_GAS)
            .ft_transfer(
                player.clone(),
                U128(amount.0.into()),
                Some("GOLD withdrawal".into()),
            )
            .then(
                ext_arena::ext(env::current_account_id())
                    .with_static_gas(RESOLVE_GAS)
                    .resolve_gold_withdrawal(player, amount),
            )
    }

    #[private]
    pub fn resolve_gold_withdrawal(&mut self, player: AccountId, amount: U64) -> bool {
        // ft_transfer returns no value. A failed receipt did not transfer tokens.
        if env::promise_result_checked(0, 0).is_err() {
            *self.balances.get_mut(&player).expect("Withdrawal account") += amount.0;
            return false;
        }
        workshop::economic_event(
            "gold_withdrawn",
            json!({ "player": player, "gold_delta": -i128::from(amount.0) }),
        );
        true
    }

    pub fn grant_gold_reward(&mut self, player: AccountId, reward_id: U64, amount: U64) {
        self.require_referee();
        require!(self.gold_config().is_some(), "GOLD vault unavailable");
        let mut rewards: LookupMap<u64, (AccountId, u64)> =
            LookupMap::new(b"gold-rewards".as_slice());
        if let Some(previous) = rewards.get(&reward_id.0) {
            require!(previous == &(player, amount.0), "Reward ID already used");
            return;
        }
        require!(
            reward_id.0 > 0 && amount.0 > 0 && self.treasury >= amount.0,
            "Reward unavailable"
        );
        let balance = self
            .balances
            .get_mut(&player)
            .expect("Player must register before receiving rewards");
        self.treasury -= amount.0;
        *balance += amount.0;
        rewards.insert(reward_id.0, (player.clone(), amount.0));
        workshop::economic_event(
            "gold_reward",
            json!({ "player": player, "gold_delta": amount.0, "reward_id": reward_id }),
        );
    }
}

impl ArenaLedger {
    pub(crate) fn allocate_starter_gold(&mut self) -> u64 {
        if self.gold_config().is_none() {
            return STARTER_GOLD;
        }
        let grant = self.treasury.min(STARTER_GOLD);
        self.treasury -= grant;
        grant
    }
}
