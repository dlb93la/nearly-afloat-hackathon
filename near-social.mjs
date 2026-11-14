import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { JsonRpcProvider, PublicKey } from 'near-api-js';
import { SOCIAL_GOLD_LIMIT } from './near-social-actions.mjs';

const ISSUER = 'https://login.testnet.fast-auth.com/';
const CLIENT_ID = 'np8paqIpMWmNbzT4xAvOOapZBjsOpptl';
const SIGNING_AUDIENCE = 'auth0.jwt.fast-auth.testnet';
const LOGIN_COOKIE = 'afloat_social_login';
const SESSION_COOKIE = 'afloat_social_session';
const REMEMBER_COOKIE = 'afloat_remembered_account';
const LOGIN_SECONDS = 300;
const SESSION_SECONDS = 28_800;
const REMEMBER_SECONDS = 7 * 86_400;
const TICKET_SECONDS = 30;
const MAX_PENDING = 1024;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

const token = () => randomBytes(32).toString('base64url');
const tokenHash = value => value ? createHash('sha256').update(value).digest('hex') : null;
const reusableSigning = signing => signing && Number.isSafeInteger(signing.remaining) && signing.remaining > 0
  && signing.operations instanceof Map;

function cookie(request, name) {
  const value = request.headers.cookie?.split(';').map(part => part.trim())
    .find(part => part.startsWith(name + '='))?.slice(name.length + 1);
  return TOKEN.test(value ?? '') ? value : null;
}

export async function deriveSocialNearAccount(subject, provider) {
  if (typeof subject !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(subject)) throw new Error('Invalid Auth0 subject.');
  const derived = await provider.callFunction({ contractId: 'v1.signer-prod.testnet', method: 'derived_public_key',
    args: { path: `jwt#${ISSUER}#${subject}`, predecessor: 'fast-auth.testnet', domain_id: 1 },
    blockQuery: { finality: 'final' } });
  if (typeof derived !== 'string' || !derived.startsWith('ed25519:')) throw new Error('Invalid MPC public key.');
  return Buffer.from(PublicKey.fromString(derived).data).toString('hex');
}

