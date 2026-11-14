import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
const sections = ['NEARly Afloat — Third-party dependency notices',
  'These dependencies retain their respective licenses. The project license does not replace them.'];
let count = 0;
for (const [path, entry] of Object.entries(lock.packages).sort()) {
  if (!path || entry.dev) continue;
  const folder = resolve(root, path);
  let names;
  try { names = await readdir(folder); }
  catch (error) { if (error.code === 'ENOENT' && entry.optional) continue; throw error; }
  const pkg = JSON.parse(await readFile(resolve(folder, 'package.json'), 'utf8'));
  const notices = names.filter(name => /^(?:licen[cs]e|copying|notice)(?:$|[.-])/i.test(name));
  sections.push(`\n${'='.repeat(70)}\n${pkg.name}@${pkg.version}\nLicense: ${pkg.license ?? entry.license ?? 'See package notices'}`);
  for (const name of notices.sort()) {
    try { sections.push(`--- ${name} ---\n` + await readFile(resolve(folder, name), 'utf8')); }
    catch (error) { if (error.code !== 'EISDIR') throw error; }
  }
  count++;
}
await writeFile(resolve(root, 'dist/THIRD-PARTY-NOTICES.txt'), sections.join('\n\n') + '\n');
for (const [source, target] of [['LICENSE', 'LICENSE.txt'], ['NOTICE', 'NOTICE.txt'], ['ASSETS-LICENSE.md', 'ASSETS-LICENSE.md']]) {
  await writeFile(resolve(root, 'dist', target), await readFile(resolve(root, source)));
}
console.log(`Dependency notices included for ${count} installed runtime packages.`);
