import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { ingestFrontend } from '../src/ingestors/frontend.js';

const FIXTURE = join(__dirname, 'fixtures/frontend');

describe('frontend ingestor', () => {
  it('extracts routes from createBrowserRouter calls', async () => {
    const out = await ingestFrontend({ monoRoot: join(FIXTURE, 'lista-mono') });
    const paths = out.nodes.filter(n => n.type === 'route').map(n => (n.data as { path: string }).path);
    expect(paths).toEqual(expect.arrayContaining(['/', '/dashboard', '/liquid-staking/BNB']));
  });

  it('captures lazy module path → component name', async () => {
    const out = await ingestFrontend({ monoRoot: join(FIXTURE, 'lista-mono') });
    const dash = out.nodes.find(n => (n.data as { path: string }).path === '/dashboard');
    const d = dash!.data as { component: string; isLazy: number };
    expect(d.component).toBe('Dashboard');
    expect(d.isLazy).toBe(1);
  });

  it('infers app_name from apps/{name}/src/router.tsx path', async () => {
    const out = await ingestFrontend({ monoRoot: join(FIXTURE, 'lista-mono') });
    const route = out.nodes.find(n => (n.data as { path: string }).path === '/dashboard');
    expect((route!.data as { appName: string }).appName).toBe('lista');
  });

  it('infers domain from modules/{domain}/page heuristic', async () => {
    const out = await ingestFrontend({ monoRoot: join(FIXTURE, 'lista-mono') });
    const edges = out.edges.filter(e => e.linkType === 'BELONGS_TO');
    // dashboard has no domain match (modules/dashboard not a business domain), so look for staking
    const bnbEdge = edges.find(e => e.targetKey === 'staking');
    expect(bnbEdge).toBeDefined();
  });
});
