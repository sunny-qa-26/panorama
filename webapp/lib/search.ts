import 'server-only';
import type { RowDataPacket } from 'mysql2';
import { getPool } from './db';

export type SearchType = 'domain' | 'doc' | 'cron' | 'api' | 'contract' | 'entity' | 'redis' | 'route';

export interface SearchResult {
  type: SearchType;
  id: number;
  name: string;
  subtitle: string | null;
  score: number;
  href: string;
}

interface DomainRow extends RowDataPacket { id: number; name: string; displayName: string; score: number; }
interface DocRow extends RowDataPacket { id: number; title: string | null; path: string; domainId: number; score: number; }
interface CronRow extends RowDataPacket { id: number; name: string; description: string | null; score: number; }
interface ApiRow extends RowDataPacket { id: number; httpMethod: string; path: string; description: string | null; score: number; }
interface ContractRow extends RowDataPacket { id: number; name: string; address: string; chain: string; score: number; }
interface EntityRow extends RowDataPacket { id: number; tableName: string; }
interface RedisRow extends RowDataPacket { id: number; keyPattern: string; sourceFile: string; score: number; }
interface RouteRow extends RowDataPacket { id: number; appName: string; path: string; component: string | null; }

const LIMIT = 25;

export async function search(q: string, types?: SearchType[]): Promise<SearchResult[]> {
  if (!q || q.trim().length === 0) return [];
  const trimmed = q.trim();
  const allowed = new Set<SearchType>(types && types.length ? types : ['domain','doc','cron','api','contract','entity','redis','route']);
  const pool = getPool();
  const results: SearchResult[] = [];

  // FULLTEXT requires ≥3-char tokens. For shorter queries fall back to LIKE.
  const useFulltext = trimmed.length >= 3;
  const likePattern = `%${trimmed}%`;
  const ftQuery = `"${trimmed.replace(/"/g, '\\"')}"`; // boolean phrase query

  // Domain — no FULLTEXT index on this table; LIKE only with name-prefix scoring
  if (allowed.has('domain')) {
    const [rows] = await pool.query<DomainRow[]>(
      `SELECT id, name, display_name AS displayName,
              CASE
                WHEN name = ? THEN 5
                WHEN display_name = ? THEN 5
                WHEN name LIKE ? THEN 3
                WHEN display_name LIKE ? THEN 3
                ELSE 1
              END AS score
       FROM panorama_business_domain
       WHERE name LIKE ? OR display_name LIKE ?
       ORDER BY score DESC, name LIMIT ?`,
      [trimmed, trimmed, `${trimmed}%`, `${trimmed}%`, likePattern, likePattern, LIMIT]
    );
    for (const r of rows) {
      results.push({
        type: 'domain', id: Number(r.id),
        name: r.displayName ?? r.name,
        subtitle: r.name !== r.displayName ? r.name : null,
        score: Number(r.score) * 1.5,  // boost domain matches
        href: `/domain/${r.id}`
      });
    }
  }

  // Doc
  if (allowed.has('doc')) {
    const [rows] = useFulltext
      ? await pool.query<DocRow[]>(
          `SELECT id, title, path, domain_id AS domainId,
                  MATCH(title) AGAINST (? IN BOOLEAN MODE) AS score
           FROM panorama_knowledge_doc
           WHERE MATCH(title) AGAINST (? IN BOOLEAN MODE) OR title LIKE ? OR path LIKE ?
           ORDER BY score DESC LIMIT ?`,
          [ftQuery, ftQuery, likePattern, likePattern, LIMIT]
        )
      : await pool.query<DocRow[]>(
          `SELECT id, title, path, domain_id AS domainId, 1 AS score
           FROM panorama_knowledge_doc WHERE title LIKE ? OR path LIKE ? LIMIT ?`,
          [likePattern, likePattern, LIMIT]
        );
    for (const r of rows) {
      results.push({
        type: 'doc', id: Number(r.id),
        name: r.title ?? r.path,
        subtitle: r.path,
        score: Number(r.score),
        href: `/domain/${r.domainId}`
      });
    }
  }

  // Cron
  if (allowed.has('cron')) {
    const [rows] = useFulltext
      ? await pool.query<CronRow[]>(
          `SELECT id, name, description,
                  MATCH(name, description) AGAINST (? IN BOOLEAN MODE) AS score
           FROM panorama_cron_job
           WHERE MATCH(name, description) AGAINST (? IN BOOLEAN MODE) OR name LIKE ?
           ORDER BY score DESC LIMIT ?`,
          [ftQuery, ftQuery, likePattern, LIMIT]
        )
      : await pool.query<CronRow[]>(
          `SELECT id, name, description, 1 AS score
           FROM panorama_cron_job WHERE name LIKE ? LIMIT ?`,
          [likePattern, LIMIT]
        );
    for (const r of rows) {
      results.push({
        type: 'cron', id: Number(r.id),
        name: r.name,
        subtitle: r.description,
        score: Number(r.score),
        href: `/node/cron/${r.id}`
      });
    }
  }

  // Api
  if (allowed.has('api')) {
    const [rows] = useFulltext
      ? await pool.query<ApiRow[]>(
          `SELECT id, http_method AS httpMethod, path, description,
                  MATCH(path, description) AGAINST (? IN BOOLEAN MODE) AS score
           FROM panorama_api_endpoint
           WHERE MATCH(path, description) AGAINST (? IN BOOLEAN MODE) OR path LIKE ?
           ORDER BY score DESC LIMIT ?`,
          [ftQuery, ftQuery, likePattern, LIMIT]
        )
      : await pool.query<ApiRow[]>(
          `SELECT id, http_method AS httpMethod, path, description, 1 AS score
           FROM panorama_api_endpoint WHERE path LIKE ? LIMIT ?`,
          [likePattern, LIMIT]
        );
    for (const r of rows) {
      results.push({
        type: 'api', id: Number(r.id),
        name: `${r.httpMethod} ${r.path}`,
        subtitle: r.description,
        score: Number(r.score),
        href: `/node/api/${r.id}`
      });
    }
  }

  // Contract — supports both name FT and exact/partial address LIKE
  if (allowed.has('contract')) {
    const looksLikeAddress = /^0x[0-9a-fA-F]{1,40}/i.test(trimmed) || /^[0-9a-fA-F]{4,40}$/i.test(trimmed);
    const [rows] = looksLikeAddress
      ? await pool.query<ContractRow[]>(
          `SELECT id, name, address, chain, 2 AS score
           FROM panorama_contract WHERE address LIKE ? LIMIT ?`,
          [`%${trimmed.replace(/^0x/i, '')}%`, LIMIT]
        )
      : useFulltext
      ? await pool.query<ContractRow[]>(
          `SELECT id, name, address, chain,
                  MATCH(name, notes) AGAINST (? IN BOOLEAN MODE) AS score
           FROM panorama_contract
           WHERE MATCH(name, notes) AGAINST (? IN BOOLEAN MODE) OR name LIKE ?
           ORDER BY score DESC LIMIT ?`,
          [ftQuery, ftQuery, likePattern, LIMIT]
        )
      : await pool.query<ContractRow[]>(
          `SELECT id, name, address, chain, 1 AS score
           FROM panorama_contract WHERE name LIKE ? LIMIT ?`,
          [likePattern, LIMIT]
        );
    for (const r of rows) {
      results.push({
        type: 'contract', id: Number(r.id),
        name: r.name,
        subtitle: `${r.chain} ${r.address}`,
        score: Number(r.score),
        href: `/node/contract/${r.id}`
      });
    }
  }

  // Entity — table_name BTREE only (no FT)
  if (allowed.has('entity')) {
    const [rows] = await pool.query<EntityRow[]>(
      `SELECT id, table_name AS tableName
       FROM panorama_entity WHERE table_name LIKE ? LIMIT ?`,
      [likePattern, LIMIT]
    );
    for (const r of rows) {
      results.push({
        type: 'entity', id: Number(r.id),
        name: r.tableName,
        subtitle: null,
        score: 1,
        href: `/node/entity/${r.id}`
      });
    }
  }

  // Redis
  if (allowed.has('redis')) {
    const [rows] = useFulltext
      ? await pool.query<RedisRow[]>(
          `SELECT id, key_pattern AS keyPattern, source_file AS sourceFile,
                  MATCH(key_pattern, description) AGAINST (? IN BOOLEAN MODE) AS score
           FROM panorama_redis_key
           WHERE MATCH(key_pattern, description) AGAINST (? IN BOOLEAN MODE) OR key_pattern LIKE ?
           ORDER BY score DESC LIMIT ?`,
          [ftQuery, ftQuery, likePattern, LIMIT]
        )
      : await pool.query<RedisRow[]>(
          `SELECT id, key_pattern AS keyPattern, source_file AS sourceFile, 1 AS score
           FROM panorama_redis_key WHERE key_pattern LIKE ? LIMIT ?`,
          [likePattern, LIMIT]
        );
    for (const r of rows) {
      results.push({
        type: 'redis', id: Number(r.id),
        name: r.keyPattern,
        subtitle: r.sourceFile,
        score: Number(r.score),
        href: `/node/redis/${r.id}`
      });
    }
  }

  // Route — path/component FT
  if (allowed.has('route')) {
    const [rows] = useFulltext
      ? await pool.query<RouteRow[]>(
          `SELECT id, app_name AS appName, path, component
           FROM panorama_frontend_route
           WHERE MATCH(path, component) AGAINST (? IN BOOLEAN MODE) OR path LIKE ?
           LIMIT ?`,
          [ftQuery, likePattern, LIMIT]
        )
      : await pool.query<RouteRow[]>(
          `SELECT id, app_name AS appName, path, component
           FROM panorama_frontend_route WHERE path LIKE ? LIMIT ?`,
          [likePattern, LIMIT]
        );
    for (const r of rows) {
      results.push({
        type: 'route', id: Number(r.id),
        name: `${r.appName}: ${r.path}`,
        subtitle: r.component,
        score: 1,
        href: `/node/route/${r.id}`
      });
    }
  }

  // Sort merged by score desc, take top LIMIT
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, LIMIT);
}
