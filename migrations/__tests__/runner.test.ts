import type { RowDataPacket } from 'mysql2/promise';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConnection } from '../src/connection.js';
import { applyMigrations, listApplied, listPending } from '../src/runner.js';

interface TableRow extends RowDataPacket { t: string; }
interface CountRow extends RowDataPacket { count: number; }

async function reset(conn: Awaited<ReturnType<typeof createConnection>>) {
  const [rows] = await conn.query<TableRow[]>(
    `SELECT table_name AS t FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name LIKE 'panorama\\_%' ESCAPE '\\\\'`
  );
  // Disable FK checks momentarily so DROP order doesn't matter (relevant once 001 lands FK constraints).
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const { t } of rows) {
      await conn.query(`DROP TABLE IF EXISTS \`${t}\``);
    }
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  }
}

describe('migrations runner', () => {
  let conn: Awaited<ReturnType<typeof createConnection>>;

  beforeEach(async () => { conn = await createConnection(); await reset(conn); });
  afterEach(async () => { await reset(conn); await conn.end(); });

  it('applies 000_migration_history.sql first and tracks subsequent files', async () => {
    const result = await applyMigrations({ conn, sqlDir: 'sql' });
    expect(result.applied).toContain('000_migration_history.sql');
    expect(result.applied[0]).toBe('000_migration_history.sql');

    const applied = await listApplied(conn);
    expect(applied).toEqual(expect.arrayContaining(['000_migration_history.sql']));
  });

  it('is idempotent — second apply is a no-op', async () => {
    const first = await applyMigrations({ conn, sqlDir: 'sql' });
    expect(first.applied.length).toBeGreaterThan(0);

    const [historyRows] = await conn.query<CountRow[]>(
      'SELECT COUNT(*) AS count FROM panorama_migration_history'
    );
    expect(historyRows[0]?.count).toBe(first.applied.length);

    const second = await applyMigrations({ conn, sqlDir: 'sql' });
    expect(second.applied).toEqual([]);
  });

  it('lists pending files when nothing is applied yet', async () => {
    const pending = await listPending({ conn, sqlDir: 'sql' });
    expect(pending).toContain('000_migration_history.sql');
    expect(pending[0]).toBe('000_migration_history.sql');
  });
});
