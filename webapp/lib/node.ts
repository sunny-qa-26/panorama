import 'server-only';
import type { RowDataPacket } from 'mysql2';
import { getPool } from './db';

export type NodeType = 'cron' | 'api' | 'contract' | 'entity' | 'redis' | 'route';
export type RelationType = NodeType | 'doc' | 'domain';

export interface RelationItem {
  type: RelationType;
  id: number;
  name: string;
  href: string;
}

export interface NodeDetail {
  id: number;
  type: NodeType;
  name: string;
  domain: { id: number; name: string; displayName: string } | null;
  filePath: string | null;
  lineNo: number | null;
  description: string | null;
  usedBy: RelationItem[];
  calls: RelationItem[];
  extra: Record<string, unknown>;
}

interface DomainRow extends RowDataPacket { id: number; name: string; displayName: string; }

async function fetchDomainFor(id: number | null): Promise<NodeDetail['domain']> {
  if (id === null) return null;
  const pool = getPool();
  const [rows] = await pool.query<DomainRow[]>(
    `SELECT id, name, display_name AS displayName FROM panorama_business_domain WHERE id = ?`,
    [id]
  );
  const r = rows[0];
  if (!r) return null;
  return { id: Number(r.id), name: r.name, displayName: r.displayName };
}

interface CronRow extends RowDataPacket {
  id: number; name: string; schedule: string | null; jobId: string | null;
  repo: string; filePath: string; lineNo: number | null;
  handlerClass: string | null; description: string | null;
  confidence: string | number; domainId: number | null;
}

interface ApiRow extends RowDataPacket {
  id: number; httpMethod: string; path: string; controller: string | null;
  repo: string; filePath: string; lineNo: number | null;
  authRequired: number; description: string | null;
  confidence: string | number; domainId: number | null;
}

interface ContractRow extends RowDataPacket {
  id: number; name: string; address: string; chain: string;
  abiPath: string | null; deployedAt: Date | string | null; notes: string | null;
}

interface EntityRow extends RowDataPacket {
  id: number; tableName: string; repo: string; filePath: string;
  columns: string | unknown; description: string | null;
  domainId: number | null;
}

interface RedisRow extends RowDataPacket {
  id: number; keyPattern: string; redisType: string;
  ttlSeconds: number | null; description: string | null;
  sourceRepo: string; sourceFile: string; sourceLine: number | null;
  confidence: string | number; domainId: number | null;
}

interface RouteRow extends RowDataPacket {
  id: number; appName: string; path: string; component: string | null;
  repo: string; filePath: string; isLazy: number; domainId: number | null;
}

