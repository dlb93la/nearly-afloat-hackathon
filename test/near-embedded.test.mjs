import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once, on } from 'node:events';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import test from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { openEconomy } from '../economy.mjs';
import { loadNearEmbedded } from '../near-embedded.mjs';
import { loadNearSocial } from '../near-social.mjs';
import { SOCIAL_LOGIN_WINDOW_MS, SOCIAL_SIGNING_WINDOW_MS } from '../shared/social-session.mjs';

const env = { BARREL_NEAR_SOCIAL: '1', BARREL_NEAR_SOCIAL_PROVIDER: 'privy', PRIVY_APP_ID: 'test-app-id', PRIVY_CLIENT_ID: 'test-client-id' };
const account = 'b'.repeat(64);
const wallet = { type: 'wallet', chain_type: 'near', wallet_client_type: 'privy', id: 'wallet-one', address: account };
const request = value => ({ headers: { cookie: value } });
const pair = value => value.split(';')[0];
function capture() {
  return { writeHead(status, headers) { this.status = status; this.headers = headers; return this; }, end(body) { this.body = body; } };
}

async function fixture(t, overrides = {}, configuration = env) {
  const keys = await generateKeyPair('ES256');
  const jwk = await exportJWK(keys.publicKey);
  const db = openEconomy(':memory:');
  t.after(() => db.close());
  let preparations = 0;
  let installations = 0;
  const actions = {
    async prepare(value) { preparations++; assert.equal(value, account); return { encoded: Uint8Array.from([1, 2, 3]) }; },
    async authorizeSignature(prepared, signature) {
      installations++;
      assert.equal(signature, 'root-signature');
      assert.deepEqual([...prepared.encoded], [1, 2, 3]);
      return { marker: true };
    },
    submit(value, signing, method, args, id, active) {
      assert.equal(value, account); assert.equal(signing.marker, true); assert.ok(active()); return method;
    },
  };
  const social = loadNearSocial(configuration, { actions });
  const embedded = loadNearEmbedded(configuration, { jwks: createLocalJWKSet({ keys: [jwk] }), actions, social,
    bindIdentity: (identity, value) => db.bindEmbeddedIdentity(identity, value), ...overrides });
  async function tokens(claims = {}) {
    const sign = value => new SignJWT(value).setProtectedHeader({ alg: 'ES256' }).setIssuer('privy.io')
      .setAudience(env.PRIVY_APP_ID).setIssuedAt().setExpirationTime('1 hour').sign(keys.privateKey);
    const common = { sub: 'did:privy:test-user', ...claims };
    return { accessToken: await sign({ ...common, app_client_id: configuration.PRIVY_CLIENT_ID || 'root' }),
      identityToken: await sign({ ...common, linked_accounts: JSON.stringify([wallet]) }) };
  }
  const start = capture();
  embedded.start(request(''), start, 'profile', 'a1c45307-bdd4-467c-837d-c13c8181c5ba');
  const state = new URL(start.headers.Location, social.origin).searchParams.get('state');
  const browser = request(pair(start.headers['Set-Cookie']));
  return { embedded, social, state, browser, tokens, db, keys,
    counts: () => ({ preparations, installations }) };
}

