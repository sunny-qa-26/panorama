import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, posix } from 'node:path';
import type { IngestorNode, IngestorOutput } from '../types.js';

interface Opts { reposPath: string; repos: string[]; }

const CALL_RE = /\b(?:redisClient|redisService|RedisService|cache)\.(get|set|setNx|incr|expire|del|hget|hset|sadd|zadd|lpush|rpush|smembers|zrange|lrange|unlink)\s*\(/g;
const FILE_GLOB = /\.ts$/;
const SKIP_FILE = /(\.spec\.ts|\.test\.ts|\.qa\.spec\.ts)$/;

function methodToOp(method: string): 'READ' | 'WRITE' | 'EXPIRE' | 'DELETE' {
  if (method === 'expire') return 'EXPIRE';
  if (method === 'del' || method === 'unlink') return 'DELETE';
  if (method === 'set' || method === 'setNx' || method === 'hset'
      || method === 'sadd' || method === 'zadd'
      || method === 'lpush' || method === 'rpush') return 'WRITE';
  return 'READ';
}

interface ExtractedKey { pattern: string; confidence: number; }

function normaliseTemplateVar(expr: string): string {
  const trimmed = expr.trim();
  const m = trimmed.match(/[A-Za-z_$][A-Za-z0-9_$]*$/);
  const name = m ? m[0] : 'var';
  return `{${name.replace(/[A-Z]/g, c => '_' + c.toLowerCase()).replace(/^_/, '')}}`;
}

function extractKeyArgFromText(text: string): ExtractedKey | null {
  let i = 0;
  while (i < text.length && /\s/.test(text[i] ?? '')) i++;
  if (i >= text.length) return null;
  const ch = text[i];
  if (ch === "'" || ch === '"') {
    const close = text.indexOf(ch, i + 1);
    if (close < 0) return null;
    return { pattern: text.slice(i + 1, close), confidence: 1.0 };
  }
  if (ch === '`') {
    const close = text.indexOf('`', i + 1);
    if (close < 0) return null;
    let raw = text.slice(i + 1, close);
    raw = raw.replace(/\$\{([^}]+)\}/g, (_m, expr: string) => normaliseTemplateVar(expr));
    return { pattern: raw, confidence: 0.8 };
  }
  return null;
}

async function walkSourceFiles(repoRoot: string): Promise<string[]> {
  const out: string[] = [];
  async function go(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name === '__tests__') continue;
        await go(full);
      } else if (e.isFile() && FILE_GLOB.test(e.name) && !SKIP_FILE.test(e.name)) {
        out.push(full);
      }
    }
  }
  await go(repoRoot);
  return out.sort();
}

export async function ingestRedis(opts: Opts): Promise<IngestorOutput> {
  type AccumKey = { node: IngestorNode; opTypes: Set<string>; };
  const acc = new Map<string, AccumKey>();   // key = `${repo}:${pattern}` (matches uk_pattern)

  for (const repo of opts.repos) {
    const repoRoot = join(opts.reposPath, repo);
    if (!(await stat(repoRoot).catch(() => null))) continue;
    const files = await walkSourceFiles(repoRoot);
    for (const abs of files) {
      const filePath = posix.normalize(relative(repoRoot, abs).replace(/\\/g, '/'));
      const raw = await readFile(abs, 'utf8').catch(() => null);
      if (!raw) continue;
      const lines = raw.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        CALL_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = CALL_RE.exec(line)) !== null) {
          const method = m[1];
          if (!method) continue;
          const fromIdx = m.index + m[0].length;
          // Look at this line + up to 2 following lines (multi-line calls are common).
          const window = lines.slice(i, i + 3).join('\n');
          const tailFromCall = window.slice(fromIdx);
          const key = extractKeyArgFromText(tailFromCall);
          if (!key) continue;
          const op = methodToOp(method);
          const dedup = `${repo}:${key.pattern}`;
          const existing = acc.get(dedup);
          if (existing) {
            existing.opTypes.add(op);
            const data = existing.node.data as { opTypes: string[] };
            data.opTypes = [...existing.opTypes];
          } else {
            const opSet = new Set<string>([op]);
            acc.set(dedup, {
              opTypes: opSet,
              node: {
                type: 'redis', key: dedup,
                data: {
                  keyPattern: key.pattern,
                  redisType: 'unknown',
                  ttlSeconds: null,
                  description: null,
                  sourceRepo: repo,
                  sourceFile: filePath,
                  sourceLine: i + 1,
                  confidence: key.confidence,
                  opTypes: [op]
                }
              }
            });
          }
        }
      }
    }
  }

  return { ingestor: 'redis', nodes: [...acc.values()].map(a => a.node), edges: [], brokenRefs: [] };
}
