import { Project, SyntaxKind, type Decorator, type ClassDeclaration, type MethodDeclaration } from 'ts-morph';
import { join, relative, posix } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import type { IngestorNode, IngestorEdge, IngestorOutput } from '../types.js';

interface Opts {
  reposPath: string;
  repos: string[];        // e.g. ['lista-cron', 'lista-bot']
}

const SUPPORTED_DECORATORS = new Set(['XxlJobHandler', 'Cron']);
const FILE_GLOB = /\.service\.ts$/;
// Only scan src/modules/** to skip tests and infra code.
const KEEP_DIR = /\bsrc\/modules\b/;

async function walkServiceFiles(repoRoot: string): Promise<string[]> {
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

/** "src/modules/moolah/emission.service.ts" → "moolah" */
function inferDomainKey(filePath: string): string | null {
  const m = filePath.match(/src\/modules\/([^/]+)\//);
  return m ? (m[1] ?? null) : null;
}

function getDecoratorArg(d: Decorator): string | null {
  const args = d.getArguments();
  if (args.length === 0) return null;
  const first = args[0];
  if (!first) return null;
  if (first.getKind() === SyntaxKind.StringLiteral) {
    return first.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText();
  }
  // CronExpression.EVERY_DAY_AT_MIDNIGHT — return the source text.
  return first.getText();
}

function extractDescription(method: MethodDeclaration): string | null {
  const ranges = method.getLeadingCommentRanges();
  if (ranges.length === 0) return null;
  const lastRange = ranges[ranges.length - 1];
  if (!lastRange) return null;
  const text = lastRange.getText();
  const cleaned = text
    .replace(/^\/\*\*?/, '').replace(/\*\/$/, '')
    .replace(/^\s*\*\s?/gm, '')
    .trim();
  return cleaned || null;
}

function processClass(cls: ClassDeclaration, repo: string, filePath: string): { nodes: IngestorNode[]; edges: IngestorEdge[] } {
  const nodes: IngestorNode[] = [];
  const edges: IngestorEdge[] = [];
  const handlerClass = cls.getName() ?? '';

  for (const method of cls.getMethods()) {
    for (const dec of method.getDecorators()) {
      const decName = dec.getName();
      if (!SUPPORTED_DECORATORS.has(decName)) continue;

      const arg = getDecoratorArg(dec);
      if (!arg) continue;

      const isXxl = decName === 'XxlJobHandler';
      const name = isXxl ? arg : method.getName();
      const schedule = isXxl ? null : arg;
      const jobId = isXxl ? arg : null;
      const lineNo = dec.getStartLineNumber();
      const key = `${repo}:${name}`;

      nodes.push({
        type: 'cron', key,
        data: {
          name, schedule, jobId,
          repo, filePath, lineNo,
          handlerClass,
          description: extractDescription(method),
          confidence: 1.0
        }
      });

      const domainKey = inferDomainKey(filePath);
      if (domainKey) {
        edges.push({
          sourceType: 'cron', sourceKey: key,
          targetType: 'domain', targetKey: domainKey,
          linkType: 'BELONGS_TO', confidence: 0.6,
          meta: { strategy: 'path-prefix' }
        });
      }
    }
  }
  return { nodes, edges };
}

export async function ingestCron(opts: Opts): Promise<IngestorOutput> {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: false, target: 99 /* ESNext */ }
  });

  const nodes: IngestorNode[] = [];
  const edges: IngestorEdge[] = [];

  for (const repo of opts.repos) {
    const repoRoot = join(opts.reposPath, repo);
    const exists = await stat(repoRoot).catch(() => null);
    if (!exists) continue;

    const files = await walkServiceFiles(repoRoot);
    for (const abs of files) {
      const filePath = posix.normalize(relative(repoRoot, abs).replace(/\\/g, '/'));
      const sf = project.addSourceFileAtPath(abs);
      for (const cls of sf.getClasses()) {
        const out = processClass(cls, repo, filePath);
        nodes.push(...out.nodes);
        edges.push(...out.edges);
      }
      project.removeSourceFile(sf);
    }
  }

  return { ingestor: 'cron', nodes, edges, brokenRefs: [] };
}
