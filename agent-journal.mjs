import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export async function writeAgentFile(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = path + '.' + randomUUID() + '.tmp';
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally { await handle.close(); }
  try { await rename(temporary, path); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}

export async function readAgentFile(path, fallback = null) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

export async function lockAgentFile(path) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lock = path + '.lock.sqlite';
  const file = await open(lock, 'a', 0o600);
  await file.close();
  const db = new DatabaseSync(lock);
  try {
    db.exec('BEGIN IMMEDIATE');
    return async () => { db.exec('ROLLBACK'); db.close(); };
  } catch (error) {
    db.close();
    if (error.errcode === 5 || error.code === 'SQLITE_BUSY') return null;
    throw error;
  }
}
