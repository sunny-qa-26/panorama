import { describe, expect, it } from 'vitest';
import { runOrchestrator } from '../src/orchestrator.js';
import type { IngestorOutput } from '../src/types.js';

function knowledgeFixture(): IngestorOutput {
  return {
    ingestor: 'knowledge',
    nodes: [
      { type: 'domain', key: 'moolah', data: { name: 'moolah', displayName: 'Moolah', parentKey: null } },
      { type: 'domain', key: 'moolah/emission', data: { name: 'emission', displayName: 'Emission', parentKey: 'moolah' } },
      { type: 'doc', key: 'business/moolah/emission.md', data: { path: 'business/moolah/emission.md' } },
      { type: 'code_ref', key: 'lista-cron:src/modules/moolah/emission.service.ts:42',
        data: { repo: 'lista-cron', filePath: 'src/modules/moolah/emission.service.ts', lineNo: 42 } }
    ],
    edges: [
      { sourceType: 'doc', sourceKey: 'business/moolah/emission.md',
        targetType: 'domain', targetKey: 'moolah/emission', linkType: 'DESCRIBES', confidence: 1.0 },
      { sourceType: 'doc', sourceKey: 'business/moolah/emission.md',
        targetType: 'code_ref', targetKey: 'lista-cron:src/modules/moolah/emission.service.ts:42',
        linkType: 'REFERENCES', confidence: 1.0 }
    ],
    brokenRefs: []
  };
}

function cronFixture(): IngestorOutput {
  return {
    ingestor: 'cron',
    nodes: [
      { type: 'cron', key: 'lista-cron:moolahEmissionWeeklySnapshot',
        data: { name: 'moolahEmissionWeeklySnapshot', repo: 'lista-cron',
                filePath: 'src/modules/moolah/emission.service.ts', lineNo: 42 } }
    ],
    edges: [
      { sourceType: 'cron', sourceKey: 'lista-cron:moolahEmissionWeeklySnapshot',
        targetType: 'domain', targetKey: 'moolah', linkType: 'BELONGS_TO', confidence: 0.6 }
    ],
    brokenRefs: []
  };
}

