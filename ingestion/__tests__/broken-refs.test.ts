import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { detectBrokenRefs } from '../src/broken-refs.js';
import type { IngestorNode } from '../src/types.js';

const REPOS = join(__dirname, 'fixtures/broken-refs');

function ref(repo: string, filePath: string, lineNo: number | null, docPath = 'a.md'): IngestorNode {
  return {
    type: 'code_ref',
    key: `${repo}:${filePath}:${lineNo ?? ''}`,
    data: { repo, filePath, lineNo, docPath, docLineNo: 1 }
  };
}

describe('broken-refs detector', () => {
  it('flags missing file', async () => {
    const nodes = [ref('lista-cron', 'src/missing.ts', 5)];
    const broken = await detectBrokenRefs({ nodes, reposPath: REPOS });
    expect(broken).toEqual([
      expect.objectContaining({ refFilePath: 'src/missing.ts', reason: 'file_not_found' })
    ]);
  });

  it('passes a valid file:line that resolves to existing content', async () => {
    const nodes = [ref('lista-cron', 'src/exists.ts', 3)];
    const broken = await detectBrokenRefs({ nodes, reposPath: REPOS });
    expect(broken).toEqual([]);
  });

  it('passes when lineNo is null (file exists, line not asserted)', async () => {
    const nodes = [ref('lista-cron', 'src/exists.ts', null)];
    const broken = await detectBrokenRefs({ nodes, reposPath: REPOS });
    expect(broken).toEqual([]);
  });
});
