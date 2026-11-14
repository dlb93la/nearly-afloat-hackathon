import { readFile, readdir, mkdir, chown, symlink, lstat, readlink, rename, chmod } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Account, baseEncode, JsonRpcProvider } from 'near-api-js';
import { provisionMerchantReserve } from '../agent-provision.mjs';
import { writeAgentFile } from '../agent-journal.mjs';

if (process.platform !== 'linux') throw new Error('Private Linux preview required');
const servers = [];
for (const pid of (await readdir('/proc')).filter(id => /^\d+$/.test(id))) {
  const command = await readFile('/proc/' + pid + '/cmdline', 'utf8').catch(() => '');
  if (command.split('\0').includes('/work/server.mjs')) servers.push(pid);
}
if (servers.length !== 1) throw new Error('Expected one game server');
const env = Object.fromEntries((await readFile('/proc/' + servers[0] + '/environ', 'utf8')).split('\0')
  .filter(Boolean).map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; }));
const endpoint = new URL(env.BARREL_NEAR_RPC);
if (env.BARREL_NEAR_SOCIAL_SANDBOX !== '1' || endpoint.hostname !== '127.0.0.1') throw new Error('Private Sandbox required');
const rpc = new JsonRpcProvider({ url: endpoint.href });
const chain = (await rpc.sendJsonRpc('status', [])).chain_id;
if (!chain || ['mainnet', 'testnet'].includes(chain)) throw new Error('Public chain forbidden');
const contract = env.BARREL_NEAR_CONTRACT;
const state = await rpc.viewAccount({ accountId: contract, blockQuery: { finality: 'final' } });
const wasm = await readFile(new URL('../near-arena/target/wasm32-unknown-unknown/release/barrel_bay_arena.wasm', import.meta.url));
if (state.code_hash !== baseEncode(createHash('sha256').update(wasm).digest())) throw new Error('Preview code differs from validated WASM');
const scope = createHash('sha256').update(chain).digest('hex').slice(0, 12);
const privateHome = '/state/reserve-owner/active';
const workerHome = '/state/reserve-worker/' + scope;
await mkdir(privateHome, { recursive: true, mode: 0o700 });
await mkdir(workerHome, { recursive: true, mode: 0o700 });
await chmod('/state/reserve-worker', 0o711);
await chown(workerHome, 65534, 65534);
const admin = new Account(contract, rpc, env.BARREL_NEAR_SOCIAL_SANDBOX_KEY);
const provisioned = await provisionMerchantReserve({ admin, rpc, contract, chain,
  checkpointPath: privateHome + '/checkpoint.json', allowPrivateRestore: true, items: Array.from({ length: 10 }, (_, i) => 'pirate-' + i + '-1') });
const statusPath = workerHome + '/status.json';
try { await lstat(statusPath); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await writeAgentFile(statusPath, {});
  await chown(statusPath, 65534, 65534);
}
const publicPath = '/work/dist/merchant-reserve.json';
const currentTarget = await readlink(publicPath).catch(error => {
  if (['ENOENT', 'EINVAL'].includes(error.code)) return null;
  throw error;
});
if (currentTarget !== statusPath) {
  const replacement = publicPath + '.' + process.pid + '.tmp';
  await symlink(statusPath, replacement);
  await rename(replacement, publicPath);
}
const daemon = await readFile(privateHome + '/daemon.json', 'utf8').then(JSON.parse).catch(error => {
  if (error.code !== 'ENOENT') throw error;
  return null;
});
if (daemon?.pid) {
  const command = await readFile('/proc/' + daemon.pid + '/cmdline', 'utf8').catch(() => '');
  if (command.split('\0').includes('/work/scripts/merchant-reserve-daemon.mjs')) {
    console.log(JSON.stringify({ account: provisioned.account, resumed: true, daemonPid: daemon.pid }));
    process.exit(0);
  }
}
const child = spawn(process.execPath, ['/work/scripts/merchant-reserve-daemon.mjs'], {
  detached: true, stdio: 'ignore', uid: 65534, gid: 65534,
  env: { PATH: process.env.PATH, AFLOAT_AGENT_ACCOUNT: provisioned.account, AFLOAT_AGENT_CONTRACT: contract,
    AFLOAT_AGENT_KEY: provisioned.limitedKey, AFLOAT_AGENT_RPC: endpoint.href,
    AFLOAT_AGENT_STATUS: statusPath, AFLOAT_AGENT_JOURNAL: workerHome + '/journal.json' },
});
await writeAgentFile(privateHome + '/daemon.json', { pid: child.pid });
child.unref();
console.log(JSON.stringify({ account: provisioned.account, contract, daemonPid: child.pid, uid: 65534 }));
