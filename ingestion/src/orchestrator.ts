import type { IngestorEdge, IngestorNode, IngestorOutput, BrokenRef, NodeKind } from './types.js';

export interface MergedGraph {
  nodes: IngestorNode[];
  edges: IngestorEdge[];
  brokenRefs: BrokenRef[];
  /** Stats per ingestor for build_meta. */
  stats: Record<string, { nodes: number; edges: number; brokenRefs: number }>;
}

/**
 * Merge ingestor outputs and apply Strategy A:
 *   When a doc references a code location (REFERENCES edge: doc → code_ref),
 *   and a cron entity exists at that exact (repo, file_path), AND the doc
 *   DESCRIBES a domain, emit an authoritative BELONGS_TO edge from
 *   cron → that domain with confidence 1.0.
 *
 * Heuristic BELONGS_TO edges from the cron ingestor are kept (confidence 0.6)
 * so the UI can display "推断" provenance.
 */
export function runOrchestrator(outputs: IngestorOutput[]): MergedGraph {
  // 1. Concatenate + dedup nodes by (type, key); first-write wins.
  const nodeMap = new Map<string, IngestorNode>();
  for (const o of outputs) {
    for (const n of o.nodes) {
      const k = `${n.type}:${n.key}`;
      if (!nodeMap.has(k)) nodeMap.set(k, n);
    }
  }

  // 2. Build lookups for Strategy A.
  const docToDomain = new Map<string, string>();
  const docToCodeRefs = new Map<string, string[]>();
  const cronByLoc = new Map<string, IngestorNode[]>();

  for (const o of outputs) {
    for (const e of o.edges) {
      if (e.sourceType === 'doc' && e.targetType === 'domain' && e.linkType === 'DESCRIBES') {
        docToDomain.set(e.sourceKey, e.targetKey);
      } else if (e.sourceType === 'doc' && e.targetType === 'code_ref' && e.linkType === 'REFERENCES') {
        const arr = docToCodeRefs.get(e.sourceKey) ?? [];
        arr.push(e.targetKey);
        docToCodeRefs.set(e.sourceKey, arr);
      }
    }
    for (const n of o.nodes) {
      if (n.type === 'cron') {
        const data = n.data as { repo?: string; filePath?: string };
        if (!data.repo || !data.filePath) continue;
        const k = `${data.repo}:${data.filePath}`;
        const arr = cronByLoc.get(k) ?? [];
        arr.push(n);
        cronByLoc.set(k, arr);
      }
    }
  }

  // 3. All edges merged.
  const edges: IngestorEdge[] = [];
  for (const o of outputs) edges.push(...o.edges);

  // 4. Strategy A: emit authoritative cron → domain edges.
  for (const [docKey, codeRefKeys] of docToCodeRefs) {
    const domainKey = docToDomain.get(docKey);
    if (!domainKey) continue;
    for (const refKey of codeRefKeys) {
      // refKey format: "{repo}:{filePath}:{lineNo?}"
      const parts = refKey.split(':');
      if (parts.length < 2) continue;
      const repo = parts[0];
      const filePath = parts[1];
      if (!repo || !filePath) continue;
      const locKey = `${repo}:${filePath}`;
      const cronEntities = cronByLoc.get(locKey) ?? [];
      for (const cronNode of cronEntities) {
        edges.push({
          sourceType: 'cron' as NodeKind, sourceKey: cronNode.key,
          targetType: 'domain' as NodeKind, targetKey: domainKey,
          linkType: 'BELONGS_TO', confidence: 1.0,
          meta: { strategy: 'A-doc-coderef', viaDoc: docKey, viaCodeRef: refKey }
        });
      }
    }
  }

  // 5. brokenRefs union.
  const brokenRefs: BrokenRef[] = [];
  for (const o of outputs) brokenRefs.push(...o.brokenRefs);

  // 6. Stats per ingestor.
  const stats: MergedGraph['stats'] = {};
  for (const o of outputs) {
    stats[o.ingestor] = { nodes: o.nodes.length, edges: o.edges.length, brokenRefs: o.brokenRefs.length };
  }

  return { nodes: [...nodeMap.values()], edges, brokenRefs, stats };
}
