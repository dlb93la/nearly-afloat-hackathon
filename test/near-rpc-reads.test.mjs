import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createRpcReadPool, rpcView, RpcReadBackoff } from '../near-rpc-reads.mjs';
import { loadNearExpeditions } from '../near-expeditions.mjs';

test('five viewers share public RPC work while mutable account values stay uncached and separate', async t => {
  let campaignCalls = 0, accountCalls = 0;
  let status = 'funding', balance = 1000;
  const rpc = createServer(async (request, response) => {
    let body = ''; for await (const part of request) body += part;
    const { id, params } = JSON.parse(body);
    const args = JSON.parse(Buffer.from(params.args_base64, 'base64').toString());
    let value;
    if (params.method_name === 'campaign') {
      campaignCalls++;
      value = { id: 1, status, item_type: 'pet-expedition-parrot', target: 3000, funded: 1000 };
    } else {
      accountCalls++;
      value = { registered: true, balance: balance + Number(args.player[1]), contribution: Number(args.player[1]) * 100 };
    }
    await delay(15);
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id,
      result: { result: [...Buffer.from(JSON.stringify(value))], logs: [] } }));
  });
  rpc.listen(0, '127.0.0.1'); await once(rpc, 'listening');
  t.after(() => new Promise(resolve => rpc.close(resolve)));
  const bridge = loadNearExpeditions({ BARREL_EXPEDITIONS_CONTRACT: 'voyage.testnet',
    BARREL_EXPEDITIONS_RPC: 'http://127.0.0.1:' + rpc.address().port });
  const viewers = Array.from({ length: 5 }, (_, i) => 'p' + i + '.testnet');
  const first = await Promise.all(viewers.map(player => bridge.read(player)));
  assert.equal(campaignCalls, 1);
  assert.equal(accountCalls, 5);
  for (let i = 0; i < 5; i++) {
    assert.equal(first[i].gold, 1000 + i);
    assert.equal(first[i].campaign.myContribution, i * 100);
  }
  balance = 2000;
  assert.equal((await bridge.read(viewers[0])).gold, 2000, 'balances are never served from the public cache');
  assert.equal(campaignCalls, 1);
  status = 'auction';
  assert.equal((await bridge.read(viewers[0], { fresh: true })).campaign.status, 'auction',
    'finalized actions bypass a previously cached campaign');
  assert.equal(campaignCalls, 2);
});

test('429 cooldown is shared across different reads and automatically recovers without login or a retry storm', async () => {
  let clock = 0, calls = 0;
  const pool = createRpcReadPool({ now: () => clock });
  await assert.rejects(pool.read('arena', 'campaign', async () => {
    calls++;
    throw Object.assign(new Error('rate limit exceeded, retry after 55s'), { cause: 429 });
  }), error => error instanceof RpcReadBackoff && error.retryAfterMs === 55_000);
  await Promise.all(Array.from({ length: 5 }, (_, i) => assert.rejects(pool.read('arena', 'account:' + i,
    async () => { calls++; return i; }), RpcReadBackoff)));
  assert.equal(calls, 1, 'polling while throttled must not contact the upstream provider');
  clock = 55_001;
  assert.equal(await pool.read('arena', 'campaign', async () => { calls++; return 'auction'; }), 'auction');
  assert.equal(calls, 2);
});

test('bounded read concurrency does not reuse an older in-flight snapshot after confirmed mutation', async () => {
  const pool = createRpcReadPool({ concurrency: 2 });
  let running = 0, peak = 0;
  const values = await Promise.all(Array.from({ length: 8 }, (_, i) => pool.read('arena', String(i), async () => {
    running++; peak = Math.max(peak, running); await delay(5); running--; return i;
  })));
  assert.equal(peak, 2);
  assert.deepEqual(values, Array.from({ length: 8 }, (_, i) => i));
  let release;
  const older = pool.read('arena', 'campaign', () => new Promise(resolve => { release = resolve; }), { ttl: 2000 });
  await delay(0);
  const fresh = pool.read('arena', 'campaign', async () => ({ status: 'settled' }), { ttl: 2000, fresh: true });
  assert.equal((await fresh).status, 'settled');
  release({ status: 'auction' }); await older;
  assert.equal((await pool.read('arena', 'campaign', async () => assert.fail('fresh cache missing'), { ttl: 2000 })).status, 'settled',
    'an old response cannot replace the post-confirmation snapshot');
});

test('real HTTP read transport respects Retry-After and aborts a stalled read without occupying its worker forever', async t => {
  let calls = 0;
  const rpc = createServer(async (request, response) => {
    let body = ''; for await (const part of request) body += part;
    const { id, params } = JSON.parse(body);
    calls++;
    if (params.method_name === 'throttled') {
      response.writeHead(429, { 'Retry-After': '2' }).end('Too many requests');
      return;
    }
    if (params.method_name === 'stalled') return;
    assert.equal(params.block_id, 'fixed-final-block');
    assert.equal(params.finality, undefined);
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id,
      result: { result: [...Buffer.from(JSON.stringify({ balance: 700 }))] } }));
  });
  rpc.listen(0, '127.0.0.1'); await once(rpc, 'listening');
  t.after(() => { rpc.closeAllConnections(); return new Promise(resolve => rpc.close(resolve)); });
  const url = 'http://127.0.0.1:' + rpc.address().port;
  const throttled = { connection: { url: url + '/quota' } };
  await assert.rejects(rpcView(throttled, 'arena', 'throttled'),
    error => error instanceof RpcReadBackoff && error.retryAfterMs === 2000);
  await assert.rejects(rpcView(throttled, 'arena', 'account'), RpcReadBackoff);
  assert.equal(calls, 1, 'Retry-After also prevents a different method from contacting the throttled endpoint');
  const healthy = { connection: { url: url + '/other-endpoint' } };
  await assert.rejects(rpcView(healthy, 'arena', 'stalled', {}, { timeoutMs: 30 }), /aborted|timeout/i);
  assert.deepEqual(await rpcView(healthy, 'arena', 'account', { player: 'one.testnet' },
    { blockQuery: { blockId: 'fixed-final-block' } }), { balance: 700 });
});
