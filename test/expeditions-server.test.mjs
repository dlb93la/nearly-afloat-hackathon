import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { on, once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { openEconomy } from '../economy.mjs';
import { EXPEDITION_ITEM } from '../shared/cosmetics.mjs';

async function next(socket, predicate, send = () => {}) {
  const messages = on(socket, 'message', { signal: AbortSignal.timeout(15_000) });
  try {
    send();
    for await (const [bytes] of messages) {
      const message = JSON.parse(bytes);
      assert.notEqual(message.type, 'error', message.message);
      if (predicate(message)) return message;
    }
  } finally {
    await messages.return();
  }
}

test('Expeditions broadcasts the same voyage to four profiles and equips the settled cargo', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'barrel-expeditions-'));
  const db = join(directory, 'expeditions.sqlite');
  const economy = openEconomy(db, Date.now, { expedition: { sailingMs: 800, auctionMs: 4_000 } });
  economy.openExpedition();
  economy.close();

  const env = { ...process.env, HOST: '127.0.0.1', PORT: '0', BARREL_DB: db };
  for (const key of Object.keys(env)) {
    if (key.startsWith('BARREL_NEAR_') || key.startsWith('BARREL_EXPEDITIONS_')) delete env[key];
  }
  const server = spawn(process.execPath, ['--experimental-sqlite', fileURLToPath(new URL('../server.mjs', import.meta.url))],
    { env, windowsHide: true });
  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    if (server.exitCode === null && server.signalCode === null) {
      const stopped = once(server, 'exit');
      server.kill();
      await stopped;
    }
    await rm(directory, { recursive: true, force: true });
  });
  const output = createInterface({ input: server.stdout });
  const [line] = await once(output, 'line', { signal: AbortSignal.timeout(20_000) });
  const base = new URL(line.match(/https?:\/\/\S+/)[0]);
  const address = new URL('/arena', base);
  address.protocol = 'ws:';
  const wallet = message => message.type === 'wallet';
  const clients = await Promise.all(Array.from({ length: 4 }, async () => {
    const session = await fetch(new URL('/playtest-session', base));
    const cookie = session.headers.get('set-cookie').split(';')[0];
    const socket = new WebSocket(address, { headers: { cookie } });
    sockets.push(socket);
    return { socket, initial: await next(socket, wallet) };
  }));
  const [first, second, buyer, winner] = clients;
  const campaignId = first.initial.expeditions.id;
  assert.ok(clients.every(client => client.initial.expeditions.id === campaignId));
  const send = (client, type, fields = {}) => client.socket.send(JSON.stringify({ type, ...fields }));
  const action = (client, name, amount) => {
    const actionId = randomUUID();
    return next(client.socket, message => message.type === 'expedition-result' && message.actionId === actionId,
      () => send(client, 'expedition-' + name, { actionId, campaignId, amount }));
  };
  const funding = next(buyer.socket, message => wallet(message) && message.expeditions.funded === 600);
  assert.equal((await action(first, 'contribute', 600)).ok, true);
  assert.equal((await funding).expeditions.myContribution, 0);
  const sailing = next(buyer.socket, message => wallet(message) && message.expeditions.status === 'sailing');
  const auction = next(winner.socket, message => wallet(message) && message.expeditions.status === 'auction');
  assert.equal((await action(second, 'contribute', 2_400)).ok, true);
  assert.equal((await sailing).expeditions.supporters, 2);
  await auction;
  assert.equal((await action(buyer, 'bid', 1_000)).ok, true);
  const release = next(buyer.socket, message => wallet(message) && message.expeditions.highestBid === 2_000);
  assert.equal((await action(winner, 'bid', 2_000)).ok, true);
  assert.equal((await release).gold, buyer.initial.gold);

  const results = await Promise.all(clients.map(client => next(client.socket,
    message => wallet(message) && message.expeditions.status === 'settled')));
  assert.deepEqual(results.map(state => state.expeditions.myPayout), [380, 1_520, 0, 0]);
  assert.equal(results[3].gold, winner.initial.gold - 2_000);
  const [pet] = results[3].workshop.inventory.filter(item => item.type === EXPEDITION_ITEM);
  assert.ok(pet);
  const equipped = await next(winner.socket, wallet, () => send(winner, 'gear-style', { id: pet.id, slot: 'pet' }));
  assert.equal(equipped.workshop.appearance.pet, EXPEDITION_ITEM);
});

test('slow on-chain views still publish funding and auction updates while new polls arrive', { timeout: 15_000 }, async t => {
  const fixture = 'data:text/javascript,' + encodeURIComponent(`
    import { registerHooks } from 'node:module';
    registerHooks({ load(url, context, next) {
      if (url.endsWith('/near-arena.mjs')) return { format:'module',shortCircuit:true,source:
        "export const nearRoundId=()=> '1'; export const loadNearArena=()=>({contract:'fixture.testnet',hasWorkshop:true});" };
      if (url.endsWith('/near-expeditions.mjs')) return { format:'module',shortCircuit:true,source:
        "let count=0; export const loadNearExpeditions=()=>({contract:'fixture.testnet',unified:true,async read(account){const n=++count;await new Promise(r=>setTimeout(r,110));return {account,campaign:{id:'fixture/1',status:n===1?'funding':'auction',highestBid:n*100,won:false}};}});" };
      return next(url,context);
    }});
  `);
  const directory = await mkdtemp(join(tmpdir(), 'afloat-expedition-poll-'));
  const child = spawn(process.execPath, ['--experimental-sqlite', '--import', fixture,
    fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, NODE_ENV: 'test', PORT: '0', HOST: '127.0.0.1', BARREL_DB: join(directory, 'test.sqlite') }, windowsHide: true,
  });
  let socket, poll;
  t.after(async () => {
    clearInterval(poll); socket?.terminate();
    if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; }
    await rm(directory, { recursive: true, force: true });
  });
  const output = createInterface({ input: child.stdout });
  const [line] = await once(output, 'line', { signal: AbortSignal.timeout(10_000) });
  const base = line.match(/https?:\/\/\S+/)[0];
  const profile = await fetch(base + 'playtest-session');
  socket = new WebSocket(base.replace('http:', 'ws:') + 'arena', { headers: { Cookie: profile.headers.get('set-cookie').split(';')[0] } });
  await once(socket, 'open');
  const states = [];
  socket.on('message', bytes => { const message=JSON.parse(bytes); if(message.type==='expedition-chain-view')states.push(message); });
  const request = () => socket.send(JSON.stringify({ type: 'expedition-chain-view' }));
  const auction = next(socket, message => message.type === 'expedition-chain-view' && message.campaign.status === 'auction');
  poll = setInterval(request, 35);
  request();
  await auction;
  assert.equal(states[0].campaign.status, 'funding');
  assert.ok(states.length >= 2, 'successful earlier responses must not be cancelled by later polls');
});
