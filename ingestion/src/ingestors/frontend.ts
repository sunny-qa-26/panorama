import { Project, SyntaxKind, type ObjectLiteralExpression, type ArrayLiteralExpression, type CallExpression } from 'ts-morph';
import { join, posix } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import type { IngestorNode, IngestorEdge, IngestorOutput } from '../types.js';

interface Opts { monoRoot: string; }

interface ParsedRoute {
  path: string;
  component: string | null;
  isLazy: boolean;
  modulePath: string | null;
}

function getStringPropValue(obj: ObjectLiteralExpression, key: string): string | null {
  const prop = obj.getProperty(key);
  if (!prop || prop.getKind() !== SyntaxKind.PropertyAssignment) return null;
  const init = prop.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
  if (!init || init.getKind() !== SyntaxKind.StringLiteral) return null;
  return init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText();
}

function extractLazyModule(obj: ObjectLiteralExpression): string | null {
  const lazy = obj.getProperty('lazy');
  if (!lazy) return null;
  // Find the first import('@/...') call expression in lazy's value.
  let modulePath: string | null = null;
  lazy.forEachDescendant((node) => {
    if (modulePath) return;
    if (node.getKind() === SyntaxKind.CallExpression) {
      const ce = node.asKindOrThrow(SyntaxKind.CallExpression);
      if (ce.getExpression().getText() !== 'import') return;
      const arg = ce.getArguments()[0];
      if (arg && arg.getKind() === SyntaxKind.StringLiteral) {
        modulePath = arg.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText();
      }
    }
  });
  return modulePath;
}

function deriveComponentName(modulePath: string): string {
  const segs = modulePath.split('/').filter(Boolean);
  const last = [...segs].reverse().find(s => s !== 'page' && s !== '@') ?? segs[segs.length - 1] ?? '';
  return last.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/\s/g, '');
}

function inferDomainFromModule(modulePath: string): string | null {
  // '@/modules/staking/bnb/page' → 'staking'
  const m = modulePath.match(/modules\/([^/]+)/);
  return m ? (m[1] ?? null) : null;
}

function joinRoutePath(parent: string, child: string): string {
  if (!parent) return '/' + child.replace(/^\//, '');
  if (!child) return parent;
  if (child.startsWith('/')) return child;
  const base = parent.endsWith('/') ? parent : parent + '/';
  return (base + child).replace(/\/+/g, '/');
}

function walkRoutes(arr: ArrayLiteralExpression, parentPath: string, accum: ParsedRoute[]) {
  for (const elem of arr.getElements()) {
    if (elem.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;
    const obj = elem.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const pathProp = getStringPropValue(obj, 'path');
    const indexProp = obj.getProperty('index');
    const isIndex = indexProp !== undefined;
    let myPath = parentPath;
    if (pathProp !== null) myPath = joinRoutePath(parentPath, pathProp);
    else if (isIndex) myPath = parentPath || '/';
    if (myPath === '') myPath = '/';

    const moduleP = extractLazyModule(obj);
    if (moduleP) {
      accum.push({
        path: myPath,
        component: deriveComponentName(moduleP),
        isLazy: true,
        modulePath: moduleP
      });
    } else if (pathProp !== null && !indexProp && !obj.getProperty('children')) {
      // path with no lazy, no children — emit anyway for completeness
      accum.push({ path: myPath, component: null, isLazy: false, modulePath: null });
    }

    const childrenProp = obj.getProperty('children');
    if (childrenProp && childrenProp.getKind() === SyntaxKind.PropertyAssignment) {
      const childInit = childrenProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
      if (childInit && childInit.getKind() === SyntaxKind.ArrayLiteralExpression) {
        walkRoutes(childInit.asKindOrThrow(SyntaxKind.ArrayLiteralExpression), myPath, accum);
      }
    }
  }
}

async function listAppRouters(monoRoot: string): Promise<{ appName: string; abs: string }[]> {
  const appsDir = join(monoRoot, 'apps');
  const apps = await readdir(appsDir, { withFileTypes: true }).catch(() => []);
  const out: { appName: string; abs: string }[] = [];
  for (const a of apps) {
    if (!a.isDirectory()) continue;
    const router = join(appsDir, a.name, 'src', 'router.tsx');
    if (await stat(router).catch(() => null)) {
      out.push({ appName: a.name, abs: router });
    }
  }
  return out;
}

export async function ingestFrontend(opts: Opts): Promise<IngestorOutput> {
  const project = new Project({ skipAddingFilesFromTsConfig: true, compilerOptions: { jsx: 4, target: 99 } });
  const nodes: IngestorNode[] = [];
  const edges: IngestorEdge[] = [];

  const routers = await listAppRouters(opts.monoRoot);
  for (const { appName, abs } of routers) {
    const filePath = posix.normalize(`apps/${appName}/src/router.tsx`);
    const sf = project.addSourceFileAtPath(abs);
    sf.forEachDescendant((node) => {
      if (node.getKind() !== SyntaxKind.CallExpression) return;
      const ce = node as CallExpression;
      if (ce.getExpression().getText() !== 'createBrowserRouter') return;
      const args = ce.getArguments();
      const first = args[0];
      if (!first || first.getKind() !== SyntaxKind.ArrayLiteralExpression) return;
      const routes: ParsedRoute[] = [];
      walkRoutes(first.asKindOrThrow(SyntaxKind.ArrayLiteralExpression), '', routes);
      for (const r of routes) {
        const key = `${appName}:${r.path}`;
        nodes.push({
          type: 'route', key,
          data: {
            appName, path: r.path,
            component: r.component,
            repo: 'lista-mono',
            filePath,
            isLazy: r.isLazy ? 1 : 0,
            modulePath: r.modulePath
          }
        });
        if (r.modulePath) {
          const domainKey = inferDomainFromModule(r.modulePath);
          if (domainKey) {
            edges.push({
              sourceType: 'route', sourceKey: key,
              targetType: 'domain', targetKey: domainKey,
              linkType: 'BELONGS_TO', confidence: 0.5,
              meta: { strategy: 'module-prefix' }
            });
          }
        }
      }
    });
    project.removeSourceFile(sf);
  }
  return { ingestor: 'frontend', nodes, edges, brokenRefs: [] };
}
