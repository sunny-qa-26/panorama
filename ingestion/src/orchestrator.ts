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

  // 2. Build lookups for Strategy A — generalised to ALL file-bearing entity types
  //    (cron / api / entity / route / redis). Originally Strategy A only emitted
  //    cron→domain edges, which left e.g. lista-holder.md's reference to
  //    listaHolderProtectionLog.entity.ts un-honoured (the entity ended up with
  //    domain_id=NULL because the entity ingestor's path-prefix heuristic looks
  //    at src/entity/{module}/ which is 'lista' not 'lista-holder').
  const docToDomain = new Map<string, string>();
  const docToCodeRefs = new Map<string, string[]>();
  /** All file-bearing nodes indexed by `${repo}:${filePath}`. */
  const nodesByLoc = new Map<string, IngestorNode[]>();
  /** Same nodes indexed by `${repo}:${filePath}:${lineNo}` for precision matches. */
  const nodesByLocLine = new Map<string, IngestorNode>();

  /** Extract (repo, filePath, lineNo?) from any node type that lives in a code file.
   *  redis nodes use a different field shape (sourceRepo / sourceFile / sourceLine). */
  function extractLoc(n: IngestorNode): { repo?: string; filePath?: string; lineNo?: number } {
    const d = n.data as Record<string, unknown>;
    if (n.type === 'redis') {
      return {
        repo: typeof d.sourceRepo === 'string' ? d.sourceRepo : undefined,
        filePath: typeof d.sourceFile === 'string' ? d.sourceFile : undefined,
        lineNo: typeof d.sourceLine === 'number' ? d.sourceLine : undefined
      };
    }
    return {
      repo: typeof d.repo === 'string' ? d.repo : undefined,
      filePath: typeof d.filePath === 'string' ? d.filePath : undefined,
      lineNo: typeof d.lineNo === 'number' ? d.lineNo : undefined
    };
  }

  const FILE_BEARING_TYPES = new Set<NodeKind>(['cron', 'api', 'entity', 'route', 'redis']);

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
      if (!FILE_BEARING_TYPES.has(n.type)) continue;
      const loc = extractLoc(n);
      if (!loc.repo || !loc.filePath) continue;
      const k = `${loc.repo}:${loc.filePath}`;
      const arr = nodesByLoc.get(k) ?? [];
      arr.push(n);
      nodesByLoc.set(k, arr);
      if (typeof loc.lineNo === 'number') {
        nodesByLocLine.set(`${k}:${loc.lineNo}`, n);
      }
    }
  }

  // 3. All edges merged.
  const edges: IngestorEdge[] = [];
  for (const o of outputs) edges.push(...o.edges);

  // 4. Strategy A: emit authoritative {nodeType}→domain edges via doc REFERENCES.
  //    For EACH file-bearing entity type at the referenced location:
  //    - With lineNo: exact match within ±NEAR_LINE_RANGE
  //    - Without lineNo: only attach when ≤2 nodes of the same type live in that
  //      file (god-file guard — customtask.service.ts has 157 crons; one
  //      reference must not authoritatively claim all of them).
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
        for (let delta = 0; delta <= NEAR_LINE_RANGE; delta++) {
          const hit = nodesByLocLine.get(`${locKey}:${refLineNo - delta}`)
                   ?? nodesByLocLine.get(`${locKey}:${refLineNo + delta}`);
          if (hit) { matched.push(hit); break; }
        }
      } else {
        // No lineNo: attach all candidates UNLESS the file is a god-file for any one type.
        const candidates = nodesByLoc.get(locKey) ?? [];
        const byType = new Map<NodeKind, IngestorNode[]>();
        for (const c of candidates) {
          const arr = byType.get(c.type) ?? [];
          arr.push(c);
          byType.set(c.type, arr);
        }
        for (const [, arr] of byType) {
          if (arr.length <= 2) matched.push(...arr);
        }
      }

      for (const node of matched) {
        edges.push({
          sourceType: node.type, sourceKey: node.key,
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
    // Build tokens with `pathRank`: deeper-in-path = higher rank (more specific).
    // For each path segment + filename stem, generate THREE variants:
    //   1. raw segment (e.g. 'listaHolder')
    //   2. dasherized full (e.g. 'lista-holder')  ← matches multi-word domain leaves
    //   3. camel-split sub-tokens (e.g. 'lista', 'holder')  ← matches single-word leaves
    // Pick the highest-rank match.
    const tokens: { val: string; rank: number }[] = [];
    const segs = filePath.split('/').filter(Boolean);
    const pushAll = (s: string, rank: number) => {
      tokens.push({ val: s, rank });
      const dashed = s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
      if (dashed !== s.toLowerCase()) tokens.push({ val: dashed, rank });
      for (const sub of dashed.split(/[\s._-]+/).filter(Boolean)) {
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
  // Helper: also check the cron's NAME for a domain substring. Crons in god-files
  // (customtask.service.ts has 157) won't match by file path, but the names like
  // 'syncListaHolderBalanceLogs' / 'batchComputeListaHolderTwaps' clearly indicate
  // ownership. Match any domain whose dasherized form, when camelCase'd into PascalCase,
  // appears as a contiguous substring of the cron's name.
  function scanCronNameForDomain(cronName: string): string | null {
    if (!cronName) return null;
    let best: string | null = null;
    let bestLen = 0;
    for (const leaf of knownDomainLeaves) {
      // 'lista-holder' → 'ListaHolder'
      const pascal = leaf
        .split(/[-_]/)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join('');
      if (pascal.length < 4) continue; // avoid matching trivial 3-char tokens like 'cdp'
      if (cronName.includes(pascal) && pascal.length > bestLen) {
        best = leaf;
        bestLen = pascal.length;
      }
    }
    return best;
  }

  for (const n of nodeMap.values()) {
    if (n.type !== 'api' && n.type !== 'route' && n.type !== 'redis' && n.type !== 'entity' && n.type !== 'cron') continue;
    const data = n.data as { filePath?: string; sourceFile?: string; name?: string };
    const fp = data.filePath ?? data.sourceFile ?? '';
    let dom = scanPathForDomain(fp);
    // Cron-name fallback: catches crons in god-files whose path is uninformative
    // but whose name contains the domain (e.g. syncListaHolderBalanceLogs).
    if (!dom && n.type === 'cron' && data.name) dom = scanCronNameForDomain(data.name);
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
