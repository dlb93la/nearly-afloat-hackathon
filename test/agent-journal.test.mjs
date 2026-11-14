import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { lockAgentFile, readAgentFile, writeAgentFile } from '../agent-journal.mjs';

test('journal locking prevents two workers and recovers after a process crash', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'afloat-lock-test-'));
  const path = join(directory, 'journal.json');
  const module = new URL('../agent-journal.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import {lockAgentFile} from ${JSON.stringify(module)};
    await lockAgentFile(${JSON.stringify(path)});
    process.send('locked');
    setInterval(()=>{}, 1000);
  `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit');
      child.kill();
      await exit;
    }
    await rm(directory, { recursive: true, force: true });
  });
  await once(child, 'message', { signal: AbortSignal.timeout(10_000) });
  assert.equal(await lockAgentFile(path), null);
  const exit = once(child, 'exit');
  child.kill('SIGKILL');
  await exit;
  const release = await lockAgentFile(path);
  assert.ok(release);
  await writeAgentFile(path, { hash: 'confirmed-transaction', nonce: 1 });
  assert.deepEqual(await readAgentFile(path), { hash: 'confirmed-transaction', nonce: 1 });
  await release();
});
