import { readFile, readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { IngestorNode, IngestorEdge, IngestorOutput } from '../types.js';

interface Opts { knowledgeRoot: string; }

const ROW_RE = /^\|\s*([^|]+?)\s*\|\s*`?(0x[a-fA-F0-9]{40})`?\s*\|/;
const ONCHAIN_FILE_RE = /^([a-z0-9-]+)\.md$/;

async function listOnchainFiles(onchainDir: string): Promise<{ chain: string; abs: string }[]> {
  const entries = await readdir(onchainDir, { withFileTypes: true }).catch(() => []);
  const out: { chain: string; abs: string }[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const m = e.name.match(ONCHAIN_FILE_RE);
    if (!m || !m[1]) continue;
    if (e.name === 'README.md' || e.name === 'wallets.md') continue;
    out.push({ chain: m[1], abs: join(onchainDir, e.name) });
  }
  return out.sort((a, b) => a.chain.localeCompare(b.chain));
}

async function listAbiBasenames(abisDir: string): Promise<Set<string>> {
  const entries = await readdir(abisDir, { withFileTypes: true }).catch(() => []);
  const set = new Set<string>();
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.json')) {
      set.add(basename(e.name, '.json'));
    }
  }
  return set;
}

export async function ingestContract(opts: Opts): Promise<IngestorOutput> {
  const onchainDir = join(opts.knowledgeRoot, 'onchain');
  if (!(await stat(onchainDir).catch(() => null))) throw new Error(`contract: ${onchainDir} not found`);

  const files = await listOnchainFiles(onchainDir);
  const abis = await listAbiBasenames(join(onchainDir, 'abis'));
  const nodes: IngestorNode[] = [];
  const seen = new Set<string>();

  for (const { chain, abs } of files) {
    const raw = await readFile(abs, 'utf8').catch(() => null);
    if (!raw) continue;
    const lines = raw.split('\n');
    for (const line of lines) {
      const m = line.match(ROW_RE);
      if (!m) continue;
      const name = m[1];
      const address = m[2];
      if (!name || !address) continue;
      if (name === '合约' || /^Contract$/i.test(name) || name.startsWith('-')) continue;
      const dedup = `${chain}:${address.toLowerCase()}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      const abiPath = abis.has(name) ? `onchain/abis/${name}.json` : null;
      nodes.push({
        type: 'contract',
        key: dedup,
        data: { name, address, chain, abiPath, deployedAt: null, notes: null }
      });
    }
  }

  return { ingestor: 'contract', nodes, edges: [] as IngestorEdge[], brokenRefs: [] };
}
