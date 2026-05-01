import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrokenRef, IngestorNode } from './types.js';

interface Opts { nodes: IngestorNode[]; reposPath: string; }

export async function detectBrokenRefs({ nodes, reposPath }: Opts): Promise<BrokenRef[]> {
  const broken: BrokenRef[] = [];
  for (const n of nodes) {
    if (n.type !== 'code_ref') continue;
    const data = n.data as {
      repo?: string; filePath?: string;
      lineNo?: number | null; docPath?: string; docLineNo?: number | null;
    };
    if (!data.repo || !data.filePath) continue;
    const repo = data.repo;
    const filePath = data.filePath;
    const lineNo = data.lineNo ?? null;
    const docPath = data.docPath ?? 'unknown';
    const docLineNo = data.docLineNo ?? null;

    const abs = join(reposPath, repo, filePath);
    const fileStat = await stat(abs).catch(() => null);
    if (!fileStat || !fileStat.isFile()) {
      broken.push({ docPath, docLineNo, refRepo: repo, refFilePath: filePath, refLineNo: lineNo, reason: 'file_not_found' });
      continue;
    }

    if (lineNo !== null) {
      const content = await readFile(abs, 'utf8');
      const lines = content.split('\n');
      if (lineNo < 1 || lineNo > lines.length) {
        broken.push({ docPath, docLineNo, refRepo: repo, refFilePath: filePath, refLineNo: lineNo, reason: 'invalid_pattern' });
      }
    }
  }
  return broken;
}
