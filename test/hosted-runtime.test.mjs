import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { KeyPair } from 'near-api-js';
import { WebSocket } from 'ws';
import { loadDeployment, productionProblems, requestHasSameOrigin } from '../deployment-config.mjs';

function configured(directory) {
  const key = KeyPair.fromRandom('ed25519').toString();
  return { NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://game.example',
    BARREL_NEAR_SOCIAL_CALLBACK: 'https://game.example/',
    BARREL_DATA_DIR: directory, BARREL_DB: join(directory, 'economy.sqlite'),
    BARREL_NEAR_CONTRACT: 'game.testnet', BARREL_GOLD_CONTRACT: 'gold.testnet',
    BARREL_NEAR_REFEREE: 'game.testnet', BARREL_NEAR_KEY: key,
    BARREL_EXPEDITIONS_OPERATOR: 'game.testnet', BARREL_EXPEDITIONS_KEY: key,
    BARREL_NEAR_SOCIAL_SPONSOR: 'sponsor.testnet', BARREL_NEAR_SOCIAL_SPONSOR_KEY: key,
    BARREL_NEAR_RPC: 'https://rpc.invalid', PRIVY_APP_ID: 'test-app-id',
    BARREL_NEAR_SOCIAL: '1', BARREL_NEAR_SOCIAL_PROVIDER: 'privy',
    BARREL_NEAR_WORKSHOP: '1', BARREL_NEAR_STARTER: '1', BARREL_NEAR_COLLECTION: '1',
    BARREL_NEAR_SESSIONS: '1', BARREL_NEAR_VOYAGE: '1', BARREL_GOLD_WALLET: '1' };
}

test('hosted candidate refuses incomplete configuration, local fallback, mismatched OAuth and leaked admin keys', () => {
  const env = configured(tmpdir());
  assert.deepEqual(productionProblems(env), []);
  for (const changes of [{ PUBLIC_ORIGIN: 'http://game.example' }, { PUBLIC_ORIGIN: 'https://game.example/' },
    { BARREL_NEAR_SOCIAL_CALLBACK: 'https://other.example/' }, { BARREL_NEAR_COLLECTION: '0' },
    { BARREL_GOLD_CONTRACT: env.BARREL_NEAR_CONTRACT }, { BARREL_DB: ':memory:' },
    { BARREL_DB: join(tmpdir(), '..', 'outside.sqlite') }, { BARREL_NEAR_SOCIAL_SANDBOX: '1' },
    { BARREL_NEAR_KEY: '' }, { BARREL_NEAR_RPC: 'http://localhost:3030' }]) {
    assert.ok(productionProblems({ ...env, ...changes }).length, JSON.stringify(Object.keys(changes)));
  }
  const privateKey = 'PRIVATE_SENTINEL_VALUE';
  const problems = productionProblems({ ...env, BARREL_NEAR_DEPLOY_KEY: privateKey });
  assert.ok(problems.some(problem => problem.includes('BARREL_NEAR_DEPLOY_KEY')));
  assert.ok(problems.every(problem => !problem.includes(privateKey)));
  assert.throws(() => loadDeployment({ NODE_ENV: 'production' }), /Hosted configuration rejected/);
  assert.deepEqual(loadDeployment({}), { production: false, origin: null });
});

test('origin pinning rejects a forged forwarded host and a different scheme', () => {
  const production = loadDeployment(configured(tmpdir()));
  const request = origin => ({ headers: { origin, host: 'internal:10000', 'x-forwarded-host': 'evil.example' } });
  assert.equal(requestHasSameOrigin(request('https://game.example'), production), true);
  assert.equal(requestHasSameOrigin(request('https://evil.example'), production), false);
  assert.equal(requestHasSameOrigin(request('http://game.example'), production), false);
  assert.equal(requestHasSameOrigin(request('null'), production), false);
  assert.equal(requestHasSameOrigin({ headers: { host: 'localhost:4182', origin: 'https://evil.example',
    'x-forwarded-host': 'evil.example' } }, loadDeployment({})), false);
});

test('hosted HTTP sets secure cookies and headers; WebSocket accepts only the configured origin', { timeout: 15_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'afloat-hosted-'));
  const env = { ...process.env, ...configured(directory), HOST: '127.0.0.1', PORT: '0' };
  for (const name of Object.keys(env)) {
    if (/DEPLOY_KEY|ADMIN_KEY|SANDBOX_KEY/.test(name)) delete env[name];
  }
  const child = spawn(process.execPath, ['--experimental-sqlite', fileURLToPath(new URL('../server.mjs', import.meta.url))],
    { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null) child.kill(); await exited; await rm(directory, { recursive: true, force: true }); });
  let errors = '';
  child.stderr.on('data', data => { errors += data; });
  const lines = createInterface({ input: child.stdout });
  const [line] = await once(lines, 'line', { signal: AbortSignal.timeout(6000) }).catch(error => { throw new Error(errors || error.message); });
  lines.close();
  const base = line.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  const response = await fetch(base + '/playtest-session');
  assert.equal(response.status, 204);
  assert.match(response.headers.get('set-cookie'), /; Secure$/);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000');
  const health = await fetch(base + '/healthz');
  assert.deepEqual(await health.json(), { ok: true });
  const socketUrl = base.replace('http:', 'ws:') + '/arena';
  const good = new WebSocket(socketUrl, { origin: env.PUBLIC_ORIGIN });
  t.after(() => good.terminate());
  await once(good, 'open');
  good.terminate();
  for (const origin of [undefined, 'https://evil.example']) {
    const socket = new WebSocket(socketUrl, { ...(origin ? { origin } : {}), headers: { 'x-forwarded-host': 'evil.example' } });
    t.after(() => socket.terminate());
    const rejected = new Promise(resolve => socket.once('unexpected-response', (_request, reply) => {
      reply.resume(); socket.terminate(); resolve(reply.statusCode);
    }));
    socket.on('error', () => {});
    assert.equal(await rejected, 403);
  }
});
