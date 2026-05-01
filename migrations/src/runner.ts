import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Connection } from 'mysql2/promise';
import { createConnection } from './connection.js';

interface ApplyOpts { conn: Connection; sqlDir: string; }

export async function listApplied(conn: Connection): Promise<string[]> {
  try {
    const [rows] = await conn.query<any[]>(
      'SELECT filename FROM panorama_migration_history ORDER BY filename'
    );
    return rows.map((r: any) => r.filename);
  } catch (err: any) {
    if (err?.code === 'ER_NO_SUCH_TABLE') return [];
    throw err;
  }
}

export async function listPending({ conn, sqlDir }: ApplyOpts): Promise<string[]> {
  const all = (await readdir(sqlDir)).filter(f => f.endsWith('.sql')).sort();
  const applied = new Set(await listApplied(conn));
  return all.filter(f => !applied.has(f));
}

export async function applyMigrations(opts: ApplyOpts): Promise<{ applied: string[] }> {
  const pending = await listPending(opts);
  const applied: string[] = [];
  for (const filename of pending) {
    const path = join(opts.sqlDir, filename);
    const sql = await readFile(path, 'utf8');
    const checksum = createHash('sha1').update(sql).digest('hex');
    await opts.conn.query(sql);
    // history table only exists *after* 999_*.sql ran the first time, so skip recording it on first pass.
    const historyExists = await tableExists(opts.conn, 'panorama_migration_history');
    if (historyExists) {
      await opts.conn.query(
        'INSERT INTO panorama_migration_history (filename, checksum_sha1) VALUES (?, ?) ' +
        'ON DUPLICATE KEY UPDATE checksum_sha1 = VALUES(checksum_sha1)',
        [filename, checksum]
      );
    }
    applied.push(filename);
  }
  return { applied };
}

async function tableExists(conn: Connection, name: string): Promise<boolean> {
  const [rows] = await conn.query<any[]>(
    'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
    [name]
  );
  return rows.length > 0;
}

if (process.argv[2] === 'apply') {
  const conn = await createConnection();
  const out = await applyMigrations({ conn, sqlDir: 'sql' });
  console.log('Applied:', out.applied.length ? out.applied.join(', ') : '(none — already up to date)');
  await conn.end();
} else if (process.argv[2] === 'status') {
  const conn = await createConnection();
  const applied = await listApplied(conn);
  const pending = await listPending({ conn, sqlDir: 'sql' });
  console.log(`Applied (${applied.length}):`, applied);
  console.log(`Pending (${pending.length}):`, pending);
  await conn.end();
}
