let active = null;

export const goldActionPending = () => active !== null;

export function availableGold(account, confirmed) {
  if (active?.account !== account || !active.amount) return confirmed;
  return Math.min(confirmed, active.balance - active.amount);
}

export function holdGold(account, balance, amount) {
  if (!account || !Number.isSafeInteger(amount) || amount < 0 ||
      (amount > 0 && (!Number.isSafeInteger(balance) || amount > balance)) || active) return null;
  const hold = { account, balance, amount };
  active = hold;
  queueMicrotask(() => window.dispatchEvent(new Event('pending-gold-changed')));
  return () => {
    if (active !== hold) return;
    active = null;
    queueMicrotask(() => window.dispatchEvent(new Event('pending-gold-changed')));
  };
}
