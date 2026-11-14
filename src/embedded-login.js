import './embedded-login.css';
import './pirate-ui.css';
import Privy, { LocalStorage, create, rawSign } from '@privy-io/js-sdk-core';
import { ACCOUNT_CHOICE_KEY, resolveLoginChoice } from '../shared/login-choice.mjs';
import { bayDarkness } from '../shared/world-lighting.mjs';

document.body.dataset.night = String(bayDarkness() >= .5);

const byId = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const storageKey = 'afloat-embedded-login-state';
let state = params.get('state') ?? sessionStorage.getItem(storageKey);
const flowStorageKey = 'afloat-embedded-login-flow';
const status = byId('signin-status');
let config;
let privy;
let user;
let email;
let finishing = false;
let secureReady;

function notify(result) {
  const message = { type: 'afloat-social-login', result };
  if (config?.flow && typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('afloat-sign-in-' + config.flow);
    channel.postMessage(message);
    channel.close();
  }
  window.opener?.postMessage(message, location.origin);
}

function setBusy(busy) {
  for (const button of document.querySelectorAll('button')) button.disabled = busy;
  byId('signin-cancel').disabled = false;
}

function setCompleting(completing) {
  setBusy(completing);
  byId('signin-cancel').hidden = completing;
  byId('signin-account-options').hidden = completing;
  if (completing) {
    byId('signin-retry').hidden = true;
    byId('signin-logout').hidden = true;
    status.textContent = 'Signing in…';
    delete status.dataset.error;
  }
}

function fail(error) {
  status.textContent = error?.gameMessage ?? (error?.code === 'invalid_origin'
    ? 'This game address is not enabled for sign-in. Open the configured preview and try again.'
    : 'Could not finish signing in. Please try again.');
  status.dataset.error = '';
  byId('signin-retry').hidden = false;
  byId('signin-logout').hidden = !user;
  setCompleting(false);
}

async function restartAttempt() {
  const response = await fetch('/near-social/embedded/restart', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flow: config?.flow ?? sessionStorage.getItem(flowStorageKey) }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error('Could not renew sign-in');
  config = data;
  state = data.state;
  sessionStorage.setItem(storageKey, state);
  if (config.flow) sessionStorage.setItem(flowStorageKey, config.flow);
  history.replaceState(null, '', '/signin.html?state=' + encodeURIComponent(state));
}

async function post(path, input, retry = true) {
  const response = await fetch('/near-social/embedded/' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, ...input }), signal: AbortSignal.timeout(45_000),
  });
  const data = await response.json();
  if (!response.ok && path === 'prepare' && retry && data.code === 'login_expired') {
    await restartAttempt();
    return post(path, input, false);
  }
  if (!response.ok) throw Object.assign(new Error('Sign-in request rejected'), { gameMessage: data.message, gameCode: data.code });
  return data;
}

function mountSecureContext() {
  const iframe = document.createElement('iframe');
  iframe.title = 'Secure account';
  iframe.src = privy.embeddedWallet.getURL();
  iframe.hidden = true;
  const trustedOrigin = new URL(iframe.src).origin;
  window.addEventListener('message', event => {
    if (event.source !== iframe.contentWindow || event.origin !== trustedOrigin) return;
    try { privy.embeddedWallet.onMessage(typeof event.data === 'string' ? JSON.parse(event.data) : event.data); } catch { /* Ignore unrelated messages. */ }
  });
  secureReady = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Secure account context timed out')), 20_000);
    iframe.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true });
  });
  void secureReady.catch(() => {}); // Report a timeout in the sign-in UI when the account is needed.
  document.body.append(iframe);
  privy.setMessagePoster(iframe.contentWindow);
}

async function tokens() {
  const [accessToken, identityToken] = await Promise.all([privy.getAccessToken(), privy.getIdentityToken()]);
  if (!accessToken || !identityToken) throw Object.assign(new Error('Missing verified identity'), {
    gameMessage: 'Sign-in is not ready. Please try again or contact the crew.',
  });
  return { accessToken, identityToken };
}

