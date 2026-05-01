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

describe('full pipeline (knowledge + cron → MySQL)', () => {
  afterAll(closePool);

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
