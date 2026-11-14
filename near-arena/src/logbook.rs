use super::*;
use near_sdk::serde_json::Value;

const LIMIT: usize = 12;

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct LogEntry {
    at: u64,
    event: String,
    action: Option<String>,
    item: Option<String>,
    round_id: Option<String>,
    gold_delta: Option<i64>,
    scrap_delta: Option<i64>,
}

fn logs() -> LookupMap<AccountId, Vec<LogEntry>> {
    LookupMap::new(b"economy-logbook".as_slice())
}

#[near]
impl ArenaLedger {
    pub fn logbook(&self, player: AccountId) -> Vec<LogEntry> {
        logs().get(&player).cloned().unwrap_or_default()
    }
}

pub(crate) fn record(event: &str, data: &Value) {
    let round = &data["round"];
    let players = if let Some(account) = data["player"].as_str().or_else(|| data["winner"].as_str())
    {
        vec![account]
    } else if let Some(players) = round["players"].as_array() {
        players.iter().filter_map(Value::as_str).collect()
    } else {
        return;
    };
    let text = |field: &str| data[field].as_str().map(str::to_owned);
    let mut history = logs();
    for name in players {
        let account: AccountId = name.parse().expect("Event account");
        let gold_delta = match event {
            "arena_reserved" => data["entry"].as_i64().map(|entry| -entry),
            "arena_refunded" => data["entry"].as_i64(),
            "arena_settled" => round["paid"].as_i64().map(|paid| {
                if round["winner"].as_str() == Some(name) {
                    paid
                } else {
                    0
                }
            }),
            "voyage_contribution" => data["amount"].as_i64().map(|amount| -amount),
            "voyage_bid" => data["reserved"].as_i64().map(|amount| -amount),
            "voyage_payout" | "voyage_bid_refund" | "voyage_contribution_refund" => {
                data["amount"].as_i64()
            }
            "test_gold_granted" => data["gold"].as_i64(),
            _ => data["gold_delta"].as_i64(),
        };
        let mut entries = history.remove(&account).unwrap_or_default();
        if entries.len() >= LIMIT {
            entries.remove(0);
        }
        entries.push(LogEntry {
            at: env::block_timestamp_ms(),
            event: event.to_string(),
            action: text("action"),
            item: text("item")
                .or_else(|| text("rig"))
                .or_else(|| text("item_type")),
            round_id: text("round_id"),
            gold_delta,
            scrap_delta: data["scrap_delta"].as_i64(),
        });
        history.insert(account, entries);
    }
}
