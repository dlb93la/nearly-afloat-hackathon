import { DatabaseSync } from 'node:sqlite';
import { access, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// An online SQLite snapshot includes committed WAL data. Copying the live .sqlite
// file alone does not. Refuse to replace an existing backup.
const source = process.argv[2] ?? process.env.BARREL_DB;
const target = process.argv[3];
if (!source || !target || source === ':memory:') throw new Error('Usage: node --experimental-sqlite scripts/backup-economy.mjs SOURCE.sqlite NEW-BACKUP.sqlite');
const input = resolve(source);
const output = resolve(target);
if (input === output) throw new Error('Backup must use a different file.');
await access(input);
await mkdir(dirname(output), { recursive: true });
const db = new DatabaseSync(input, { readOnly: true });
try {
  db.exec(`VACUUM INTO '${output.replaceAll("'", "''")}'`);
  const check = new DatabaseSync(output, { readOnly: true });
  try {
    if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup integrity check failed.');
  } finally { check.close(); }
  console.log('SQLite backup created and integrity checked. Treat the backup as private.');
} finally { db.close(); }
