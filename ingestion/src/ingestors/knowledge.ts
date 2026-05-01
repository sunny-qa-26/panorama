import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, posix } from 'node:path';
import matter from 'gray-matter';
import type { IngestorNode, IngestorEdge, IngestorOutput, BrokenRef } from '../types.js';
import { extractCodeRefs } from './knowledge-coderef.js';

interface Opts { knowledgeRoot: string; }

const SKIP_PREFIX = '_';
const SKIP_DIRS = new Set(['scripts', 'sites']);  // not business-domain content
const KEEP_EXT = new Set(['.md']);

/** business/moolah/emission.md → "moolah/emission". business/moolah/overview.md → "moolah". */
function deriveDomainKey(relPath: string): string {
  const parts = relPath.replace(/\\/g, '/').split('/');
  if (parts[0] !== 'business') return parts.slice(0, -1).join('/');
  const segs = parts.slice(1, -1);                   // ['moolah']
  const filename = parts[parts.length - 1];          // 'emission.md'
  if (!filename) return segs.join('/') || 'root';
  const stem = filename.replace(/\.md$/, '');
  if (stem === 'overview' || segs.length === 0) return segs.join('/') || 'root';
  return [...segs, stem].join('/');
}

function deriveDisplayName(domainKey: string): string {
  const parts = domainKey.split('/');
  const last = parts[parts.length - 1] ?? domainKey;
  return last.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

async function walkMarkdown(root: string): Promise<string[]> {
  const out: string[] = [];
  async function go(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(SKIP_PREFIX)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        await go(full);
      } else if (e.isFile()) {
        const ext = e.name.lastIndexOf('.') >= 0 ? e.name.slice(e.name.lastIndexOf('.')) : '';
        if (KEEP_EXT.has(ext)) out.push(full);
      }
    }
  }
  await go(root);
  return out.sort();
}

function extractTitle(md: string): string | null {
  const m = md.match(/^#\s+(.+?)\s*$/m);
  return m ? (m[1] ?? null) : null;
}

export async function ingestKnowledge(opts: Opts): Promise<IngestorOutput> {
  const businessRoot = join(opts.knowledgeRoot, 'business');
  const exists = await stat(businessRoot).catch(() => null);
  if (!exists) throw new Error(`knowledge: ${businessRoot} not found`);

  const files = await walkMarkdown(businessRoot);
  const nodes: IngestorNode[] = [];
  const edges: IngestorEdge[] = [];
  const brokenRefs: BrokenRef[] = [];
  const conceptSeen = new Set<string>();
  const domainSeen = new Set<string>();

  for (const abs of files) {
    const rel = posix.normalize('business/' + relative(businessRoot, abs).replace(/\\/g, '/'));
    const raw = await readFile(abs, 'utf8');
    const parsed = matter(raw);
    const fm = parsed.data as Record<string, unknown>;
    const body = parsed.content;

    const domainKey = deriveDomainKey(rel);

    // 1. Domain node — emit once per unique key.
    if (!domainSeen.has(domainKey)) {
      domainSeen.add(domainKey);
      const parts = domainKey.split('/');
      const parentKey = parts.length > 1 ? parts.slice(0, -1).join('/') : null;
      const last = parts[parts.length - 1] ?? domainKey;
      nodes.push({
        type: 'domain', key: domainKey,
        data: {
          name: last,
          displayName: deriveDisplayName(domainKey),
          parentKey,
          fileType: fm.file_type ?? null,
          knowledgePath: rel,
          description: typeof fm.summary === 'string' ? fm.summary : null
        }
      });
    }

    // 2. Doc node.
    nodes.push({
      type: 'doc', key: rel,
      data: {
        path: rel,
        title: extractTitle(body) ?? rel,
        lastVerified: typeof fm.last_verified === 'string' ? fm.last_verified : null,
        frontmatter: fm,
        bodyMdPath: rel,
        wordCount: body.split(/\s+/).filter(Boolean).length
      }
    });

    // 3. DESCRIBES edge: doc → domain.
    edges.push({
      sourceType: 'doc', sourceKey: rel,
      targetType: 'domain', targetKey: domainKey,
      linkType: 'DESCRIBES', confidence: 1.0
    });

    // 4. Concepts.
    const concepts = Array.isArray(fm.concepts)
      ? (fm.concepts as unknown[]).filter((c): c is string => typeof c === 'string')
      : [];
    const aliases = Array.isArray(fm.aliases)
      ? (fm.aliases as unknown[]).filter((a): a is string => typeof a === 'string')
      : [];
    for (const c of concepts) {
      if (!conceptSeen.has(c)) {
        conceptSeen.add(c);
        nodes.push({
          type: 'concept', key: c,
          data: { name: c, aliases: aliases.filter(a => a.toLowerCase().includes(c.toLowerCase())) }
        });
      }
      edges.push({
        sourceType: 'doc', sourceKey: rel,
        targetType: 'concept', targetKey: c,
        linkType: 'MENTIONS', confidence: 1.0
      });
    }

    // 5. Code references in body.
    const hits = extractCodeRefs(body);
    for (const h of hits) {
      const codeRefKey = `${h.repo}:${h.filePath}:${h.lineNo ?? ''}`;
      nodes.push({
        type: 'code_ref', key: codeRefKey,
        data: { repo: h.repo, filePath: h.filePath, lineNo: h.lineNo, docLineNo: h.docLineNo }
      });
      edges.push({
        sourceType: 'doc', sourceKey: rel,
        targetType: 'code_ref', targetKey: codeRefKey,
        linkType: 'REFERENCES', confidence: 1.0,
        meta: { docLineNo: h.docLineNo }
      });
    }
  }

  // Dedup nodes by (type, key) — first-write wins.
  const seen = new Set<string>();
  const dedupedNodes = nodes.filter(n => {
    const k = `${n.type}:${n.key}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { ingestor: 'knowledge', nodes: dedupedNodes, edges, brokenRefs };
}
