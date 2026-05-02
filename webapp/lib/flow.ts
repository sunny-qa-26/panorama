import 'server-only';
import dagre from 'dagre';
import type { RowDataPacket } from 'mysql2';
import { getPool } from './db';

export type FlowKind = 'ui' | 'api' | 'cron' | 'contract' | 'db' | 'redis';

export interface FlowNode {
  id: string;
  type: 'panoramaNode';
  data: { kind: FlowKind; name: string; subtitle: string | null; confidence: number; href: string };
  position: { x: number; y: number };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  type: 'smoothstep';
  animated?: boolean;
  data: { method?: string | null; confidence: number };
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

const LANE_ORDER: Record<FlowKind, number> = {
  ui: 0,
  api: 1,
  cron: 2,
  contract: 3,
  db: 4,
  redis: 5
};

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;
const RANK_SEP = 100;
const NODE_SEP = 30;

interface DomainCronRow extends RowDataPacket {
  id: number;
  name: string;
  confidence: string | number;
  description: string | null;
}
interface DomainApiRow extends RowDataPacket {
  id: number;
  httpMethod: string;
  path: string;
}
interface DomainEntityRow extends RowDataPacket {
  id: number;
  tableName: string;
}
interface DomainRouteRow extends RowDataPacket {
  id: number;
  appName: string;
  path: string;
}
interface DomainRedisRow extends RowDataPacket {
  id: number;
  keyPattern: string;
}
interface DomainContractRow extends RowDataPacket {
  id: number;
  name: string;
  address: string;
  chain: string;
}

interface RouteApiRow extends RowDataPacket {
  routeId: number;
  apiId: number;
}
interface ApiCronRow extends RowDataPacket {
  apiId: number;
  cronId: number;
  callPath: string | null;
}
interface ApiEntityRow extends RowDataPacket {
  apiId: number;
  entityId: number;
  opType: string | null;
}
interface CronContractRow extends RowDataPacket {
  cronId: number;
  contractId: number;
  methodName: string | null;
}
interface CronRedisRow extends RowDataPacket {
  cronId: number;
  redisId: number;
  opType: string | null;
}
interface ApiRedisRow extends RowDataPacket {
  apiId: number;
  redisId: number;
  opType: string | null;
}

export async function buildFlow(domainId: number): Promise<FlowGraph> {
  const pool = getPool();

  // Collect candidate nodes: anything that EITHER belongs to this domain OR is
  // reachable through a junction from a node that does. This widens the chart
  // beyond strict same-domain matching, which caused empty graphs when the
  // ingestor's domain heuristic didn't match a knowledge-base domain.
  const [crons] = await pool.query<DomainCronRow[]>(
    `SELECT id, name, confidence, description FROM panorama_cron_job WHERE domain_id = ?`,
    [domainId]
  );
  const [apis] = await pool.query<DomainApiRow[]>(
    `SELECT id, http_method AS httpMethod, path FROM panorama_api_endpoint WHERE domain_id = ?`,
    [domainId]
  );
  const [entities] = await pool.query<DomainEntityRow[]>(
    `SELECT id, table_name AS tableName FROM panorama_entity WHERE domain_id = ?`,
    [domainId]
  );
  const [routes] = await pool.query<DomainRouteRow[]>(
    `SELECT id, app_name AS appName, path FROM panorama_frontend_route WHERE domain_id = ?`,
    [domainId]
  );
  const [redisKeys] = await pool.query<DomainRedisRow[]>(
    `SELECT id, key_pattern AS keyPattern FROM panorama_redis_key WHERE domain_id = ?`,
    [domainId]
  );

  // Pull in adjacent entities reachable from this domain's apis via api_entity_op,
  // even when the entity itself has a different (or NULL) domain_id.
  const [adjacentEntities] = apis.length === 0
    ? [[] as DomainEntityRow[]]
    : await pool.query<DomainEntityRow[]>(
        `SELECT DISTINCT e.id, e.table_name AS tableName
         FROM panorama_api_entity_op j
         JOIN panorama_entity e ON e.id = j.entity_id
         WHERE j.api_id IN (?)`,
        [apis.map(a => a.id)]
      );
  const entityById = new Map<number, DomainEntityRow>();
  for (const e of entities) entityById.set(Number(e.id), e);
  for (const e of adjacentEntities) if (!entityById.has(Number(e.id))) entityById.set(Number(e.id), e);

  // Same trick for adjacent apis pulled in by cron→redis or api→entity edges
  // when the api's own domain_id is NULL but it's reached via a doc REFERENCES path.
  const [adjacentApisFromEntities] = entities.length === 0
    ? [[] as DomainApiRow[]]
    : await pool.query<DomainApiRow[]>(
        `SELECT DISTINCT a.id, a.http_method AS httpMethod, a.path
         FROM panorama_api_entity_op j
         JOIN panorama_api_endpoint a ON a.id = j.api_id
         WHERE j.entity_id IN (?)`,
        [entities.map(e => Number(e.id))]
      );
  const apiById = new Map<number, DomainApiRow>();
  for (const a of apis) apiById.set(Number(a.id), a);
  for (const a of adjacentApisFromEntities) if (!apiById.has(Number(a.id))) apiById.set(Number(a.id), a);

  // Contracts: those reachable through this domain's crons + apis (junctions empty in Phase 2).
  const [contracts] = await pool.query<DomainContractRow[]>(
    `SELECT DISTINCT c.id, c.name, c.address, c.chain
     FROM panorama_contract c
     LEFT JOIN panorama_cron_contract_call ccc ON ccc.contract_id = c.id
     LEFT JOIN panorama_cron_job cj ON cj.id = ccc.cron_id AND cj.domain_id = ?
     LEFT JOIN panorama_api_contract_call acc ON acc.contract_id = c.id
     LEFT JOIN panorama_api_endpoint a ON a.id = acc.api_id AND a.domain_id = ?
     WHERE cj.id IS NOT NULL OR a.id IS NOT NULL`,
    [domainId, domainId]
  );

  const nodes: FlowNode[] = [];
  const idSet = new Set<string>();
  const push = (
    kind: FlowKind,
    id: number,
    name: string,
    subtitle: string | null,
    confidence: number
  ) => {
    const fid = `${kind}:${id}`;
    if (idSet.has(fid)) return;
    idSet.add(fid);
    const href =
      kind === 'db'
        ? `/node/entity/${id}`
        : kind === 'ui'
          ? `/node/route/${id}`
          : `/node/${kind}/${id}`;
    nodes.push({
      id: fid,
      type: 'panoramaNode',
      data: { kind, name, subtitle, confidence, href },
      position: { x: 0, y: 0 }
    });
  };

  for (const r of routes) push('ui', r.id, `${r.appName}: ${r.path}`, null, 1.0);
  for (const a of apiById.values()) push('api', Number(a.id), `${a.httpMethod} ${a.path}`, null, 1.0);
  for (const c of crons) {
    const conf = typeof c.confidence === 'string' ? Number(c.confidence) : c.confidence;
    push('cron', c.id, c.name, c.description, conf);
  }
  for (const c of contracts) push('contract', Number(c.id), c.name, c.address, 1.0);
  for (const e of entityById.values()) push('db', Number(e.id), e.tableName, null, 1.0);
  for (const rk of redisKeys) push('redis', rk.id, rk.keyPattern, null, 1.0);

  // Collect edges from junction tables, filtered to this domain's nodes.
  const edges: FlowEdge[] = [];
  const allNodeIds = new Set(nodes.map((n) => n.id));

  const addEdge = (
    sourceKind: FlowKind,
    sourceId: number,
    targetKind: FlowKind,
    targetId: number,
    method: string | null,
    confidence: number
  ) => {
    const src = `${sourceKind}:${sourceId}`;
    const tgt = `${targetKind}:${targetId}`;
    if (!allNodeIds.has(src) || !allNodeIds.has(tgt)) return;
    edges.push({
      id: `${src}->${tgt}:${method ?? ''}`,
      source: src,
      target: tgt,
      type: 'smoothstep',
      animated: confidence < 1.0,
      data: { method, confidence }
    });
  };

  // route → api
  if (routes.length > 0 && apis.length > 0) {
    const [rows] = await pool.query<RouteApiRow[]>(
      `SELECT j.route_id AS routeId, j.api_id AS apiId
       FROM panorama_route_api_call j
       WHERE j.route_id IN (?)`,
      [routes.map((r) => r.id)]
    );
    for (const r of rows) {
      addEdge('ui', Number(r.routeId), 'api', Number(r.apiId), null, 0.4);
    }
  }

  // api → cron (callCronApi)
  if (apiById.size > 0) {
    const [rows] = await pool.query<ApiCronRow[]>(
      `SELECT j.api_id AS apiId, j.cron_id AS cronId, j.call_path AS callPath
       FROM panorama_api_cron_call j WHERE j.api_id IN (?)`,
      [[...apiById.keys()]]
    );
    for (const r of rows) {
      addEdge('api', Number(r.apiId), 'cron', Number(r.cronId), r.callPath, 0.9);
    }
  }

  // api → entity
  if (apiById.size > 0) {
    const [rows] = await pool.query<ApiEntityRow[]>(
      `SELECT j.api_id AS apiId, j.entity_id AS entityId, j.op_type AS opType
       FROM panorama_api_entity_op j WHERE j.api_id IN (?)`,
      [[...apiById.keys()]]
    );
    for (const r of rows) {
      addEdge('api', Number(r.apiId), 'db', Number(r.entityId), r.opType, 0.8);
    }
  }

  // cron → contract  (currently empty)
  if (crons.length > 0) {
    const [rows] = await pool.query<CronContractRow[]>(
      `SELECT j.cron_id AS cronId, j.contract_id AS contractId, j.method_name AS methodName
       FROM panorama_cron_contract_call j WHERE j.cron_id IN (?)`,
      [crons.map((c) => c.id)]
    );
    for (const r of rows) {
      addEdge('cron', Number(r.cronId), 'contract', Number(r.contractId), r.methodName, 0.9);
    }
  }

  // cron → redis / api → redis
  if (crons.length > 0) {
    const [rows] = await pool.query<CronRedisRow[]>(
      `SELECT j.cron_id AS cronId, j.redis_id AS redisId, j.op_type AS opType
       FROM panorama_cron_redis_op j WHERE j.cron_id IN (?)`,
      [crons.map((c) => c.id)]
    );
    for (const r of rows) {
      addEdge('cron', Number(r.cronId), 'redis', Number(r.redisId), r.opType, 0.9);
    }
  }
  if (apiById.size > 0) {
    const [rows] = await pool.query<ApiRedisRow[]>(
      `SELECT j.api_id AS apiId, j.redis_id AS redisId, j.op_type AS opType
       FROM panorama_api_redis_op j WHERE j.api_id IN (?)`,
      [[...apiById.keys()]]
    );
    for (const r of rows) {
      addEdge('api', Number(r.apiId), 'redis', Number(r.redisId), r.opType, 0.9);
    }
  }

  // Layout via dagre
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', ranksep: RANK_SEP, nodesep: NODE_SEP });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);

  // Override y by lane to enforce 6-lane ordering (dagre's TB doesn't strictly group by kind).
  for (const n of nodes) {
    const layout = g.node(n.id);
    n.position = {
      x: layout?.x ?? 0,
      y: LANE_ORDER[n.data.kind] * (NODE_HEIGHT + RANK_SEP)
    };
  }

  return { nodes, edges };
}
