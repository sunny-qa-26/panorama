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
  'panorama_cron_job'
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

  // Step 7: ref_link — generic relations.
  const polyId = (type: NodeKind, key: string): number | null => {
    if (type === 'domain') return domainIdByKey.get(key) ?? null;
    if (type === 'doc') return docIdByKey.get(key) ?? null;
    if (type === 'concept') return conceptIdByKey.get(key) ?? null;
    if (type === 'code_ref') return codeRefIdByKey.get(key) ?? null;
    if (type === 'cron') return cronIdByKey.get(key) ?? null;
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
