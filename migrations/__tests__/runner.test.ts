import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConnection } from '../src/connection.js';
import { applyMigrations, listApplied, listPending } from '../src/runner.js';

const TEST_DB = process.env.MYSQL_DATABASE ?? 'lista_qa';

async function reset(conn: Awaited<ReturnType<typeof createConnection>>) {
  // Clean up any table created by 001-005 plus the history table.
  const cleanup = [
    'panorama_broken_ref', 'panorama_build_meta',
    'panorama_cron_job',
    'panorama_ref_link', 'panorama_code_ref',
    'panorama_doc_concept_rel', 'panorama_concept',
    'panorama_knowledge_doc', 'panorama_business_domain',
    'panorama_migration_history'
  ];
  for (const t of cleanup) await conn.query(`DROP TABLE IF EXISTS \`${t}\``);
}

describe('migrations runner', () => {
  let conn: Awaited<ReturnType<typeof createConnection>>;

  beforeEach(async () => { conn = await createConnection(); await reset(conn); });
  afterEach(async () => { await reset(conn); await conn.end(); });

  it('applies 999_migration_history.sql first and tracks subsequent files', async () => {
    const result = await applyMigrations({ conn, sqlDir: 'sql' });
    expect(result.applied).toContain('999_migration_history.sql');

    const applied = await listApplied(conn);
    expect(applied).toEqual(expect.arrayContaining(['999_migration_history.sql']));
  });

  it('is idempotent — second apply is a no-op', async () => {
    await applyMigrations({ conn, sqlDir: 'sql' });
    const second = await applyMigrations({ conn, sqlDir: 'sql' });
    expect(second.applied).toEqual([]);
  });

  it('lists pending files when nothing is applied yet', async () => {
    const pending = await listPending({ conn, sqlDir: 'sql' });
    expect(pending).toContain('999_migration_history.sql');
  });
});
