import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
function sourceFiles(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const child = resolve(path, entry.name);
    return entry.isDirectory() ? sourceFiles(child) : /\.(?:js|mjs|css|svg)$/.test(child) ? [child] : [];
  });
}
const hash = createHash('sha256');
const inputs = ['index.html', 'signin.html', 'trap-lab.html', 'judges-expeditions.html', 'vite.config.js', 'package-lock.json', 'LICENSE', 'NOTICE', 'ASSETS-LICENSE.md'].map(path => resolve(root, path))
  .concat(sourceFiles(resolve(root, 'src')), sourceFiles(resolve(root, 'shared'))).sort();
for (const path of inputs) hash.update(relative(root, path)).update('\0').update(readFileSync(path));
const buildId = hash.digest('hex').slice(0, 10);

export default defineConfig({
  define: { __AFLOAT_BUILD_ID__: JSON.stringify(buildId) },
  plugins: [{ name: 'afloat-build-identity',
    transformIndexHtml() { return [{ tag: 'meta', attrs: { name: 'afloat-build', content: buildId }, injectTo: 'head' }]; },
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify({ id: buildId }) }); },
  }],
  build: { rollupOptions: { input: {
    game: fileURLToPath(new URL('./index.html', import.meta.url)),
    signin: fileURLToPath(new URL('./signin.html', import.meta.url)),
    traps: fileURLToPath(new URL('./trap-lab.html', import.meta.url)),
    judges: fileURLToPath(new URL('./judges-expeditions.html', import.meta.url)),
  } } },
});
