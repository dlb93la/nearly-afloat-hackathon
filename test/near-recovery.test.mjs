import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { on, once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { openEconomy } from '../economy.mjs';

// Keep the chain separate from the server process. The RPC acknowledgement never
// reaches that process, but the next process can still see the finalized reservation.
const fakeChain = 'data:text/javascript,' + encodeURIComponent(`
  import { registerHooks } from 'node:module';
  registerHooks({
    load(url, context, nextLoad) {
      if (!url.endsWith('/near-arena.mjs')) return nextLoad(url, context);
      return { format: 'module', shortCircuit: true, source: \`
        import { readFileSync, writeFileSync } from 'node:fs';
        const file = process.env.BARREL_RECOVERY_FIXTURE;
        const sessionFile = process.env.BARREL_SESSION_FIXTURE;
        let nextId = 42;
        export const nearRoundId = () => sessionFile ? String(nextId++) : '42';
        export const loadNearArena = () => ({
          contract: 'fixture.testnet',
          sessions: Boolean(sessionFile),
          hasWorkshop: Boolean(sessionFile),
          hasStarter: Boolean(sessionFile),
          hasCollection: Boolean(sessionFile),
          logbook: async () => [{ event: 'workshop_action' }],
          workshop: async (_account, hash) => ({ workshop: { gold: 9280, equipped: 'iron' },
            transactionStatus: 'finalized', transactionHash: hash }),
          challenge: () => ({}),
          authenticate: async () => 'player.testnet',
          balance: async () => 10000,
          consent: async (_player, id) => {
            if (process.env.BARREL_ENTRY_FIXTURE) {
              const entry = JSON.parse(readFileSync(process.env.BARREL_ENTRY_FIXTURE, 'utf8'));
              return entry.id === id ? entry.expires : null;
            }
            return Date.now() + 90000;
          },
          async entrySession(player, scope) {
            const pass = JSON.parse(readFileSync(sessionFile, 'utf8'));
            return pass.player === player && pass.scope === scope && pass.remaining > 0 &&
              pass.expires_at > Date.now() ? pass : null;
          },
          async reserve(id, players, slots, session) {
            if (sessionFile) {
              const pass = JSON.parse(readFileSync(sessionFile, 'utf8'));
              if (session.scope !== pass.scope || session.players.join(',') !== pass.player ||
                players.join(',') !== pass.player || pass.remaining <= 0) throw new Error('Invalid pass reservation');
              pass.remaining--;
              pass.reserved = id;
              writeFileSync(sessionFile, JSON.stringify(pass));
              await new Promise(resolve => setTimeout(resolve, 180));
              return {
                round: { status: 'reserved', players, bots: slots - players.length,
                  expires_at: Date.now() + 90000, pot: 960, fee: 240, bonus: 200 },
                rigs: { [pass.player]: 'iron' }, awards: { [pass.player]: 'pet-expedition-parrot' },
              };
            }
            writeFileSync(file, JSON.stringify({ id, status: 'reserved' }));
            await new Promise(() => {});
          },
          async finish(id, { action }) {
            const round = JSON.parse(readFileSync(file, 'utf8'));
            if (round.id !== id || round.status !== 'reserved' || action !== 'cancel') {
              throw new Error('Unexpected recovery call');
            }
            round.status = 'cancelled';
            writeFileSync(file, JSON.stringify(round));
            return { round };
          },
        });
      \` };
    },
  });
`);
const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));
const startupTimeout = 20_000;
const socketTimeout = 8_000;

async function serverUrl(child, phase) {
  const output = createInterface({ input: child.stdout });
  try {
    const [line] = await once(output, 'line', { signal: AbortSignal.timeout(startupTimeout) });
    const url = line.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    assert.ok(url, line);
    return url;
  } catch (error) {
    throw new Error('Could not read the ' + phase + ' server address', { cause: error });
  } finally {
    output.close();
  }
}

async function exchange(socket, message, accepts) {
  const replies = on(socket, 'message', { signal: AbortSignal.timeout(socketTimeout) });
  socket.send(JSON.stringify(message));
  for await (const [bytes] of replies) {
    const reply = JSON.parse(bytes);
    assert.notEqual(reply.type, 'error', reply.message);
    if (accepts(reply)) return reply;
  }
}

async function until(condition, message, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (condition()) return;
    await delay(30);
  }
  assert.fail(message);
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
}

