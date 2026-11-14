use super::*;
use near_sdk::serde_json::json;

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct AgentPolicy {
    pub items: Vec<String>,
    pub budget: u64,
    pub per_trade: u64,
    pub spent: u64,
    pub revenue: u64,
    pub nonce: u64,
    pub expires_at: u64,
    pub enabled: bool,
}

fn policies() -> LookupMap<AccountId, AgentPolicy> {
    LookupMap::new(b"economic-agent-v1".as_slice())
}

#[near]
impl ArenaLedger {
    pub fn agent_policy(&self, agent: AccountId) -> Option<AgentPolicy> {
        policies().get(&agent).cloned()
    }

    // Configuration is held by the referee, never by the agent runtime key.
    // Reconfiguration cannot erase spending or reset the operation sequence.
    pub fn configure_agent(&mut self, agent: AccountId, items: Vec<String>, budget: u64,
        per_trade: u64, expires_at: u64, enabled: bool) -> AgentPolicy {
        self.require_referee();
        require!(agent != self.referee && agent != env::current_account_id(), "Separate agent required");
        require!(self.registered(agent.clone()), "Agent balance required");
        require!(!items.is_empty() && items.len() <= 16, "Invalid item policy");
        require!(items.iter().collect::<BTreeSet<_>>().len() == items.len(), "Duplicate policy item");
        require!(items.iter().all(|id| crate::catalog_data::ITEMS.iter().any(|entry| entry.0 == id && entry.2 > 0)), "Invalid policy item");
        require!(per_trade > 0 && per_trade <= budget && budget <= STARTER_GOLD, "Invalid agent budget");
        require!(!enabled || (expires_at > env::block_timestamp_ms() && expires_at <= env::block_timestamp_ms().saturating_add(86_400_000)), "Invalid policy expiry");
        let previous = self.agent_policy(agent.clone());
        let policy = AgentPolicy { items, budget, per_trade, expires_at, enabled,
            spent: previous.as_ref().map_or(0, |p| p.spent),
            revenue: previous.as_ref().map_or(0, |p| p.revenue),
            nonce: previous.as_ref().map_or(0, |p| p.nonce) };
        require!(policy.budget >= policy.spent, "Budget below spent");
        policies().insert(agent.clone(), policy.clone());
        crate::workshop::economic_event("agent_policy", json!({"player": agent, "policy": policy}));
        policy
    }

    // This is the ONLY method exposed to the delegated agent key.
    pub fn agent_trade(&mut self, action: String, item: String, expected_price: u64, nonce: u64) -> AgentPolicy {
        let agent = env::predecessor_account_id();
        let mut policy = self.agent_policy(agent.clone()).expect("Agent policy required");
        require!(policy.enabled && env::block_timestamp_ms() < policy.expires_at, "Agent policy inactive");
        require!(policy.nonce.checked_add(1) == Some(nonce), "Agent nonce changed");
        require!(policy.items.contains(&item), "Agent item forbidden");
        require!(expected_price > 0 && expected_price <= policy.per_trade, "Agent trade limit");
        require!(action == "buy" || action == "sell", "Agent action forbidden");
        if action == "buy" {
            require!(policy.spent.checked_add(expected_price).is_some_and(|v| v <= policy.budget), "Agent budget exceeded");
            require!(self.collection(agent.clone()).owned.get(&item).copied().unwrap_or(0) == 0, "Agent reserve already stocked");
            policy.spent += expected_price;
        } else {
            policy.revenue = policy.revenue.checked_add(expected_price).expect("Revenue limit");
        }
        // Existing quote, inventory, stock and balance checks stay authoritative.
        self.collection_action(action.clone(), Some(item.clone()), None, Some(expected_price));
        policy.nonce = nonce;
        policies().insert(agent.clone(), policy.clone());
        crate::workshop::economic_event("agent_trade", json!({"player": agent, "action": action,
            "item": item, "price": expected_price, "nonce": nonce, "spent": policy.spent,
            "revenue": policy.revenue }));
        policy
    }
}