export function loadNearSocial(env = process.env, dependencies = {}) {
  if (env.BARREL_NEAR_SOCIAL !== '1') return null;
  const callback = new URL(env.BARREL_NEAR_SOCIAL_CALLBACK ?? 'http://localhost:3000/');
  if (callback.username || callback.password || callback.search || callback.hash ||
      !(callback.protocol === 'https:' || (callback.protocol === 'http:' && callback.hostname === 'localhost'))) {
    throw new Error('Configure the NEAR Auth callback on an HTTPS origin or localhost.');
  }
  const clientId = env.BARREL_NEAR_SOCIAL_CLIENT_ID ?? CLIENT_ID;
  const secure = callback.protocol === 'https:' ? '; Secure' : '';
  const setCookie = (name, value, age, sameSite) =>
    `${name}=${value}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=${age}${secure}`;
  const fetchToken = dependencies.fetch ?? fetch;
  const jwks = createRemoteJWKSet(new URL('.well-known/jwks.json', ISSUER));
  const verify = dependencies.verify ?? (async idToken => (await jwtVerify(idToken, jwks, {
    issuer: ISSUER, audience: clientId, algorithms: ['RS256'], maxTokenAge: '5 minutes', clockTolerance: 5,
  })).payload);
  const verifyApproval = dependencies.verifyApproval ?? (async accessToken => (await jwtVerify(accessToken, jwks, {
    issuer: ISSUER, audience: SIGNING_AUDIENCE, algorithms: ['RS256'], maxTokenAge: '5 minutes', clockTolerance: 5,
  })).payload);
  const provider = new JsonRpcProvider({ url: 'https://test.rpc.fastnear.com' }, { retries: 1, wait: 200 });
  const derive = dependencies.derive ?? (subject => deriveSocialNearAccount(subject, provider));
  const pending = new Map();
  const sessions = new Map();
  const tickets = new Map();

  function read(map, id) {
    const entry = map.get(id);
    return entry?.expires > Date.now() ? entry : null;
  }

  function remember(map, id, entry, seconds) {
    for (const [key, value] of map) if (value.expires <= Date.now()) map.delete(key);
    if (map.size >= MAX_PENDING) return false;
    map.set(id, { ...entry, expires: Date.now() + seconds * 1000 });
    setTimeout(() => map.delete(id), seconds * 1000).unref();
    return true;
  }

  function redirectToAuth(response, profile, stage = {}) {
    const state = token();
    const verifier = token();
    const nonce = token();
    const browser = token();
    if (!remember(pending, state, { verifier, nonce, browser, profile, ...stage }, LOGIN_SECONDS)) return false;
    const url = new URL('authorize', ISSUER);
    url.search = new URLSearchParams({ client_id: clientId, response_type: 'code', scope: 'openid',
      redirect_uri: callback.href, state, nonce, code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url') });
    if (stage.approval) {
      url.searchParams.set('audience', SIGNING_AUDIENCE);
      url.searchParams.set('scope', 'openid transaction:sign');
      url.searchParams.set('transaction', stage.approval.encoded.join(','));
    }
    response.writeHead(302, { ...headers, Location: url.href,
      'Set-Cookie': setCookie(LOGIN_COOKIE, browser, LOGIN_SECONDS, 'Lax') }).end();
    return true;
  }

  async function start(request, response, profile, flow, renew = false) {
    if (!profile || request.headers['sec-fetch-site'] === 'cross-site') return response.writeHead(403, headers).end();
    const stage = { flow: /^[0-9a-f-]{36}$/.test(flow ?? '') ? flow : null };
    const sessionId = cookie(request, SESSION_COOKIE);
    const session = read(sessions, sessionId);
    if (session?.profile === profile && (!dependencies.actions || (!renew && reusableSigning(session.signing)))) {
      respondLogin(response, sessionId, stage.flow);
      return;
    }
    const knownAccount = session?.profile === profile ? session.account : dependencies.accountHint?.(profile);
    if (dependencies.actions && /^[a-f0-9]{64}$/.test(knownAccount ?? '')) {
      try {
        stage.account = knownAccount;
        stage.approval = await dependencies.actions.prepare(knownAccount);
      } catch {
        dependencies.onError?.('session key preparation');
        respondLogin(response, null, stage.flow);
        return;
      }
    }
    if (!redirectToAuth(response, profile, stage)) {
      response.writeHead(503, headers).end();
    }
  }

  async function finish(request, response, params) {
    const state = params.get('state');
    const login = read(pending, state);
    let sessionId;
    let flow;
    if (login && login.browser === cookie(request, LOGIN_COOKIE)) {
      pending.delete(state);
      flow = login.flow;
      const code = params.get('code');
      if (code && code.length <= 2048 && !params.has('error')) {
        let phase = 'OAuth exchange';
        try {
          const result = await fetchToken(new URL('oauth/token', ISSUER), {
            method: 'POST', signal: AbortSignal.timeout(10_000), redirect: 'error',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code,
              redirect_uri: callback.href, code_verifier: login.verifier }),
          });
          if (!result.ok) throw new Error('Auth0 rejected the authorization code.');
          const { id_token: idToken, access_token: accessToken } = await result.json();
          phase = 'identity verification';
          const claims = await verify(idToken);
          if (claims.nonce !== login.nonce) throw new Error('Auth0 nonce mismatch.');
          if (login.subject && claims.sub !== login.subject) throw new Error('Auth0 identity changed during approval.');
          phase = 'NEAR account derivation';
          const account = login.subject ? login.account : await derive(claims.sub);
          if (!/^[a-f0-9]{64}$/.test(account)) throw new Error('Invalid derived NEAR account.');
          if (login.account && account !== login.account) throw new Error('The account selected differs from the saved game account.');
          const oldSession = cookie(request, SESSION_COOKIE);
          const existing = read(sessions, oldSession);
          if (dependencies.actions && !login.approval && (existing?.account !== account || existing?.profile !== login.profile || !reusableSigning(existing.signing))) {
            phase = 'session key preparation';
            const approval = await dependencies.actions.prepare(account);
            if (redirectToAuth(response, login.profile, { account, subject: claims.sub, approval, flow })) return;
            throw new Error('Too many pending sign-ins.');
          }
          let signing = existing?.account === account && existing.profile === login.profile ? existing.signing : null;
          if (login.approval) {
            phase = 'approval verification';
            const approved = await verifyApproval(accessToken);
            const { fatxn } = approved;
            if (approved.sub !== claims.sub || !Array.isArray(fatxn) || fatxn.length !== login.approval.encoded.length ||
                fatxn.some((byte, index) => byte !== login.approval.encoded[index])) {
              throw new Error('NEAR Auth did not approve this game session.');
            }
            phase = 'MPC authorization';
            signing = await dependencies.actions.authorize(login.approval, accessToken, `jwt#${ISSUER}`);
          }
          const id = token();
          const duration = signing && signing === existing?.signing ? Math.floor((existing.expires - Date.now()) / 1000) : SESSION_SECONDS;
          if (duration > 0 && remember(sessions, id, { account, profile: login.profile, signing }, duration)) {
            if (existing?.profile === login.profile) sessions.delete(oldSession);
            sessionId = id;
          }
        } catch {
          // Authorization codes, ID tokens and OAuth subjects never enter application logs.
          dependencies.onError?.(phase);
        }
      }
    }
    respondLogin(response, sessionId, flow);
  }

  function respondLogin(response, sessionId, flow) {
    const clearLogin = setCookie(LOGIN_COOKIE, '', 0, 'Lax');
    const scriptNonce = token();
    const result = sessionId ? 'success' : 'error';
    const sessionCookie = sessionId ? [clearLogin, setCookie(SESSION_COOKIE, sessionId, SESSION_SECONDS, 'Lax')] : [clearLogin];
    response.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${scriptNonce}'; frame-ancestors 'none'`,
      'Set-Cookie': sessionCookie }).end(`<!doctype html><meta charset="utf-8"><title>NEARly Afloat</title>
<p>${sessionId ? 'Signed in. Return to NEARly Afloat.' : 'Sign-in could not be confirmed. Return to NEARly Afloat to try again.'}</p>
<script nonce="${scriptNonce}">history.replaceState(null, '', location.pathname);
const result = { type: 'afloat-social-login', result: '${result}' };
${flow ? `if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('afloat-sign-in-${flow}'); channel.postMessage(result); channel.close(); }` : ''}
if (window.opener) window.opener.postMessage(result, location.origin);
window.close();</script>`);
  }

  function issue(request, response, profile) {
    if (!profile || request.headers['sec-fetch-site'] === 'cross-site') return response.writeHead(204, headers).end();
    const id = cookie(request, SESSION_COOKIE);
    const session = read(sessions, id);
    const remembered = tokenHash(cookie(request, REMEMBER_COOKIE));
    const active = session?.profile === profile;
    if (!active && !(remembered && dependencies.remembered?.get(remembered, profile))) return response.writeHead(204, headers).end();
    const ticket = token();
    if (!remember(tickets, ticket, active ? { sessionId: id } : { remembered }, TICKET_SECONDS)) return response.writeHead(503, headers).end();
    response.writeHead(200, { ...headers, 'Content-Type': 'application/json' }).end(JSON.stringify({ ticket, signingReady: active }));
  }

  function consume(ticket, profile) {
    if (typeof ticket !== 'string' || !TOKEN.test(ticket)) return null;
    const issued = read(tickets, ticket);
    if (!profile || !issued) return null;
    if (issued.remembered) {
      const account = dependencies.remembered?.get(issued.remembered, profile);
      if (!account) return null;
      tickets.delete(ticket);
      return { account, embedded: true, signingReady: false };
    }
    const session = issued && read(sessions, issued.sessionId);
    if (!profile || session?.profile !== profile) return null;
    tickets.delete(ticket);
    return { account: session.account, id: issued.sessionId, embedded: session.embedded === true };
  }

  function sign(handle, profile, method, args, requestId) {
    const active = () => {
      const entry = read(sessions, handle?.id);
      return entry?.account === handle?.account && entry?.profile === profile && entry?.signing ? entry : null;
    };
    const entry = active();
    if (!entry) throw new Error('Sign in again to authorize your game session.');
    return dependencies.actions.submit(entry.account, entry.signing, method, args, requestId, active);
  }

  function canSignAction(handle, profile, cost) {
    const entry = read(sessions, handle?.id);
    return Boolean(dependencies.actions && entry?.account === handle?.account && entry?.profile === profile
      && Number.isSafeInteger(cost) && cost >= 0 && entry.signing?.remaining >= cost);
  }

  function authorizeRequest(request, profile, input) {
    if (!input || typeof input.requestId !== 'string' || !/^[0-9a-f-]{36}$/.test(input.requestId) ||
        typeof input.account !== 'string' || typeof input.method !== 'string') throw new Error('Invalid game action.');
    return sign({ id: cookie(request, SESSION_COOKIE), account: input.account }, profile, input.method, input.args, input.requestId);
  }

  function logout(request, response, profile) {
    const id = cookie(request, SESSION_COOKIE);
    if (profile && read(sessions, id)?.profile === profile) sessions.delete(id);
    const remembered = tokenHash(cookie(request, REMEMBER_COOKIE));
    if (remembered && profile) dependencies.remembered?.revoke(remembered, profile);
    response.writeHead(204, { ...headers, 'Set-Cookie': [setCookie(SESSION_COOKIE, '', 0, 'Lax'),
      setCookie(REMEMBER_COOKIE, '', 0, 'Lax')] }).end();
  }

  // Only trusted server-side provider adapters may install a verified signing session.
  function establish(request, response, profile, account, signing) {
    if (!profile || !/^[a-f0-9]{64}$/.test(account) || !signing) throw new Error('Invalid game session.');
    const id = token();
    if (!remember(sessions, id, { account, profile, signing, embedded: true }, SESSION_SECONDS)) throw new Error('Too many game sessions.');
    const cookies = [setCookie(SESSION_COOKIE, id, SESSION_SECONDS, 'Lax')];
    if (dependencies.remembered) {
      const browserToken = token();
      try {
        dependencies.remembered.replace(tokenHash(cookie(request, REMEMBER_COOKIE)), tokenHash(browserToken), profile,
          account, Date.now() + REMEMBER_SECONDS * 1000);
      } catch (error) { sessions.delete(id); throw error; }
      cookies.push(setCookie(REMEMBER_COOKIE, browserToken, REMEMBER_SECONDS, 'Lax'));
    }
    const previous = cookie(request, SESSION_COOKIE);
    if (read(sessions, previous)?.profile === profile) sessions.delete(previous);
    response.writeHead(200, { ...headers, 'Content-Type': 'application/json',
      'Set-Cookie': cookies.length === 1 ? cookies[0] : cookies }).end(JSON.stringify({ ok: true }));
  }

  return { callbackPath: callback.pathname, origin: callback.origin, canSign: Boolean(dependencies.actions),
    goldLimit: SOCIAL_GOLD_LIMIT, start, finish, issue, consume, authorizeRequest, logout, establish, canSignAction, sign };
}