test('embedded login verifies real JWT signatures and installs one session without an approval redirect', async t => {
  const f = await fixture(t);
  const config = capture();
  f.embedded.config(f.browser, config, 'profile', f.state);
  assert.equal(config.status, 200);
  assert.equal(JSON.parse(config.body).clientId, env.PRIVY_CLIENT_ID);
  assert.doesNotMatch(config.body, /secret/i);
  const identity = await f.tokens();
  const prepare = capture();
  await f.embedded.handle(f.browser, prepare, 'profile', '/near-social/embedded/prepare', { state: f.state, ...identity });
  assert.equal(prepare.status, 200);
  assert.deepEqual(JSON.parse(prepare.body), { account, walletId: wallet.id,
    hash: '0x039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81' });
  const duplicate = capture();
  await f.embedded.handle(f.browser, duplicate, 'profile', '/near-social/embedded/prepare', { state: f.state, ...identity });
  assert.equal(duplicate.status, 200);
  assert.equal(f.counts().preparations, 1);
  const finish = capture();
  const input = { state: f.state, ...identity, signature: 'root-signature' };
  await f.embedded.handle(f.browser, finish, 'profile', '/near-social/embedded/complete', input);
  assert.equal(finish.status, 200);
  assert.match(finish.headers['Set-Cookie'], /HttpOnly/);
  assert.equal(finish.headers.Location, undefined);
  assert.equal(f.counts().installations, 1);
  const signedIn = request(pair(finish.headers['Set-Cookie']));
  const issue = capture();
  f.social.issue(signedIn, issue, 'profile');
  assert.equal(f.social.consume(JSON.parse(issue.body).ticket, 'profile').account, account);
  assert.equal(f.social.authorizeRequest(signedIn, 'profile', { account, method: 'workshop_action', args: {},
    requestId: 'aa651890-257d-45de-87e3-2195675ecefa' }), 'workshop_action');
  f.social.logout(signedIn, capture(), 'profile');
  assert.throws(() => f.social.authorizeRequest(signedIn, 'profile', { account, method: 'bid', args: {},
    requestId: 'aa651890-257d-45de-87e3-2195675ecefa' }), /Sign in again/);
  const replay = capture();
  await f.embedded.handle(f.browser, replay, 'profile', '/near-social/embedded/complete', input);
  assert.equal(replay.status, 400);
  assert.equal(f.counts().installations, 1);
});

test('embedded login rejects a different browser/profile, untrusted claims and identity changes', async t => {
  const f = await fixture(t);
  const identity = await f.tokens();
  for (const [browser, profile, auth] of [
    [request(''), 'profile', identity], [f.browser, 'other-profile', identity],
    [f.browser, 'profile', { ...identity, accessToken: identity.accessToken.slice(0, -8) + 'tampered' }],
    [f.browser, 'profile', { ...identity, identityToken: identity.accessToken }],
    [f.browser, 'profile', { ...identity, identityToken: (await f.tokens({ sub: 'did:privy:other' })).identityToken }],
  ]) {
    const result = capture();
    await f.embedded.handle(browser, result, profile, '/near-social/embedded/prepare', { state: f.state, ...auth });
    assert.equal(result.status, 400);
  }
  assert.equal(f.counts().preparations, 0);
  const prepare = capture();
  await f.embedded.handle(f.browser, prepare, 'profile', '/near-social/embedded/prepare', { state: f.state, ...identity });
  const changed = capture();
  await f.embedded.handle(f.browser, changed, 'profile', '/near-social/embedded/complete', { state: f.state,
    ...await f.tokens({ sub: 'did:privy:other' }), signature: 'root-signature' });
  assert.equal(changed.status, 400);
  assert.equal(f.counts().installations, 0);
});

test('embedded sign-in preserves the existing game account before funding a different one', async t => {
  const f = await fixture(t, { accountHint: () => 'c'.repeat(64) });
  const result = capture();
  await f.embedded.handle(f.browser, result, 'profile', '/near-social/embedded/prepare', { state: f.state, ...await f.tokens() });
  assert.equal(result.status, 400);
  assert.match(result.body, /previous sign-in/);
  assert.equal(f.counts().preparations, 0);
});

test('the default web app needs no separate client and accepts only its root-scoped access token', async t => {
  const f = await fixture(t, {}, { ...env, PRIVY_CLIENT_ID: '' });
  const config = capture();
  f.embedded.config(f.browser, config, 'profile', f.state);
  assert.equal(JSON.parse(config.body).clientId, null);
  const result = capture();
  await f.embedded.handle(f.browser, result, 'profile', '/near-social/embedded/prepare', { state: f.state, ...await f.tokens() });
  assert.equal(result.status, 200);
  const accessToken = await new SignJWT({ sub: 'did:privy:test-user', app_client_id: 'unconfigured-client' })
    .setProtectedHeader({ alg: 'ES256' }).setIssuer('privy.io').setAudience(env.PRIVY_APP_ID)
    .setIssuedAt().setExpirationTime('1 hour').sign(f.keys.privateKey);
  const refused = capture();
  await f.embedded.handle(f.browser, refused, 'profile', '/near-social/embedded/complete', {
    state: f.state, ...await f.tokens(), accessToken, signature: 'root-signature' });
  assert.equal(refused.status, 400);
  assert.equal(f.counts().installations, 0);
});