test('restarting refunds a finalized NEAR reservation before its round expires', { timeout: 65_000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'barrel-near-recovery-'));
  const database = join(directory, 'ledger.sqlite');
  const fixture = join(directory, 'round.json');
  const children = [];
  t.after(async () => {
    await Promise.all(children.map(stop));
    for (const path of [fixture, database, database + '-wal', database + '-shm']) rmSync(path, { force: true });
    rmdirSync(directory);
  });

  async function start(phase) {
    const child = spawn(process.execPath, ['--experimental-sqlite', '--import', fakeChain, serverPath], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: '0', BARREL_DB: database, BARREL_RECOVERY_FIXTURE: fixture },
      stdio: ['ignore', 'pipe', 'inherit'],
      windowsHide: true,
    });
    children.push(child);
    return { child, url: await serverUrl(child, phase) };
  }

  const { child, url } = await start('initial');
  const session = await fetch(url + '/playtest-session');
  assert.equal(session.status, 204);
  const cookie = session.headers.get('set-cookie').split(';')[0];
  const socket = new WebSocket(url.replace('http:', 'ws:') + '/arena', { headers: { cookie }, origin: url });
  try {
    await once(socket, 'open', { signal: AbortSignal.timeout(socketTimeout) });
    await exchange(socket, { type: 'near-challenge' }, reply => reply.type === 'near-challenge');
    await exchange(socket, { type: 'near-auth' }, reply => reply.type === 'near-wallet');
    const room = await exchange(socket, { type: 'create-near' }, reply => reply.type === 'state');
    const id = room.stake.chainId;
    await exchange(socket, { type: 'near-ready', id, ready: true }, reply => reply.stake?.ready.length === 1);
    await exchange(socket, { type: 'start', slots: 6 }, reply => reply.stake?.processing);
    const reserved = JSON.stringify({ id, status: 'reserved' });
    await until(() => existsSync(fixture) && readFileSync(fixture, 'utf8') === reserved,
      'The simulated chain never recorded the reservation', socketTimeout);
    await stop(child);
    assert.deepEqual(JSON.parse(readFileSync(fixture, 'utf8')), { id, status: 'reserved' });
  } finally {
    socket.terminate();
  }

  const ledger = openEconomy(database);
  try {
    const [[id, intent]] = ledger.nearRounds();
    assert.deepEqual([id, intent.action, intent.contract], ['42', 'cancel', 'fixture.testnet']);
    // stop() waits for the first process to exit before the second opens SQLite.
    await start('restarted');
    await until(() => ledger.nearRounds().length === 0, 'The restarted server left the reservation pending', 12_000);
    assert.deepEqual(JSON.parse(readFileSync(fixture, 'utf8')), { id, status: 'cancelled' });
  } finally {
    ledger.close();
  }
});

test('rejoining checks the finalized NEAR entry without signing again and waits for an undo', { timeout: 40_000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'barrel-near-entry-'));
  const database = join(directory, 'ledger.sqlite');
  const fixture = join(directory, 'entry.json');
  writeFileSync(fixture, '{}');
  const child = spawn(process.execPath, ['--experimental-sqlite', '--import', fakeChain, serverPath], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', BARREL_DB: database, BARREL_ENTRY_FIXTURE: fixture },
    stdio: ['ignore', 'pipe', 'inherit'],
    windowsHide: true,
  });
  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    await stop(child);
    for (const path of [fixture, database, database + '-wal', database + '-shm']) rmSync(path, { force: true });
    rmdirSync(directory);
  });
  const url = await serverUrl(child, 'entry');
  const session = await fetch(url + '/playtest-session');
  const cookie = session.headers.get('set-cookie').split(';')[0];
  async function connect() {
    const socket = new WebSocket(url.replace('http:', 'ws:') + '/arena', { headers: { cookie }, origin: url });
    sockets.push(socket);
    await once(socket, 'open', { signal: AbortSignal.timeout(socketTimeout) });
    return socket;
  }
  let socket = await connect();
  await exchange(socket, { type: 'near-challenge' }, reply => reply.type === 'near-challenge');
  await exchange(socket, { type: 'near-auth' }, reply => reply.type === 'near-wallet');
  const welcome = once(socket, 'message', { signal: AbortSignal.timeout(socketTimeout) });
  const room = await exchange(socket, { type: 'create-near' }, reply => reply.type === 'state');
  const [bytes] = await welcome;
  const { code, resumeToken, id: memberId } = JSON.parse(bytes);
  const id = room.stake.chainId;
  const check = ready => exchange(socket, { type: 'near-ready', id, ready, check: true },
    reply => reply.type === 'near-entry-status' && reply.id === id && reply.ready === ready);
  assert.equal((await check(true)).confirmed, false);

  const closed = once(socket, 'close', { signal: AbortSignal.timeout(socketTimeout) });
  socket.close();
  await closed;
  writeFileSync(fixture, JSON.stringify({ id, expires: Date.now() + 90_000 }));
  socket = await connect();
  let current;
  socket.on('message', bytes => {
    const message = JSON.parse(bytes);
    if (message.type === 'state') current = message;
  });
  await exchange(socket, { type: 'join', code, resumeToken }, reply => reply.type === 'state');
  assert.equal((await check(true)).confirmed, true);
  await until(() => current?.stake.ready.includes(memberId), 'The finalized entry never reached the lobby', 1000);

  assert.equal((await check(false)).confirmed, false);
  assert.deepEqual(current.stake.ready, []);
  writeFileSync(fixture, '{}');
  assert.equal((await check(false)).confirmed, true);
  assert.deepEqual(current.stake.ready, []);
});

