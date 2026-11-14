import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, lstat, copyFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('Unable to read the private source checkout.');
  return result.stdout;
}
const tracked = [...new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean))].sort();
const submission = process.argv.includes('--submission');
const submissionDocs = new Set([
  'docs/JUDGES-GUIDE.md',
  'docs/media/arena.webp',
  'docs/media/harbor.webp',
  'docs/evidence/agent-gold-testnet.json',
  'docs/evidence/agent-testnet.json',
  'docs/evidence/expedition-human-sale-2026-11-14.json',
  'docs/evidence/judges-expedition-2026-11-14.json',
]);
const secrets = [];
for (const path of ['.env.privy', 'data/gold-preview.env', '.env.near-admin']) {
  let env;
  try { env = parseEnv(await readFile(resolve(root, path), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  for (const [key, value] of Object.entries(env)) {
    if (/(?:KEY|SECRET|PASSWORD|ACCESS_TOKEN)$/.test(key) && value.length >= 16) secrets.push(value);
  }
}
const pending = [];
for (const name of tracked) {
  if (submission && (name === 'Checklist.md' || (name.startsWith('docs/') && !submissionDocs.has(name)))) continue;
  if (isAbsolute(name) || name.split(/[\\/]/).includes('..') ||
      /(?:^|\/)(?:\.git|node_modules|dist|data|output|target)(?:\/|$)/.test(name) ||
      /(?:^|\/)\.env[^/]*$|\.env$|\.sqlite(?:$|-)/.test(name)) throw new Error(`Private or unsupported release path: ${name}`);
  const path = resolve(root, name);
  const child = relative(root, path);
  if (child.startsWith('..' + sep) || isAbsolute(child)) throw new Error('Release path escaped the source directory.');
  let stat;
  try { stat = await lstat(path); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Release requires ordinary files: ${name}`);
  const bytes = await readFile(path);
  const text = bytes.toString('utf8');
  if (/ed25519:[1-9A-HJ-NP-Za-km-z]{80,90}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) ||
      secrets.some(secret => text.includes(secret))) throw new Error(`Potential private signing material in ${name}. Export refused.`);
  pending.push({ name, path, bytes: stat.size, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const license = await readFile(resolve(root, 'LICENSE'), 'utf8');
if (!license.startsWith('# PolyForm Shield License 1.0.0')) throw new Error('Expected the approved PolyForm Shield license.');
for (const name of ['LICENSE', 'NOTICE', 'ASSETS-LICENSE.md', 'README.md', ...(submission ? submissionDocs : [])]) {
  if (!pending.some(file => file.name === name)) throw new Error(`Release is missing ${name}.`);
}
const directory = resolve(root, 'output/release');
await mkdir(directory, { recursive: true });
const destination = await mkdtemp(resolve(directory, 'candidate-'));
for (const file of pending) {
  const path = resolve(destination, file.name);
  await mkdir(dirname(path), { recursive: true });
  await copyFile(file.path, path);
}
const manifest = { preparedAt: new Date().toISOString(), published: false,
  provenance: { privateBaseCommit: git('rev-parse', 'HEAD').trim(), includesWorkingTreeChanges: true,
    note: 'Current source snapshot. Original private history is preserved separately; no remote or visibility was changed.' },
  license: 'PolyForm Shield License 1.0.0; original asset permissions in ASSETS-LICENSE.md',
  files: pending.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })) };
await writeFile(resolve(destination, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(resolve(root, 'output/release-latest.json'), JSON.stringify({ directory: destination,
  files: pending.length, privateBaseCommit: manifest.provenance.privateBaseCommit, published: false }, null, 2) + '\n');
console.log(`Prepared ${pending.length} checked source files in ${destination}. No Git history, deployment or publication included.`);
