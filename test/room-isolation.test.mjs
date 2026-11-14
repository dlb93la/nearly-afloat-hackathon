import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once, on } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';

test('a paid victory waiting indefinitely for settlement does not stop a different room', { timeout: 16000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'afloat-isolation-'));
  const real = new URL('../shared/simulation.mjs', import.meta.url).href;
  const sim = `export * from ${JSON.stringify(real + '?real')}; import {createMatch as create,stepMatch as step} from ${JSON.stringify(real + '?real')};
    export function createMatch(roster,...args){const m=create(roster,...args);m.endProof=roster.some(p=>p.nearAccount);return m;}
    export function stepMatch(m,dt,inputs){step(m,dt,inputs);if(m.endProof&&m.tick>=105){m.phase='results';m.winnerId=m.players[0].id;for(const[i,p]of m.players.entries()){p.rank=i+1;p.alive=i===0;}}}`;
  const near = `export const nearRoundId=()=> '42'; export const loadNearArena=()=>({contract:'isolation.testnet',receiptNetwork:'testnet',
    challenge:()=>({}),authenticate:async()=> 'player.testnet',balance:async()=>10000,consent:async()=>Date.now()+90000,
    reserve:async(id,players,slots)=>({round:{status:'reserved',players,bots:slots-players.length,expires_at:Date.now()+90000,pot:960,fee:240,bonus:200}}),
    finish:async()=>new Promise(()=>{})});`;
  const hook = join(dir, 'hook.mjs');
  await writeFile(hook, `import{registerHooks}from'node:module';registerHooks({load(url,c,next){
    if(url===${JSON.stringify(real)})return{format:'module',shortCircuit:true,source:${JSON.stringify(sim)}};
    if(url.endsWith('/near-arena.mjs'))return{format:'module',shortCircuit:true,source:${JSON.stringify(near)}};return next(url,c);}});`);
  const env = { ...process.env, HOST: '127.0.0.1', PORT: '0', BARREL_DB: join(dir, 'economy.sqlite') };
  for (const k of Object.keys(env)) if (/^BARREL_NEAR_|^BARREL_EXPEDITIONS_|^AFLOAT_JUDGES_/.test(k)) delete env[k];
  const child = spawn(process.execPath, ['--experimental-sqlite', '--import', pathToFileURL(hook).href,
    fileURLToPath(new URL('../server.mjs', import.meta.url))], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] });
  const sockets = [];
  t.after(async () => { sockets.forEach(s => s.terminate()); if (child.exitCode === null) { const end = once(child, 'exit'); child.kill(); await end; } await rm(dir, { recursive: true, force: true }); });
  const lines = createInterface({ input: child.stdout });
  const [line] = await once(lines, 'line', { signal: AbortSignal.timeout(6000) }); lines.close();
  const url = line.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  async function connect() {
    const r = await fetch(url + '/playtest-session'); const cookie = r.headers.get('set-cookie').split(';')[0];
    const s = new WebSocket(url.replace('http:', 'ws:') + '/arena', { headers: { cookie }, origin: url }); sockets.push(s); await once(s, 'open'); return s;
  }
  async function exchange(s, input, predicate) {
    const replies = on(s, 'message', { signal: AbortSignal.timeout(8000) });
    try { s.send(JSON.stringify(input)); for await (const [bytes] of replies) { const m = JSON.parse(bytes); assert.notEqual(m.type, 'error', m.message); if (predicate(m)) return m; } }
    finally { await replies.return(); }
  }
  const paid = await connect(), other = await connect();
  await exchange(paid, { type: 'near-challenge' }, m => m.type === 'near-challenge');
  await exchange(paid, { type: 'near-auth' }, m => m.type === 'near-wallet');
  const lobby = await exchange(paid, { type: 'create-near' }, m => m.type === 'state');
  await exchange(paid, { type: 'near-ready', id: lobby.stake.chainId, ready: true }, m => m.stake?.ready?.length === 1);
  await exchange(other, { type: 'practice' }, m => m.type === 'state');
  const samples = []; let resultAt;
  other.on('message', bytes => { const m = JSON.parse(bytes); if (m.type === 'state' && m.match) samples.push({ at: performance.now(), tick: m.match.tick }); });
  paid.on('message', bytes => { const m = JSON.parse(bytes); if (m.phase === 'results') resultAt ??= performance.now(); });
  await exchange(paid, { type: 'start', slots: 6 }, m => m.phase === 'results' && m.stake.processing);
  await delay(1000);
  const after = samples.filter(s => s.at >= resultAt);
  assert.ok(after.length >= 8, 'other room continues publishing while the winning room awaits blockchain');
  assert.ok(after.at(-1).tick > after[0].tick + 15, 'other simulation advances independently');
  const gaps = after.slice(1).map((s, i) => s.at - after[i].at).sort((a, b) => a - b);
  assert.ok(gaps.at(-1) < 1000, 'settlement must not block another room for a second');
  t.diagnostic(JSON.stringify({ packetsAfterVictory: after.length, p95IntervalMs: Math.round(gaps[Math.floor(gaps.length * .95)]), maxIntervalMs: Math.round(gaps.at(-1)) }));
});