async function finish() {
  if (finishing) return;
  finishing = true;
  setCompleting(true);
  delete status.dataset.error;
  byId('signin-retry').hidden = true;
  byId('signin-options').hidden = true;
  status.textContent = 'Bringing your loot aboard…';
  try {
    let wallet = user.linked_accounts.find(account => account.type === 'wallet' && account.chain_type === 'near' && account.wallet_client_type === 'privy');
    if (!wallet) {
      // The user owns the wallet. No service-owned root key or signing secret enters the game server.
      wallet = await create(privy, { request: { chain_type: 'near', owner: { user_id: user.id } },
        headers: { 'privy-idempotency-key': 'afloat-near-' + user.id } });
      ({ user } = await privy.user.get());
    }
    await secureReady;
    const authorization = await post('prepare', await tokens());
    const { data } = await rawSign(privy, options => privy.embeddedWallet.signWithUserSigner(options), {
      wallet_id: authorization.walletId, params: { hash: authorization.hash },
    });
    await post('complete', { ...await tokens(), signature: data.signature });
    sessionStorage.removeItem(storageKey);
    sessionStorage.removeItem(flowStorageKey);
    status.textContent = 'Ahoy! Your crew is waiting.';
    notify('success');
    window.close();
    if (!window.closed && !window.opener) location.replace('/');
  } catch (error) {
    // A broadcast may have succeeded even if its HTTP response was interrupted.
    const session = await fetch('/near-social/session', { cache: 'no-store' }).catch(() => null);
    if (session?.status === 200 && (await session.json().catch(() => null))?.signingReady === true) {
      notify('success');
      window.close();
      if (!window.closed && !window.opener) location.replace('/');
    }
    else {
      fail(error);
      if (error?.gameCode === 'login_expired') {
        byId('signin-retry').textContent = 'Renew sign-in';
      }
    }
  } finally { finishing = false; }
}

byId('signin-email-form').addEventListener('submit', async event => {
  event.preventDefault();
  setBusy(true);
  email = byId('signin-email').value.trim();
  try {
    await privy.auth.email.sendCode(email);
    byId('signin-email-form').hidden = true;
    byId('signin-code-form').hidden = false;
    status.textContent = 'Check your email for a six-digit code.';
    delete status.dataset.error;
    byId('signin-code').focus();
  } catch (error) { fail(error); }
  finally { setBusy(false); }
});
byId('signin-code-form').addEventListener('submit', async event => {
  event.preventDefault();
  setCompleting(true);
  try {
    ({ user } = await privy.auth.email.loginWithCode(email, byId('signin-code').value.trim()));
    await finish();
  } catch (error) { fail(error); }
});
byId('signin-google').addEventListener('click', async () => {
  setCompleting(true);
  try {
    const { url } = await privy.auth.oauth.generateURL('google', config.callback);
    const destination = new URL(url);
    if (destination.protocol !== 'https:') throw new Error('Invalid login destination');
    sessionStorage.setItem(storageKey, state);
    location.assign(destination.href);
  } catch (error) { fail(error); }
});
byId('signin-change-email').addEventListener('click', () => {
  byId('signin-code-form').hidden = true;
  byId('signin-email-form').hidden = false;
  byId('signin-code').value = '';
  byId('signin-email').focus();
});
byId('signin-retry').addEventListener('click', async () => {
  if (!user) { location.reload(); return; }
  setCompleting(true);
  try {
    await restartAttempt();
    await finish();
  } catch (error) { fail(error); }
});
byId('signin-logout').addEventListener('click', async () => {
  setBusy(true);
  try { await privy.auth.logout({ userId: user.id }); location.reload(); } catch (error) { fail(error); }
});
byId('signin-cancel').addEventListener('click', () => { notify('cancelled'); window.close(); });

async function init() {
  const code = params.get('privy_oauth_code');
  const oauthState = params.get('privy_oauth_state');
  if (code && oauthState) setCompleting(true);
  if (!/^[A-Za-z0-9_-]{43}$/.test(state ?? '')) throw new Error('Missing login state');
  sessionStorage.setItem(storageKey, state);
  const response = await fetch('/near-social/embedded/config?state=' + encodeURIComponent(state), { cache: 'no-store' });
  config = await response.json();
  if (!response.ok && config.code === 'login_expired') await restartAttempt();
  else if (!response.ok) throw Object.assign(new Error('Expired sign-in'), { gameMessage: config.message });
  if (config.flow) sessionStorage.setItem(flowStorageKey, config.flow);
  byId('signin-previous').href += config.flow ? '&flow=' + encodeURIComponent(config.flow) : '';
  privy = new Privy({ appId: config.appId, ...(config.clientId ? { clientId: config.clientId } : {}), storage: new LocalStorage() });
  await privy.initialize();
  mountSecureContext();
  history.replaceState(null, '', '/signin.html?state=' + encodeURIComponent(state));
  if (code && oauthState) ({ user } = await privy.auth.oauth.loginWithCode(code, oauthState));
  else {
    try { ({ user } = await privy.user.get()); }
    catch (error) {
      // Core SDK 0.79.5 throws on a first visit instead of returning {user: null}.
      if (error?.code !== 'missing_or_invalid_token') throw error;
      user = null;
    }
  }
  user = await resolveLoginChoice({ user,
    chooseAccount: localStorage.getItem(ACCOUNT_CHOICE_KEY) === '1', oauthReturned: Boolean(code && oauthState),
    logout: userId => privy.auth.logout({ userId }),
    clearChoice: () => localStorage.removeItem(ACCOUNT_CHOICE_KEY),
  });
  if (user) await finish();
  else { byId('signin-options').hidden = false; status.textContent = ''; }
}

void init().catch(fail);
