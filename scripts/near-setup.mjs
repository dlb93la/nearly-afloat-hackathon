import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { Account, actions, baseEncode, formatNearAmount, JsonRpcProvider, KeyPair } from 'near-api-js';
import { AccessKeyDoesNotExistError } from 'near-api-js/rpc-errors';

const TEST_ACCOUNT = /^(?=.{2,64}$)[a-z0-9]+(?:[-_.][a-z0-9]+)*\.testnet$/;
const EMPTY_CODE_HASH = '1'.repeat(32);
const STARTER = process.env.BARREL_NEAR_STARTER === '1';
const GOLD = process.env.BARREL_GOLD_CONTRACT;
const FUNDER = process.env.BARREL_GOLD_FUNDER;
const METHODS = ['grant_test_gold', 'reserve_round', 'settle_round', 'cancel_round',
  ...(STARTER ? ['grant_first_brawl'] : []), ...(GOLD ? ['grant_gold_reward'] : [])];
const ALLOWANCE = 250_000_000_000_000_000_000_000n;
const DEPLOY_BUFFER = 50_000_000_000_000_000_000_000n;
const wasmFile = new URL('../near-arena/target/wasm32-unknown-unknown/release/barrel_bay_arena.wasm', import.meta.url);
let phase = 'read the setup configuration';

function requireSetup(condition, message) {
  if (!condition) throw new Error(message, { cause: 'setup' });
}

