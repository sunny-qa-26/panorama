import { Project, SyntaxKind, type ClassDeclaration } from 'ts-morph';
import { join, relative, posix } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import type { IngestorNode, IngestorEdge, IngestorOutput } from '../types.js';

interface Opts { reposPath: string; repos: string[]; }

const FILE_GLOB = /\.entity\.ts$/;
const KEEP_DIR = /\bsrc\/entity\b/;

async function walkEntityFiles(repoRoot: string): Promise<string[]> {
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
  const m = filePath.match(/src\/entity\/([^/]+)\//);
  return m ? (m[1] ?? null) : null;
}

function camelToSnake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

interface ColumnSpec { name: string; type: string; nullable: boolean; isPrimary: boolean; }

function extractColumns(cls: ClassDeclaration): ColumnSpec[] {
  const cols: ColumnSpec[] = [];
  for (const prop of cls.getInstanceProperties()) {
    const propName = prop.getName();
    let isPrimary = false;
    let columnDec = null;
    for (const d of prop.getDecorators()) {
      const n = d.getName();
      if (n === 'PrimaryGeneratedColumn' || n === 'PrimaryColumn') {
        isPrimary = true;
        columnDec = d;
        break;
      }
      if (n === 'Column') {
        columnDec = d;
        break;
      }
    }
    if (!columnDec) continue;

    let columnName = camelToSnake(propName);
    let columnType = 'unknown';
    let nullable = false;
    const args = columnDec.getArguments();
    for (const arg of args) {
      if (arg.getKind() === SyntaxKind.ObjectLiteralExpression) {
        const obj = arg.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
        const nameProp = obj.getProperty('name');
        if (nameProp && nameProp.getKind() === SyntaxKind.PropertyAssignment) {
          const init = nameProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
          if (init && init.getKind() === SyntaxKind.StringLiteral) {
            columnName = init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText();
          }
        }
        const typeProp = obj.getProperty('type');
        if (typeProp && typeProp.getKind() === SyntaxKind.PropertyAssignment) {
          const init = typeProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
          if (init && init.getKind() === SyntaxKind.StringLiteral) {
            columnType = init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText();
          }
        }
        const nullProp = obj.getProperty('nullable');
        if (nullProp && nullProp.getKind() === SyntaxKind.PropertyAssignment) {
          const init = nullProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
          if (init && init.getKind() === SyntaxKind.TrueKeyword) nullable = true;
        }
      }
    }
    if (columnType === 'unknown') {
      const tn = prop.getType().getText();
      columnType = tn || 'unknown';
    }
    cols.push({ name: columnName, type: columnType, nullable, isPrimary });
  }
  return cols;
}

function extractDescription(cls: ClassDeclaration): string | null {
  const ranges = cls.getLeadingCommentRanges();
  if (ranges.length === 0) return null;
  const last = ranges[ranges.length - 1];
  if (!last) return null;
  const cleaned = last.getText()
    .replace(/^\/\*\*?/, '').replace(/\*\/$/, '')
    .replace(/^\s*\*\s?/gm, '').trim();
  return cleaned || null;
}

export async function ingestEntity(opts: Opts): Promise<IngestorOutput> {
  const project = new Project({ skipAddingFilesFromTsConfig: true, compilerOptions: { target: 99 } });
  const nodes: IngestorNode[] = [];
  const edges: IngestorEdge[] = [];

  for (const repo of opts.repos) {
    const repoRoot = join(opts.reposPath, repo);
    if (!(await stat(repoRoot).catch(() => null))) continue;
    const files = await walkEntityFiles(repoRoot);
    for (const abs of files) {
      const filePath = posix.normalize(relative(repoRoot, abs).replace(/\\/g, '/'));
      const sf = project.addSourceFileAtPath(abs);
      for (const cls of sf.getClasses()) {
        const entityDec = cls.getDecorator('Entity');
        if (!entityDec) continue;
        const args = entityDec.getArguments();
        const first = args[0];
        let tableName = camelToSnake(cls.getName() ?? '');
        if (first && first.getKind() === SyntaxKind.StringLiteral) {
          tableName = first.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText();
        }
        const key = `${repo}:${tableName}`;
        const columns = extractColumns(cls);
        nodes.push({
          type: 'entity', key,
          data: {
            tableName, repo, filePath,
            columns,
            description: extractDescription(cls)
          }
        });
        const domainKey = inferDomainKey(filePath);
        if (domainKey) {
          edges.push({
            sourceType: 'entity', sourceKey: key,
            targetType: 'domain', targetKey: domainKey,
            linkType: 'BELONGS_TO', confidence: 0.6,
            meta: { strategy: 'path-prefix' }
          });
        }
      }
      project.removeSourceFile(sf);
    }
  }
  return { ingestor: 'entity', nodes, edges, brokenRefs: [] };
}
