import { describe, expect, it } from 'vitest';
import { fetchTreeChildren } from '@/lib/domain';

describe('GET /api/tree', () => {
  it('returns top-level domains when parent_id is omitted', async () => {
    const rows = await fetchTreeChildren(null);
    const names = rows.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['moolah']));
    for (const r of rows) {
      expect(r.parentId).toBeNull();
      expect(typeof r.id).toBe('number');
    }
  });

  it('returns sub-domains for a given parent_id', async () => {
    const top = await fetchTreeChildren(null);
    const moolah = top.find((r) => r.name === 'moolah');
    expect(moolah).toBeDefined();
    const children = await fetchTreeChildren(moolah!.id);
    expect(children.length).toBeGreaterThan(0);
    expect(children.every((c) => c.parentId === moolah!.id)).toBe(true);
  });

  it('flags hasChildren=true when domain has descendants', async () => {
    const top = await fetchTreeChildren(null);
    const moolah = top.find((r) => r.name === 'moolah');
    expect(moolah!.hasChildren).toBe(true);
  });
});
