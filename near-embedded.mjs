import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { SOCIAL_LOGIN_WINDOW_MS, SOCIAL_SIGNING_WINDOW_MS } from './shared/social-session.mjs';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ACCOUNT = /^[a-f0-9]{64}$/;
const COOKIE = 'afloat_embedded_login';
const MAX_PENDING = 64;
const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json', 'Referrer-Policy': 'no-referrer' };
const random = () => randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('hex');

export function loadNearEmbedded(env = process.env, dependencies = {}) {
  if (env.BARREL_NEAR_SOCIAL_PROVIDER !== 'privy') return null;
  const appId = env.PRIVY_APP_ID;
  const clientId = env.PRIVY_CLIENT_ID || null;
  const validId = value => /^[A-Za-z0-9_-]{5,128}$/.test(value ?? '');
  if (!validId(appId) || (clientId && !validId(clientId))) {
    throw new Error('Configure PRIVY_APP_ID and, if using an app client, PRIVY_CLIENT_ID.');
  }
  if (!dependencies.actions?.authorizeSignature || !dependencies.social || !dependencies.bindIdentity) {
    throw new Error('Embedded sign-in requires session signing and persistent identity bindings.');
  }
  const origin = dependencies.social.origin;
  const secure = origin.startsWith('https:') ? '; Secure' : '';
  const jwks = dependencies.jwks ?? createRemoteJWKSet(new URL(`https://api.privy.io/v1/apps/${appId}/jwks.json`));
  const verify = dependencies.verify ?? (async (value, kind) => (await jwtVerify(value, jwks, {
    issuer: 'privy.io', audience: appId, algorithms: ['ES256'], requiredClaims: ['sub', 'exp', 'iat'],
    // The configured access token is 1 h; identity tokens default to 10 h in the dashboard.
    // Both must remain unexpired. An identity token cannot replace the fresh access token.
    maxTokenAge: kind === 'identity' ? '24 hours' : '1 hour', clockTolerance: 5,
  })).payload);
  const pending = new Map();
  const inFlight = new Set();
  const now = dependencies.now ?? Date.now;
  const expired = () => Object.assign(new Error('Sign-in expired. Try again.'), { code: 'login_expired' });

  function read(request, state, profile) {
    const browser = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
    const login = TOKEN.test(state ?? '') ? pending.get(state) : null;
    if (!login || login.expires <= now() || login.profile !== profile || login.browser !== browser) {
      throw expired();
    }
    return login;
  }

  function start(request, response, profile, flow, json = false) {
    if (!profile || request.headers['sec-fetch-site'] === 'cross-site') return response.writeHead(403, headers).end();
    for (const [id, login] of pending) if (login.expires <= now()) pending.delete(id);
    if (pending.size >= MAX_PENDING) return response.writeHead(503, headers).end();
    const state = random();
    const browser = random();
    const login = { profile, browser, flow: /^[0-9a-f-]{36}$/.test(flow ?? '') ? flow : null,
      expires: now() + SOCIAL_LOGIN_WINDOW_MS };
    pending.set(state, login);
    setTimeout(() => pending.delete(state), SOCIAL_LOGIN_WINDOW_MS).unref();
    const cookie = `${COOKIE}=${browser}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SOCIAL_LOGIN_WINDOW_MS / 1000}${secure}`;
    if (json) response.writeHead(200, { ...headers, 'Set-Cookie': cookie }).end(JSON.stringify(settings(login, state)));
    else response.writeHead(302, { ...headers, Location: `/signin.html?state=${state}`, 'Set-Cookie': cookie }).end();
  }

  const settings = (login, state) => ({ appId, clientId, state, flow: login.flow, callback: origin + '/signin.html' });

  function config(request, response, profile, state) {
    try {
      const login = read(request, state, profile);
      response.writeHead(200, headers).end(JSON.stringify(settings(login, state)));
    } catch { response.writeHead(401, headers).end(JSON.stringify({ message: 'Sign-in expired. Try again.', code: 'login_expired' })); }
  }

  async function identity(input) {
    if (typeof input?.accessToken !== 'string' || input.accessToken.length > 8192 ||
        typeof input.identityToken !== 'string' || input.identityToken.length > 24576) throw new Error('Invalid sign-in.');
    const [access, claims] = await Promise.all([verify(input.accessToken, 'access'), verify(input.identityToken, 'identity')]);
    if (!/^did:privy:[A-Za-z0-9_-]{1,128}$/.test(access.sub ?? '') || claims.sub !== access.sub ||
        access.app_client_id !== (clientId ?? 'root')) throw new Error('Invalid sign-in.');
    const accounts = typeof claims.linked_accounts === 'string' ? JSON.parse(claims.linked_accounts) : null;
    if (!Array.isArray(accounts)) throw new Error('Identity tokens must include linked accounts.');
    const wallet = accounts.find(account => account.type === 'wallet' && account.chain_type === 'near' &&
      account.wallet_client_type === 'privy' && ACCOUNT.test(account.address ?? '') &&
      /^[A-Za-z0-9_-]{1,128}$/.test(account.id ?? ''));
    if (!wallet) throw new Error('No embedded NEAR account.');
    return { subject: digest(`privy#${appId}#${claims.sub}`), account: wallet.address, walletId: wallet.id };
  }

  async function handle(request, response, profile, path, input) {
    let phase = 'browser binding';
    try {
      // This creates an unauthenticated attempt only; account linking still requires both signed JWTs and the owner signature.
      // The HTTP router enforces the same-origin POST and existing game profile before this method.
      if (path.endsWith('/restart')) return start(request, response, profile, input?.flow, true);
      const login = read(request, input?.state, profile);
      if (login.busy) return response.writeHead(409, headers).end(JSON.stringify({ message: 'Sign-in is already being prepared.' }));
      login.busy = true;
      try {
        phase = 'identity verification';
        const who = await identity(input);
        if (path.endsWith('/prepare')) {
          if (login.prepared && login.subject !== who.subject) throw new Error('Identity changed during sign-in.');
          const existingAccount = dependencies.accountHint?.(profile);
          if (existingAccount && existingAccount !== who.account) throw new Error('Use previous sign-in to keep your existing game account.');
          phase = 'account binding';
          if (!dependencies.bindIdentity(who.subject, who.account)) throw new Error('A different game account is already linked to this login.');
          if (!login.prepared || login.preparedAt + SOCIAL_SIGNING_WINDOW_MS <= now()) {
            // Concurrent popups for one identity cannot mint multiple funded accounts/keys.
            if (inFlight.has(who.subject)) throw new Error('Sign-in is already being prepared.');
            inFlight.add(who.subject);
            try {
              phase = 'session preparation';
              login.prepared = await dependencies.actions.prepare(who.account);
              login.preparedAt = now();
              Object.assign(login, who);
            } finally { inFlight.delete(who.subject); }
          }
          const body = JSON.stringify({ account: login.account, walletId: login.walletId,
            hash: '0x' + digest(login.prepared.encoded) });
          response.writeHead(200, headers).end(body);
        } else if (path.endsWith('/complete')) {
          if (!login.prepared || login.subject !== who.subject || login.account !== who.account || login.walletId !== who.walletId) {
            throw new Error('Identity changed during sign-in.');
          }
          if (login.preparedAt + SOCIAL_SIGNING_WINDOW_MS <= now()) throw expired();
          // Consume before broadcast: a lost response must be reconciled by /session, never replayed.
          pending.delete(input.state);
          phase = 'session installation';
          const signing = await dependencies.actions.authorizeSignature(login.prepared, input.signature);
          dependencies.social.establish(request, response, profile, who.account, signing);
        } else response.writeHead(404, headers).end();
      } finally { login.busy = false; }
    } catch (error) {
      dependencies.onError?.(phase);
      const allowed = ['Sign-in expired. Try again.', 'A different game account is already linked to this login.',
        'Use previous sign-in to keep your existing game account.',
        'Identity tokens must include linked accounts.', 'No embedded NEAR account.'];
      response.writeHead(400, headers).end(JSON.stringify({ message: allowed.includes(error.message) ? error.message : 'Could not finish signing in. Try again.',
        ...(error.code === 'login_expired' ? { code: error.code } : {}) }));
    }
  }

  return { start, config, handle, publicConfig: { appId, clientId } };
}
