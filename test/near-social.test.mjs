import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once, on } from 'node:events';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { KeyPair } from 'near-api-js';
import { WebSocket } from 'ws';
import { deriveSocialNearAccount, loadNearSocial } from '../near-social.mjs';
import { openEconomy } from '../economy.mjs';
import { socialGoldCost } from '../near-social-actions.mjs';
import { NearSocialActionError, setNearSocialAccount, signNearEntry, signNearExpedition, signNearWorkshop } from '../src/near-wallet.js';

function capture() {
  return {
    writeHead(status, headers) { this.status = status; this.headers = headers; return this; },
    end(body) { this.body = body; },
  };
}

const request = cookie => ({ headers: { cookie } });
const cookiePair = value => value.split(';')[0];

test('remembered login survives a server restart without restoring signing permission', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'afloat-signin-'));
  const filename = join(directory, 'game.sqlite');
  let clock = Date.now();
  let storage = openEconomy(filename, () => clock);
  const env = { BARREL_NEAR_SOCIAL: '1', BARREL_NEAR_SOCIAL_CALLBACK: 'https://game.example/' };
  let service = loadNearSocial(env, { remembered: storage.rememberedLogins });
  try {
    const profile = 'profile-a', account = 'd'.repeat(64);
    const login = capture();
    service.establish(request(''), login, profile, account, { remaining: 100 });
    const [session, remembered] = login.headers['Set-Cookie'];
    assert.match(remembered, /HttpOnly;.*Max-Age=604800; Secure$/);
    const browser = request([session, remembered].map(cookiePair).join('; '));
    storage.close();
    storage = openEconomy(filename, () => clock);
    service = loadNearSocial(env, { remembered: storage.rememberedLogins });
    const wrongProfile = capture();
    service.issue(browser, wrongProfile, 'profile-b');
    assert.equal(wrongProfile.status, 204);
    const visit = capture();
    service.issue(browser, visit, profile);
    const { ticket, signingReady } = JSON.parse(visit.body);
    assert.equal(signingReady, false);
    assert.deepEqual(service.consume(ticket, profile), { account, embedded: true, signingReady: false });
    assert.equal(service.consume(ticket, profile), null);
    assert.throws(() => service.authorizeRequest(browser, profile,
      { account, method: 'workshop_action', args: {}, requestId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }), /Sign in again/);
    clock += 7 * 86_400_000 + 5000;
    const expired = capture();
    service.issue(browser, expired, profile);
    assert.equal(expired.status, 204);
  } finally {
    storage.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('legacy sign-in renews exhausted budgets instead of returning the unusable session', async () => {
  let preparations = 0;
  const account = 'd'.repeat(64);
  const social = loadNearSocial({ BARREL_NEAR_SOCIAL: '1' }, {
    actions: { async prepare(id) { assert.equal(id, account); preparations++; return { encoded: Uint8Array.of(8, 9) }; } },
  });
  const signing = { remaining: 10000, operations: new Map() };
  const response = capture();
  social.establish(request(''), response, 'profile', account, signing);
  const authenticated = request(cookiePair(response.headers['Set-Cookie']));
  const probe = capture();
  social.issue(authenticated, probe, 'profile');
  const handle = social.consume(JSON.parse(probe.body).ticket, 'profile');
  assert.equal(social.canSignAction(handle, 'profile', 200), true);
  assert.equal(social.canSignAction(handle, 'other-profile', 200), false);
  assert.equal(social.canSignAction({ ...handle, account: 'f'.repeat(64) }, 'profile', 200), false);
  assert.equal(social.canSignAction(handle, 'profile', 10001), false);
  const reuse = capture(); await social.start(authenticated, reuse, 'profile');
  assert.equal(reuse.status, 200);
  assert.equal(preparations, 0);
  const manual = capture(); await social.start(authenticated, manual, 'profile', null, true);
  assert.equal(manual.status, 302);
  assert.equal(preparations, 1);
  signing.remaining = 0;
  const renew = capture(); await social.start(authenticated, renew, 'profile');
  assert.equal(renew.status, 302);
  assert.equal(new URL(renew.headers.Location).searchParams.get('transaction'), '8,9');
  assert.equal(preparations, 2);
  signing.remaining = 10000;
  for (let i = 0; i < 150; i++) signing.operations.set(String(i), {});
  const capped = capture(); await social.start(authenticated, capped, 'profile');
  assert.equal(capped.status, 200, 'operation count must not force another sign-in');
  assert.equal(preparations, 2);
});

test('social login requires the issuing browser, verifies PKCE and consumes each ticket once', async () => {
  const account = 'a'.repeat(64);
  let auth;
  let exchanges = 0;
  const social = loadNearSocial({ BARREL_NEAR_SOCIAL: '1' }, {
    async fetch(url, { body }) {
      exchanges++;
      assert.equal(url.href, 'https://login.testnet.fast-auth.com/oauth/token');
      assert.equal(body.get('redirect_uri'), 'http://localhost:3000/');
      assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'), auth.searchParams.get('code_challenge'));
      return Response.json({ id_token: 'verified-by-test' });
    },
    async verify(value) {
      assert.equal(value, 'verified-by-test');
      return { nonce: auth.searchParams.get('nonce'), sub: 'google-oauth2|example' };
    },
    async derive(subject) { assert.equal(subject, 'google-oauth2|example'); return account; },
  });
  const start = capture();
  social.start(request(''), start, 'profile-a');
  assert.equal(start.status, 302);
  auth = new URL(start.headers.Location);
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  const callback = new URLSearchParams({ state: auth.searchParams.get('state'), code: 'test' });
  const wrongBrowser = capture();
  await social.finish(request(''), wrongBrowser, callback);
  assert.match(wrongBrowser.body, /result: 'error'/);
  assert.equal(exchanges, 0);

  const complete = capture();
  const browser = cookiePair(start.headers['Set-Cookie']);
  await social.finish(request(browser), complete, callback);
  assert.match(complete.body, /result: 'success'/);
  assert.match(complete.headers['Set-Cookie'][1], /HttpOnly/);
  const cookie = cookiePair(complete.headers['Set-Cookie'][1]);
  const wrongProfile = capture();
  social.issue(request(cookie), wrongProfile, 'profile-b');
  assert.equal(wrongProfile.status, 204);
  const access = capture();
  social.issue(request(cookie), access, 'profile-a');
  const { ticket } = JSON.parse(access.body);
  assert.equal(social.consume(ticket, 'profile-b'), null);
  assert.equal(social.consume(ticket, 'profile-a').account, account);
  assert.equal(social.consume(ticket, 'profile-a'), null);
  const reload = capture();
  social.issue(request(cookie), reload, 'profile-a');
  assert.equal(social.consume(JSON.parse(reload.body).ticket, 'profile-a').account, account);

  const replay = capture();
  await social.finish(request(browser), replay, callback);
  assert.match(replay.body, /result: 'error'/);
  assert.equal(exchanges, 1);
});

test('a session key is enabled only after the same OAuth identity approves the exact payload', async () => {
  let auth;
  let authorized = 0;
  const prepared = { encoded: Uint8Array.from([1, 3, 5]) };
  const social = loadNearSocial({ BARREL_NEAR_SOCIAL: '1' }, {
    async fetch() { return Response.json({ id_token: 'test', access_token: 'signing-token' }); },
    async verify() { return { nonce: auth.searchParams.get('nonce'), sub: 'auth0|example' }; },
    async verifyApproval() { return { sub: 'auth0|example', fatxn: [...prepared.encoded] }; },
    async derive() { return 'b'.repeat(64); },
    actions: {
      async prepare(account) { assert.equal(account, 'b'.repeat(64)); return prepared; },
      async authorize(value, accessToken, guardId) {
        assert.equal(value, prepared);
        assert.equal(accessToken, 'signing-token');
        assert.equal(guardId, 'jwt#https://login.testnet.fast-auth.com/');
        authorized++;
        return { remaining: 10000, operations: new Map() };
      },
      submit(account, signing, method, args, requestId, active) {
        assert.equal(account, 'b'.repeat(64));
        assert.ok(active());
        return 'submitted';
      },
    },
  });
  async function callback(from) {
    auth = new URL(from.headers.Location);
    const next = capture();
    await social.finish(request(cookiePair(from.headers['Set-Cookie'])), next,
      new URLSearchParams({ state: auth.searchParams.get('state'), code: 'test' }));
    return next;
  }
  const start = capture();
  social.start(request(''), start, 'profile');
  const approval = await callback(start);
  assert.equal(approval.status, 302);
  assert.equal(new URL(approval.headers.Location).searchParams.get('transaction'), '1,3,5');
  assert.equal(authorized, 0);
  const finish = await callback(approval);
  assert.equal(authorized, 1);
  const signedIn = request(cookiePair(finish.headers['Set-Cookie'][1]));
  const resume = capture();
  await social.start(signedIn, resume, 'profile');
  assert.equal(resume.status, 200);
  assert.match(resume.body, /result: 'success'/);
  assert.equal(authorized, 1);
  const action = { account: 'b'.repeat(64), requestId: '97aa1e12-e2df-4ca8-96ee-72d5ae91a8f8', method: 'authorize_entry', args: {} };
  assert.equal(social.authorizeRequest(signedIn, 'profile', action), 'submitted');
  social.logout(signedIn, capture(), 'profile');
  assert.throws(() => social.authorizeRequest(signedIn, 'profile', action), /Sign in again/);
});

test('social spending covers entry, quoted purchases and bids and rejects unpriced gold buys', () => {
  assert.equal(socialGoldCost('authorize_session', { entries: 3 }), 600);
  assert.equal(socialGoldCost('workshop_action', { action: 'buy', expected_price: 840 }), 840);
  assert.equal(socialGoldCost('bid', { amount: 1800 }), 1800);
  assert.equal(socialGoldCost('collection_action', { action: 'equip' }), 0);
  assert.equal(socialGoldCost('collection_action', { action: 'open_chest', expected_price: 2200 }), 2200);
  assert.throws(() => socialGoldCost('workshop_action', { action: 'buy' }), /current offer/);
  assert.throws(() => socialGoldCost('transfer', { amount: 1 }), /outside/);
});

test('a returning profile combines identity and session authorization in one provider request', async () => {
  const account = 'c'.repeat(64);
  const prepared = { encoded: Uint8Array.from([7, 4, 1]) };
  let auth;
  let exchanges = 0;
  let approvals = 0;
  const social = loadNearSocial({ BARREL_NEAR_SOCIAL: '1' }, {
    accountHint: profile => profile === 'returning' ? account : null,
    async derive() { return account; },
    async fetch() { exchanges++; return Response.json({ id_token: 'identity', access_token: 'approval' }); },
    async verify() { return { sub: 'auth0|returning', nonce: auth.searchParams.get('nonce') }; },
    async verifyApproval() { return { sub: 'auth0|returning', fatxn: [...prepared.encoded] }; },
    actions: {
      async prepare(expected) { assert.equal(expected, account); return prepared; },
      async authorize(payload) { assert.equal(payload, prepared); approvals++; return { remaining: 10000, operations: new Map() }; },
    },
  });
  const start = capture();
  await social.start(request(''), start, 'returning');
  auth = new URL(start.headers.Location);
  assert.equal(auth.searchParams.get('scope'), 'openid transaction:sign');
  assert.equal(auth.searchParams.get('transaction'), '7,4,1');
  const finish = capture();
  await social.finish(request(cookiePair(start.headers['Set-Cookie'])), finish,
    new URLSearchParams({ state: auth.searchParams.get('state'), code: 'code' }));
  assert.match(finish.body, /result: 'success'/);
  assert.equal(exchanges, 1);
  assert.equal(approvals, 1);
});

test('a remembered account cannot authorize a session with another social identity', async () => {
  let auth;
  let approvals = 0;
  const social = loadNearSocial({ BARREL_NEAR_SOCIAL: '1' }, {
    accountHint: () => 'c'.repeat(64),
    async derive() { return 'd'.repeat(64); },
    async fetch() { return Response.json({ id_token: 'another-identity', access_token: 'approval' }); },
    async verify() { return { sub: 'auth0|other', nonce: auth.searchParams.get('nonce') }; },
    actions: {
      async prepare() { return { encoded: Uint8Array.from([7, 4, 1]) }; },
      async authorize() { approvals++; },
    },
  });
  const start = capture();
  await social.start(request(''), start, 'returning');
  auth = new URL(start.headers.Location);
  const finish = capture();
  await social.finish(request(cookiePair(start.headers['Set-Cookie'])), finish,
    new URLSearchParams({ state: auth.searchParams.get('state'), code: 'code' }));
  assert.match(finish.body, /result: 'error'/);
  assert.equal(approvals, 0);
  assert.equal(finish.headers['Set-Cookie'].length, 1);
});

test('the browser routes workshop, Arena and Expeditions actions through the same social session', async t => {
  const account = 'b'.repeat(64);
  const contract = 'arena.testnet';
  const submitted = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/near-social/action');
    assert.equal(options.method, 'POST');
    submitted.push(JSON.parse(options.body));
    return Response.json({ transaction: { hash: 'test-hash' }, status: { SuccessValue: '' }, final_execution_status: 'FINAL' });
  });
  setNearSocialAccount(account, contract, true);
  t.after(() => setNearSocialAccount(null));
  const purchase = await signNearWorkshop(contract, account, { action: 'buy', rig: 'cork', expected_price: 620 });
  assert.deepEqual(purchase, { hash: 'test-hash', failed: false, finalized: true });
  await signNearEntry(contract, account, '123', true);
  assert.equal(await signNearExpedition(contract, account, 'bid', { amount: 400 }), 'test-hash');
  await assert.rejects(signNearWorkshop('other.testnet', account, {}), NearSocialActionError);
  assert.deepEqual(submitted.map(action => [action.account, action.method]),
    [[account, 'workshop_action'], [account, 'authorize_entry'], [account, 'bid']]);
  assert.equal(new Set(submitted.map(action => action.requestId)).size, 3);
});

