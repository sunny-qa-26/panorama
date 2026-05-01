import 'server-only';
import type { RowDataPacket } from 'mysql2';
import { getPool } from './db';

export interface TreeRow {
  id: number;
  name: string;
  displayName: string;
  parentId: number | null;
  hasChildren: boolean;
  cronCount: number;
}

interface TreeQueryRow extends RowDataPacket {
  id: number;
  name: string;
  displayName: string;
  parentId: number | null;
  hasChildren: number; // 0 or 1
  cronCount: number;
}

export async function fetchTreeChildren(parentId: number | null): Promise<TreeRow[]> {
  const pool = getPool();
  const where = parentId === null ? 'd.parent_id IS NULL' : 'd.parent_id = ?';
  const params = parentId === null ? [] : [parentId];
  const [rows] = await pool.query<TreeQueryRow[]>(
    `SELECT
        d.id, d.name, d.display_name AS displayName, d.parent_id AS parentId,
        EXISTS(SELECT 1 FROM panorama_business_domain c WHERE c.parent_id = d.id) AS hasChildren,
        (SELECT COUNT(*) FROM panorama_cron_job cj WHERE cj.domain_id = d.id) AS cronCount
       FROM panorama_business_domain d
       WHERE ${where}
       ORDER BY d.sort_order, d.name`,
    params
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    displayName: r.displayName,
    parentId: r.parentId === null ? null : Number(r.parentId),
    hasChildren: Boolean(r.hasChildren),
    cronCount: Number(r.cronCount)
  }));
}

export interface DomainDoc {
  id: number;
  path: string;
  title: string | null;
  lastVerified: string | null;
  frontmatter: Record<string, unknown>;
  bodyMdPath: string | null;
  wordCount: number;
}

export interface DomainCron {
  id: number;
  name: string;
  schedule: string | null;
  jobId: string | null;
  repo: string;
  filePath: string;
  lineNo: number | null;
  handlerClass: string | null;
  description: string | null;
  confidence: number;
}

export interface DomainStats {
  cronCount: number;
  apiCount: number; // Phase 2
  contractCount: number; // Phase 2
  storageCount: number; // Phase 2 (entities + redis)
}

export interface DomainDetail {
  domain: {
    id: number;
    name: string;
    displayName: string;
    description: string | null;
    knowledgePath: string | null;
  };
  docs: DomainDoc[];
  crons: DomainCron[];
  stats: DomainStats;
}

interface DomainRow extends RowDataPacket {
  id: number;
  name: string;
  displayName: string;
  description: string | null;
  knowledgePath: string | null;
}

interface DocRow extends RowDataPacket {
  id: number;
  path: string;
  title: string | null;
  lastVerified: string | Date | null;
  frontmatter: string | Record<string, unknown> | null;
  bodyMdPath: string | null;
  wordCount: number;
}

interface CronRow extends RowDataPacket {
  id: number;
  name: string;
  schedule: string | null;
  jobId: string | null;
  repo: string;
  filePath: string;
  lineNo: number | null;
  handlerClass: string | null;
  description: string | null;
  confidence: string | number;
}

export async function fetchDomainDetail(id: number): Promise<DomainDetail | null> {
  const pool = getPool();
  const [domains] = await pool.query<DomainRow[]>(
    `SELECT id, name, display_name AS displayName, description, knowledge_path AS knowledgePath
       FROM panorama_business_domain WHERE id = ?`,
    [id]
  );
  const domain = domains[0];
  if (!domain) return null;

  const [docs] = await pool.query<DocRow[]>(
    `SELECT id, path, title, last_verified AS lastVerified, frontmatter_json AS frontmatter,
            body_md_path AS bodyMdPath, word_count AS wordCount
       FROM panorama_knowledge_doc WHERE domain_id = ? ORDER BY path`,
    [id]
  );

  const [crons] = await pool.query<CronRow[]>(
    `SELECT id, name, schedule, job_id AS jobId, repo, file_path AS filePath, line_no AS lineNo,
            handler_class AS handlerClass, description, confidence
       FROM panorama_cron_job WHERE domain_id = ? ORDER BY name`,
    [id]
  );

  const stats: DomainStats = {
    cronCount: crons.length,
    apiCount: 0,
    contractCount: 0,
    storageCount: 0
  };

  return {
    domain: {
      id: Number(domain.id),
      name: domain.name,
      displayName: domain.displayName,
      description: domain.description,
      knowledgePath: domain.knowledgePath
    },
    docs: docs.map((d): DomainDoc => {
      const fm = d.frontmatter;
      const parsed: Record<string, unknown> =
        typeof fm === 'string' ? JSON.parse(fm) : fm && typeof fm === 'object' ? fm : {};
      const lv = d.lastVerified;
      return {
        id: Number(d.id),
        path: d.path,
        title: d.title,
        lastVerified:
          lv === null ? null : lv instanceof Date ? lv.toISOString().slice(0, 10) : lv,
        frontmatter: parsed,
        bodyMdPath: d.bodyMdPath,
        wordCount: Number(d.wordCount)
      };
    }),
    crons: crons.map((c): DomainCron => ({
      id: Number(c.id),
      name: c.name,
      schedule: c.schedule,
      jobId: c.jobId,
      repo: c.repo,
      filePath: c.filePath,
      lineNo: c.lineNo === null ? null : Number(c.lineNo),
      handlerClass: c.handlerClass,
      description: c.description,
      confidence: typeof c.confidence === 'string' ? Number(c.confidence) : c.confidence
    })),
    stats
  };
}
