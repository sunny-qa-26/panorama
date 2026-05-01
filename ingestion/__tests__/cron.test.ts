import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { ingestCron } from '../src/ingestors/cron.js';

const FIXTURE = join(__dirname, 'fixtures/cron');

describe('cron ingestor', () => {
  it('extracts @XxlJobHandler decorators with the job id literal', async () => {
    const out = await ingestCron({
      reposPath: FIXTURE,
      repos: ['lista-cron']
    });
    const cronJobs = out.nodes.filter(n => n.type === 'cron');
    expect(cronJobs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'cron',
        key: 'lista-cron:moolahEmissionWeeklySnapshot',
        data: expect.objectContaining({
          name: 'moolahEmissionWeeklySnapshot',
          handlerClass: 'MoolahEmissionService',
          repo: 'lista-cron',
          filePath: 'src/modules/moolah/emission.service.ts'
        })
      }),
      expect.objectContaining({
        key: 'lista-cron:moolahEmissionAcceptRoot'
      })
    ]));
  });

  it('extracts @Cron decorators with schedule expression', async () => {
    const out = await ingestCron({
      reposPath: FIXTURE,
      repos: ['lista-bot']
    });
    const cronJobs = out.nodes.filter(n => n.type === 'cron');
    const buyback = cronJobs.find(n => {
      const data = n.data as { handlerClass?: string; name?: string };
      return data.handlerClass === 'BuybackService' && data.name === 'runBuyback';
    });
    expect(buyback).toBeDefined();
    const data = buyback!.data as { schedule?: string };
    expect(data.schedule).toBe('CronExpression.EVERY_DAY_AT_MIDNIGHT');
  });

  it('captures file_path + line_no for the decorator location', async () => {
    const out = await ingestCron({ reposPath: FIXTURE, repos: ['lista-cron'] });
    const job = out.nodes.find(n => {
      const data = n.data as { name?: string };
      return n.type === 'cron' && data.name === 'moolahEmissionWeeklySnapshot';
    });
    expect(job).toBeDefined();
    const data = job!.data as { lineNo?: number };
    expect(data.lineNo).toBeGreaterThan(0);
  });

  it('infers domainKey from path when "src/modules/{domain}" is present', async () => {
    const out = await ingestCron({ reposPath: FIXTURE, repos: ['lista-cron'] });
    const edge = out.edges.find(
      e => e.linkType === 'BELONGS_TO'
        && e.sourceKey === 'lista-cron:moolahEmissionWeeklySnapshot'
    );
    expect(edge).toBeDefined();
    expect(edge!.targetKey).toBe('moolah');
    expect(edge!.confidence).toBeGreaterThanOrEqual(0.6);
  });
});