test('a bounded room pass can be armed and disarmed, then consumed by reservation', { timeout: 40_000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'barrel-near-pass-'));
  const database = join(directory, 'ledger.sqlite');
  const fixture = join(directory, 'pass.json');
  writeFileSync(fixture, '{}');
  const child = spawn(process.execPath, ['--experimental-sqlite', '--import', fakeChain, serverPath], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', BARREL_DB: database, BARREL_SESSION_FIXTURE: fixture, BARREL_NEAR_VOYAGE: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
    windowsHide: true,
  });
  let socket;
  t.after(async () => {
    socket?.terminate();
    await stop(child);
    for (const path of [fixture, database, database + '-wal', database + '-shm']) rmSync(path, { force: true });
    rmdirSync(directory);
  });
  const url = await serverUrl(child, 'room pass');
  const session = await fetch(url + '/playtest-session');
  const cookie = session.headers.get('set-cookie').split(';')[0];
  socket = new WebSocket(url.replace('http:', 'ws:') + '/arena', { headers: { cookie }, origin: url });
  await once(socket, 'open', { signal: AbortSignal.timeout(socketTimeout) });
  await exchange(socket, { type: 'near-challenge' }, reply => reply.type === 'near-challenge');
  await exchange(socket, { type: 'near-auth' }, reply => reply.type === 'near-wallet');
  const localWrite = once(socket, 'message', { signal: AbortSignal.timeout(socketTimeout) });
  socket.send(JSON.stringify({ type: 'create-stakes' }));
  const [rejected] = await localWrite;
  assert.match(JSON.parse(rejected).message, /Use the NEAR economy/);
  const hash = '1'.repeat(44);
  const workshop = await exchange(socket, { type: 'near-workshop-view', account: 'player.testnet', transactionHash: hash },
    reply => reply.type === 'near-workshop');
  assert.equal(workshop.workshop.equipped, 'iron');
  assert.equal(workshop.transactionStatus, 'finalized');
  const log = await exchange(socket, { type: 'near-logbook-view' }, reply => reply.type === 'near-logbook');
  assert.equal(log.entries[0].event, 'workshop_action');
  assert.equal(log.receipts[0].hash, hash);
  const lobby = await exchange(socket, { type: 'create-near' }, reply => reply.type === 'state');
  const { sessionScope: scope, chainId: id } = lobby.stake;
  assert.ok(scope && scope !== id);
  const inspect = () => exchange(socket, { type: 'near-session-check', scope }, reply => reply.type === 'near-session-status');
  assert.equal((await inspect()).session, null);
  const pass = { player: 'player.testnet', scope, remaining: 3, expires_at: Date.now() + 600_000 };
  writeFileSync(fixture, JSON.stringify(pass));
  assert.equal((await inspect()).session.remaining, 3);
  const ready = value => exchange(socket, { type: 'near-session-ready', id, ready: value },
    reply => reply.type === 'state' && reply.stake.sessionReady.length === Number(value));
  await ready(true);
  await ready(false);
  assert.equal((await inspect()).session.remaining, 3);
  await ready(true);
  const updates = on(socket, 'message', { signal: AbortSignal.timeout(socketTimeout) });
  socket.send(JSON.stringify({ type: 'start', slots: 6 }));
  let immediate;
  let confirmed;
  for await (const [bytes] of updates) {
    const reply = JSON.parse(bytes);
    if (reply.type !== 'state') continue;
    assert.notEqual(reply.phase, 'preparing', 'chain receipts must never block the match countdown');
    if (reply.phase !== 'countdown') continue;
    immediate ??= reply;
    if (reply.stake.round?.status !== 'reserved') continue;
    confirmed = reply;
    break;
  }
  assert.equal(immediate.stake.processing, true);
  assert.equal(immediate.stake.round.status, 'pending');
  assert.equal(immediate.match.seconds, 3, 'the complete countdown starts before the reservation receipt');
  assert.equal(confirmed.stake.round.status, 'reserved');
  assert.ok(confirmed.match.seconds < immediate.match.seconds, 'the countdown progresses while the reservation is pending');
  const human = immediate.match.players.find(player => !player.bot);
  assert.equal(human.rig, 'iron');
  assert.equal(human.appearance.pet, undefined, 'late reserve metadata cannot change a running match loadout');
  assert.deepEqual(confirmed.match.players.find(player => !player.bot).appearance, human.appearance);
  assert.equal(immediate.stake.sessionScope, scope);
  assert.notEqual(immediate.stake.chainId, id);
  assert.deepEqual(immediate.stake.sessionReady, []);
  assert.equal((await inspect()).session.remaining, 2);
  assert.equal(JSON.parse(readFileSync(fixture, 'utf8')).reserved, id);
});