test('email sign-in can take longer than five minutes and an expired attempt restarts without accepting its old payload', async t => {
  let clock = Date.now();
  const f = await fixture(t, { now: () => clock });
  clock += 6 * 60_000;
  const identity = await f.tokens();
  const prepared = capture();
  await f.embedded.handle(f.browser, prepared, 'profile', '/near-social/embedded/prepare', { state: f.state, ...identity });
  assert.equal(prepared.status, 200);
  clock += SOCIAL_SIGNING_WINDOW_MS + 1;
  const stale = capture();
  await f.embedded.handle(f.browser, stale, 'profile', '/near-social/embedded/complete', {
    state: f.state, ...identity, signature: 'root-signature' });
  assert.equal(stale.status, 400);
  assert.equal(JSON.parse(stale.body).code, 'login_expired');
  assert.equal(f.counts().installations, 0);
  const reprepared = capture();
  await f.embedded.handle(f.browser, reprepared, 'profile', '/near-social/embedded/prepare', { state: f.state, ...identity });
  assert.equal(reprepared.status, 200);
  assert.equal(f.counts().preparations, 2);
  clock += SOCIAL_LOGIN_WINDOW_MS;
  const expired = capture();
  await f.embedded.handle(f.browser, expired, 'profile', '/near-social/embedded/prepare', { state: f.state, ...identity });
  assert.equal(JSON.parse(expired.body).code, 'login_expired');
  const restarted = capture();
  await f.embedded.handle(f.browser, restarted, 'profile', '/near-social/embedded/restart', { flow: 'a1c45307-bdd4-467c-837d-c13c8181c5ba' });
  assert.equal(restarted.status, 200);
  const next = JSON.parse(restarted.body);
  assert.notEqual(next.state, f.state);
  assert.equal(next.flow, 'a1c45307-bdd4-467c-837d-c13c8181c5ba');
  const browser = request(pair(restarted.headers['Set-Cookie']));
  const finish = capture();
  await f.embedded.handle(browser, finish, 'profile', '/near-social/embedded/complete', {
    state: next.state, ...identity, signature: 'root-signature' });
  assert.equal(finish.status, 400); // Restart is not an authorization.
  assert.equal(f.counts().installations, 0);
  const newPreparation = capture();
  await f.embedded.handle(browser, newPreparation, 'profile', '/near-social/embedded/prepare', { state: next.state, ...identity });
  assert.equal(newPreparation.status, 200);
  const valid = capture();
  await f.embedded.handle(browser, valid, 'profile', '/near-social/embedded/complete', {
    state: next.state, ...identity, signature: 'root-signature' });
  assert.equal(valid.status, 200);
});

test('an embedded identity stays bound across restarts and cannot fund a replacement account', () => {
  const dir = mkdtempSync(join(tmpdir(), 'afloat-identity-'));
  const path = join(dir, 'accounts.sqlite');
  let db = openEconomy(path);
  assert.equal(db.bindEmbeddedIdentity('a'.repeat(64), account), true);
  db.close();
  db = openEconomy(path);
  try {
    assert.equal(db.bindEmbeddedIdentity('a'.repeat(64), account), true);
    assert.equal(db.bindEmbeddedIdentity('a'.repeat(64), 'c'.repeat(64)), false);
    assert.throws(() => db.bindEmbeddedIdentity('did:privy:raw-identity', account), /Invalid account/);
  } finally { db.close(); }
});