test('a verified callback unlocks the real HTTP and WebSocket session and sign-out disables actions', { timeout: 20_000 }, async t => {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const base = `http://localhost:${port}`;
  const account = 'd'.repeat(64);
  // Inject OAuth and RPC outcomes only. The HTTP endpoints, browser cookies and socket handlers are real.
  const fixture = 'data:text/javascript,' + encodeURIComponent(`
    import { registerHooks } from 'node:module';
    registerHooks({ load(url, context, nextLoad) {
      if (url.endsWith('/near-arena.mjs')) return { format: 'module', shortCircuit: true, source: \`
        export const nearRoundId = () => '1';
        export const loadNearArena = () => ({ contract: 'arena.testnet', hasStarter: true, hasWorkshop: true,
          ensureAccount: async () => {}, workshop: async () => ({ workshop: { gold: 10000, equipped: 'oak' } }) });
      \` };
      const loaded = nextLoad(url, context);
      if (!url.endsWith('/near-social.mjs')) return loaded;
      const source = String(loaded.source).replace('export function loadNearSocial(', 'function realLoadNearSocial(');
      return { ...loaded, source: source + \`
        export const loadNearSocial = env => realLoadNearSocial(env, {
          derive: async () => '${account}',
          fetch: async (_url, { body }) => Response.json({ id_token: body.get('code'), access_token: 'approved' }),
          verify: async nonce => ({ nonce, sub: 'auth0|fixture' }),
          verifyApproval: async () => ({ sub: 'auth0|fixture', fatxn: [1, 2] }),
          actions: {
            prepare: async () => ({ encoded: [1, 2] }), authorize: async () => ({}),
            submit: async (_account, _session, method) => ({ transaction: { hash: method }, status: { SuccessValue: '' },
              final_execution_status: 'FINAL' }),
          },
        });
      \` };
    } });
  `);
  const server = spawn(process.execPath, ['--experimental-sqlite', '--import', fixture,
    fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), BARREL_DB: ':memory:',
      BARREL_NEAR_SOCIAL: '1', BARREL_NEAR_SOCIAL_CALLBACK: base + '/' }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  const exited = once(server, 'exit');
  t.after(async () => { if (server.exitCode === null) server.kill(); await exited; });
  const output = createInterface({ input: server.stdout });
  await once(output, 'line', { signal: AbortSignal.timeout(6_000) });
  output.close();

  const call = (path, init = {}) => fetch(base + path, { redirect: 'manual', ...init });
  const guest = await call('/playtest-session');
  const profile = cookiePair(guest.headers.get('set-cookie'));
  const first = await call('/near-social/start', { headers: { Cookie: profile } });
  assert.equal(first.status, 302);
  const callback = response => {
    const url = new URL(response.headers.get('location'));
    return call('/?' + new URLSearchParams({ state: url.searchParams.get('state'), code: url.searchParams.get('nonce') }),
      { headers: { Cookie: cookiePair(response.headers.get('set-cookie')) } });
  };
  const approval = await callback(first);
  assert.equal(approval.status, 302);
  const complete = await callback(approval);
  assert.match(await complete.text(), /result: 'success'/);
  const cookies = `${profile}; ${cookiePair(complete.headers.getSetCookie()[1])}`;
  const signedIn = await call('/near-social/session', { headers: { Cookie: cookies } });
  const { ticket } = await signedIn.json();
  const socket = new WebSocket(`ws://127.0.0.1:${port}/arena`, { headers: { Cookie: profile } });
  t.after(() => socket.terminate());
  const replies = on(socket, 'message', { signal: AbortSignal.timeout(5_000) });
  await once(socket, 'open');
  socket.send(JSON.stringify({ type: 'near-social-auth', ticket }));
  for await (const [bytes] of replies) {
    const reply = JSON.parse(bytes);
    assert.notEqual(reply.type, 'near-social-error', reply.message);
    if (reply.type === 'near-wallet' && !reply.balanceLoading) {
      assert.deepEqual(reply, { type: 'near-wallet', account, gold: 10000, social: true, embedded: false, appearance: {} });
      break;
    }
  }
  const action = { method: 'POST', headers: { Origin: base, Cookie: cookies,
    'Content-Type': 'application/json' }, body: JSON.stringify({ account, method: 'authorize_entry', args: { round_id: '1' },
      requestId: '7f19f538-9da7-4c90-a287-f8e0268a752c' }) };
  const performed = await call('/near-social/action', action);
  assert.equal(performed.status, 200);
  assert.equal((await performed.json()).transaction.hash, 'authorize_entry');
  assert.equal((await call('/near-social/logout', action)).status, 204);
  assert.equal((await call('/near-social/action', action)).status, 400);
});

test('NEAR social account derivation uses the Auth0 issuer and verified subject', async () => {
  const key = KeyPair.fromRandom('ed25519').getPublicKey();
  const provider = { async callFunction(query) {
    assert.equal(query.contractId, 'v1.signer-prod.testnet');
    assert.equal(query.method, 'derived_public_key');
    assert.deepEqual(query.args, { path: 'jwt#https://login.testnet.fast-auth.com/#google-oauth2|example',
      predecessor: 'fast-auth.testnet', domain_id: 1 });
    return key.toString();
  } };
  assert.equal(await deriveSocialNearAccount('google-oauth2|example', provider), Buffer.from(key.data).toString('hex'));
  await assert.rejects(deriveSocialNearAccount('bad\nsubject', provider), /Invalid Auth0 subject/);
});
