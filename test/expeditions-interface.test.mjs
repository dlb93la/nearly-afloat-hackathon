import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('Expeditions clamps excess funding before review, checks changed offers, and preserves bids', () => {
  const result = execFileSync(process.execPath, [fileURLToPath(new URL('./fixtures/expedition-contribution-dom.mjs', import.meta.url))], { encoding: 'utf8' });
  assert.match(result, /PASS/);
});