test('a still-valid identity token can outlive an hour but never replaces a fresh access token', async t => {
  const f = await fixture(t);
  const now = Math.floor(Date.now() / 1000);
  const sign = value => new SignJWT(value).setProtectedHeader({ alg: 'ES256' }).setIssuer('privy.io')
    .setAudience(env.PRIVY_APP_ID).setIssuedAt(now - 7200).setExpirationTime(now + 3600).sign(f.keys.privateKey);
  const fresh = await f.tokens();
  const identityToken = await sign({ sub: 'did:privy:test-user', linked_accounts: JSON.stringify([wallet]) });
  const prepared = capture();
  await f.embedded.handle(f.browser, prepared, 'profile', '/near-social/embedded/prepare', {
    state: f.state, ...fresh, identityToken });
  assert.equal(prepared.status, 200);
  const stale = capture();
  await f.embedded.handle(f.browser, stale, 'profile', '/near-social/embedded/complete', {
    state: f.state, ...fresh, identityToken, signature: 'root-signature',
    accessToken: await sign({ sub: 'did:privy:test-user', app_client_id: env.PRIVY_CLIENT_ID }) });
  assert.equal(stale.status, 400);
  assert.equal(f.counts().installations, 0);
});

test('embedded JWTs must belong to this app/client and contain a Privy NEAR wallet', async t => {
  const f = await fixture(t);
  const sign = claims => new SignJWT(claims).setProtectedHeader({ alg: 'ES256' }).setIssuer('privy.io')
    .setAudience(env.PRIVY_APP_ID).setIssuedAt().setExpirationTime('1 hour').sign(f.keys.privateKey);
  const base = await f.tokens();
  for (const tokens of [
    { ...base, accessToken: await sign({ sub: 'did:privy:test-user', app_client_id: 'other-client' }) },
    { ...base, identityToken: await sign({ sub: 'did:privy:test-user', linked_accounts: JSON.stringify([{ ...wallet, chain_type: 'solana' }]) }) },
    { ...base, accessToken: await new SignJWT({ sub: 'did:privy:test-user', app_client_id: env.PRIVY_CLIENT_ID })
      .setProtectedHeader({ alg: 'ES256' }).setIssuer('privy.io').setAudience('other-app').setIssuedAt().setExpirationTime('1 hour').sign(f.keys.privateKey) },
  ]) {
    const result = capture();
    await f.embedded.handle(f.browser, result, 'profile', '/near-social/embedded/prepare', { state: f.state, ...tokens });
    assert.equal(result.status, 400);
  }
  assert.equal(f.counts().preparations, 0);
});

