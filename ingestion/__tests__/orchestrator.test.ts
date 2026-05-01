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
});
