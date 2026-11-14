import { signGoldWalletAction } from './near-wallet.js';
import { goldActionPending, holdGold } from './pending-gold.js';

const gas = '80000000000000';
const format = (value, decimals) => {
  const padded = String(value).padStart(decimals + 1, '0');
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return padded.slice(0, -decimals) + (fraction ? '.' + fraction : '');
};

export function mountGoldWallet() {
  const element = id => document.getElementById('gold-wallet' + (id ? '-' + id : ''));
  const panel = element(), status = element('status'), button = element('submit');
  const action = element('action'), amount = element('amount');
  const form = element('form');
  let identity, state, plan, pending = false, locked = false;
  const showBalances = (inGame, inWallet) => {
    element('balances').textContent = `${format(inGame, 2)} in game · ${format(inWallet, 2)} in wallet`;
  };
  function reset() {
    plan = null;
    button.textContent = 'Review';
  }
  async function refresh() {
    const account = identity?.account;
    if (!account) return;
    const response = await fetch('/gold-wallet?account=' + encodeURIComponent(account), {
      cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Could not load your GOLD balances.');
    const next = await response.json();
    if (identity?.account !== account) return;
    state = next;
    showBalances(next.inGame, next.inWallet);
    return next;
  }
  panel.addEventListener('toggle', () => {
    if (panel.open) refresh().catch(error => { status.textContent = error.message; });
    else if (!pending) { reset(); status.textContent = ''; }
  });
  form.addEventListener('input', () => { if (!pending) { reset(); status.textContent = ''; } });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!identity || pending || locked || goldActionPending()) return;
    if (!plan) {
      if (!state || !/^\d{1,12}(?:\.\d{1,2})?$/.test(amount.value.trim())) {
        status.textContent = 'Enter a GOLD amount with up to two decimal places.';
        return;
      }
      const [whole, fraction = ''] = amount.value.trim().split('.');
      const cents = BigInt(whole + fraction.padEnd(2, '0'));
      if (!cents) { status.textContent = 'Choose a positive amount.'; return; }
      const value = String(cents);
      const call = (methodName, args, deposit = '1') => ({ methodName, args, deposit, gas });
      const display = format(value, 2) + ' GOLD';
      let receiverId = state.token, calls, summary;
      switch (action.value) {
        case 'deposit':
          if (cents > BigInt(state.inWallet)) { status.textContent = 'Insufficient GOLD in your wallet.'; return; }
          calls = [call('ft_transfer_call', { receiver_id: state.arena, amount: value, msg: 'deposit' })];
          summary = `Move ${display} into the game`;
          break;
        case 'withdraw':
          if (cents > BigInt(state.inGame)) { status.textContent = 'Insufficient GOLD in the game.'; return; }
          receiverId = state.arena;
          calls = [call('withdraw_gold', { amount: value })];
          summary = `Move ${display} to your wallet`;
          break;
        case 'buy': {
          if (cents > BigInt(state.inventory)) { status.textContent = 'There is not enough GOLD in the sale.'; return; }
          const price = String(cents * BigInt(state.unitPrice));
          calls = [call('buy', { amount: value }, price)];
          summary = `Buy ${display} for ${format(price, 24)} test NEAR`;
          break;
        }
        default:
          status.textContent = 'Choose an available GOLD action.';
          return;
      }
      if (!state.registered && action.value !== 'buy') {
        if (action.value !== 'withdraw') {
          status.textContent = 'Move GOLD to your wallet or buy GOLD to register it.';
          return;
        }
        calls = [{ receiverId: state.token, calls: [call('storage_deposit',
          { account_id: identity.account, registration_only: true }, state.storage)] }, { receiverId, calls }];
      } else {
        if (!state.registered) calls.unshift(call('storage_deposit',
          { account_id: identity.account, registration_only: true }, state.storage));
        calls = [{ receiverId, calls }];
      }
      plan = { transactions: calls, action: action.value, value };
      status.textContent = summary + (!state.registered ? ` · Wallet registration ${format(state.storage, 24)} test NEAR` : '');
      button.textContent = 'Confirm';
      return;
    }
    const operation = plan;
    const snapshot = state;
    const cents = BigInt(operation.value);
    const gameDebit = operation.action === 'withdraw' ? Number(cents) : 0;
    const release = holdGold(identity.account, Number(snapshot.inGame), gameDebit);
    if (!release) return;
    pending = true;
    for (const control of form.elements) control.disabled = true;
    const walletDebit = operation.action === 'deposit' ? cents : 0n;
    showBalances(BigInt(snapshot.inGame) - BigInt(gameDebit), BigInt(snapshot.inWallet) - walletDebit);
    status.textContent = `${format(operation.value, 2)} GOLD · Confirmation pending`;
    try {
      const { account } = identity;
      const embedded = identity.embedded && snapshot.embedded && snapshot.network === 'testnet'
        ? await import('./gold-wallet-embedded.js').then(module => module.createGoldSigner(snapshot.embedded, account))
        : null;
      for (const { receiverId, calls } of operation.transactions) {
        if (identity?.account !== account) throw new Error('The active game account changed.');
        const result = await (embedded ? embedded(receiverId, calls) : signGoldWalletAction(receiverId, account, calls));
        if (result?.status?.Failure) throw new Error('The transaction was declined by the contract.');
        if (typeof result?.status?.SuccessValue !== 'string') {
          throw new Error('Check your wallet and balances before trying again.');
        }
        if (receiverId === snapshot.arena && atob(result.status.SuccessValue) !== 'true') {
          throw new Error('The withdrawal failed and the GOLD was returned to the game balance.');
        }
        if (operation.action === 'deposit' && JSON.parse(atob(result.status.SuccessValue)) !== operation.value) {
          throw new Error('The deposit was returned to your wallet.');
        }
      }
      const walletDelta = operation.action === 'deposit' ? -cents : cents;
      const expectedWallet = BigInt(snapshot.inWallet) + walletDelta;
      let refreshed = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt) await new Promise(resolve => setTimeout(resolve, 600));
        if (identity?.account !== account) break;
        const latest = await refresh().catch(() => null);
        if (latest && BigInt(latest.inWallet) === expectedWallet) {
          refreshed = true;
          break;
        }
      }
      status.textContent = refreshed ? 'Confirmed' : 'Confirmed. Reopen the wallet to refresh your balances.';
      window.dispatchEvent(new Event('gold-wallet-confirmed'));
      amount.value = '';
    } catch (error) {
      status.textContent = error.message || 'Check your balances before trying again.';
      if (!await refresh().catch(() => null)) element('balances').textContent = 'Reopen the wallet to check your balances.';
    } finally {
      pending = false;
      release();
      for (const control of form.elements) control.disabled = false;
      button.disabled = locked;
      reset();
    }
  });
  function update(account, busy) {
    locked = busy;
    button.disabled = locked || pending;
    panel.hidden = !account?.account;
    if (identity?.account !== account?.account) {
      state = null;
      panel.open = false;
      status.textContent = '';
      reset();
    }
    identity = account;
  }
  return { update };
}