test('embedded HTTP endpoints bind the browser and restore the verified account over the game socket', { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const base = `http://localhost:${port}`;
  const publicKey = await exportJWK(f.keys.publicKey);
  // The real HTTP/WS handlers and JWT verifier run; only contract outcomes and the JWK source are fixtures.
  const hooks = 'data:text/javascript,' + encodeURIComponent(`
    import { registerHooks } from 'node:module';
    registerHooks({ load(url, context, nextLoad) {
      if (url.endsWith('/near-arena.mjs')) return { format: 'module', shortCircuit: true, source: \`
        export const nearRoundId = () => '1';
        export const loadNearArena = () => ({ contract: 'arena.testnet', hasStarter: true, hasWorkshop: true,
          ensureAccount: async () => {}, workshop: async () => ({ workshop: { gold: 10000, equipped: 'oak' } }) });
      \` };
      if (url.endsWith('/near-social-actions.mjs')) return { format: 'module', shortCircuit: true, source: \`
        export const SOCIAL_GOLD_LIMIT = 10000;
        export const loadNearSocialActions = () => ({ prepare: async () => ({ encoded: Uint8Array.from([1,2,3]) }),
          authorizeSignature: async () => ({}), submit: async () => ({ status: { SuccessValue: '' } }) });
      \` };
      const loaded = nextLoad(url, context);
      if (!url.endsWith('/near-embedded.mjs')) return loaded;
      const source = String(loaded.source).replace('export function loadNearEmbedded(', 'function realLoadNearEmbedded(');
      return { ...loaded, source: source + \`
        import { createLocalJWKSet } from 'jose';
        export const loadNearEmbedded = (env, dependencies) => realLoadNearEmbedded(env, {
          ...dependencies, jwks: createLocalJWKSet({keys:[${JSON.stringify(publicKey)}]}) });
      \` };
    } });
  `);
  const server = spawn(process.execPath, ['--experimental-sqlite', '--import', hooks,
    fileURLToPath(new URL('../server.mjs', import.meta.url))], { env: { ...process.env, ...env,
      HOST: '127.0.0.1', PORT: String(port), BARREL_DB: ':memory:', BARREL_NEAR_SOCIAL_CALLBACK: base + '/' },
    stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = once(server, 'exit');
  t.after(async () => { if (server.exitCode === null) server.kill(); await exited; });
  const output = createInterface({ input: server.stdout });
  await once(output, 'line', { signal: AbortSignal.timeout(8_000) });
  output.close();
  const call = (path, init = {}) => fetch(base + path, { redirect: 'manual', ...init });
  const profile = pair((await call('/playtest-session')).headers.get('set-cookie'));
  const start = await call('/near-social/start', { headers: { Cookie: profile } });
  assert.equal(start.status, 302);
  const renewed = await call('/near-social/start?renew=1', { headers: { Cookie: profile } });
  assert.equal(renewed.status, 302, 'embedded renewal must redirect to sign-in instead of returning JSON');
  assert.match(renewed.headers.get('location'), /^\/signin.html\?state=/);
  assert.match(start.headers.get('location'), /^\/signin.html\?state=/);
  const state = new URL(start.headers.get('location'), base).searchParams.get('state');
  const cookies = profile + '; ' + pair(start.headers.get('set-cookie'));
  const input = { state, ...await f.tokens(), signature: 'fixture-root-signature' };
  assert.equal((await call('/near-social/embedded/config?state=' + state, { headers: { Cookie: cookies } })).status, 200);
  const post = (path, cookie, origin = base, body = JSON.stringify(input)) => call(path, {
    method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body });
  assert.equal((await post('/near-social/embedded/prepare', cookies, 'https://other.example')).status, 403);
  assert.equal((await post('/near-social/embedded/restart', cookies, 'https://other.example')).status, 403);
  assert.equal((await post('/near-social/embedded/restart', '')).status, 403);
  assert.equal((await post('/near-social/embedded/prepare', profile)).status, 400);
  assert.equal((await post('/near-social/embedded/prepare', cookies, base, 'x'.repeat(40_961))).status, 413);
  assert.equal((await post('/near-social/embedded/prepare', cookies)).status, 200);
  const completed = await post('/near-social/embedded/complete', cookies);
  assert.equal(completed.status, 200);
  const [shortCookie, rememberCookie] = completed.headers.getSetCookie().map(pair);
  const rememberedOnly = profile + '; ' + rememberCookie;
  const signedCookie = profile + '; ' + shortCookie + '; ' + rememberCookie;
  const rememberedSession = await call('/near-social/session', { headers: { Cookie: rememberedOnly } });
  assert.equal(rememberedSession.status, 200);
  assert.equal((await rememberedSession.json()).signingReady, false);
  assert.equal((await call('/near-social/session', { headers: { Cookie: rememberCookie } })).status, 204);
  const session = await call('/near-social/session', { headers: { Cookie: signedCookie } });
  const { ticket } = await session.json();
  const socket = new WebSocket(`ws://127.0.0.1:${port}/arena`, { headers: { Cookie: profile } });
  t.after(() => socket.terminate());
  const replies = on(socket, 'message', { signal: AbortSignal.timeout(5_000) });
  await once(socket, 'open');
  socket.send(JSON.stringify({ type: 'near-social-auth', ticket }));
  let restored = false;
  for await (const [bytes] of replies) {
    const message = JSON.parse(bytes);
    if (message.type === 'near-wallet') {
      assert.equal(message.account, account);
      assert.equal(message.social, true);
      assert.equal(message.embedded, true);
      restored = true;
      break;
    }
  }
  assert.equal(restored, true);
  assert.equal((await call('/near-social/session', { headers: { Cookie: signedCookie } })).status, 200);
  assert.equal((await post('/near-social/logout', signedCookie)).status, 204);
  assert.equal((await call('/near-social/session', { headers: { Cookie: signedCookie } })).status, 204);
  assert.equal((await call('/near-social/session', { headers: { Cookie: rememberedOnly } })).status, 204);
});
