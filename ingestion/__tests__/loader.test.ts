import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { RowDataPacket } from 'mysql2';
import { loadGraph } from '../src/loader.js';
import { getPool, closePool } from '../src/db.js';
import { runOrchestrator } from '../src/orchestrator.js';
import type { IngestorOutput } from '../src/types.js';

function fixture(): IngestorOutput[] {
  return [{
    ingestor: 'knowledge',
    nodes: [
      { type: 'domain', key: 'moolah', data: { name: 'moolah', displayName: 'Moolah', parentKey: null } },
      { type: 'domain', key: 'moolah/emission', data: { name: 'emission', displayName: 'Emission', parentKey: 'moolah' } },
      { type: 'doc', key: 'business/moolah/emission.md',
        data: { path: 'business/moolah/emission.md', title: 'Emission', frontmatter: {}, lastVerified: '2026-04-27', wordCount: 100, bodyMdPath: 'business/moolah/emission.md' } }
    ],
    edges: [
      { sourceType: 'doc', sourceKey: 'business/moolah/emission.md',
        targetType: 'domain', targetKey: 'moolah/emission', linkType: 'DESCRIBES', confidence: 1.0 }
    ],
    brokenRefs: []
  }, {
    ingestor: 'cron',
    nodes: [
      { type: 'cron', key: 'lista-cron:moolahEmissionWeeklySnapshot',
        data: { name: 'moolahEmissionWeeklySnapshot', repo: 'lista-cron',
                filePath: 'src/modules/moolah/emission.service.ts', lineNo: 42,
                handlerClass: 'MoolahEmissionService', confidence: 1.0 } }
    ],
    edges: [
      { sourceType: 'cron', sourceKey: 'lista-cron:moolahEmissionWeeklySnapshot',
        targetType: 'domain', targetKey: 'moolah', linkType: 'BELONGS_TO', confidence: 0.6 }
    ],
    brokenRefs: []
  }];
}

interface CountRow extends RowDataPacket { c: number; }
interface DomainParentRow extends RowDataPacket { child: string; parent: string | null; }
interface BuildMetaRow extends RowDataPacket { status: string; stats_json: string | null; }

async function clean() {
  const pool = getPool();
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    // Drop both production and any leftover staging tables.
    for (const t of [
      'panorama_cron_job', 'panorama_ref_link',
      'panorama_doc_concept_rel', 'panorama_concept',
      'panorama_code_ref', 'panorama_knowledge_doc',
      'panorama_business_domain'
    ]) {
      await pool.query(`DELETE FROM \`${t}\``);
      await pool.query(`DROP TABLE IF EXISTS \`${t}_new\``);
    }
    await pool.query(`DELETE FROM panorama_broken_ref`);
    await pool.query(`DELETE FROM panorama_build_meta`);
  } finally {
    await pool.query('SET FOREIGN_KEY_CHECKS = 1');
  }
}

describe('loader', () => {
  beforeEach(clean);
  afterAll(closePool);

  it('writes 2 domains, 1 doc, 1 cron after loadGraph', async () => {
    const merged = runOrchestrator(fixture());
    const buildId = await loadGraph({ merged, buildId: 'test-' + Date.now(), triggerType: 'manual' });
    expect(buildId).toMatch(/^test-/);

    const pool = getPool();
    const [d] = await pool.query<CountRow[]>('SELECT COUNT(*) c FROM panorama_business_domain');
    expect(d[0]?.c).toBe(2);
    const [doc] = await pool.query<CountRow[]>('SELECT COUNT(*) c FROM panorama_knowledge_doc');
    expect(doc[0]?.c).toBe(1);
    const [c] = await pool.query<CountRow[]>('SELECT COUNT(*) c FROM panorama_cron_job');
    expect(c[0]?.c).toBe(1);
  });

  it('domain parent_id resolves correctly after swap', async () => {
    const merged = runOrchestrator(fixture());
    await loadGraph({ merged, buildId: 'test-' + Date.now(), triggerType: 'manual' });

    const pool = getPool();
    const [rows] = await pool.query<DomainParentRow[]>(`
      SELECT child.name AS child, parent.name AS parent
      FROM panorama_business_domain child
      LEFT JOIN panorama_business_domain parent ON parent.id = child.parent_id
      WHERE child.name = 'emission'
    `);
    expect(rows[0]).toMatchObject({ child: 'emission', parent: 'moolah' });
  });

  it('writes a build_meta row with status=success and ingestor stats', async () => {
    const merged = runOrchestrator(fixture());
    const buildId = 'test-' + Date.now();
    await loadGraph({ merged, buildId, triggerType: 'manual' });

    const pool = getPool();
    const [rows] = await pool.query<BuildMetaRow[]>(
      `SELECT status, stats_json FROM panorama_build_meta WHERE build_id = ?`, [buildId]);
    expect(rows[0]?.status).toBe('success');
    const statsRaw = rows[0]?.stats_json;
    const stats = typeof statsRaw === 'string' ? JSON.parse(statsRaw) : (statsRaw ?? {});
    expect(stats.knowledge?.nodes).toBeGreaterThan(0);
  });
});
