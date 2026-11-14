import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('actual main routes guest login, gates paid entry, and confines introduction to the debut', () => {
  // The fixture replaces browser globals, timers, rendering/audio and transport.
  // A separate process keeps those replacements out of other application tests.
  for (const args of [[], ['--returning'], ['--invite'], ['--touch']]) {
    const output = execFileSync(process.execPath,
      [fileURLToPath(new URL('./fixtures/main-arena-dom.mjs', import.meta.url)), ...args],
      { encoding: 'utf8', timeout: 10_000 });
    assert.match(output, /PASS actual main\.js DOM/);
  }
});
