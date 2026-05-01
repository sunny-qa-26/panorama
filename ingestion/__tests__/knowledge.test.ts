import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { ingestKnowledge } from '../src/ingestors/knowledge.js';

const FIXTURE = join(__dirname, 'fixtures/knowledge');

describe('knowledge ingestor', () => {
  it('emits BusinessDomain nodes for moolah and infrastructure', async () => {
    const out = await ingestKnowledge({ knowledgeRoot: FIXTURE });
    const domainKeys = out.nodes.filter(n => n.type === 'domain').map(n => n.key);
    expect(domainKeys).toEqual(expect.arrayContaining(['moolah', 'moolah/emission']));
  });

  it('skips files starting with underscore', async () => {
    const out = await ingestKnowledge({ knowledgeRoot: FIXTURE });
    const docPaths = out.nodes
      .filter(n => n.type === 'doc')
      .map(n => (n.data as { path: string }).path);
    expect(docPaths).not.toContain('business/_template.md');
  });

  it('parses frontmatter concepts and emits one Concept node per name', async () => {
    const out = await ingestKnowledge({ knowledgeRoot: FIXTURE });
    const conceptKeys = out.nodes.filter(n => n.type === 'concept').map(n => n.key);
    expect(conceptKeys).toEqual(expect.arrayContaining(['emission', 'merkle_root']));
  });

  it('emits DESCRIBES edge from doc to its domain', async () => {
    const out = await ingestKnowledge({ knowledgeRoot: FIXTURE });
    const describes = out.edges.filter(e => e.linkType === 'DESCRIBES');
    expect(describes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceType: 'doc',
        sourceKey: 'business/moolah/emission.md',
        targetType: 'domain',
        targetKey: 'moolah/emission',
        confidence: 1.0
      })
    ]));
  });

  it('extracts code references with file:line patterns', async () => {
    const out = await ingestKnowledge({ knowledgeRoot: FIXTURE });
    const refs = out.nodes.filter(n => n.type === 'code_ref').map(n => n.key);
    expect(refs).toEqual(expect.arrayContaining([
      'lista-cron:src/modules/moolah/emission.service.ts:42',
      'lista-cron:src/modules/moolah/snapshot.service.ts:88'
    ]));
  });
});