describe('orchestrator', () => {
  it('Strategy A: links cron to its domain via knowledge code_ref (confidence 1.0)', () => {
    const merged = runOrchestrator([knowledgeFixture(), cronFixture()]);
    const link = merged.edges.find(
      e => e.linkType === 'BELONGS_TO'
        && e.sourceKey === 'lista-cron:moolahEmissionWeeklySnapshot'
        && e.targetKey === 'moolah/emission'
    );
    expect(link).toBeDefined();
    expect(link!.confidence).toBe(1.0);
  });

  it('keeps the heuristic edge but with lower confidence than authoritative', () => {
    const merged = runOrchestrator([knowledgeFixture(), cronFixture()]);
    const heuristic = merged.edges.find(
      e => e.targetKey === 'moolah' && e.sourceKey === 'lista-cron:moolahEmissionWeeklySnapshot'
        && e.confidence < 1.0
    );
    expect(heuristic).toBeDefined();
  });

  it('deduplicates nodes across ingestors by (type,key)', () => {
    const merged = runOrchestrator([knowledgeFixture(), cronFixture()]);
    const cronNodes = merged.nodes.filter(n => n.type === 'cron');
    expect(cronNodes.length).toBe(1);
  });

  it('preserves brokenRefs from all ingestors', () => {
    const merged = runOrchestrator([
      { ...knowledgeFixture(), brokenRefs: [
        { docPath: 'a.md', docLineNo: 1, refRepo: 'lista-cron', refFilePath: 'x.ts', refLineNo: null, reason: 'file_not_found' }
      ]},
      cronFixture()
    ]);
    expect(merged.brokenRefs).toHaveLength(1);
  });

  it('Strategy api→entity: emits BOTH op_type when api has Repository<X> meta', () => {
    const knowledge: IngestorOutput = {
      ingestor: 'knowledge',
      nodes: [
        { type: 'domain', key: 'staking', data: { name: 'staking', displayName: 'Staking', parentKey: null } }
      ], edges: [], brokenRefs: []
    };
    const apiOut: IngestorOutput = {
      ingestor: 'api',
      nodes: [{
        type: 'api', key: 'lista-admin:GET /staking/summary',
        data: { httpMethod: 'GET', path: '/staking/summary', repo: 'lista-admin',
                filePath: 'src/modules/staking/staking.controller.ts', repositories: ['Stake'] }
      }],
      edges: [], brokenRefs: []
    };
    const entOut: IngestorOutput = {
      ingestor: 'entity',
      nodes: [{
        type: 'entity', key: 'lista-admin:stake',
        data: { tableName: 'stake', repo: 'lista-admin', filePath: 'src/entity/staking/Stake.entity.ts' }
      }],
      edges: [], brokenRefs: []
    };
    apiOut.edges.push({
      sourceType: 'api', sourceKey: 'lista-admin:GET /staking/summary',
      targetType: 'domain', targetKey: 'staking', linkType: 'BELONGS_TO', confidence: 0.6
    });

    const merged = runOrchestrator([knowledge, apiOut, entOut]);
    const link = merged.edges.find(
      e => e.sourceType === 'api' && e.sourceKey === 'lista-admin:GET /staking/summary'
        && e.targetType === 'entity' && e.targetKey === 'lista-admin:stake'
    );
    expect(link).toBeDefined();
    expect(link!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('Strategy api→cron via callCronApi paths', () => {
    const apiOut: IngestorOutput = {
      ingestor: 'api',
      nodes: [{
        type: 'api', key: 'lista-admin:POST /admin/rebuild',
        data: { httpMethod: 'POST', path: '/admin/rebuild', repo: 'lista-admin',
                filePath: 'src/modules/admin/admin.controller.ts',
                callCronApiPaths: ['/cron/moolahRebuild'] }
      }],
      edges: [], brokenRefs: []
    };
    const cronOut: IngestorOutput = {
      ingestor: 'cron',
      nodes: [{
        type: 'cron', key: 'lista-cron:moolahRebuild',
        data: { name: 'moolahRebuild', repo: 'lista-cron',
                filePath: 'src/modules/moolah/rebuild.service.ts' }
      }],
      edges: [], brokenRefs: []
    };
    const merged = runOrchestrator([apiOut, cronOut]);
    const link = merged.edges.find(
      e => e.sourceType === 'api' && e.targetType === 'cron'
        && e.sourceKey === 'lista-admin:POST /admin/rebuild'
        && e.targetKey === 'lista-cron:moolahRebuild'
    );
    expect(link).toBeDefined();
    expect(link!.linkType).toBe('CALLS');
    expect(link!.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('Strategy *→redis: when redis source_file matches a cron/api file_path', () => {
    const cronOut: IngestorOutput = {
      ingestor: 'cron',
      nodes: [{
        type: 'cron', key: 'lista-cron:moolahEmissionTask',
        data: { name: 'moolahEmissionTask', repo: 'lista-cron',
                filePath: 'src/modules/moolah/emission.service.ts' }
      }],
      edges: [], brokenRefs: []
    };
    const redisOut: IngestorOutput = {
      ingestor: 'redis',
      nodes: [{
        type: 'redis', key: 'lista-cron:moolah:emission:pending_root',
        data: { keyPattern: 'moolah:emission:pending_root', sourceRepo: 'lista-cron',
                sourceFile: 'src/modules/moolah/emission.service.ts', sourceLine: 42,
                opTypes: ['READ', 'WRITE'] }
      }],
      edges: [], brokenRefs: []
    };
    const merged = runOrchestrator([cronOut, redisOut]);
    const link = merged.edges.find(
      e => e.sourceType === 'cron' && e.targetType === 'redis'
        && e.sourceKey === 'lista-cron:moolahEmissionTask'
        && e.targetKey === 'lista-cron:moolah:emission:pending_root'
    );
    expect(link).toBeDefined();
    expect(link!.linkType).toBe('CALLS');
    expect((link!.meta as { resource?: string } | undefined)?.resource).toBe('redis');
  });

  it('Strategy route→api: when route module path imports from same app api/', () => {
    const routeOut: IngestorOutput = {
      ingestor: 'frontend',
      nodes: [{
        type: 'route', key: 'lista:/dashboard',
        data: { appName: 'lista', path: '/dashboard',
                modulePath: '@/modules/dashboard/page',
                repo: 'lista-mono', filePath: 'apps/lista/src/router.tsx' }
      }],
      edges: [], brokenRefs: []
    };
    const apiOut: IngestorOutput = {
      ingestor: 'api',
      nodes: [{
        type: 'api', key: 'lista-admin:GET /dashboard/data',
        data: { httpMethod: 'GET', path: '/dashboard/data', repo: 'lista-admin',
                filePath: 'src/modules/dashboard/dashboard.controller.ts' }
      }],
      edges: [], brokenRefs: []
    };
    const merged = runOrchestrator([routeOut, apiOut]);
    const link = merged.edges.find(
      e => e.sourceType === 'route' && e.targetType === 'api'
        && e.sourceKey === 'lista:/dashboard'
        && e.targetKey === 'lista-admin:GET /dashboard/data'
    );
    expect(link).toBeDefined();
    expect(link!.confidence).toBeLessThanOrEqual(0.5);
  });
});
