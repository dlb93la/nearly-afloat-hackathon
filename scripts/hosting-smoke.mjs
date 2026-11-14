import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { KeyPair } from 'near-api-js';
import { WebSocket } from 'ws';

// This starts only a loopback-bound local container with disposable keys.
// It never reads the real .env files or writes to NEAR.
const suffix = randomBytes(5).toString('hex');
const name = 'afloat-local-smoke-' + suffix;
const volume = name + '-data';
const folder = new URL('../output/hosting/', import.meta.url);
await mkdir(folder, { recursive: true });
const envPath = new URL('smoke-' + suffix + '.env', folder);
const env = Object.fromEntries((await readFile(new URL('../config/deploy.example', import.meta.url), 'utf8'))
  .split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => {
    const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)];
  }));
Object.assign(env, { PUBLIC_ORIGIN: 'https://smoke.example', BARREL_NEAR_SOCIAL_CALLBACK: 'https://smoke.example/',
  BARREL_NEAR_RPC: 'https://rpc.invalid',
  BARREL_NEAR_CONTRACT: `arena-${suffix}.testnet`, BARREL_NEAR_REFEREE: `arena-${suffix}.testnet`,
  BARREL_GOLD_CONTRACT: `gold-${suffix}.testnet`, BARREL_EXPEDITIONS_OPERATOR: `arena-${suffix}.testnet`,
  BARREL_NEAR_SOCIAL_SPONSOR: `sponsor-${suffix}.testnet` });
for (const key of ['BARREL_NEAR_KEY', 'BARREL_EXPEDITIONS_KEY', 'BARREL_NEAR_SOCIAL_SPONSOR_KEY']) {
  env[key] = KeyPair.fromRandom('ed25519').toString();
}
await writeFile(envPath, Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n'), { mode: 0o600 });
function docker(...args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  if (result.error || result.status !== 0) throw new Error('Local Docker command failed: ' + args[0]);
  return result.stdout.trim();
}
let socket;
const keepAlive = setInterval(() => {}, 1000);
try {
  docker('volume', 'create', volume);
  docker('run', '--detach', '--name', name, '--env-file', fileURLToPath(envPath),
    '--publish', '127.0.0.1::10000', '--mount', `type=volume,source=${volume},target=/app/data`,
    'nearly-afloat:local-preflight');
  let address = docker('port', name, '10000/tcp');
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  let base = 'http://' + address;
  async function ready() {
    for (let tries = 0; tries < 40; tries++) {
      if (await fetch(base + '/healthz', { signal: AbortSignal.timeout(2000) }).then(response => response.ok).catch(() => false)) return;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Local container did not become healthy.');
  }
  await ready();
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/signin.html')).status, 200);
  const profile = await fetch(base + '/playtest-session');
  const cookie = profile.headers.get('set-cookie');
  assert.match(cookie, /; Secure$/);
  const cookiePair = cookie.split(';')[0];
  socket = new WebSocket(base.replace('http:', 'ws:') + '/arena', { origin: env.PUBLIC_ORIGIN, headers: { Cookie: cookiePair } });
  await once(socket, 'open');
  socket.terminate();
  socket = null;
  const uid = docker('exec', name, 'node', '-e', 'console.log(process.getuid())');
  assert.equal(uid, '1000');
  docker('restart', '--time', '5', name);
  // Docker Desktop can reassign an ephemeral host port on restart.
  address = docker('port', name, '10000/tcp');
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  base = 'http://' + address;
  await ready();
  const restored = await fetch(base + '/playtest-session', { headers: { Cookie: cookiePair } });
  assert.equal(restored.status, 204);
  assert.equal(restored.headers.get('set-cookie'), null, 'Existing profile must survive a container restart.');
  const report = { checkedAt: new Date().toISOString(), image: 'nearly-afloat:local-preflight',
    scope: 'Local Docker only, disposable keys; no real login, transactions or cloud deployment.',
    loopbackOnly: true, healthy: true, gameAndSignin: true, secureCookie: true,
    webSocket: true, uid: Number(uid), profileSurvivesRestart: true };
  await writeFile(new URL('../output/hosting-smoke.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log('PASS ' + JSON.stringify(report));
} finally {
  clearInterval(keepAlive);
  socket?.terminate();
  // Names are unique to this run; never touch existing application containers/data.
  spawnSync('docker', ['rm', '--force', name], { stdio: 'ignore', windowsHide: true, timeout: 15_000 });
  spawnSync('docker', ['volume', 'rm', volume], { stdio: 'ignore', windowsHide: true, timeout: 15_000 });
}
