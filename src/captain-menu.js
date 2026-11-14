import { goldLabel } from './harbor.js';
import { mountGoldWallet } from './gold-wallet.js';
import './captain-menu.css';

export function mountCaptainMenu(saveName = () => {}) {
  const get = id => document.getElementById(id);
  const dialog = get('captain-menu');
  const trigger = get('captain-menu-open');
  const nickname = get('nickname');
  const preferences = get('captain-preferences');
  const goldWallet = mountGoldWallet();
  let address = '';
  let signoutLocked = false;
  const key = 'nearly-afloat:pirate-name';
  get('captain-build').textContent = 'Test build · ' + (typeof __AFLOAT_BUILD_ID__ === 'string' ? __AFLOAT_BUILD_ID__ : 'development');
  const text = (id, value) => { const element = get(id); if (element.textContent !== value) element.textContent = value; };
  try { nickname.value = localStorage.getItem(key) ?? nickname.value; } catch { /* Storage may be unavailable. */ }

  function close() { if (dialog.open) dialog.close(); }
  function renderName() {
    text('captain-name', nickname.value.trim() || 'Deckhand');
  }
  nickname.addEventListener('input', () => {
    renderName();
    try { localStorage.setItem(key, nickname.value); } catch { /* Keep the current session usable. */ }
  });
  trigger.addEventListener('click', () => {
    if (dialog.open) { close(); return; }
    get('captain-copy-status').hidden = true;
    preferences.open = document.body.dataset.uiLayout !== 'mobile';
    dialog.showModal();
    trigger.setAttribute('aria-expanded', 'true');
  });
  get('captain-menu-close').addEventListener('click', close);
  dialog.addEventListener('close', () => {
    trigger.setAttribute('aria-expanded', 'false');
    get('captain-account-details').open = false;
    get('gold-wallet').open = false;
  });
  // Close before another dialog, a provider popup or fullscreen takes focus.
  for (const id of ['near-social-connect', 'near-connect', 'profile-progress', 'fullscreen']) {
    get(id).addEventListener('click', close, { capture: true });
  }
  get('pirate-name-save').addEventListener('click', () => {
    if (address) {
      get('pirate-name-status').textContent = saveName(nickname.value) ? 'Saving…' : 'Return to the bay to save your name.';
    } else get('pirate-name-status').textContent = 'Sign in to save your name to your account.';
  });
  get('captain-copy-address').addEventListener('click', async () => {
    const status = get('captain-copy-status');
    try { await navigator.clipboard.writeText(address); status.textContent = 'Address copied'; }
    catch { status.textContent = 'Select the address above to copy it.'; }
    status.hidden = false;
  });

  function update({ account, gold, goldWalletEnabled, enabled, online, busy, locked, goldActionPending, balanceLoading }) {
    goldWallet.update(goldWalletEnabled && online ? account : null, locked || busy);
    address = account?.account ?? '';
    get('nickname').disabled = get('pirate-name-save').disabled = Boolean(locked);
    signoutLocked = locked || busy || goldActionPending || !online;
    renderName();
    trigger.dataset.connected = String(Boolean(address));
    trigger.setAttribute('aria-label', address ? 'Your account' : 'Account');
    text('captain-account-state', busy ? 'Bringing your loot aboard…' : balanceLoading ? 'Updating gold…' : address ? 'Crew member' : 'Guest pirate');
    get('captain-guest-hint').hidden = Boolean(address);
    get('captain-balance').hidden = get('header-gold').hidden = gold == null || !online;
    if (gold != null) {
      text('captain-balance-value', goldLabel(gold));
      text('header-gold-value', goldLabel(gold));
      get('header-gold').title = goldLabel(gold) + ' test gold';
    }
    get('captain-copy-address').hidden = !address;
    get('captain-signout-hint').hidden = !account?.social || !(locked || busy);
    text('captain-signout-hint', locked ? 'Finish this round before signing out.' : 'Wait for your action to finish before signing out.');
    get('near-social-logout').disabled = signoutLocked;
    get('near-options').hidden = !enabled;
  }

  function profile(value) {
    nickname.value = value.name;
    get('pirate-name-status').textContent = value.named ? 'Name saved' : '';
    renderName();
  }
  return { update, close, profile, canSignOut: () => !signoutLocked };
}
