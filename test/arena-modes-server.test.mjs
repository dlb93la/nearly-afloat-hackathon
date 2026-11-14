import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once, on } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { WebSocket } from 'ws';

async function next(socket, predicate, action = () => {}) {
  const messages = on(socket, 'message', { signal: AbortSignal.timeout(10_000) });
  try {
    action();
    for await (const [bytes] of messages) {
      const message = JSON.parse(bytes);
      if (predicate(message)) return message;
      assert.notEqual(message.type, 'error', message.message);
    }
  } finally { await messages.return(); }
}

test('first completed match unlocks one starter in every mode; later free games grant no extra rewards', { timeout: 20_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'afloat-arena-modes-'));
  const simulation = new URL('../shared/simulation.mjs', import.meta.url).href;
  const fixture = join(directory, 'fast-rounds.mjs');
  // Only speed up round completion. Real server routing, economy, room rosters,
  // tutorial eligibility and actual map selection all run unmodified.
  const source = `export * from ${JSON.stringify(simulation + '?real')};
    import { stepMatch as realStep } from ${JSON.stringify(simulation + '?real')};
    export function stepMatch(match, dt, inputs) {
      realStep(match, dt, inputs);
      if (match.tick === 5 && !match.inaugural) {
        match.phase = 'playing'; match.countdown = 0;
        match.players[0].alive = false;
      }
      if (match.tick >= (match.inaugural ? 5 : 30)) {
        match.phase = 'results'; match.countdown = 0; match.winnerId = match.players[1].id;
        for (const player of match.players) player.alive = player.id === match.winnerId;
      }
    }`;
  await writeFile(fixture, `import { registerHooks } from 'node:module';
    registerHooks({load(url, context, nextLoad) {
      if (url === ${JSON.stringify(simulation)}) return { format: 'module', shortCircuit: true, source: ${JSON.stringify(source)} };
      return nextLoad(url, context);
    }});`);
  const env = { ...process.env, HOST: '127.0.0.1', PORT: '0', BARREL_DB: ':memory:' };
  for (const key of Object.keys(env)) if (key.startsWith('BARREL_NEAR_') || key.startsWith('BARREL_EXPEDITIONS_')) delete env[key];
  const server = spawn(process.execPath, ['--experimental-sqlite', '--import', pathToFileURL(fixture).href,
    fileURLToPath(new URL('../server.mjs', import.meta.url))], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] });
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.terminate();
    if (server.exitCode === null && server.signalCode === null) { const ended = once(server, 'exit'); server.kill(); await ended; }
    await rm(directory, { recursive: true, force: true });
  });
  const lines = createInterface({ input: server.stdout });
  const [line] = await once(lines, 'line', { signal: AbortSignal.timeout(6000) });
  lines.close();
  const base = line.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  async function connect() {
    const response = await fetch(base + '/playtest-session');
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const socket = new WebSocket(base.replace('http:', 'ws:') + '/arena', { headers: { Cookie: cookie } });
    clients.push(socket);
    const initial = next(socket, m => m.type === 'wallet');
    await once(socket, 'open');
    return { socket, wallet: await initial };
  }
  const one = await connect(), two = await connect();
  const send = (client, type, extra = {}) => client.socket.send(JSON.stringify({ type, name: 'Test pirate', ...extra }));
  const state = (client, action, predicate = m => m.phase === 'countdown') => next(client.socket,
    m => m.type === 'state' && predicate(m), action);
  const wallet = client => next(client.socket, m => m.type === 'wallet', () => send(client, 'gear-refresh'));

  const training = await state(one, () => send(one, 'practice'));
  assert.equal(training.kind, 'practice');
  assert.equal(training.match.inaugural, false);
  assert.equal(training.stake, null);
  assert.equal(training.roster.filter(p => p.bot).length, 7);
  const soloError = await next(two.socket, m => m.type === 'error', () => send(two, 'join', { code: training.code }));
  assert.match(soloError.message, /solo training/);
  await state(one, () => send(one, 'training-speed'), m => m.phase === 'playing');
  const faster = await state(one, () => send(one, 'training-speed'), m => m.trainingSpeed === 3);
  const accelerated = await state(one, () => {}, m => m.phase === 'playing' && m.match.tick > faster.match.tick);
  assert.equal((accelerated.match.tick - faster.match.tick) % 3, 0);
  await state(one, () => {}, m => m.phase === 'results');
  const firstReward = await wallet(one);
  assert.deepEqual(firstReward, { ...one.wallet, firstBrawl: { status: 'ready' } });
  const again = await state(one, () => send(one, 'practice'));
  assert.equal(again.trainingSpeed, undefined);
  assert.notEqual(again.match.arenaMap, training.match.arenaMap);
  await state(one, () => {}, m => m.phase === 'results');

  const queue = await state(one, () => send(one, 'find-fun'), m => m.phase === 'lobby');
  assert.equal(queue.kind, 'fun');
  assert.ok(queue.startsAt > Date.now());
  const joined = await state(two, () => send(two, 'find-fun'), m => m.phase === 'lobby');
  assert.equal(joined.code, queue.code);
  const free = await state(one, () => {}, m => m.phase === 'countdown');
  assert.equal(free.roster.filter(p => !p.bot).length, 2);
  assert.equal(free.roster.filter(p => p.bot).length, 6);
  assert.equal(free.stake, null);
  await state(one, () => {}, m => m.phase === 'results');
  assert.deepEqual(await wallet(one), firstReward);
  assert.deepEqual(await wallet(two), { ...two.wallet, firstBrawl: { status: 'ready' } });

  const friends = await state(one, () => send(one, 'create'), m => m.phase === 'lobby');
  await state(two, () => send(two, 'join', { code: friends.code }), m => m.phase === 'lobby');
  const friendRound = await state(one, () => send(one, 'start'));
  assert.equal(friendRound.kind, 'room');
  assert.equal(friendRound.match.inaugural, false);
  assert.equal(friendRound.stake, null);
  await state(one, () => {}, m => m.phase === 'results');
  assert.deepEqual(await wallet(one), firstReward);

  const tutorial = await state(one, () => send(one, 'tutorial'));
  assert.equal(tutorial.kind, 'practice');
  assert.equal(tutorial.match.inaugural, false);
  assert.equal((await wallet(one)).gold, one.wallet.gold);
  const ready = await state(one, () => send(one, 'tutorial'));
  assert.equal(ready.kind, 'practice');
  assert.equal(ready.match.inaugural, false);
  await state(one, () => {}, m => m.phase === 'results');
  const claimed = await next(one.socket, m => m.type === 'wallet' && m.firstBrawl?.status === 'claimed', () => {
    send(one, 'leave'); send(one, 'first-brawl-claim', { rig: 'iron' });
  });
  assert.equal(claimed.workshop.inventory.length, 1);
  const paidError = await next(one.socket, m => m.type === 'error', () => send(one, 'create-near'));
  assert.match(paidError.message, /Sign in to open this room/);
  const normal = await state(one, () => send(one, 'practice'));
  assert.equal(normal.match.inaugural, false);
  await state(one, () => {}, m => m.phase === 'results');
  const after = await wallet(one);
  assert.equal(after.gold, claimed.gold);
  assert.deepEqual(after.workshop.inventory, claimed.workshop.inventory, 'training must neither wear nor mint gear');
  assert.equal(after.firstBrawl.status, 'claimed');
});
