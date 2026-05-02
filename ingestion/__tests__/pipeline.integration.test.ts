import { afterAll, describe, expect, it } from 'vitest';
import type { RowDataPacket } from 'mysql2';
import { join } from 'node:path';
import { ingestKnowledge } from '../src/ingestors/knowledge.js';
import { ingestCron } from '../src/ingestors/cron.js';
import { runOrchestrator } from '../src/orchestrator.js';
import { detectBrokenRefs } from '../src/broken-refs.js';
import { loadGraph } from '../src/loader.js';
import { getPool, closePool } from '../src/db.js';

interface CronDomainRow extends RowDataPacket {
  name: string;
  domain: string | null;
}

/**
 * THIS TEST IS DESTRUCTIVE: it calls loader.loadGraph with fixture data,
 * which calls swapStagingTables — atomically replacing the production
 * panorama_* tables with the tiny test fixture (2 domains, 1 cron, etc).
 *
 * Running this test wipes a real Panorama rebuild. Phase 1 acceptance
 * documented this as the "shared-DB race"; Task 54 partially fixed it
 * but only this test is the truly destructive one.
 *
 * Default: SKIPPED. Set `ENABLE_DESTRUCTIVE_TESTS=1` to opt in.
 *
 * After running, you MUST `pnpm run rebuild` to restore real data.
 */
const RUN_DESTRUCTIVE = process.env.ENABLE_DESTRUCTIVE_TESTS === '1';
const describeDestructive = RUN_DESTRUCTIVE ? describe : describe.skip;

describeDestructive('full pipeline (knowledge + cron → MySQL) [DESTRUCTIVE]', () => {
  afterAll(async () => {
    const pool = getPool();
    await pool.query("DELETE FROM panorama_broken_ref WHERE build_id LIKE 'integ-%'");
    await pool.query("DELETE FROM panorama_build_meta WHERE build_id LIKE 'integ-%'");
    await closePool();
  });

  it('runs end-to-end on combined fixtures and produces queryable results', async () => {
    const knowledgeOut = await ingestKnowledge({
      knowledgeRoot: join(__dirname, 'fixtures/knowledge')
    });
    const cronOut = await ingestCron({
      reposPath: join(__dirname, 'fixtures/cron'),
      repos: ['lista-cron', 'lista-bot']
    });
    const merged = runOrchestrator([knowledgeOut, cronOut]);
    merged.brokenRefs.push(...await detectBrokenRefs({
      nodes: merged.nodes,
      reposPath: join(__dirname, 'fixtures/cron')
    }));

    const buildId = 'integ-' + Date.now();
    await loadGraph({ merged, buildId, triggerType: 'manual' });

    const pool = getPool();
    const [crons] = await pool.query<CronDomainRow[]>(`
      SELECT cj.name, bd.knowledge_path AS domain
      FROM panorama_cron_job cj
      LEFT JOIN panorama_business_domain bd ON bd.id = cj.domain_id
      WHERE cj.repo = 'lista-cron'
    `);
    expect(crons.length).toBeGreaterThanOrEqual(2);
    expect(crons.find(r => r.name === 'moolahEmissionWeeklySnapshot')?.domain).toMatch(/moolah/);
  });
});
