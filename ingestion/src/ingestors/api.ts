import { Project, SyntaxKind, type Decorator, type ClassDeclaration, type MethodDeclaration, type SourceFile } from 'ts-morph';
import { join, relative, posix } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import type { IngestorNode, IngestorEdge, IngestorOutput } from '../types.js';

interface Opts { reposPath: string; repos: string[]; }

const HTTP_DECORATORS = new Set(['Get', 'Post', 'Put', 'Delete', 'Patch']);
const FILE_GLOB = /\.controller\.ts$/;
const KEEP_DIR = /\bsrc\/modules\b/;

async function walkControllerFiles(repoRoot: string): Promise<string[]> {
  const out: string[] = [];
  async function go(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name === '__tests__') continue;
        await go(full);
      } else if (e.isFile() && FILE_GLOB.test(e.name) && KEEP_DIR.test(full)) {
        out.push(full);
      }
    }
  }
  await go(repoRoot);
  return out.sort();
}

function inferDomainKey(filePath: string): string | null {
  const m = filePath.match(/src\/modules\/([^/]+)\//);
  return m ? (m[1] ?? null) : null;
}

function getStringArg(d: Decorator): string {
  const args = d.getArguments();
  if (args.length === 0) return '';
  const first = args[0];
  if (!first || first.getKind() !== SyntaxKind.StringLiteral) return '';
  return first.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText();
}

function joinPath(base: string, sub: string): string {
  const b = base.startsWith('/') ? base : '/' + base;
  const s = sub === '' ? '' : (sub.startsWith('/') ? sub : '/' + sub);
  const combined = (b + s).replace(/\/+/g, '/');
  return combined.length > 1 && combined.endsWith('/') ? combined.slice(0, -1) : combined;
}

function extractDescription(method: MethodDeclaration): string | null {
  const ranges = method.getLeadingCommentRanges();
  if (ranges.length === 0) return null;
  const last = ranges[ranges.length - 1];
  if (!last) return null;
  const cleaned = last.getText()
    .replace(/^\/\*\*?/, '').replace(/\*\/$/, '')
    .replace(/^\s*\*\s?/gm, '').trim();
  return cleaned || null;
}

function extractCallCronPaths(sf: SourceFile): string[] {
  const paths: string[] = [];
  sf.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return;
    const call = node.asKindOrThrow(SyntaxKind.CallExpression);
    const callee = call.getExpression();
    const calleeText = callee.getText();
    if (calleeText !== 'callCronApi' && !calleeText.endsWith('.callCronApi')) return;
    const args = call.getArguments();
    const first = args[0];
    if (!first || first.getKind() !== SyntaxKind.StringLiteral) return;
    paths.push(first.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText());
  });
  return paths;
}

function extractRepositories(cls: ClassDeclaration): string[] {
  const names = new Set<string>();
  // @InjectRepository(EntityName) on constructor params
  const ctor = cls.getConstructors()[0];
  if (ctor) {
    for (const p of ctor.getParameters()) {
      for (const dec of p.getDecorators()) {
        if (dec.getName() !== 'InjectRepository') continue;
        const args = dec.getArguments();
        const first = args[0];
        if (!first) continue;
        names.add(first.getText());
      }
    }
  }
  // Repository<EntityName> in field/parameter types
  cls.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.TypeReference) return;
    const t = node.asKindOrThrow(SyntaxKind.TypeReference);
    if (t.getTypeName().getText() !== 'Repository') return;
    const args = t.getTypeArguments();
    const first = args[0];
    if (!first) return;
    names.add(first.getText());
  });
  return [...names];
}

function processClass(cls: ClassDeclaration, repo: string, filePath: string, sf: SourceFile): { nodes: IngestorNode[]; edges: IngestorEdge[] } {
  const nodes: IngestorNode[] = [];
  const edges: IngestorEdge[] = [];
  const controllerName = cls.getName() ?? '';

  const controllerDec = cls.getDecorator('Controller');
  if (!controllerDec) return { nodes, edges };
  const basePath = getStringArg(controllerDec);

  const classGuards = cls.getDecorator('UseGuards') !== undefined;

  const callCronApiPaths = extractCallCronPaths(sf);
  const repositories = extractRepositories(cls);

  for (const method of cls.getMethods()) {
    let methodHttp: string | null = null;
    let methodSub = '';
    for (const dec of method.getDecorators()) {
      if (HTTP_DECORATORS.has(dec.getName())) {
        methodHttp = dec.getName().toUpperCase();
        methodSub = getStringArg(dec);
        break;
      }
    }
    if (!methodHttp) continue;

    const path = joinPath(basePath, methodSub);
    const lineNo = method.getStartLineNumber();
    const methodGuards = method.getDecorator('UseGuards') !== undefined;
    const authRequired = (classGuards || methodGuards) ? 1 : 0;
    const key = `${repo}:${methodHttp} ${path}`;

    nodes.push({
      type: 'api', key,
      data: {
        httpMethod: methodHttp, path,
        controller: controllerName,
        repo, filePath, lineNo,
        authRequired,
        description: extractDescription(method),
        confidence: 1.0,
        callCronApiPaths,
        repositories
      }
    });

    const domainKey = inferDomainKey(filePath);
    if (domainKey) {
      edges.push({
        sourceType: 'api', sourceKey: key,
        targetType: 'domain', targetKey: domainKey,
        linkType: 'BELONGS_TO', confidence: 0.6,
        meta: { strategy: 'path-prefix' }
      });
    }
  }
  return { nodes, edges };
}

export async function ingestApi(opts: Opts): Promise<IngestorOutput> {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: false, target: 99 }
  });
  const nodes: IngestorNode[] = [];
  const edges: IngestorEdge[] = [];

  for (const repo of opts.repos) {
    const repoRoot = join(opts.reposPath, repo);
    if (!(await stat(repoRoot).catch(() => null))) continue;
    const files = await walkControllerFiles(repoRoot);
    for (const abs of files) {
      const filePath = posix.normalize(relative(repoRoot, abs).replace(/\\/g, '/'));
      const sf = project.addSourceFileAtPath(abs);
      for (const cls of sf.getClasses()) {
        const out = processClass(cls, repo, filePath, sf);
        nodes.push(...out.nodes);
        edges.push(...out.edges);
      }
      project.removeSourceFile(sf);
    }
  }
  return { ingestor: 'api', nodes, edges, brokenRefs: [] };
}
