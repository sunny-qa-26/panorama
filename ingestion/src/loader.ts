import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { getPool } from './db.js';
import { withLock } from './lock.js';
import { log } from './log.js';
import type { IngestorEdge, IngestorNode, NodeKind } from './types.js';
import type { MergedGraph } from './orchestrator.js';

interface Opts {
  merged: MergedGraph;
  buildId: string;
  triggerType: 'cron' | 'manual';
  triggeredBy?: string;
}

const STAGING_TABLES = [
  'panorama_business_domain',
  'panorama_knowledge_doc',
  'panorama_concept',
  'panorama_doc_concept_rel',
  'panorama_code_ref',
  'panorama_ref_link',
  'panorama_cron_job',
  // Phase 2 entity tables
  'panorama_api_endpoint',
  'panorama_entity',
  'panorama_contract',
  'panorama_frontend_route',
  'panorama_redis_key',
  // Phase 2 junctions
  'panorama_cron_contract_call',
  'panorama_api_contract_call',
  'panorama_api_entity_op',
  'panorama_cron_redis_op',
  'panorama_api_redis_op',
  'panorama_route_api_call',
  'panorama_api_cron_call'
];

interface ExistsRow extends RowDataPacket {}

/** Load the merged graph into MySQL via staging-table + RENAME swap. */
export async function loadGraph(opts: Opts): Promise<string> {
  const pool = getPool();
  const startedAt = new Date();

  await pool.query(
    `INSERT INTO panorama_build_meta (build_id, status, started_at, trigger_type, triggered_by)
     VALUES (?, 'running', ?, ?, ?)`,
    [opts.buildId, startedAt, opts.triggerType, opts.triggeredBy ?? null]
  );

  try {
    await withLock(pool, async () => {
      await dropStagingTables(pool);
      await createStagingTables(pool);
      await populateStagingTables(pool, opts.merged);
      await swapStagingTables(pool);
      await persistBrokenRefs(pool, opts.buildId, opts.merged);
    });

    const finishedAt = new Date();
    await pool.query(
      `UPDATE panorama_build_meta
       SET status = 'success', finished_at = ?, duration_ms = ?, stats_json = ?
       WHERE build_id = ?`,
      [finishedAt, finishedAt.getTime() - startedAt.getTime(), JSON.stringify(opts.merged.stats), opts.buildId]
    );
    return opts.buildId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack ?? message : message;
    log('error', 'load failed', { buildId: opts.buildId, error: message });
    await pool.query(
      `UPDATE panorama_build_meta SET status = 'failed', finished_at = ?, error_log = ? WHERE build_id = ?`,
      [new Date(), stack, opts.buildId]
    );
    // Best-effort cleanup so a retry isn't blocked.
    await dropStagingTables(pool).catch(() => undefined);
    throw err;
  }
}

async function dropStagingTables(pool: Pool) {
  for (const t of STAGING_TABLES) {
    await pool.query(`DROP TABLE IF EXISTS \`${t}_new\``);
  }
}

async function createStagingTables(pool: Pool) {
  for (const t of STAGING_TABLES) {
    await pool.query(`CREATE TABLE \`${t}_new\` LIKE \`${t}\``);
  }
}

interface DomainData { name: string; displayName: string; parentKey: string | null;
                       description?: string | null; fileType?: string | null; knowledgePath?: string | null; }
interface DocData { path: string; title?: string | null; lastVerified?: string | null;
                    frontmatter?: Record<string, unknown>; bodyMdPath?: string | null; wordCount?: number; }
interface ConceptData { name: string; aliases?: string[]; }
interface CodeRefData { repo: string; filePath: string; lineNo?: number | null; }
interface CronData { name: string; schedule?: string | null; jobId?: string | null;
                     repo: string; filePath: string; lineNo?: number | null;
                     handlerClass?: string | null; description?: string | null; confidence?: number; }
interface ApiData { httpMethod: string; path: string; controller?: string | null;
                    repo: string; filePath: string; lineNo?: number | null;
                    authRequired?: number; description?: string | null;
                    confidence?: number; }
