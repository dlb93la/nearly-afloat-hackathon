use near_contract_standards::{
    fungible_token::{
        FungibleToken, FungibleTokenCore, FungibleTokenResolver,
        events::FtMint,
        metadata::{FT_METADATA_SPEC, FungibleTokenMetadata, FungibleTokenMetadataProvider},
    },
    storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement},
};
use near_sdk::{
    AccountId, NearToken, PanicOnDefault, Promise, PromiseOrValue, assert_one_yocto, env,
    json_types::U128, near, require,
};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Gold {
    token: FungibleToken,
    treasury: AccountId,
    unit_price: NearToken,
}

#[near]
impl Gold {
    #[init]
    #[private]
    pub fn new(
        treasury: AccountId,
        supply: U128,
        sale_inventory: U128,
        yocto_per_cent: U128,
    ) -> Self {
        let shop = env::current_account_id();
        require!(treasury != shop, "Treasury must be a separate account");
        require!(
            supply.0 <= 9_007_199_254_740_991,
            "Supply exceeds the game ledger limit"
        );
        require!(
            sale_inventory.0 > 0 && sale_inventory.0 < supply.0,
            "Invalid sale inventory"
        );
        require!(yocto_per_cent.0 > 0, "Invalid sale price");

        let mut token = FungibleToken::new(b"gold".to_vec());
        token.internal_register_account(&treasury);
        token.internal_register_account(&shop);
        for (owner, amount) in [
            (&treasury, supply.0 - sale_inventory.0),
            (&shop, sale_inventory.0),
        ] {
            token.internal_deposit(owner, amount);
            FtMint {
                owner_id: owner,
                amount: U128(amount),
                memo: Some("Initial allocation"),
            }
            .emit();
        }
        Self {
            token,
            treasury,
            unit_price: NearToken::from_yoctonear(yocto_per_cent.0),
        }
    }

    pub fn sale_quote(&self, amount: U128) -> U128 {
        U128(
            self.unit_price
                .as_yoctonear()
                .checked_mul(amount.0)
                .expect("Sale price overflow"),
        )
    }

    pub fn sale_inventory(&self) -> U128 {
        self.token.ft_balance_of(env::current_account_id())
    }

    #[payable]
    pub fn buy(&mut self, amount: U128) {
        let buyer = env::predecessor_account_id();
        let price = self.sale_quote(amount);
        require!(amount.0 > 0, "Choose a positive amount");
        require!(
            env::attached_deposit().as_yoctonear() == price.0,
            "Attach the exact sale price"
        );
        require!(
            self.token.storage_balance_of(buyer.clone()).is_some(),
            "Register GOLD storage first"
        );
        self.token.internal_transfer(
            &env::current_account_id(),
            &buyer,
            amount.0,
            Some("GOLD sale".into()),
        );
        Promise::new(self.treasury.clone())
            .transfer(env::attached_deposit())
            .detach();
    }
}

#[near]
impl FungibleTokenCore for Gold {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        require!(
            receiver_id != env::current_account_id(),
            "Use the sale method"
        );
        self.token.ft_transfer(receiver_id, amount, memo);
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(
            receiver_id != env::current_account_id(),
            "Use the sale method"
        );
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }
}

#[near]
impl FungibleTokenResolver for Gold {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        self.token
            .ft_resolve_transfer(sender_id, receiver_id, amount)
    }
}

#[near]
impl StorageManagement for Gold {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, _force: Option<bool>) -> bool {
        // Keep accounts registered while an asynchronous transfer may be refunded to them.
        assert_one_yocto();
        false
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Gold {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.into(),
            name: "NEARly Afloat Gold".into(),
            symbol: "GOLD".into(),
            decimals: 2,
            icon: None,
            reference: None,
            reference_hash: None,
        }
    }
}
