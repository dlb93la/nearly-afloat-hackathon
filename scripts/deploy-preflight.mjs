import { readFile, readdir, mkdir, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonRpcProvider, KeyPair } from 'near-api-js';
import { productionProblems } from '../deployment-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const env = process.env;
let phase = 'configuration';
class PreflightCheckError extends Error {}
const requireRule = (condition, message) => { if (!condition) throw new PreflightCheckError(message); };
async function files(directory) {
  return (await readdir(directory, { withFileTypes: true })).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? [files(path)] : [path];
  }).reduce(async (pending, item) => [...await pending, ...[await item].flat()], Promise.resolve([]));
}

try {
  const filesOnly = process.argv.includes('--files-only');
  if (!filesOnly) {
    const problems = productionProblems(env);
    requireRule(!problems.length, problems.join('\n'));
  }
  phase = 'client artifact';
  const dist = resolve(root, 'dist');
  for (const name of ['index.html', 'signin.html', 'judges-expeditions.html', 'manifest.webmanifest', 'build-info.json', 'THIRD-PARTY-NOTICES.txt', 'LICENSE.txt', 'NOTICE.txt', 'ASSETS-LICENSE.md']) {
    await access(resolve(dist, name));
  }
  let checkedFiles = 0;
  for (const path of await files(dist)) {
    requireRule(!/(?:^|[\\/])\.env(?:$|[.\\/])/.test(path) && !/\.sqlite(?:$|-)/.test(path), 'Private file found in dist.');
    if (!/\.(?:js|mjs|html|css|json|map|txt)$/.test(path)) continue;
    const source = await readFile(path, 'utf8');
    requireRule(!/ed25519:[1-9A-HJ-NP-Za-km-z]{80,90}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(source),
      'Private signing material found in dist.');
    for (const name of ['BARREL_NEAR_KEY', 'BARREL_NEAR_SOCIAL_SPONSOR_KEY', 'BARREL_EXPEDITIONS_KEY']) {
      requireRule(!env[name] || !source.includes(env[name]), 'A runtime secret was copied into dist.');
    }
    checkedFiles++;
  }
  const build = JSON.parse(await readFile(resolve(dist, 'build-info.json'), 'utf8'));
  const report = { checkedAt: new Date().toISOString(), build: build.id, checkedFiles,
    scope: filesOnly ? 'Local build only; hosting, login and network unverified.' : 'Read-only hosted configuration and testnet checks; no deployment or transaction.' };
  if (!filesOnly) {
    phase = 'persistent directory';
    await mkdir(env.BARREL_DATA_DIR, { recursive: true });
    await access(env.BARREL_DATA_DIR, constants.W_OK);
    const provider = new JsonRpcProvider({ url: env.BARREL_NEAR_RPC }, { retries: 2, wait: 300 });
    phase = 'testnet identity';
    const status = await provider.sendJsonRpc('status', []);
    requireRule(status.chain_id === 'testnet', 'RPC must report testnet.');
    const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args, blockQuery: { finality: 'final' } });
    phase = 'GOLD token and vault';
    const config = await view(env.BARREL_NEAR_CONTRACT, 'gold_config');
    requireRule(config?.token === env.BARREL_GOLD_CONTRACT, 'Arena vault token differs from BARREL_GOLD_CONTRACT.');
    const metadata = await view(config.token, 'ft_metadata');
    requireRule(metadata.decimals === 2 && metadata.symbol === 'GOLD', 'Unexpected token metadata.');
    const supply = await view(config.token, 'ft_total_supply');
    const vault = await view(config.token, 'ft_balance_of', { account_id: env.BARREL_NEAR_CONTRACT });
    const saleInventory = await view(config.token, 'sale_inventory');
    requireRule(BigInt(supply) > 0n && BigInt(vault) > 0n && BigInt(saleInventory) > 0n, 'Token, game vault and token sale must be funded.');
    phase = 'runtime key permissions';
    const runtimeKeys = [
      ['referee', env.BARREL_NEAR_REFEREE, env.BARREL_NEAR_KEY,
        ['grant_test_gold', 'reserve_round', 'settle_round', 'cancel_round', 'grant_first_brawl', 'grant_gold_reward']],
      ['voyage', env.BARREL_EXPEDITIONS_OPERATOR, env.BARREL_EXPEDITIONS_KEY, ['advance']],
    ];
    for (const [name, accountId, key, allowed] of runtimeKeys) {
      const publicKey = KeyPair.fromString(key).getPublicKey().toString();
      const accessKey = await provider.viewAccessKey({ accountId, publicKey, finality: 'final' });
      const permission = accessKey.permission?.FunctionCall;
      requireRule(permission?.receiver_id === env.BARREL_NEAR_CONTRACT && permission.method_names.length > 0 &&
        permission.method_names.every(method => allowed.includes(method)) &&
        allowed.filter(method => name !== 'referee' || !['grant_test_gold', 'grant_gold_reward'].includes(method))
          .every(method => permission.method_names.includes(method)) &&
        permission.allowance != null && BigInt(permission.allowance) > 0n &&
        BigInt(permission.allowance) <= 250_000_000_000_000_000_000_000n,
      `${name} key must be restricted to the game contract, required methods and finite gas allowance.`);
    }
    phase = 'sponsor gas';
    const sponsorPublic = KeyPair.fromString(env.BARREL_NEAR_SOCIAL_SPONSOR_KEY).getPublicKey().toString();
    const sponsorAccess = await provider.viewAccessKey({ accountId: env.BARREL_NEAR_SOCIAL_SPONSOR, publicKey: sponsorPublic, finality: 'final' });
    requireRule(sponsorAccess.permission === 'FullAccess', 'The dedicated sponsor must be able to fund new testnet accounts.');
    const sponsor = await provider.viewAccount({ accountId: env.BARREL_NEAR_SOCIAL_SPONSOR, finality: 'final' });
    requireRule(BigInt(sponsor.amount) > 1_000_000_000_000_000_000_000_000n, 'Top up the dedicated sponsor before inviting testers.');
    Object.assign(report, { network: status.chain_id, origin: env.PUBLIC_ORIGIN,
      arena: env.BARREL_NEAR_CONTRACT, token: config.token, supply, vault, saleInventory,
      runtimeKeys: 'restricted', sponsorGas: 'above 1 test NEAR; storage and traffic costs still need monitoring' });
  }
  await mkdir(resolve(root, 'output'), { recursive: true });
  await writeFile(resolve(root, 'output/deploy-preflight.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('PASS ' + JSON.stringify(report));
} catch (error) {
  // RPC messages can contain request details. Only controlled configuration errors are printed.
  console.error(`Hosting preflight failed during ${phase}.`);
  if (error instanceof PreflightCheckError) console.error(error.message);
  else console.error('Check the build, persistent paths, contract configuration, key permissions and testnet funding. No transaction was sent.');
  process.exitCode = 1;
}
