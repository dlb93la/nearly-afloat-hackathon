import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Account, actions, JsonRpcProvider, KeyPair } from 'near-api-js';
import { GenesisAccount, Sandbox } from 'near-sandbox';
import { SOCIAL_PREVIEW_GENESIS } from '../near-social-actions.mjs';

if (!process.env.BARREL_NEAR_SOCIAL_SPONSOR || !process.env.BARREL_NEAR_SOCIAL_SPONSOR_KEY) {
  throw new Error('Configure the testnet sponsor for NEAR Auth before starting this preview.');
}

const contractId = 'arena.testnet';
const refereeKey = KeyPair.fromRandom('ed25519');
const wasm = await readFile(new URL('../near-arena/target/wasm32-unknown-unknown/release/barrel_bay_arena.wasm', import.meta.url));
const sandbox = await Sandbox.start({ version: '2.14.0', config: { additionalGenesis: SOCIAL_PREVIEW_GENESIS, additionalAccounts: [
  new GenesisAccount(contractId, refereeKey.getPublicKey().toString(), refereeKey.toString(), 30n * 10n ** 24n),
] } });
let web;
let backupTimer;
let saveSnapshot;
try {
  const provider = new JsonRpcProvider({ url: sandbox.rpcUrl });
  const { chain_id: chain } = await provider.sendJsonRpc('status', []);
  if (new URL(sandbox.rpcUrl).hostname !== '127.0.0.1' || !chain || ['mainnet', 'testnet'].includes(chain)) {
    throw new Error('The preview must use a private NEAR Sandbox.');
  }
  const referee = new Account(contractId, provider, refereeKey.toString());
  await referee.signAndSendTransaction({ receiverId: contractId, actions: [actions.deployContract(wasm),
    actions.functionCall('new', { referee: contractId }, 100_000_000_000_000n, 0n)], waitUntil: 'FINAL' });
  const snapshotPath = process.env.AFLOAT_PREVIEW_STATE ?? process.env.AFLOAT_PREVIEW_IMPORT;
  const savedSnapshot = snapshotPath ? await readFile(snapshotPath, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }) : null;
  if (savedSnapshot) {
    const snapshot = JSON.parse(savedSnapshot);
    if (snapshot.contract !== contractId || !Array.isArray(snapshot.values)) throw new Error('Invalid preview snapshot');
    const records = snapshot.values.map(entry => ({ Data: { account_id: contractId, data_key: entry.key, value: entry.value } }));
    // An imported V1 ledger cannot claim that every historic commercial holder is known.
    const supplyKey = Buffer.concat([Buffer.from('commercial-supply-v2'), Buffer.from([0])]).toString('base64');
    const allRecords = [...records];
    if (!snapshot.values.some(entry => entry.key === supplyKey)) allRecords.push({ Data: { account_id: contractId, data_key: supplyKey, value: 'AA==' } });
    await provider.sendJsonRpc('sandbox_patch_state', { records: allRecords });
    // Patches enter the next block; FINAL can still point at the pre-import state.
    await provider.sendJsonRpc('sandbox_fast_forward', { delta_height: 5 });
    let unmatched = snapshot.values;
    for (let attempt = 0; attempt < 15 && unmatched.length; attempt++) {
      const restored = await provider.sendJsonRpc('query', { request_type: 'view_state', account_id: contractId, prefix_base64: '', finality: 'final' });
      const contents = new Map(restored.values.map(entry => [entry.key, entry.value]));
      unmatched = snapshot.values.filter(entry => contents.get(entry.key) !== entry.value);
      if (unmatched.length) await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (unmatched.length) throw new Error('Preview storage restore mismatch: ' + unmatched.map(entry => entry.key).join(','));
    console.log('Restored private ledger: ' + snapshot.values.length + ' unchanged records.');
  } else {
    await referee.callFunctionRaw({ contractId, methodName: 'new_voyage',
      args: { funding_ms: 300_000, sailing_ms: 8_000, auction_ms: 60_000 }, waitUntil: 'FINAL' });
  }
  if (process.env.AFLOAT_PREVIEW_STATE) {
    let writing = Promise.resolve();
    saveSnapshot = () => {
      writing = writing.catch(() => {}).then(async () => {
        const state = await provider.sendJsonRpc('query', { request_type: 'view_state', account_id: contractId, prefix_base64: '', finality: 'final' });
        const path = process.env.AFLOAT_PREVIEW_STATE;
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path + '.tmp', JSON.stringify({ contract: contractId, block_hash: state.block_hash, values: state.values }));
        await rename(path + '.tmp', path);
      });
      return writing;
    };
    await saveSnapshot();
    backupTimer = setInterval(() => saveSnapshot().catch(error => console.error('Private ledger backup failed:', error.message)), 30_000);
    backupTimer.unref();
  }
  const runtimeKey = KeyPair.fromRandom('ed25519');
  await referee.addFunctionCallAccessKey({ publicKey: runtimeKey.getPublicKey(), contractId,
    methodNames: ['grant_test_gold', 'grant_first_brawl', 'reserve_round', 'settle_round', 'cancel_round'], allowance: 2n * 10n ** 24n });
  const voyageKey = KeyPair.fromRandom('ed25519');
  await referee.addFunctionCallAccessKey({ publicKey: voyageKey.getPublicKey(), contractId,
    methodNames: ['advance'], allowance: 250_000_000_000_000_000_000_000n });
  web = spawn(process.execPath, ['--experimental-sqlite', fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    stdio: 'inherit',
    env: { ...process.env, PORT: process.env.PORT ?? '3000', BARREL_DB: process.env.BARREL_DB ?? ':memory:',
      BARREL_NEAR_CONTRACT: contractId, BARREL_NEAR_REFEREE: contractId, BARREL_NEAR_KEY: runtimeKey.toString(),
      BARREL_EXPEDITIONS_OPERATOR: contractId, BARREL_EXPEDITIONS_KEY: voyageKey.toString(),
      BARREL_NEAR_RPC: sandbox.rpcUrl, BARREL_NEAR_WORKSHOP: '1', BARREL_NEAR_STARTER: '1', BARREL_NEAR_VOYAGE: '1',
      BARREL_NEAR_COLLECTION: '1', BARREL_NEAR_SESSIONS: '1', BARREL_NEAR_SOCIAL: '1', BARREL_NEAR_SOCIAL_SANDBOX: '1',
      BARREL_NEAR_SOCIAL_SANDBOX_ACCOUNT: contractId, BARREL_NEAR_SOCIAL_SANDBOX_KEY: refereeKey.toString(),
    },
  });
  const reserve = spawn(process.execPath, [fileURLToPath(new URL('./merchant-reserve-preview.mjs', import.meta.url))],
    { stdio: 'inherit' });
  reserve.on('error', () => console.warn('Merchant reserve could not start.'));
  reserve.on('exit', code => { if (code) console.warn('Merchant reserve setup needs review.'); });
  const stop = () => web.kill();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const [exitCode] = await once(web, 'exit');
  process.exitCode = exitCode ?? 0;
} finally {
  clearInterval(backupTimer);
  if (web?.exitCode === null) web.kill();
  if (saveSnapshot) await saveSnapshot().catch(error => console.error('Final private ledger backup failed:', error.message));
  await sandbox.tearDown();
}