async function loadSaved(file) {
  try {
    return parseEnv(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

async function accessKey(account, key) {
  try {
    return await account.getAccessKey(key.getPublicKey());
  } catch (error) {
    if (!(error instanceof AccessKeyDoesNotExistError)) throw error;
    return null;
  }
}

async function setup() {
  const contractId = process.env.BARREL_NEAR_CONTRACT;
  const refereeId = process.env.BARREL_NEAR_REFEREE ?? contractId;
  const deployKey = process.env.BARREL_NEAR_DEPLOY_KEY;
  const refereeAdminKey = process.env.BARREL_NEAR_REFEREE_ADMIN_KEY ?? (refereeId === contractId ? deployKey : null);
  const rpc = process.env.BARREL_NEAR_RPC ?? 'https://test.rpc.fastnear.com';
  requireSetup(TEST_ACCOUNT.test(contractId ?? '') && TEST_ACCOUNT.test(refereeId ?? '') && deployKey && refereeAdminKey,
    'Supply named testnet accounts and the required deployer and referee admin keys.');
  requireSetup(!GOLD || (GOLD !== contractId && TEST_ACCOUNT.test(GOLD) && TEST_ACCOUNT.test(FUNDER ?? '') && STARTER),
    'GOLD requires distinct named testnet contracts, a named funder, and BARREL_NEAR_STARTER=1.');
  const configPath = `data/near.${contractId}.env`;
  const configFile = new URL('../' + configPath, import.meta.url);
  const provider = new JsonRpcProvider({ url: rpc }, { retries: 2, wait: 200, backoff: 2 });

  phase = 'verify the RPC network and account permissions';
  requireSetup((await provider.sendJsonRpc('status', [])).chain_id === 'testnet', 'The configured RPC must be on NEAR testnet.');
  const deploy = KeyPair.fromString(deployKey);
  const refereeAdmin = KeyPair.fromString(refereeAdminKey);
  const contract = new Account(contractId, provider, deployKey);
  const referee = new Account(refereeId, provider, refereeAdminKey);
  const [state, deployAccess, refereeAccess] = await Promise.all([
    contract.getState(), accessKey(contract, deploy), accessKey(referee, refereeAdmin),
  ]);
  requireSetup(deployAccess?.permission === 'FullAccess' && refereeAccess?.permission === 'FullAccess',
    'Setup requires a full-access key for each account. The game server uses the generated restricted key.');

  phase = 'load the built WASM and prepare a resumable setup';
  const wasm = await readFile(wasmFile);
  const hash = baseEncode(createHash('sha256').update(wasm).digest());
  const config = {
    BARREL_NEAR_CONTRACT: contractId,
    BARREL_NEAR_REFEREE: refereeId,
    BARREL_NEAR_RPC: rpc,
    BARREL_NEAR_WASM_HASH: hash,
    ...(STARTER ? { BARREL_NEAR_STARTER: '1', BARREL_NEAR_WORKSHOP: '1' } : {}),
    ...(GOLD ? { BARREL_GOLD_WALLET: '1', BARREL_NEAR_VOYAGE: '1', BARREL_NEAR_COLLECTION: '1',
      BARREL_GOLD_CONTRACT: GOLD, BARREL_GOLD_FUNDER: FUNDER } : {}),
  };
  const saved = await loadSaved(configFile);
  requireSetup(state.codeHash === EMPTY_CODE_HASH || (saved && state.codeHash === hash),
    'Use a fresh contract account. Setup will only resume an existing deployment recorded in its generated file.');
  if (state.codeHash === EMPTY_CODE_HASH) {
    const protocol = await provider.sendJsonRpc('EXPERIMENTAL_protocol_config', { finality: 'final' });
    const minimum = BigInt(wasm.byteLength) * BigInt(protocol.runtime_config.storage_amount_per_byte) + DEPLOY_BUFFER;
    requireSetup(state.balance.available >= minimum,
      `Fund the contract account with at least ${formatNearAmount(minimum, 4)} available NEAR on testnet for code storage and gas.`);
  }
  if (saved) {
    requireSetup(Object.entries(config).every(([key, value]) => saved[key] === value) && saved.BARREL_NEAR_KEY,
      'The generated file belongs to another setup. Keep it intact and check the account, RPC and WASM.');
  }
  const runtimeKey = saved ? KeyPair.fromString(saved.BARREL_NEAR_KEY) : KeyPair.fromRandom('ed25519');
  if (!saved) {
    await mkdir(new URL('../data/', import.meta.url), { recursive: true });
    const env = { ...config, BARREL_NEAR_KEY: runtimeKey.toString() };
    await writeFile(configFile, Object.entries(env).map(([key, value]) => key + '=' + JSON.stringify(value)).join('\n') + '\n',
      { flag: 'wx', mode: 0o600 });
  }

  phase = 'deploy and initialize the arena';
  if (state.codeHash === EMPTY_CODE_HASH) {
    const result = await contract.signAndSendTransaction({
      receiverId: contractId,
      actions: [actions.deployContract(wasm), actions.functionCall(GOLD ? 'new_with_gold' : 'new',
        { referee: refereeId, ...(GOLD ? { token: GOLD, funder: FUNDER } : {}) }, 35_000_000_000_000n, 0n)],
      waitUntil: 'FINAL',
    });
    console.log('Deployment:', result.transaction.hash);
  }
  const [deployed, pools] = await Promise.all([
    contract.getState(), provider.callFunction({ contractId, method: 'pools', args: {}, blockQuery: { finality: 'final' } }),
  ]);
  requireSetup(deployed.codeHash === hash && Array.isArray(pools) && pools.length === 2, 'The contract did not initialize with the expected code.');
  if (GOLD) {
    const gold = await provider.callFunction({ contractId, method: 'gold_config', args: {}, blockQuery: { finality: 'final' } });
    requireSetup(gold?.token === GOLD && gold.funder === FUNDER, 'Arena GOLD configuration does not match.');
  }

  phase = 'install and verify the restricted runtime key';
  let runtimeAccess = await accessKey(referee, runtimeKey);
  if (!runtimeAccess) {
    const result = await referee.addFunctionCallAccessKey({
      publicKey: runtimeKey.getPublicKey(), contractId, methodNames: METHODS, allowance: ALLOWANCE,
    });
    console.log('Referee key registration:', result.transaction.hash);
    runtimeAccess = await accessKey(referee, runtimeKey);
  }
  const permission = runtimeAccess?.permission?.FunctionCall;
  requireSetup(permission?.receiver_id === contractId && permission.method_names.length === METHODS.length
    && METHODS.every(method => permission.method_names.includes(method))
    && permission.allowance != null && BigInt(permission.allowance) > 0n && BigInt(permission.allowance) <= ALLOWANCE,
  'The stored runtime key is not restricted to the expected methods and allowance, or its allowance is exhausted.');
  console.log('Testnet contract:', contractId);
  console.log('Runtime configuration:', configPath);
  console.log('Start: node --env-file=' + configPath + ' --experimental-sqlite server.mjs');
}

try {
  await setup();
} catch (error) {
  console.error(error.cause === 'setup' ? error.message : `Could not ${phase} (${error.name}).`);
  process.exitCode = 1;
}
