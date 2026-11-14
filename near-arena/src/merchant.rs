use near_sdk::env;

// A wanted offer may rotate, but never ignores stock or permits an immediate
// profitable sell/buy-back at the resulting stock level.
pub(crate) fn offer(normal: u64, stock: u8, item: usize, next_buy: u64, cap: u8) -> (u64, bool) {
    let cycle = env::block_timestamp_ms() / 600_000;
    let low = ((u16::from(cap) * 3 + 7) / 8).max(1) as u8;
    let interested = stock < cap && stock <= low && (cycle + item as u64) % 3 == 0;
    let premium = if interested { normal * u64::from(low + 1 - stock) / (2 * u64::from(low + 1)) } else { 0 };
    let price = (normal + premium).min(next_buy.saturating_sub(1));
    (price, interested && price > normal)
}
