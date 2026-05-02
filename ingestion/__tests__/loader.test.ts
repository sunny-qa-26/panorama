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
      'panorama_api_cron_call', 'panorama_route_api_call',
      'panorama_api_redis_op', 'panorama_cron_redis_op',
      'panorama_api_entity_op', 'panorama_api_contract_call', 'panorama_cron_contract_call',
      'panorama_redis_key', 'panorama_frontend_route', 'panorama_contract',
      'panorama_entity', 'panorama_api_endpoint',
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

  it('writes all 5 new entity types after loadGraph', async () => {
    const merged = runOrchestrator(fixturePhase2());
    await loadGraph({ merged, buildId: 'p2-' + Date.now(), triggerType: 'manual' });

    const pool = getPool();
    const [api] = await pool.query<CountRow[]>('SELECT COUNT(*) c FROM panorama_api_endpoint');
    expect(api[0]?.c).toBe(1);
    const [ent] = await pool.query<CountRow[]>('SELECT COUNT(*) c FROM panorama_entity');
    expect(ent[0]?.c).toBe(1);
    const [con] = await pool.query<CountRow[]>('SELECT COUNT(*) c FROM panorama_contract');
    expect(con[0]?.c).toBe(1);
    const [r] = await pool.query<CountRow[]>('SELECT COUNT(*) c FROM panorama_frontend_route');
    expect(r[0]?.c).toBe(1);
    const [rk] = await pool.query<CountRow[]>('SELECT COUNT(*) c FROM panorama_redis_key');
    expect(rk[0]?.c).toBe(1);
  });
});

function fixturePhase2(): IngestorOutput[] {
  return [
    {
      ingestor: 'knowledge',
      nodes: [
        { type: 'domain', key: 'moolah', data: { name: 'moolah', displayName: 'Moolah', parentKey: null } }
      ], edges: [], brokenRefs: []
    },
    {
      ingestor: 'api',
      nodes: [{
        type: 'api', key: 'lista-admin:GET /moolah/list',
        data: { httpMethod: 'GET', path: '/moolah/list', repo: 'lista-admin',
                filePath: 'src/modules/moolah/moolah.controller.ts', lineNo: 10,
                authRequired: 0, controller: 'MoolahController',
                description: null, confidence: 1.0, callCronApiPaths: [], repositories: [] }
      }],
      edges: [{
        sourceType: 'api', sourceKey: 'lista-admin:GET /moolah/list',
        targetType: 'domain', targetKey: 'moolah', linkType: 'BELONGS_TO', confidence: 0.6
      }],
      brokenRefs: []
    },
    {
      ingestor: 'entity',
      nodes: [{
        type: 'entity', key: 'lista-admin:moolah_market',
        data: { tableName: 'moolah_market', repo: 'lista-admin',
                filePath: 'src/entity/moolah/moolahMarket.entity.ts',
                columns: [{ name: 'id', type: 'number', nullable: false, isPrimary: true }],
                description: null }
      }],
      edges: [{
        sourceType: 'entity', sourceKey: 'lista-admin:moolah_market',
        targetType: 'domain', targetKey: 'moolah', linkType: 'BELONGS_TO', confidence: 0.6
      }],
      brokenRefs: []
    },
    {
      ingestor: 'contract',
      nodes: [{
        type: 'contract', key: 'bsc-mainnet:0x8f73b65b4caaf64fba2af91cc5d4a2a1318e5d8c',
        data: { name: 'Moolah', address: '0x8F73b65B4caAf64FBA2aF91cC5D4a2A1318E5D8C',
                chain: 'bsc-mainnet', abiPath: null, deployedAt: null, notes: null }
      }],
      edges: [], brokenRefs: []
    },
    {
      ingestor: 'frontend',
      nodes: [{
        type: 'route', key: 'lista:/dashboard',
        data: { appName: 'lista', path: '/dashboard', component: 'Dashboard',
                repo: 'lista-mono', filePath: 'apps/lista/src/router.tsx',
                isLazy: 1, modulePath: '@/modules/dashboard/page' }
      }],
      edges: [], brokenRefs: []
    },
    {
      ingestor: 'redis',
      nodes: [{
        type: 'redis', key: 'lista-cron:moolah:emission:pending_root',
        data: { keyPattern: 'moolah:emission:pending_root', redisType: 'unknown',
                ttlSeconds: null, description: null, sourceRepo: 'lista-cron',
                sourceFile: 'src/modules/moolah/emission.service.ts', sourceLine: 42,
                confidence: 1.0, opTypes: ['READ', 'WRITE'] }
      }],
      edges: [], brokenRefs: []
    }
  ];
}
