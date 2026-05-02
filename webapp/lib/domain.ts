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

export interface DomainApi {
  id: number;
  httpMethod: string;
  path: string;
  controller: string | null;
  repo: string;
  filePath: string;
  lineNo: number | null;
  authRequired: number;
}

export interface DomainEntity {
  id: number;
  tableName: string;
  repo: string;
  filePath: string;
  columns: unknown;
}

export interface DomainContract {
  id: number;
  name: string;
  address: string;
  chain: string;
  abiPath: string | null;
  // not associated with a domain directly — we surface ones called by this domain's crons/apis
  via: 'cron' | 'api' | 'doc';
}

export interface DomainRoute {
  id: number;
  appName: string;
  path: string;
  component: string | null;
  isLazy: number;
}

export interface DomainRedis {
  id: number;
  keyPattern: string;
  sourceFile: string;
  sourceLine: number | null;
  redisType: string;
}

interface ApiRow extends RowDataPacket {
  id: number;
  httpMethod: string;
  path: string;
  controller: string | null;
  repo: string;
  filePath: string;
  lineNo: number | null;
  authRequired: number;
}
interface EntityRowD extends RowDataPacket {
  id: number;
  tableName: string;
  repo: string;
  filePath: string;
  columns: string | unknown;
}
interface ContractRowD extends RowDataPacket {
  id: number;
  name: string;
  address: string;
  chain: string;
  abiPath: string | null;
}
interface RouteRowD extends RowDataPacket {
  id: number;
  appName: string;
  path: string;
  component: string | null;
  isLazy: number;
}
interface RedisRowD extends RowDataPacket {
  id: number;
  keyPattern: string;
  sourceFile: string;
  sourceLine: number | null;
  redisType: string;
}

export async function fetchDomainExtras(domainId: number): Promise<{
  apis: DomainApi[];
  entities: DomainEntity[];
  contracts: DomainContract[];
  routes: DomainRoute[];
  redisKeys: DomainRedis[];
}> {
  const pool = getPool();

  const [apis] = await pool.query<ApiRow[]>(
    `SELECT id, http_method AS httpMethod, path, controller, repo, file_path AS filePath,
            line_no AS lineNo, auth_required AS authRequired
     FROM panorama_api_endpoint WHERE domain_id = ? ORDER BY path`,
    [domainId]
  );

  const [entities] = await pool.query<EntityRowD[]>(
    `SELECT id, table_name AS tableName, repo, file_path AS filePath, columns_json AS columns
     FROM panorama_entity WHERE domain_id = ? ORDER BY table_name`,
    [domainId]
  );

  // Contracts: surface ones called by crons or apis in this domain.
  // Phase 2 has no cron_contract_call/api_contract_call rows yet, so this might return [].
  // Keep the query in place for future ingestor expansion.
  const [contracts] = await pool.query<ContractRowD[]>(
    `SELECT DISTINCT c.id, c.name, c.address, c.chain, c.abi_path AS abiPath
     FROM panorama_contract c
     LEFT JOIN panorama_cron_contract_call ccc ON ccc.contract_id = c.id
     LEFT JOIN panorama_cron_job cj ON cj.id = ccc.cron_id AND cj.domain_id = ?
     LEFT JOIN panorama_api_contract_call acc ON acc.contract_id = c.id
     LEFT JOIN panorama_api_endpoint a ON a.id = acc.api_id AND a.domain_id = ?
     WHERE cj.id IS NOT NULL OR a.id IS NOT NULL
     ORDER BY c.name`,
    [domainId, domainId]
  );

  const [routes] = await pool.query<RouteRowD[]>(
    `SELECT id, app_name AS appName, path, component, is_lazy AS isLazy
     FROM panorama_frontend_route WHERE domain_id = ? ORDER BY path`,
    [domainId]
  );

  const [redisKeys] = await pool.query<RedisRowD[]>(
    `SELECT id, key_pattern AS keyPattern, source_file AS sourceFile,
            source_line AS sourceLine, redis_type AS redisType
     FROM panorama_redis_key WHERE domain_id = ? ORDER BY key_pattern`,
    [domainId]
  );

  return {
    apis: apis.map((r) => ({
      id: Number(r.id),
      httpMethod: r.httpMethod,
      path: r.path,
      controller: r.controller,
      repo: r.repo,
      filePath: r.filePath,
      lineNo: r.lineNo === null ? null : Number(r.lineNo),
      authRequired: Number(r.authRequired)
    })),
    entities: entities.map((r) => ({
      id: Number(r.id),
      tableName: r.tableName,
      repo: r.repo,
      filePath: r.filePath,
      columns: typeof r.columns === 'string' ? JSON.parse(r.columns) : (r.columns ?? [])
    })),
    contracts: contracts.map((r) => ({
      id: Number(r.id),
      name: r.name,
      address: r.address,
      chain: r.chain,
      abiPath: r.abiPath,
      via: 'cron' as const
    })),
    routes: routes.map((r) => ({
      id: Number(r.id),
      appName: r.appName,
      path: r.path,
      component: r.component,
      isLazy: Number(r.isLazy)
    })),
    redisKeys: redisKeys.map((r) => ({
      id: Number(r.id),
      keyPattern: r.keyPattern,
      sourceFile: r.sourceFile,
      sourceLine: r.sourceLine === null ? null : Number(r.sourceLine),
      redisType: r.redisType
    }))
  };
}