export async function fetchNodeDetail(type: NodeType, id: number): Promise<NodeDetail | null> {
  const pool = getPool();
  if (type === 'cron') {
    const [rows] = await pool.query<CronRow[]>(
      `SELECT id, name, schedule, job_id AS jobId, repo, file_path AS filePath,
              line_no AS lineNo, handler_class AS handlerClass, description,
              confidence, domain_id AS domainId
       FROM panorama_cron_job WHERE id = ?`, [id]
    );
    const r = rows[0];
    if (!r) return null;
    const usedBy: RelationItem[] = [];
    // Apis that proxy to this cron
    const [proxies] = await pool.query<RowDataPacket[]>(
      `SELECT a.id, a.http_method AS httpMethod, a.path
       FROM panorama_api_cron_call j JOIN panorama_api_endpoint a ON a.id = j.api_id
       WHERE j.cron_id = ?`, [id]
    );
    for (const p of proxies) {
      usedBy.push({
        type: 'api', id: Number((p as RowDataPacket).id),
        name: `${(p as RowDataPacket).httpMethod} ${(p as RowDataPacket).path}`,
        href: `/node/api/${(p as RowDataPacket).id}`
      });
    }
    // Docs that REFERENCE the cron's file_path
    const [docs] = await pool.query<RowDataPacket[]>(
      `SELECT DISTINCT d.id, d.title, d.path, d.domain_id AS domainId
       FROM panorama_code_ref cr
       JOIN panorama_ref_link rl ON rl.target_type = 'code_ref' AND rl.target_id = cr.id AND rl.link_type = 'REFERENCES'
       JOIN panorama_knowledge_doc d ON d.id = rl.source_id AND rl.source_type = 'doc'
       WHERE cr.repo = ? AND cr.file_path = ?`, [r.repo, r.filePath]
    );
    for (const d of docs) {
      usedBy.push({
        type: 'doc', id: Number((d as RowDataPacket).id),
        name: ((d as RowDataPacket).title as string) ?? ((d as RowDataPacket).path as string),
        href: `/domain/${(d as RowDataPacket).domainId}`
      });
    }
    const calls: RelationItem[] = [];
    // redis keys this cron writes/reads
    const [redis] = await pool.query<RowDataPacket[]>(
      `SELECT rk.id, rk.key_pattern AS keyPattern, j.op_type AS opType
       FROM panorama_cron_redis_op j JOIN panorama_redis_key rk ON rk.id = j.redis_id
       WHERE j.cron_id = ?`, [id]
    );
    for (const rr of redis) {
      calls.push({
        type: 'redis', id: Number((rr as RowDataPacket).id),
        name: `${(rr as RowDataPacket).keyPattern} (${(rr as RowDataPacket).opType})`,
        href: `/node/redis/${(rr as RowDataPacket).id}`
      });
    }
    return {
      id: Number(r.id), type: 'cron', name: r.name,
      domain: await fetchDomainFor(r.domainId),
      filePath: r.filePath, lineNo: r.lineNo,
      description: r.description, usedBy, calls,
      extra: {
        schedule: r.schedule, jobId: r.jobId,
        handlerClass: r.handlerClass, repo: r.repo,
        confidence: typeof r.confidence === 'string' ? Number(r.confidence) : r.confidence
      }
    };
  }

  if (type === 'api') {
    const [rows] = await pool.query<ApiRow[]>(
      `SELECT id, http_method AS httpMethod, path, controller, repo, file_path AS filePath,
              line_no AS lineNo, auth_required AS authRequired, description,
              confidence, domain_id AS domainId
       FROM panorama_api_endpoint WHERE id = ?`, [id]
    );
    const r = rows[0];
    if (!r) return null;
    const usedBy: RelationItem[] = [];
    // Routes calling this api
    const [routes] = await pool.query<RowDataPacket[]>(
      `SELECT fr.id, fr.path, fr.app_name AS appName
       FROM panorama_route_api_call j JOIN panorama_frontend_route fr ON fr.id = j.route_id
       WHERE j.api_id = ?`, [id]
    );
    for (const ro of routes) {
      usedBy.push({
        type: 'route', id: Number((ro as RowDataPacket).id),
        name: `${(ro as RowDataPacket).appName}: ${(ro as RowDataPacket).path}`,
        href: `/node/route/${(ro as RowDataPacket).id}`
      });
    }
    const calls: RelationItem[] = [];
    // Crons proxied
    const [crons] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.name FROM panorama_api_cron_call j JOIN panorama_cron_job c ON c.id = j.cron_id WHERE j.api_id = ?`, [id]
    );
    for (const c of crons) {
      calls.push({
        type: 'cron', id: Number((c as RowDataPacket).id),
        name: (c as RowDataPacket).name as string,
        href: `/node/cron/${(c as RowDataPacket).id}`
      });
    }
    // Entities
    const [ents] = await pool.query<RowDataPacket[]>(
      `SELECT e.id, e.table_name AS tableName, j.op_type AS opType
       FROM panorama_api_entity_op j JOIN panorama_entity e ON e.id = j.entity_id
       WHERE j.api_id = ?`, [id]
    );
    for (const e of ents) {
      calls.push({
        type: 'entity', id: Number((e as RowDataPacket).id),
        name: `${(e as RowDataPacket).tableName} (${(e as RowDataPacket).opType})`,
        href: `/node/entity/${(e as RowDataPacket).id}`
      });
    }
    // Redis
    const [reds] = await pool.query<RowDataPacket[]>(
      `SELECT rk.id, rk.key_pattern AS keyPattern, j.op_type AS opType
       FROM panorama_api_redis_op j JOIN panorama_redis_key rk ON rk.id = j.redis_id
       WHERE j.api_id = ?`, [id]
    );
    for (const rr of reds) {
      calls.push({
        type: 'redis', id: Number((rr as RowDataPacket).id),
        name: `${(rr as RowDataPacket).keyPattern} (${(rr as RowDataPacket).opType})`,
        href: `/node/redis/${(rr as RowDataPacket).id}`
      });
    }
    return {
      id: Number(r.id), type: 'api', name: `${r.httpMethod} ${r.path}`,
      domain: await fetchDomainFor(r.domainId),
      filePath: r.filePath, lineNo: r.lineNo,
      description: r.description, usedBy, calls,
      extra: {
        httpMethod: r.httpMethod, path: r.path,
        controller: r.controller, repo: r.repo,
        authRequired: r.authRequired,
        confidence: typeof r.confidence === 'string' ? Number(r.confidence) : r.confidence
      }
    };
  }

  if (type === 'contract') {
    const [rows] = await pool.query<ContractRow[]>(
      `SELECT id, name, address, chain, abi_path AS abiPath,
              deployed_at AS deployedAt, notes
       FROM panorama_contract WHERE id = ?`, [id]
    );
    const r = rows[0];
    if (!r) return null;
    // usedBy: crons + apis that call this contract (junctions empty in Phase 2 — return [])
    const usedBy: RelationItem[] = [];
    const [cronCallers] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.name FROM panorama_cron_contract_call j JOIN panorama_cron_job c ON c.id = j.cron_id WHERE j.contract_id = ?`, [id]
    );
    for (const c of cronCallers) {
      usedBy.push({
        type: 'cron', id: Number((c as RowDataPacket).id),
        name: (c as RowDataPacket).name as string,
        href: `/node/cron/${(c as RowDataPacket).id}`
      });
    }
    const [apiCallers] = await pool.query<RowDataPacket[]>(
      `SELECT a.id, a.http_method AS httpMethod, a.path FROM panorama_api_contract_call j JOIN panorama_api_endpoint a ON a.id = j.api_id WHERE j.contract_id = ?`, [id]
    );
    for (const a of apiCallers) {
      usedBy.push({
        type: 'api', id: Number((a as RowDataPacket).id),
        name: `${(a as RowDataPacket).httpMethod} ${(a as RowDataPacket).path}`,
        href: `/node/api/${(a as RowDataPacket).id}`
      });
    }
    const lv = r.deployedAt;
    const deployedAtIso = lv === null ? null : (lv instanceof Date ? lv.toISOString().slice(0, 10) : lv);
    return {
      id: Number(r.id), type: 'contract', name: r.name,
      domain: null,
      filePath: null, lineNo: null,
      description: r.notes, usedBy, calls: [],
      extra: {
        address: r.address, chain: r.chain,
        abiPath: r.abiPath, deployedAt: deployedAtIso
      }
    };
  }

  if (type === 'entity') {
    const [rows] = await pool.query<EntityRow[]>(
      `SELECT id, table_name AS tableName, repo, file_path AS filePath,
              columns_json AS columns, description, domain_id AS domainId
       FROM panorama_entity WHERE id = ?`, [id]
    );
    const r = rows[0];
    if (!r) return null;
    const usedBy: RelationItem[] = [];
    const [apis] = await pool.query<RowDataPacket[]>(
      `SELECT a.id, a.http_method AS httpMethod, a.path, j.op_type AS opType
       FROM panorama_api_entity_op j JOIN panorama_api_endpoint a ON a.id = j.api_id
       WHERE j.entity_id = ?`, [id]
    );
    for (const a of apis) {
      usedBy.push({
        type: 'api', id: Number((a as RowDataPacket).id),
        name: `${(a as RowDataPacket).httpMethod} ${(a as RowDataPacket).path} (${(a as RowDataPacket).opType})`,
        href: `/node/api/${(a as RowDataPacket).id}`
      });
    }
    const cols = typeof r.columns === 'string' ? JSON.parse(r.columns) : (r.columns ?? []);
    return {
      id: Number(r.id), type: 'entity', name: r.tableName,
      domain: await fetchDomainFor(r.domainId),
      filePath: r.filePath, lineNo: null,
      description: r.description, usedBy, calls: [],
      extra: { tableName: r.tableName, repo: r.repo, columns: cols }
    };
  }

  if (type === 'redis') {
    const [rows] = await pool.query<RedisRow[]>(
      `SELECT id, key_pattern AS keyPattern, redis_type AS redisType,
              ttl_seconds AS ttlSeconds, description,
              source_repo AS sourceRepo, source_file AS sourceFile,
              source_line AS sourceLine, confidence, domain_id AS domainId
       FROM panorama_redis_key WHERE id = ?`, [id]
    );
    const r = rows[0];
    if (!r) return null;
    const usedBy: RelationItem[] = [];
    const [crons] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.name, j.op_type AS opType FROM panorama_cron_redis_op j JOIN panorama_cron_job c ON c.id = j.cron_id WHERE j.redis_id = ?`, [id]
    );
    for (const c of crons) {
      usedBy.push({
        type: 'cron', id: Number((c as RowDataPacket).id),
        name: `${(c as RowDataPacket).name} (${(c as RowDataPacket).opType})`,
        href: `/node/cron/${(c as RowDataPacket).id}`
      });
    }
    const [apis] = await pool.query<RowDataPacket[]>(
      `SELECT a.id, a.http_method AS httpMethod, a.path, j.op_type AS opType FROM panorama_api_redis_op j JOIN panorama_api_endpoint a ON a.id = j.api_id WHERE j.redis_id = ?`, [id]
    );
    for (const a of apis) {
      usedBy.push({
        type: 'api', id: Number((a as RowDataPacket).id),
        name: `${(a as RowDataPacket).httpMethod} ${(a as RowDataPacket).path} (${(a as RowDataPacket).opType})`,
        href: `/node/api/${(a as RowDataPacket).id}`
      });
    }
    return {
      id: Number(r.id), type: 'redis', name: r.keyPattern,
      domain: await fetchDomainFor(r.domainId),
      filePath: r.sourceFile, lineNo: r.sourceLine,
      description: r.description, usedBy, calls: [],
      extra: {
        keyPattern: r.keyPattern, redisType: r.redisType,
        ttlSeconds: r.ttlSeconds, sourceRepo: r.sourceRepo,
        confidence: typeof r.confidence === 'string' ? Number(r.confidence) : r.confidence
      }
    };
  }

  if (type === 'route') {
    const [rows] = await pool.query<RouteRow[]>(
      `SELECT id, app_name AS appName, path, component, repo, file_path AS filePath,
              is_lazy AS isLazy, domain_id AS domainId
       FROM panorama_frontend_route WHERE id = ?`, [id]
    );
    const r = rows[0];
    if (!r) return null;
    const calls: RelationItem[] = [];
    const [apis] = await pool.query<RowDataPacket[]>(
      `SELECT a.id, a.http_method AS httpMethod, a.path FROM panorama_route_api_call j JOIN panorama_api_endpoint a ON a.id = j.api_id WHERE j.route_id = ?`, [id]
    );
    for (const a of apis) {
      calls.push({
        type: 'api', id: Number((a as RowDataPacket).id),
        name: `${(a as RowDataPacket).httpMethod} ${(a as RowDataPacket).path}`,
        href: `/node/api/${(a as RowDataPacket).id}`
      });
    }
    return {
      id: Number(r.id), type: 'route', name: `${r.appName}: ${r.path}`,
      domain: await fetchDomainFor(r.domainId),
      filePath: r.filePath, lineNo: null,
      description: null, usedBy: [], calls,
      extra: {
        appName: r.appName, path: r.path,
        component: r.component, isLazy: Boolean(r.isLazy)
      }
    };
  }

  return null;
}
