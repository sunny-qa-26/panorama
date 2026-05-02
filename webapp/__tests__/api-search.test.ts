import { describe, expect, it } from 'vitest';
import { search } from '@/lib/search';

describe('GET /api/search', () => {
  it('returns results across multiple types for "emission"', async () => {
    const results = await search('emission');
    expect(results.length).toBeGreaterThan(0);
    const types = new Set(results.map(r => r.type));
    // emission lives as a domain, has a doc (emission.md), and likely a cron job (moolahEmission*)
    expect(types.size).toBeGreaterThanOrEqual(2);
  });

  it('returns results sorted by relevance score (desc)', async () => {
    const results = await search('moolah');
    expect(results.length).toBeGreaterThan(0);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });

  it('finds contracts by hex address', async () => {
    const results = await search('0x8F73b65B4caAf64FBA2aF91cC5D4a2A1318E5D8C');
    const contractMatch = results.find(r => r.type === 'contract');
    expect(contractMatch).toBeDefined();
    expect(contractMatch!.name).toBe('Moolah');
  });

  it('finds contracts by partial hex address (case-insensitive)', async () => {
    const results = await search('8f73b65b');
    const contractMatch = results.find(r => r.type === 'contract');
    expect(contractMatch).toBeDefined();
  });

  it('respects types filter', async () => {
    const results = await search('moolah', ['cron']);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.type === 'cron')).toBe(true);
  });

  it('returns at most 25 total results', async () => {
    const results = await search('a');  // very broad / common letter
    expect(results.length).toBeLessThanOrEqual(25);
  });

  it('returns href that routes correctly', async () => {
    const results = await search('emission');
    for (const r of results) {
      if (r.type === 'domain' || r.type === 'doc') {
        expect(r.href).toMatch(/^\/domain\/\d+$/);
      } else {
        expect(r.href).toMatch(/^\/node\/(cron|api|contract|entity|redis|route)\/\d+$/);
      }
    }
  });
});
