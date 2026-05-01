import { describe, expect, it } from 'vitest';
import { fetchDomainDetail, fetchTreeChildren } from '@/lib/domain';

describe('GET /api/domain/{id}', () => {
  it('returns domain row + doc + cron list + stats', async () => {
    const top = await fetchTreeChildren(null);
    const moolah = top.find(r => r.name === 'moolah');
    expect(moolah).toBeDefined();
    const children = await fetchTreeChildren(moolah!.id);
    const emission = children.find(c => c.name === 'emission');
    if (!emission) throw new Error('test data missing — run pnpm rebuild first');

    const detail = await fetchDomainDetail(emission.id);
    expect(detail).not.toBeNull();
    expect(detail!.domain.name).toBe('emission');
    expect(detail!.docs.length).toBeGreaterThanOrEqual(1);
    expect(detail!.docs[0]).toHaveProperty('frontmatter');
    expect(detail!.crons.length).toBeGreaterThanOrEqual(1);
    expect(detail!.stats).toMatchObject({
      cronCount: expect.any(Number),
      apiCount: expect.any(Number),
      contractCount: expect.any(Number),
      storageCount: expect.any(Number)
    });
  });

  it('returns null for non-existent id', async () => {
    const detail = await fetchDomainDetail(99_999_999);
    expect(detail).toBeNull();
  });
});
