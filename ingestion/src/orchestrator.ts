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
  // Index crons two ways: by (repo, file) for fallback, and by (repo, file, line) for precision.
  const cronByLoc = new Map<string, IngestorNode[]>();
  const cronByLocLine = new Map<string, IngestorNode>();

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
        const data = n.data as { repo?: string; filePath?: string; lineNo?: number | null };
        if (!data.repo || !data.filePath) continue;
        const k = `${data.repo}:${data.filePath}`;
        const arr = cronByLoc.get(k) ?? [];
        arr.push(n);
        cronByLoc.set(k, arr);
        if (typeof data.lineNo === 'number') {
          cronByLocLine.set(`${k}:${data.lineNo}`, n);
        }
      }
    }
  }

  // 3. All edges merged.
  const edges: IngestorEdge[] = [];
  for (const o of outputs) edges.push(...o.edges);

  // 4. Strategy A: emit authoritative cron → domain edges.
  //    Match by (repo, file, lineNo) when the doc reference includes a line number;
  //    fall back to (repo, file) only when lineNo is omitted in the doc reference.
  //    This prevents the "god-file blast radius" bug where a single doc reference
  //    to one cron in a 157-cron service would attribute all 157 to that doc's domain.
  const NEAR_LINE_RANGE = 5;
  for (const [docKey, codeRefKeys] of docToCodeRefs) {
    const domainKey = docToDomain.get(docKey);
    if (!domainKey) continue;
    for (const refKey of codeRefKeys) {
      // refKey format: "{repo}:{filePath}:{lineNo?}"
      const parts = refKey.split(':');
      if (parts.length < 2) continue;
      const repo = parts[0];
      const filePath = parts[1];
      const lineNoStr = parts[2];
      if (!repo || !filePath) continue;
      const locKey = `${repo}:${filePath}`;
      const refLineNo = lineNoStr ? Number(lineNoStr) : NaN;

      const matched: IngestorNode[] = [];
      if (Number.isFinite(refLineNo)) {
        // Precise match: cron whose own decorator line is within ±NEAR_LINE_RANGE of the ref line.
        for (let delta = 0; delta <= NEAR_LINE_RANGE; delta++) {
          const exact = cronByLocLine.get(`${locKey}:${refLineNo}`);
          if (exact) { matched.push(exact); break; }
          const above = cronByLocLine.get(`${locKey}:${refLineNo - delta}`);
          if (above) { matched.push(above); break; }
          const below = cronByLocLine.get(`${locKey}:${refLineNo + delta}`);
          if (below) { matched.push(below); break; }
        }
      } else {
        // No lineNo in the doc reference. Be conservative: only attach when the
        // file has at most 2 cron handlers — otherwise we'd blast a god-file
        // (e.g. customtask.service.ts has 157 handlers; one doc reference must
        // not authoritatively claim all of them for one domain).
        const candidates = cronByLoc.get(locKey) ?? [];
        if (candidates.length <= 2) matched.push(...candidates);
      }

      for (const cronNode of matched) {
        edges.push({
          sourceType: 'cron' as NodeKind, sourceKey: cronNode.key,
          targetType: 'domain' as NodeKind, targetKey: domainKey,
          linkType: 'BELONGS_TO', confidence: 1.0,
          meta: { strategy: 'A-doc-coderef', viaDoc: docKey, viaCodeRef: refKey }
        });
      }
    }
  }

  // 5. Strategy api→entity (Repository<X> heuristic).
  // Map class-name → entity nodes for matching.
  const entityByClassName = new Map<string, IngestorNode[]>();
  for (const o of outputs) {
    for (const n of o.nodes) {
      if (n.type !== 'entity') continue;
      const data = n.data as { tableName: string };
      // Convert table_name to PascalCase guess (e.g. moolah_market → MoolahMarket).
      const pascal = data.tableName
        .split('_')
        .map(s => s.charAt(0).toUpperCase() + s.slice(1))
        .join('');
      const arr = entityByClassName.get(pascal) ?? [];
      arr.push(n);
      entityByClassName.set(pascal, arr);
    }
  }
  for (const o of outputs) {
    for (const n of o.nodes) {
      if (n.type !== 'api') continue;
      const data = n.data as { repositories?: string[] };
      if (!data.repositories) continue;
      for (const repoName of data.repositories) {
        const matches = entityByClassName.get(repoName) ?? [];
        for (const ent of matches) {
          edges.push({
            sourceType: 'api', sourceKey: n.key,
            targetType: 'entity', targetKey: ent.key,
            linkType: 'READS_WRITES', confidence: 0.8,
            meta: { strategy: 'repository-class-match' }
          });
        }
      }
    }
  }

  // 6. Strategy api→cron via callCronApi paths.
  // Build cron index by name.
  const cronByName = new Map<string, IngestorNode>();
  for (const o of outputs) {
    for (const n of o.nodes) {
      if (n.type !== 'cron') continue;
      const data = n.data as { name: string };
      cronByName.set(data.name, n);
    }
  }
  for (const o of outputs) {
    for (const n of o.nodes) {
      if (n.type !== 'api') continue;
      const data = n.data as { callCronApiPaths?: string[] };
      if (!data.callCronApiPaths) continue;
      for (const path of data.callCronApiPaths) {
        const segs = path.split('/').filter(Boolean);
        const name = segs[segs.length - 1];
        if (!name) continue;
        const cron = cronByName.get(name);
        if (!cron) continue;
        edges.push({
          sourceType: 'api', sourceKey: n.key,
          targetType: 'cron', targetKey: cron.key,
          linkType: 'CALLS', confidence: 0.9,
          meta: { strategy: 'callCronApi-path-match', callPath: path }
        });
      }
    }
  }

  // 7. Strategy *→redis via source_file match.
  // Index nodes that have file_path: cron and api.
  const fileToOwners = new Map<string, IngestorNode[]>();
  for (const o of outputs) {
    for (const n of o.nodes) {
      if (n.type !== 'cron' && n.type !== 'api') continue;
      const data = n.data as { repo: string; filePath: string };
      const k = `${data.repo}:${data.filePath}`;
      const arr = fileToOwners.get(k) ?? [];
      arr.push(n);
      fileToOwners.set(k, arr);
    }
  }
  for (const o of outputs) {
    for (const n of o.nodes) {
      if (n.type !== 'redis') continue;
      const data = n.data as { sourceRepo: string; sourceFile: string; opTypes?: string[] };
      const k = `${data.sourceRepo}:${data.sourceFile}`;
      const owners = fileToOwners.get(k) ?? [];
      for (const owner of owners) {
        edges.push({
          sourceType: owner.type, sourceKey: owner.key,
          targetType: 'redis', targetKey: n.key,
          linkType: 'CALLS', confidence: 0.9,
          meta: { resource: 'redis', opTypes: data.opTypes ?? [] }
        });
      }
    }
  }

  // 8. Strategy route→api (heuristic: same domain segment in path).
  const routeDomain = (modulePath: string | null | undefined): string | null => {
    if (!modulePath) return null;
    const m = modulePath.match(/modules\/([^/]+)/);
    return m ? (m[1] ?? null) : null;
  };
  const apiPathDomain = (path: string): string | null => {
    const m = path.match(/^\/?([^/]+)/);
    return m ? (m[1] ?? null) : null;
  };
  const apisByPathDomain = new Map<string, IngestorNode[]>();
  for (const o of outputs) {
    for (const n of o.nodes) {
      if (n.type !== 'api') continue;
      const data = n.data as { path: string };
      const dom = apiPathDomain(data.path);
      if (!dom) continue;
      const arr = apisByPathDomain.get(dom) ?? [];
      arr.push(n);
      apisByPathDomain.set(dom, arr);
    }
  }
  for (const o of outputs) {
    for (const n of o.nodes) {
      if (n.type !== 'route') continue;
      const data = n.data as { modulePath?: string | null };
      const dom = routeDomain(data.modulePath);
      if (!dom) continue;
      const apis = apisByPathDomain.get(dom) ?? [];
      for (const api of apis) {
        edges.push({
          sourceType: 'route', sourceKey: n.key,
          targetType: 'api', targetKey: api.key,
          linkType: 'CALLS', confidence: 0.4,
          meta: { strategy: 'domain-prefix-match' }
        });
      }
    }
  }

  // Post-pass: rescue api/route/redis nodes that the path-prefix heuristic missed
  //   because the leading `src/modules/{x}/` segment is a NestJS module name
  //   (admin / launchpool / customtask) rather than a knowledge-base domain.
  //   Strategy: scan the filePath for any known knowledge domain key as a path
  //   segment and emit a heuristic BELONGS_TO at confidence 0.5 (overrides the
  //   broken 0.6 prefix edge that resolves to a non-existent domain).
  const knownDomains = new Set<string>();
  const knownDomainLeaves = new Set<string>();
  for (const n of nodeMap.values()) {
    if (n.type !== 'domain') continue;
    knownDomains.add(n.key);
    const last = n.key.split('/').pop();
    if (last) knownDomainLeaves.add(last);
  }
  function scanPathForDomain(filePath: string): string | null {
    // Build an ordered list of tokens with `pathRank`: deeper-in-path = higher rank.
    // For each path segment + filename stem, also split camelCase into sub-tokens.
    // Pick the highest-rank match; ties broken by token specificity (leaf domain > root).
    const tokens: { val: string; rank: number }[] = [];
    const segs = filePath.split('/').filter(Boolean);
    const pushAll = (s: string, rank: number) => {
      tokens.push({ val: s, rank });
      const camel = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
      // Split on whitespace/dashes/underscores/dots to get sub-tokens.
      for (const sub of camel.split(/[\s._-]+/).filter(Boolean)) {
        tokens.push({ val: sub, rank });
      }
    };
    segs.forEach((s, i) => pushAll(s, i));
    const last = segs[segs.length - 1] ?? '';
    if (last) {
      const stem = last.replace(/\.(?:ts|tsx|js|jsx|sol|py|sql|md)$/, '');
      pushAll(stem, segs.length);
    }
    let best: { val: string; rank: number } | null = null;
    for (const t of tokens) {
      if (!knownDomainLeaves.has(t.val)) continue;
      if (!best || t.rank > best.rank) best = t;
    }
    return best?.val ?? null;
  }
  for (const n of nodeMap.values()) {
    if (n.type !== 'api' && n.type !== 'route' && n.type !== 'redis' && n.type !== 'entity' && n.type !== 'cron') continue;
    const data = n.data as { filePath?: string; sourceFile?: string };
    const fp = data.filePath ?? data.sourceFile ?? '';
    const dom = scanPathForDomain(fp);
    if (!dom) continue;
    // find the canonical domain key (might be 'moolah/emission' or 'staking/launchpool')
    let target = dom;
    for (const k of knownDomains) {
      if (k === dom || k.endsWith('/' + dom)) { target = k; break; }
    }
    edges.push({
      sourceType: n.type, sourceKey: n.key,
      targetType: 'domain', targetKey: target,
      linkType: 'BELONGS_TO', confidence: 0.5,
      meta: { strategy: 'path-domain-scan', segment: dom }
    });
  }

  // 9. brokenRefs union.
  const brokenRefs: BrokenRef[] = [];
  for (const o of outputs) brokenRefs.push(...o.brokenRefs);

  // 10. Stats per ingestor.
  const stats: MergedGraph['stats'] = {};
  for (const o of outputs) {
    stats[o.ingestor] = { nodes: o.nodes.length, edges: o.edges.length, brokenRefs: o.brokenRefs.length };
  }

  return { nodes: [...nodeMap.values()], edges, brokenRefs, stats };
}
