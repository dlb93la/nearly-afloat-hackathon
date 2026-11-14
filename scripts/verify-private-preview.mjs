import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { JsonRpcProvider } from 'near-api-js';

if (process.platform !== 'linux') throw new Error('Run inside the private Linux preview');
const find = async (script, worker = false) => {
  const matches = [];
  for (const id of (await readdir('/proc')).filter(pid => /^\d+$/.test(pid))) {
    const command = await readFile('/proc/' + id + '/cmdline', 'utf8').catch(() => '');
    if (command.split('\0').includes(script)) matches.push(id);
  }
  assert.equal(matches.length, 1, 'Expected one process for ' + script);
  const pid = matches[0];
  let contents;
  if (worker) {
    const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import {readFile} from 'node:fs/promises';
      const entries=(await readFile('/proc/${pid}/environ','utf8')).split('\\0').filter(Boolean).map(line=>{
        const at=line.indexOf('='),name=line.slice(0,at);
        return [name,['AFLOAT_AGENT_RPC','AFLOAT_AGENT_STATUS','AFLOAT_AGENT_JOURNAL'].includes(name)?line.slice(at+1):'<present>'];
      });
      console.log(JSON.stringify(Object.fromEntries(entries)));
    `], {uid:65534,gid:65534,encoding:'utf8'});
    assert.equal(probe.status,0,'Worker environment probe failed');
    contents=JSON.parse(probe.stdout);
  } else {
    contents=Object.fromEntries((await readFile('/proc/'+pid+'/environ','utf8')).split('\0')
      .filter(Boolean).map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)];}));
  }
  const env = contents;
  return { pid, env };
};
const server = await find('/work/server.mjs');
const worker = await find('/work/scripts/merchant-reserve-daemon.mjs', true);
const endpoint = new URL(worker.env.AFLOAT_AGENT_RPC);
assert.equal(endpoint.hostname, '127.0.0.1');
const rpc = new JsonRpcProvider({ url: endpoint.href });
const chain = (await rpc.sendJsonRpc('status', [])).chain_id;
assert.ok(chain && !['mainnet', 'testnet'].includes(chain));
const scope = createHash('sha256').update(chain).digest('hex').slice(0, 12);
const secret = '/state/reserve-owner/active/checkpoint.json';
const status = worker.env.AFLOAT_AGENT_STATUS;
assert.equal((await stat(secret)).mode & 0o777, 0o600);
const identity = await readFile('/proc/' + worker.pid + '/status', 'utf8');
assert.match(identity, /Uid:\s+65534\s+65534\s+65534\s+65534/);
assert.ok(!Object.keys(worker.env).some(name => /^(BARREL_|PRIVY_)/.test(name)));
const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `
  import {readFile} from 'node:fs/promises';
  await readFile(${JSON.stringify(status)},'utf8');
  try { await readFile(${JSON.stringify(secret)},'utf8'); process.exit(2); }
  catch(error) { if(error.code!=='EACCES') throw error; }
`], { uid: 65534, gid: 65534, encoding: 'utf8' });
assert.equal(probe.status, 0, 'Worker must read its status and fail to read the owner checkpoint');
const snapshot = JSON.parse(await readFile('/state/ledger.json', 'utf8'));
assert.equal(snapshot.contract, server.env.BARREL_NEAR_CONTRACT);
assert.ok(Array.isArray(snapshot.values) && snapshot.values.length > 0);
console.log(JSON.stringify({ network: 'private-sandbox', workerUid: 65534,
  publicStatusReadable: true, ownerCheckpointDenied: true,
  forbiddenEnvironmentNames: false, snapshotRecords: snapshot.values.length,
  privateJournal: Boolean(worker.env.AFLOAT_AGENT_JOURNAL), checkedAt: new Date().toISOString() }));
