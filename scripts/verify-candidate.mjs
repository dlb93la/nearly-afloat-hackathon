import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const baseline = process.argv[2] ?? process.env.AFLOAT_PREVIOUS_WASM;
if (!baseline) throw new Error('Provide the previous deployed WASM as the first argument or AFLOAT_PREVIOUS_WASM');
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const previous = resolve(baseline);
const current = new URL('../near-arena/target/wasm32-unknown-unknown/release/barrel_bay_arena.wasm', import.meta.url);
const previousHash = hash(previous);
const currentHash = hash(current);
if (previousHash === currentHash) throw new Error('Upgrade baseline must differ from the candidate');
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run with npm run verify:candidate -- <previous.wasm>');
const commands = [
  ['--experimental-sqlite', '--test', 'test/*.test.mjs'],
  [npm, 'run', 'build'],
  ['--test', 'near-arena/test/contract-session.test.mjs'],
];
for (const args of commands) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit',
    env: { ...process.env, AFLOAT_PREVIOUS_WASM: previous }, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(JSON.stringify({ previousSha256: previousHash, candidateSha256: currentHash, upgradeTestRequired: true }));
