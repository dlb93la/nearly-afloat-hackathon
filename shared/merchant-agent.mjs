// Reserve keeper: buy discounted surplus, release reserves into low stock.
// Deliberately programmed strategy; this module does not call an LLM.
export function decideMerchantTrade({ policy, quotes, owned, now = Date.now() }) {
  if (!policy?.enabled || now >= policy.expires_at) return { action: 'wait', reason: 'Policy inactive' };
  const permitted = quotes.filter(q => policy.items.includes(q.item));
  const release = permitted.filter(q => (owned[q.item] ?? 0) > 0 && q.count <= 3 && q.sell > 0 && q.sell <= policy.per_trade)
    .sort((a, b) => a.count - b.count || b.sell - a.sell || a.item.localeCompare(b.item))[0];
  if (release) return { action: 'sell', item: release.item, expected_price: release.sell, nonce: policy.nonce + 1,
    reason: 'Release reserve into scarce shop stock' };
  const acquire = permitted.filter(q => !(owned[q.item] > 0) && q.count >= 6 && q.discount > 0 && q.buy > 0 &&
    q.buy <= policy.per_trade && q.buy <= policy.budget - policy.spent)
    .sort((a, b) => b.discount - a.discount || a.buy - b.buy || a.item.localeCompare(b.item))[0];
  if (acquire) return { action: 'buy', item: acquire.item, expected_price: acquire.buy, nonce: policy.nonce + 1,
    reason: 'Acquire discounted surplus for the merchant reserve' };
  return { action: 'wait', reason: 'No permitted trade at the current stock and prices' };
}
