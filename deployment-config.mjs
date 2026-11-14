import { isAbsolute, relative, sep } from 'node:path';

const TEST_ACCOUNT = /^(?=.{2,64}$)[a-z0-9]+(?:[-_.][a-z0-9]+)*\.testnet$/;
const KEY = /^ed25519:[1-9A-HJ-NP-Za-km-z]{80,90}$/;
const requiredFlags = ['BARREL_NEAR_SESSIONS', 'BARREL_NEAR_WORKSHOP', 'BARREL_NEAR_STARTER',
  'BARREL_NEAR_COLLECTION', 'BARREL_NEAR_VOYAGE', 'BARREL_NEAR_SOCIAL', 'BARREL_GOLD_WALLET'];

// Deliberately report variable names only. Never include a credential in an error.
export function productionProblems(env) {
  const problems = [];
  let origin;
  try {
    const url = new URL(env.PUBLIC_ORIGIN);
    if (url.protocol !== 'https:' || url.origin !== env.PUBLIC_ORIGIN || url.username || url.password ||
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error();
    origin = url.origin;
  } catch { problems.push('PUBLIC_ORIGIN must be the exact public HTTPS origin, without a trailing slash.'); }
  try {
    const callback = new URL(env.BARREL_NEAR_SOCIAL_CALLBACK);
    if (!origin || callback.origin !== origin || callback.pathname !== '/' || callback.search || callback.hash ||
        callback.username || callback.password) throw new Error();
  } catch { problems.push('BARREL_NEAR_SOCIAL_CALLBACK must equal PUBLIC_ORIGIN followed by /.'); }
  for (const name of requiredFlags) if (env[name] !== '1') problems.push(`${name} must be 1 for the GOLD candidate.`);
  for (const name of ['BARREL_NEAR_CONTRACT', 'BARREL_NEAR_REFEREE', 'BARREL_GOLD_CONTRACT',
    'BARREL_NEAR_SOCIAL_SPONSOR', 'BARREL_EXPEDITIONS_OPERATOR']) {
    if (!TEST_ACCOUNT.test(env[name] ?? '')) problems.push(`${name} must identify a named testnet account.`);
  }
  for (const name of ['BARREL_NEAR_KEY', 'BARREL_NEAR_SOCIAL_SPONSOR_KEY', 'BARREL_EXPEDITIONS_KEY']) {
    if (!KEY.test(env[name] ?? '')) problems.push(`${name} must contain the runtime signing key.`);
  }
  if (env.BARREL_GOLD_CONTRACT === env.BARREL_NEAR_CONTRACT) problems.push('GOLD and Arena must use separate contracts.');
  if (env.BARREL_NEAR_SOCIAL_PROVIDER !== 'privy') problems.push('BARREL_NEAR_SOCIAL_PROVIDER must be privy.');
  if (!/^[A-Za-z0-9_-]{5,128}$/.test(env.PRIVY_APP_ID ?? '')) problems.push('PRIVY_APP_ID is missing or invalid.');
  if (env.PRIVY_CLIENT_ID && !/^[A-Za-z0-9_-]{5,128}$/.test(env.PRIVY_CLIENT_ID)) problems.push('PRIVY_CLIENT_ID is invalid.');
  if (env.BARREL_NEAR_SOCIAL_SANDBOX === '1') problems.push('The hosted candidate must not use Sandbox.');
  try {
    const rpc = new URL(env.BARREL_NEAR_RPC);
    if (rpc.protocol !== 'https:' || rpc.username || rpc.password) throw new Error();
  } catch { problems.push('BARREL_NEAR_RPC must be an HTTPS testnet RPC URL.'); }
  if (!isAbsolute(env.BARREL_DATA_DIR ?? '') || !isAbsolute(env.BARREL_DB ?? '')) {
    problems.push('BARREL_DATA_DIR and BARREL_DB must be absolute persistent storage paths.');
  } else {
    const child = relative(env.BARREL_DATA_DIR, env.BARREL_DB);
    if (!child || child === '..' || child.startsWith('..' + sep) || isAbsolute(child)) {
      problems.push('BARREL_DB must be a file inside BARREL_DATA_DIR.');
    }
  }
  for (const name of Object.keys(env)) {
    if (env[name] && (name === 'PRIVY_APP_SECRET' || /^BARREL_.*(?:DEPLOY_KEY|ADMIN_KEY|SANDBOX_KEY)$/.test(name))) {
      problems.push(`Remove ${name} from the game runtime; deployment/admin credentials do not belong there.`);
    }
    if (/^VITE_.*(?:SECRET|PRIVATE|PASSWORD|KEY)/.test(name) && env[name]) problems.push(`Remove ${name}; browser build variables are public.`);
  }
  return problems;
}

export function loadDeployment(env = process.env) {
  const production = env.NODE_ENV === 'production';
  if (production) {
    const problems = productionProblems(env);
    if (problems.length) throw new Error('Hosted configuration rejected:\n' + problems.join('\n'));
  }
  return { production, origin: production ? env.PUBLIC_ORIGIN : null };
}

export function requestHasSameOrigin(request, deployment) {
  const { origin, host } = request.headers;
  if (!origin) return true; // Read-only navigation/health probes do not send Origin.
  try {
    const url = new URL(origin);
    // A proxy/client cannot expand the allowlist using X-Forwarded-Host.
    if (deployment.production) return origin === deployment.origin;
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.host === host;
  } catch { return false; }
}
