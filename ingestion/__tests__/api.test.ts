import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { ingestApi } from '../src/ingestors/api.js';

const FIXTURE = join(__dirname, 'fixtures/api');

describe('api ingestor', () => {
  it('extracts @Controller + @Get/@Post into ApiEndpoint nodes', async () => {
    const out = await ingestApi({ reposPath: FIXTURE, repos: ['lista-admin'] });
    const apis = out.nodes.filter(n => n.type === 'api');
    const paths = apis.map(n => {
      const data = n.data as { httpMethod: string; path: string };
      return `${data.httpMethod} ${data.path}`;
    });
    expect(paths).toEqual(expect.arrayContaining([
      'GET /moolah/vault/search',
      'POST /moolah/vault/create',
      'POST /moolah/rebuild',
      'GET /staking/summary'
    ]));
  });

  it('captures controller, file_path, line_no', async () => {
    const out = await ingestApi({ reposPath: FIXTURE, repos: ['lista-admin'] });
    const search = out.nodes.find(n => {
      const d = n.data as { httpMethod: string; path: string };
      return d.httpMethod === 'GET' && d.path === '/moolah/vault/search';
    });
    expect(search).toBeDefined();
    const d = search!.data as { controller: string; filePath: string; lineNo: number };
    expect(d.controller).toBe('MoolahController');
    expect(d.filePath).toBe('src/modules/moolah/moolah.controller.ts');
    expect(d.lineNo).toBeGreaterThan(0);
  });

  it('marks auth_required=1 when @UseGuards is present on the method or class', async () => {
    const out = await ingestApi({ reposPath: FIXTURE, repos: ['lista-admin'] });
    const create = out.nodes.find(n => {
      const d = n.data as { httpMethod: string; path: string };
      return d.httpMethod === 'POST' && d.path === '/moolah/vault/create';
    });
    const d = create!.data as { authRequired: number };
    expect(d.authRequired).toBe(1);

    const search = out.nodes.find(n => {
      const dd = n.data as { httpMethod: string; path: string };
      return dd.httpMethod === 'GET' && dd.path === '/moolah/vault/search';
    });
    expect((search!.data as { authRequired: number }).authRequired).toBe(0);
  });

  it('infers domainKey from src/modules/{domain}/ path', async () => {
    const out = await ingestApi({ reposPath: FIXTURE, repos: ['lista-admin'] });
    const edges = out.edges.filter(e => e.linkType === 'BELONGS_TO');
    expect(edges.find(e => e.sourceKey.includes(':GET /moolah/vault/search') && e.targetKey === 'moolah')).toBeDefined();
    expect(edges.find(e => e.sourceKey.includes(':GET /staking/summary') && e.targetKey === 'staking')).toBeDefined();
  });

  it('extracts callCronApi paths into meta for orchestrator Strategy api→cron', async () => {
    const out = await ingestApi({ reposPath: FIXTURE, repos: ['lista-admin'] });
    const rebuild = out.nodes.find(n => {
      const d = n.data as { path: string };
      return d.path === '/moolah/rebuild';
    });
    const d = rebuild!.data as { callCronApiPaths: string[] };
    expect(d.callCronApiPaths).toContain('/cron/moolahRebuild');
  });

  it('extracts @InjectRepository entity names into meta for Strategy api→entity', async () => {
    const out = await ingestApi({ reposPath: FIXTURE, repos: ['lista-admin'] });
    const summary = out.nodes.find(n => {
      const d = n.data as { path: string };
      return d.path === '/staking/summary';
    });
    const d = summary!.data as { repositories: string[] };
    expect(d.repositories).toContain('Stake');
  });
});
