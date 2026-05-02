import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { ingestRedis } from '../src/ingestors/redis.js';

const FIXTURE = join(__dirname, 'fixtures/redis');

describe('redis ingestor', () => {
  it('extracts string-literal redis keys at confidence 1.0', async () => {
    const out = await ingestRedis({ reposPath: FIXTURE, repos: ['lista-cron'] });
    const keys = out.nodes.filter(n => n.type === 'redis').map(n => (n.data as { keyPattern: string; confidence: number }));
    const root = keys.find(k => k.keyPattern === 'moolah:emission:pending_root');
    expect(root).toBeDefined();
    expect(root!.confidence).toBe(1.0);
  });

  it('normalises template-literal vars to {var} at confidence 0.8', async () => {
    const out = await ingestRedis({ reposPath: FIXTURE, repos: ['lista-cron'] });
    const claim = out.nodes.find(n => n.type === 'redis' && (n.data as { keyPattern: string }).keyPattern === 'moolah:claim_status:{addr}');
    expect(claim).toBeDefined();
    expect((claim!.data as { confidence: number }).confidence).toBe(0.8);
  });

  it('skips expression-keys (KEY_PREFIX + ":" + ...)', async () => {
    const out = await ingestRedis({ reposPath: FIXTURE, repos: ['lista-cron'] });
    const keys = out.nodes.map(n => (n.data as { keyPattern: string }).keyPattern);
    expect(keys.filter(k => k.includes('foo:bar'))).toHaveLength(0);
  });

  it('derives op_type from method name', async () => {
    const out = await ingestRedis({ reposPath: FIXTURE, repos: ['lista-cron'] });
    // The fixture has GET on pending_root, SET on claim_status, EXPIRE on pending_root.
    // For Phase 2 we only emit one node per (key, repo) (UNIQUE constraint), but op_types accumulate via edges.
    // Simpler design for Phase 2: emit per-call edge meta describing op_type, OR emit a single representative node.
    // The test asserts at least one EXPIRE-typed call exists in the metadata.
    const expiry = out.nodes.find(n => {
      const d = n.data as { keyPattern: string; opTypes?: string[] };
      return d.keyPattern === 'moolah:emission:pending_root' && (d.opTypes ?? []).includes('EXPIRE');
    });
    expect(expiry).toBeDefined();
  });

  it('captures source_file + source_line', async () => {
    const out = await ingestRedis({ reposPath: FIXTURE, repos: ['lista-cron'] });
    const root = out.nodes.find(n => n.type === 'redis' && (n.data as { keyPattern: string }).keyPattern === 'moolah:emission:pending_root');
    const d = root!.data as { sourceFile: string; sourceLine: number };
    expect(d.sourceFile).toBe('src/modules/moolah/cache.service.ts');
    expect(d.sourceLine).toBeGreaterThan(0);
  });
});
