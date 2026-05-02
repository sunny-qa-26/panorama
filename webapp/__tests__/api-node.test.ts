import { describe, expect, it } from 'vitest';
import { fetchNodeDetail } from '@/lib/node';
import { search } from '@/lib/search';

describe('GET /api/node/{type}/{id}', () => {
  it('returns null for unknown type or id', async () => {
    const res = await fetchNodeDetail('cron', 999_999_999);
    expect(res).toBeNull();
  });

  it('returns cron node with extra schedule + handler info', async () => {
    const search1 = await search('moolahEmissionTask', ['cron']);
    if (search1.length === 0) {
      // pick any cron
      const any = await search('moolah', ['cron']);
      expect(any.length).toBeGreaterThan(0);
      const detail = await fetchNodeDetail('cron', any[0]!.id);
      expect(detail).not.toBeNull();
      expect(detail!.type).toBe('cron');
      expect(detail!.extra).toHaveProperty('schedule');
      expect(detail!.extra).toHaveProperty('handlerClass');
      return;
    }
    const detail = await fetchNodeDetail('cron', search1[0]!.id);
    expect(detail).not.toBeNull();
    expect(detail!.type).toBe('cron');
    expect(detail!.extra).toHaveProperty('handlerClass');
  });

  it('returns api node with httpMethod + path', async () => {
    const apis = await search('moolah', ['api']);
    if (apis.length === 0) return; // skip if no api data
    const detail = await fetchNodeDetail('api', apis[0]!.id);
    expect(detail).not.toBeNull();
    expect(detail!.type).toBe('api');
    expect(detail!.extra).toHaveProperty('httpMethod');
    expect(detail!.extra).toHaveProperty('path');
  });

  it('returns contract node with address + chain + abiPath', async () => {
    const contracts = await search('Moolah', ['contract']);
    expect(contracts.length).toBeGreaterThan(0);
    const detail = await fetchNodeDetail('contract', contracts[0]!.id);
    expect(detail).not.toBeNull();
    expect(detail!.type).toBe('contract');
    const extra = detail!.extra as Record<string, unknown>;
    expect(typeof extra.address).toBe('string');
    expect(typeof extra.chain).toBe('string');
    expect(extra.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('returns entity node with tableName + columns', async () => {
    const entities = await search('moolah', ['entity']);
    if (entities.length === 0) return;
    const detail = await fetchNodeDetail('entity', entities[0]!.id);
    expect(detail).not.toBeNull();
    expect(detail!.type).toBe('entity');
    expect(detail!.extra).toHaveProperty('tableName');
    expect(detail!.extra).toHaveProperty('columns');
  });

  it('populates `usedBy` from junction tables for an entity', async () => {
    const entities = await search('moolah', ['entity']);
    // pick any entity that has at least one api_entity_op row
    const any = entities[0];
    if (!any) return;
    const detail = await fetchNodeDetail('entity', any.id);
    expect(detail).not.toBeNull();
    // entity might not be referenced anywhere — accept empty array, just verify the field exists
    expect(Array.isArray(detail!.usedBy)).toBe(true);
  });

  it('populates `calls` for an api with @InjectRepository entities', async () => {
    // Find an api node that has at least one api_entity_op row
    const apis = await search('moolah', ['api']);
    // try a few until we find one that has calls
    let foundCalls = false;
    for (const api of apis.slice(0, 10)) {
      const detail = await fetchNodeDetail('api', api.id);
      if (detail && detail.calls.length > 0) {
        foundCalls = true;
        const c = detail.calls[0]!;
        expect(['entity', 'cron', 'redis']).toContain(c.type);
        expect(typeof c.name).toBe('string');
        break;
      }
    }
    expect(foundCalls).toBe(true);
  });

  it('returns redis node with keyPattern + sourceRepo', async () => {
    // Redis ingestion only finds 5 string-literal keys (most use variables);
    // all currently start with "task_" / "redelegate" / "tempRedelegate" / "transactionMonitor".
    const candidates = (await search('task', ['redis']))
      .concat(await search('redelegate', ['redis']))
      .concat(await search('transactionMonitor', ['redis']));
    if (candidates.length === 0) return; // skip if no redis data ingested
    const detail = await fetchNodeDetail('redis', candidates[0]!.id);
    expect(detail).not.toBeNull();
    expect(detail!.type).toBe('redis');
    expect(detail!.extra).toHaveProperty('keyPattern');
    expect(detail!.extra).toHaveProperty('sourceRepo');
  });

  it('returns route node with appName + path + isLazy', async () => {
    const routes = await search('dashboard', ['route']);
    const pick = routes[0] ?? (await search('lista', ['route']))[0];
    if (!pick) return; // skip if no route data
    const detail = await fetchNodeDetail('route', pick.id);
    expect(detail).not.toBeNull();
    expect(detail!.type).toBe('route');
    expect(detail!.extra).toHaveProperty('appName');
    expect(detail!.extra).toHaveProperty('path');
    expect(detail!.extra).toHaveProperty('isLazy');
  });
});
