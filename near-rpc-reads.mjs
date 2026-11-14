// Shared read pressure control. Transactions and confirmed balances never use a
// cached substitute; this only joins identical reads and briefly caches public views.
const endpoints = new Map();
const injected = new WeakMap();
let nextReadId = 0;

export class RpcReadBackoff extends Error {
  constructor(retryAfterMs) {
    super('The network is busy. Your account is still connected; updates will resume automatically.');
    this.name = 'RpcReadBackoff';
    this.retryAfterMs = Math.max(1, Math.ceil(retryAfterMs));
  }
}

export function isRpcReadBackoff(error) { return error instanceof RpcReadBackoff; }

function rateDelay(error) {
  if (error?.cause !== 429 && error?.status !== 429 && !/\b429\b|rate.?limit|too many requests/i.test(error?.message ?? '')) return 0;
  if (Number.isFinite(error.retryAfterMs)) return Math.min(120_000, Math.max(500, error.retryAfterMs));
  const match = String(error.message).match(/retry[\s_-]*after[^\d]{0,12}(\d+(?:\.\d+)?)\s*(ms|milliseconds?|seconds?|s)?/i);
  return match ? Math.min(120_000, Math.max(500, Number(match[1]) * (/^m/i.test(match[2] ?? '') ? 1 : 1000))) : 5000;
}

export function createRpcReadPool({ now = Date.now, concurrency = 3, cacheLimit = 256, queueLimit = 256 } = {}) {
  const pending = new Map(), cache = new Map(), revisions = new Map(), queue = [];
  let active = 0, blockedUntil = 0;
  function cooldown() { return Math.max(0, blockedUntil - now()); }
  function failure(error) {
    const delay = rateDelay(error);
    if (delay) blockedUntil = Math.max(blockedUntil, now() + delay);
    return delay ? new RpcReadBackoff(cooldown()) : error;
  }
  function pump() {
    while (queue.length && active < concurrency) {
      const entry = queue.shift();
      const blocked = cooldown();
      if (blocked) { pending.delete(entry.key); entry.reject(new RpcReadBackoff(blocked)); continue; }
      active++;
      Promise.resolve().then(entry.task).then(value => {
        if (entry.ttl && entry.revision === (revisions.get(entry.contract) ?? 0)) {
          cache.set(entry.key, { value, until: now() + entry.ttl });
          while (cache.size > cacheLimit) cache.delete(cache.keys().next().value);
        }
        entry.resolve(value);
      }, error => {
        entry.reject(failure(error));
      }).finally(() => { active--; pending.delete(entry.key); pump(); });
    }
  }
  function invalidate(contract) {
    revisions.set(contract, (revisions.get(contract) ?? 0) + 1);
    for (const [key, entry] of cache) if (key.startsWith(contract + '\0')) cache.delete(key);
  }
  function read(contract, key, task, { ttl = 0, fresh = false } = {}) {
    if (fresh) invalidate(contract);
    const revision = revisions.get(contract) ?? 0;
    const scoped = contract + '\0' + revision + '\0' + key;
    const saved = cache.get(scoped);
    if (saved && saved.until > now()) return Promise.resolve(structuredClone(saved.value));
    if (saved) cache.delete(scoped);
    const blocked = cooldown();
    if (blocked) return Promise.reject(new RpcReadBackoff(blocked));
    if (!pending.has(scoped)) {
      if (queue.length >= queueLimit) return Promise.reject(new RpcReadBackoff(1000));
      const promise = new Promise((resolve, reject) => queue.push({ key: scoped, contract, revision, task, ttl, resolve, reject }));
      pending.set(scoped, promise);
      pump();
    }
    return pending.get(scoped).then(value => structuredClone(value));
  }
  return { read, invalidate, cooldown, failure };
}

export function rpcReadPool(provider) {
  const url = provider.connection?.url;
  const stores = url ? endpoints : injected;
  const key = url || provider;
  if (!stores.has(key)) stores.set(key, createRpcReadPool());
  return stores.get(key);
}

async function readView(provider, contract, method, args, blockQuery, timeoutMs) {
  // The SDK does not expose a cancellation signal or Retry-After response header.
  // Keep the same final/block-pinned view protocol, with a bounded HTTP lifetime.
  if (!provider.connection?.url) return provider.callFunction({ contractId: contract, method, args, blockQuery });
  const params = { request_type: 'call_function', account_id: contract, method_name: method,
    args_base64: Buffer.from(args instanceof Uint8Array ? args : JSON.stringify(args)).toString('base64'),
    ...('blockId' in blockQuery ? { block_id: blockQuery.blockId } : { finality: blockQuery.finality }) };
  const headers = new Headers(provider.connection.headers);
  headers.set('Content-Type', 'application/json');
  const response = await fetch(provider.connection.url, { method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 'afloat-read-' + (++nextReadId), method: 'query', params }),
    signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    const error = Object.assign(new Error('RPC read HTTP ' + response.status + ': ' + (await response.text()).slice(0, 500)), { cause: response.status });
    const retry = response.headers.get('retry-after');
    if (retry) {
      const milliseconds = /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
      if (Number.isFinite(milliseconds)) error.retryAfterMs = Math.max(500, milliseconds);
    }
    throw error;
  }
  const rpc = await response.json();
  if (rpc.error || rpc.result?.error) throw new Error('RPC view failed: ' + JSON.stringify(rpc.error ?? rpc.result.error));
  const bytes = rpc.result?.result;
  if (!Array.isArray(bytes)) throw new Error('RPC view returned an invalid result');
  if (!bytes.length) return undefined;
  const text = Buffer.from(bytes).toString('utf8');
  try { return JSON.parse(text); } catch { return text; }
}

export function rpcView(provider, contract, method, args = {}, options = {}) {
  const { blockQuery = { finality: 'final' }, timeoutMs = 12_000, ...policy } = options;
  return rpcReadPool(provider).read(contract, JSON.stringify([method, args, blockQuery]),
    () => readView(provider, contract, method, args, blockQuery, timeoutMs), policy);
}
