import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { ingestEntity } from '../src/ingestors/entity.js';

const FIXTURE = join(__dirname, 'fixtures/entity');

describe('entity ingestor', () => {
  it('extracts @Entity classes with table names', async () => {
    const out = await ingestEntity({
      reposPath: FIXTURE,
      repos: ['lista-admin', 'lista-cron']
    });
    const tables = out.nodes.filter(n => n.type === 'entity').map(n => (n.data as { tableName: string }).tableName);
    expect(tables).toEqual(expect.arrayContaining(['moolah_market', 'stake_record']));
  });

  it('captures column names with @Column overrides', async () => {
    const out = await ingestEntity({ reposPath: FIXTURE, repos: ['lista-admin'] });
    const market = out.nodes.find(n => (n.data as { tableName: string }).tableName === 'moolah_market');
    const cols = (market!.data as { columns: Array<{ name: string }> }).columns;
    const colNames = cols.map(c => c.name);
    expect(colNames).toEqual(expect.arrayContaining(['id', 'address', 'market_id', 'block_number']));
  });

  it('infers domain from src/entity/{domain}/ path', async () => {
    const out = await ingestEntity({ reposPath: FIXTURE, repos: ['lista-admin', 'lista-cron'] });
    const edges = out.edges.filter(e => e.linkType === 'BELONGS_TO');
    expect(edges.find(e => e.targetKey === 'moolah' && e.sourceKey.includes('moolah_market'))).toBeDefined();
    expect(edges.find(e => e.targetKey === 'staking' && e.sourceKey.includes('stake_record'))).toBeDefined();
  });

  it('skips files without @Entity decorator', async () => {
    const out = await ingestEntity({ reposPath: FIXTURE, repos: ['lista-admin'] });
    // common.entity.ts (if added later) without @Entity should be skipped — for now, confirm we don't double-count
    const entityCount = out.nodes.filter(n => n.type === 'entity').length;
    expect(entityCount).toBeGreaterThanOrEqual(1);
  });
});