interface EntityData { tableName: string; repo: string; filePath: string;
                       columns?: unknown; description?: string | null; }
interface ContractData { name: string; address: string; chain: string;
                         abiPath?: string | null; deployedAt?: string | null;
                         notes?: string | null; }
interface RouteData { appName: string; path: string; component?: string | null;
                      repo: string; filePath: string; isLazy?: number;
                      modulePath?: string | null; }
interface RedisData { keyPattern: string; redisType?: string;
                      ttlSeconds?: number | null; description?: string | null;
                      sourceRepo: string; sourceFile: string; sourceLine?: number | null;
                      confidence?: number; opTypes?: string[]; }

async function populateStagingTables(pool: Pool, merged: MergedGraph) {
  // Step 1: insert domains and resolve parent_id by name.
  const domains = merged.nodes.filter(n => n.type === 'domain');
  const domainIdByKey = new Map<string, number>();
  for (const d of domains) {
    const data = d.data as unknown as DomainData;
    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO panorama_business_domain_new
        (name, display_name, parent_id, description, file_type, knowledge_path, sort_order)
       VALUES (?, ?, NULL, ?, ?, ?, 0)`,
      [data.name, data.displayName, data.description ?? null, data.fileType ?? null, data.knowledgePath ?? null]
    );
    domainIdByKey.set(d.key, res.insertId);
  }
  // Step 2: resolve parent links now that we have IDs.
  for (const d of domains) {
    const data = d.data as unknown as DomainData;
    if (!data.parentKey) continue;
    const childId = domainIdByKey.get(d.key);
    const parentId = domainIdByKey.get(data.parentKey);
    if (childId && parentId) {
      await pool.query(`UPDATE panorama_business_domain_new SET parent_id = ? WHERE id = ?`, [parentId, childId]);
    }
  }

  // Step 3: docs.
  const docs = merged.nodes.filter(n => n.type === 'doc');
  const docIdByKey = new Map<string, number>();
  for (const doc of docs) {
    const data = doc.data as unknown as DocData;
    const describes = merged.edges.find(
      e => e.sourceType === 'doc' && e.sourceKey === doc.key && e.linkType === 'DESCRIBES'
    );
    const domainId = describes ? domainIdByKey.get(describes.targetKey) ?? null : null;
    if (domainId === null) continue;
    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO panorama_knowledge_doc_new
        (domain_id, path, title, last_verified, frontmatter_json, body_md_path, word_count)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?)`,
      [domainId, data.path, data.title ?? null, data.lastVerified ?? null,
       JSON.stringify(data.frontmatter ?? {}), data.bodyMdPath ?? data.path, data.wordCount ?? 0]
    );
    docIdByKey.set(doc.key, res.insertId);
  }

  // Step 4: concepts + doc_concept_rel.
  const concepts = merged.nodes.filter(n => n.type === 'concept');
  const conceptIdByKey = new Map<string, number>();
  for (const c of concepts) {
    const data = c.data as unknown as ConceptData;
    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO panorama_concept_new (name, aliases_json) VALUES (?, CAST(? AS JSON))`,
      [data.name, JSON.stringify(data.aliases ?? [])]
    );
    conceptIdByKey.set(c.key, res.insertId);
  }
  for (const e of merged.edges) {
    if (e.linkType !== 'MENTIONS' || e.sourceType !== 'doc' || e.targetType !== 'concept') continue;
    const docId = docIdByKey.get(e.sourceKey);
    const conceptId = conceptIdByKey.get(e.targetKey);
    if (docId && conceptId) {
      await pool.query(
        `INSERT IGNORE INTO panorama_doc_concept_rel_new (doc_id, concept_id) VALUES (?, ?)`,
        [docId, conceptId]
      );
    }
  }

  // Step 5: code_ref.
  const codeRefs = merged.nodes.filter(n => n.type === 'code_ref');
  const codeRefIdByKey = new Map<string, number>();
  for (const cr of codeRefs) {
    const data = cr.data as unknown as CodeRefData;
    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO panorama_code_ref_new (repo, file_path, line_no, snippet) VALUES (?, ?, ?, NULL)`,
      [data.repo, data.filePath, data.lineNo ?? null]
    );
    codeRefIdByKey.set(cr.key, res.insertId);
  }

  // Step 6: cron jobs (resolve domain_id via authoritative BELONGS_TO; fall back to heuristic).
  const crons = merged.nodes.filter(n => n.type === 'cron');
  const cronIdByKey = new Map<string, number>();
  for (const c of crons) {
    const data = c.data as unknown as CronData;
    const auth = merged.edges.find(
      e => e.sourceType === 'cron' && e.sourceKey === c.key
        && e.linkType === 'BELONGS_TO' && e.confidence >= 1.0
    );
    const heuristic = merged.edges.find(
      e => e.sourceType === 'cron' && e.sourceKey === c.key
        && e.linkType === 'BELONGS_TO' && e.confidence < 1.0
    );
    const winner = auth ?? heuristic;
    const domainId = winner ? domainIdByKey.get(winner.targetKey) ?? null : null;

    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO panorama_cron_job_new
        (domain_id, name, schedule, job_id, repo, file_path, line_no, handler_class, description, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [domainId, data.name, data.schedule ?? null, data.jobId ?? null,
       data.repo, data.filePath, data.lineNo ?? null,
       data.handlerClass ?? null, data.description ?? null,
       winner?.confidence ?? data.confidence ?? 1.0]
    );
    cronIdByKey.set(c.key, res.insertId);
  }

  // Step 6.1: APIs
  const apis = merged.nodes.filter(n => n.type === 'api');
  const apiIdByKey = new Map<string, number>();
  for (const a of apis) {
    const data = a.data as unknown as ApiData;
    const auth = merged.edges.find(
      e => e.sourceType === 'api' && e.sourceKey === a.key
        && e.linkType === 'BELONGS_TO' && e.confidence >= 1.0
    );
    const heuristic = merged.edges.find(
      e => e.sourceType === 'api' && e.sourceKey === a.key
        && e.linkType === 'BELONGS_TO' && e.confidence < 1.0
    );
    const winner = auth ?? heuristic;
    const domainId = winner ? domainIdByKey.get(winner.targetKey) ?? null : null;
    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO panorama_api_endpoint_new
        (domain_id, http_method, path, controller, repo, file_path, line_no, auth_required, description, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [domainId, data.httpMethod, data.path, data.controller ?? null,
       data.repo, data.filePath, data.lineNo ?? null,
       data.authRequired ?? 0, data.description ?? null,
       data.confidence ?? 1.0]
    );
    apiIdByKey.set(a.key, res.insertId);
  }

  // Step 6.2: Entities
  const entities = merged.nodes.filter(n => n.type === 'entity');
  const entityIdByKey = new Map<string, number>();
  for (const ent of entities) {
    const data = ent.data as unknown as EntityData;
    const auth = merged.edges.find(
      e => e.sourceType === 'entity' && e.sourceKey === ent.key
        && e.linkType === 'BELONGS_TO' && e.confidence >= 1.0
    );
    const heuristic = merged.edges.find(
      e => e.sourceType === 'entity' && e.sourceKey === ent.key
        && e.linkType === 'BELONGS_TO' && e.confidence < 1.0
    );
    const winner = auth ?? heuristic;
    const domainId = winner ? domainIdByKey.get(winner.targetKey) ?? null : null;
    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO panorama_entity_new
        (domain_id, table_name, repo, file_path, columns_json, description)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), ?)`,
      [domainId, data.tableName, data.repo, data.filePath,
       JSON.stringify(data.columns ?? []), data.description ?? null]
    );
    entityIdByKey.set(ent.key, res.insertId);
  }

  // Step 6.3: Contracts
  const contracts = merged.nodes.filter(n => n.type === 'contract');
  const contractIdByKey = new Map<string, number>();
  for (const c of contracts) {
    const data = c.data as unknown as ContractData;
    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO panorama_contract_new
        (name, address, chain, abi_path, deployed_at, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [data.name, data.address, data.chain, data.abiPath ?? null,
       data.deployedAt ?? null, data.notes ?? null]
    );
    contractIdByKey.set(c.key, res.insertId);
  }

  // Step 6.4: Frontend Routes
  const routes = merged.nodes.filter(n => n.type === 'route');
  const routeIdByKey = new Map<string, number>();
  for (const r of routes) {
    const data = r.data as unknown as RouteData;
    const auth = merged.edges.find(
      e => e.sourceType === 'route' && e.sourceKey === r.key
        && e.linkType === 'BELONGS_TO' && e.confidence >= 1.0
    );
    const heuristic = merged.edges.find(
      e => e.sourceType === 'route' && e.sourceKey === r.key
        && e.linkType === 'BELONGS_TO' && e.confidence < 1.0
    );
    const winner = auth ?? heuristic;
    const domainId = winner ? domainIdByKey.get(winner.targetKey) ?? null : null;
    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO panorama_frontend_route_new
        (domain_id, app_name, path, component, repo, file_path, is_lazy)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [domainId, data.appName, data.path, data.component ?? null,
       data.repo, data.filePath, data.isLazy ?? 0]
    );
    routeIdByKey.set(r.key, res.insertId);
  }

  // Step 6.5: Redis keys
  const redisKeys = merged.nodes.filter(n => n.type === 'redis');
  const redisIdByKey = new Map<string, number>();
  for (const rk of redisKeys) {
    const data = rk.data as unknown as RedisData;
    const auth = merged.edges.find(
      e => e.sourceType === 'redis' && e.sourceKey === rk.key
        && e.linkType === 'BELONGS_TO' && e.confidence >= 1.0
    );
    const heuristic = merged.edges.find(
      e => e.sourceType === 'redis' && e.sourceKey === rk.key
        && e.linkType === 'BELONGS_TO' && e.confidence < 1.0
    );
    const winner = auth ?? heuristic;
    const domainId = winner ? domainIdByKey.get(winner.targetKey) ?? null : null;
    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO panorama_redis_key_new
        (domain_id, key_pattern, redis_type, ttl_seconds, description, source_repo, source_file, source_line, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [domainId, data.keyPattern, (data.redisType ?? 'unknown'),
       data.ttlSeconds ?? null, data.description ?? null,
       data.sourceRepo, data.sourceFile, data.sourceLine ?? null,
       data.confidence ?? 0.7]
    );
    redisIdByKey.set(rk.key, res.insertId);
  }

  // Step 7: ref_link — generic relations.
  const polyId = (type: NodeKind, key: string): number | null => {
    if (type === 'domain') return domainIdByKey.get(key) ?? null;
    if (type === 'doc') return docIdByKey.get(key) ?? null;
    if (type === 'concept') return conceptIdByKey.get(key) ?? null;
    if (type === 'code_ref') return codeRefIdByKey.get(key) ?? null;
    if (type === 'cron') return cronIdByKey.get(key) ?? null;
    if (type === 'api') return apiIdByKey.get(key) ?? null;
    if (type === 'entity') return entityIdByKey.get(key) ?? null;
    if (type === 'contract') return contractIdByKey.get(key) ?? null;
    if (type === 'route') return routeIdByKey.get(key) ?? null;
    if (type === 'redis') return redisIdByKey.get(key) ?? null;
    return null;
  };
  for (const e of merged.edges) {
    const sId = polyId(e.sourceType, e.sourceKey);
    const tId = polyId(e.targetType, e.targetKey);
    if (sId === null || tId === null) continue;
    await pool.query(
      `INSERT INTO panorama_ref_link_new
        (source_type, source_id, target_type, target_id, link_type, confidence, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
      [e.sourceType, sId, e.targetType, tId, e.linkType, e.confidence,
       JSON.stringify(e.meta ?? {})]
    );
  }

  // Step 8: Junction tables
  for (const e of merged.edges) {
    // api → cron via callCronApi → panorama_api_cron_call
    if (e.sourceType === 'api' && e.targetType === 'cron' && e.linkType === 'CALLS') {
      const aId = apiIdByKey.get(e.sourceKey);
      const cId = cronIdByKey.get(e.targetKey);
      if (aId && cId) {
        const meta = (e.meta ?? {}) as { callPath?: string };
        await pool.query(
          `INSERT IGNORE INTO panorama_api_cron_call_new (api_id, cron_id, call_path) VALUES (?, ?, ?)`,
          [aId, cId, meta.callPath ?? null]
        );
      }
      continue;
    }
    // route → api → panorama_route_api_call
    if (e.sourceType === 'route' && e.targetType === 'api' && e.linkType === 'CALLS') {
      const rId = routeIdByKey.get(e.sourceKey);
      const aId = apiIdByKey.get(e.targetKey);
      if (rId && aId) {
        await pool.query(
          `INSERT IGNORE INTO panorama_route_api_call_new (route_id, api_id) VALUES (?, ?)`,
          [rId, aId]
        );
      }
      continue;
    }
    // api → entity (READS_WRITES) → panorama_api_entity_op
    if (e.sourceType === 'api' && e.targetType === 'entity' && e.linkType === 'READS_WRITES') {
      const aId = apiIdByKey.get(e.sourceKey);
      const entId = entityIdByKey.get(e.targetKey);
      if (aId && entId) {
        await pool.query(
          `INSERT IGNORE INTO panorama_api_entity_op_new (api_id, entity_id, op_type) VALUES (?, ?, 'BOTH')`,
          [aId, entId]
        );
      }
      continue;
    }
    // {cron|api} → redis (CALLS) → panorama_{cron|api}_redis_op
    if (e.targetType === 'redis' && e.linkType === 'CALLS') {
      const meta = (e.meta ?? {}) as { resource?: string; opTypes?: string[] };
      if (meta.resource !== 'redis') continue;
      const opTypes = meta.opTypes ?? ['BOTH'];
      const op = opTypes.length > 1 ? 'BOTH' : (opTypes[0] ?? 'BOTH');
      const redisId = redisIdByKey.get(e.targetKey);
      if (!redisId) continue;
      if (e.sourceType === 'cron') {
        const cId = cronIdByKey.get(e.sourceKey);
        if (cId) {
          await pool.query(
            `INSERT IGNORE INTO panorama_cron_redis_op_new (cron_id, redis_id, op_type) VALUES (?, ?, ?)`,
            [cId, redisId, op]
          );
        }
      } else if (e.sourceType === 'api') {
        const aId = apiIdByKey.get(e.sourceKey);
        if (aId) {
          await pool.query(
            `INSERT IGNORE INTO panorama_api_redis_op_new (api_id, redis_id, op_type) VALUES (?, ?, ?)`,
            [aId, redisId, op]
          );
        }
      }
      continue;
    }
    // cron_contract_call and api_contract_call: not actively emitted in Phase 2 — leave cases empty
  }
}

async function swapStagingTables(pool: Pool) {
  const renames: string[] = [];
  for (const t of STAGING_TABLES) {
    renames.push(`\`${t}\` TO \`${t}_old\``);
    renames.push(`\`${t}_new\` TO \`${t}\``);
  }
  await pool.query(`RENAME TABLE ${renames.join(', ')}`);
  for (const t of STAGING_TABLES) {
    await pool.query(`DROP TABLE \`${t}_old\``);
  }
}

async function persistBrokenRefs(pool: Pool, buildId: string, merged: MergedGraph) {
  if (merged.brokenRefs.length === 0) return;
  const values = merged.brokenRefs.map(b =>
    [buildId, b.docPath, b.docLineNo, b.refRepo, b.refFilePath, b.refLineNo, b.reason]
  );
  await pool.query(
    `INSERT INTO panorama_broken_ref
      (build_id, doc_path, doc_line_no, ref_repo, ref_file_path, ref_line_no, reason)
     VALUES ?`,
    [values]
  );
}
