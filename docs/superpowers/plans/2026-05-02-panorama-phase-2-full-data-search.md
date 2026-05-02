# Panorama Phase 2 (Full Data + Flow Chart + Search) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Phase 1 from 2 ingestors (knowledge + cron) to all 7 (api / entity / contract / frontend / redis added), wire Strategy A authoritative linking across all pairs, add Cmd+K global search across 6 indexes, build the L3 node-detail drawer, and ship the React Flow business-flow chart on the domain detail page. End state: all 4 PRD §4.2 user stories addressable from the platform.

**Architecture:**
- Build on `phase-1/foundation` (or whatever branch holds Phase 1 work). Create worktree `panorama-phase-2/` on `phase-2/full-data-search`.
- 12 new tables: 5 entity tables (`api_endpoint`, `entity`, `contract`, `frontend_route`, `redis_key`) + 7 junction tables (`cron_contract_call`, `api_entity_op`, `route_api_call`, `cron_redis_op`, `api_redis_op`, `api_contract_call`, `api_cron_call`).
- 5 new ingestors mirror the knowledge/cron pattern from Phase 1: TDD pair (failing test → impl), real-world sanity check at the end.
- Orchestrator gains 4 new linking strategies: api→entity (TypeORM repo usage), api→cron (`callCronApi` proxy), api→contract (web3 call detection), route→api (api-class import grep).
- Loader extends `STAGING_TABLES` to 12 tables and writes 7 junction tables.
- Webapp gains: Cmd+K modal (FULLTEXT 6-table UNION), `/api/node/{type}/{id}` for L3 drawer, ReactFlow business chart (lazy-loaded on `/domain/[id]`), reverse-relations panel.

**Tech Stack additions over Phase 1:** `reactflow` v11 + `dagre` v0.8 (auto-layout), `@radix-ui/react-dialog` v1 (drawer), `@radix-ui/react-tabs`, `cmdk` v1 for the command palette.

**Out-of-scope for Phase 2** (deferred to Phase 3): Monaco code browser, source-code redaction layer, K8s production deploy, OIDC/SSO, content-drift broken-refs detector.

**Real-world patterns confirmed:**
- `lista-admin/src/modules/**/*.controller.ts` — `@Controller('path')` + method decorators `@Get('subpath')`, `@Post('...')`, `@Put('...')`, `@Delete('...')`
- `lista-admin/src/entity/**/*.entity.ts` — `@Entity('table_name')` class decorator, `@Column({...})` field decorators
- `lista-mono/apps/lista/src/router.tsx` — `createBrowserRouter([{ path, lazy: async () => import('@/modules/...') }, ...])`. Static JSX, lazy-resolved Component.
- `lista-mono/apps/lista/src/api/*.ts` — one file per business area, exports a class with methods named after API endpoints
- `lista-knowledge/onchain/{chain}.md` — markdown tables `| ContractName | \`0x...\` |` with section headers
- `lista-knowledge/onchain/abis/*.json` — Hardhat-style ABI export; basename matches contract name
- Redis ops: `redisClient.{get,set,setNx,incr,expire,del}(key, ...)` with key as first argument (string literal or template literal)

---

## File Structure (additions over Phase 1)

```
migrations/sql/
  006_api_endpoint_and_entity.sql           # api_endpoint, entity, api_entity_op
  007_contract_and_redis.sql                # contract, redis_key, cron_redis_op, api_redis_op, cron_contract_call, api_contract_call
  008_frontend_route_and_calls.sql          # frontend_route, route_api_call, api_cron_call

ingestion/src/
  ingestors/
    api.ts                                  # @Controller/@Get/... AST scan
    entity.ts                               # @Entity AST scan
    contract.ts                             # markdown table parser + ABI loader
    frontend.ts                             # router.tsx parser + api class scanner
    redis.ts                                # grep-based key extractor
  orchestrator.ts                           # extended with 4 new strategies (api↔entity, api↔cron via callCronApi, api↔contract, route↔api)
  loader.ts                                 # STAGING_TABLES extended; 7 new junction populate steps

ingestion/__tests__/
  fixtures/
    api/lista-admin/src/modules/.../foo.controller.ts
    entity/lista-admin/src/entity/.../foo.entity.ts
    contract/lista-knowledge/onchain/bsc-mainnet.md  +  abis/Foo.json
    frontend/lista-mono/apps/lista/src/{router.tsx,api/foo.ts}
    redis/lista-cron/src/.../bar.service.ts
  api.test.ts
  entity.test.ts
  contract.test.ts
  frontend.test.ts
  redis.test.ts

webapp/
  app/
    api/
      search/route.ts                       # GET /api/search?q=&types=
      node/[type]/[id]/route.ts             # GET /api/node/{type}/{id}
      domain/[id]/flow/route.ts             # GET /api/domain/{id}/flow (ReactFlow data)
  components/
    CommandPalette.tsx                      # Cmd+K (cmdk)
    DomainDetail/
      FlowChart.tsx                         # ReactFlow wrapper
      PanoramaNode.tsx                      # custom 6-type node
      PanoramaEdge.tsx                      # smoothstep + animation
      ImplementationTabs.tsx                # extended: enable api/contract/db/redis tabs
      ApiTab.tsx
      ContractTab.tsx
      EntityTab.tsx
      RedisTab.tsx
      FrontendTab.tsx
    NodeDrawer/
      DrawerContainer.tsx                   # vaul/radix dialog shell
      ContractDetail.tsx
      ApiDetail.tsx
      CronDetail.tsx                        # extended from Phase 1's cron-tab content
      EntityDetail.tsx
      RedisDetail.tsx
      RouteDetail.tsx
      RelationsPanel.tsx                    # used-by + calls
  lib/
    node.ts                                 # fetchNodeDetail(type, id) + per-type queries
    search.ts                               # 6-table UNION FULLTEXT helper
    flow.ts                                 # graph→ReactFlow data transformer + dagre layout
```

---

## Pre-flight (Task 34)

**Files:** none — environment + branching only.

- [ ] **Step 1: Branch + worktree from Phase 1 tip**

```bash
cd /Users/quansong/Documents/code/panorama
# Confirm phase-1/foundation tip
git fetch origin
git log --oneline origin/phase-1/foundation -1   # expect f351daf or later
git worktree add -b phase-2/full-data-search /Users/quansong/Documents/code/panorama-phase-2 origin/phase-1/foundation
ls /Users/quansong/Documents/code/panorama-phase-2  # should mirror phase-1 contents
```

- [ ] **Step 2: Copy `.env` symlinks**

```bash
cd /Users/quansong/Documents/code/panorama-phase-2
cp /Users/quansong/Documents/code/panorama-phase-1/.env .env
ln -s ../.env migrations/.env
ln -s ../.env ingestion/.env
ln -s ../.env webapp/.env.local
```

- [ ] **Step 3: Verify the inherited state still works**

```bash
pnpm install            # lockfile already in repo, should be a no-op
pnpm --filter @panorama/migrations status   # 6 applied, 0 pending
pnpm --filter @panorama/ingestion test      # 20 passes
pnpm --filter @panorama/webapp test         # 5 passes
```

If any of those fail, **stop** — the worktree state diverged from what Phase 1 committed. Investigate before proceeding.

- [ ] **Step 4: Commit env confirmation (no code)**

There's nothing to commit yet. Move on to Task 35.

---

## DDL Phase (Tasks 35–37)

Three migrations. Each follows the Phase 1 pattern: `CREATE TABLE IF NOT EXISTS`, utf8mb4 + collate utf8mb4_unicode_ci, FULLTEXT where Cmd+K queries. Apply via `pnpm --filter @panorama/migrations apply` after writing each file.

### Task 35 — DDL 006: api_endpoint + entity (+ api_entity_op)

**File:** `migrations/sql/006_api_endpoint_and_entity.sql`

```sql
CREATE TABLE IF NOT EXISTS panorama_api_endpoint (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  domain_id       BIGINT NULL,
  http_method     VARCHAR(10) NOT NULL,
  path            VARCHAR(500) NOT NULL,
  controller      VARCHAR(200) NULL,
  repo            VARCHAR(50) NOT NULL,
  file_path       VARCHAR(500) NOT NULL,
  line_no         INT NULL,
  auth_required   TINYINT(1) NOT NULL DEFAULT 0,
  description     TEXT NULL,
  confidence      DECIMAL(3,2) NOT NULL DEFAULT 1.00,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  db_modify_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_domain (domain_id),
  KEY idx_path (path),
  KEY idx_repo_file (repo, file_path),
  FULLTEXT KEY ft_search (path, description) WITH PARSER ngram
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS panorama_entity (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  domain_id       BIGINT NULL,
  table_name      VARCHAR(100) NOT NULL,
  repo            VARCHAR(50) NOT NULL,
  file_path       VARCHAR(500) NOT NULL,
  columns_json    JSON NULL,
  description     TEXT NULL,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  db_modify_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_repo_table (repo, table_name),
  KEY idx_domain (domain_id),
  KEY idx_repo_file (repo, file_path),
  FULLTEXT KEY ft_search (table_name) WITH PARSER ngram
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS panorama_api_entity_op (
  api_id          BIGINT NOT NULL,
  entity_id       BIGINT NOT NULL,
  op_type         ENUM('READ','WRITE','BOTH') NOT NULL,
  PRIMARY KEY (api_id, entity_id),
  KEY idx_entity (entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] Apply + verify (3 new tables) + commit `feat(panorama-migrations): 006 api_endpoint + entity`.

### Task 36 — DDL 007: contract + redis_key + 4 junctions

**File:** `migrations/sql/007_contract_and_redis.sql`

```sql
CREATE TABLE IF NOT EXISTS panorama_contract (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(200) NOT NULL,
  address         VARCHAR(42) NOT NULL,
  chain           VARCHAR(50) NOT NULL,
  abi_path        VARCHAR(500) NULL,
  deployed_at     DATE NULL,
  notes           TEXT NULL,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  db_modify_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_chain_addr (chain, address),
  KEY idx_name (name),
  FULLTEXT KEY ft_search (name, notes) WITH PARSER ngram
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS panorama_redis_key (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  domain_id       BIGINT NULL,
  key_pattern     VARCHAR(500) NOT NULL,
  redis_type      ENUM('string','hash','list','set','zset','stream','unknown') NOT NULL DEFAULT 'unknown',
  ttl_seconds     INT NULL,
  description     TEXT NULL,
  source_repo     VARCHAR(50) NOT NULL,
  source_file     VARCHAR(500) NOT NULL,
  source_line     INT NULL,
  confidence      DECIMAL(3,2) NOT NULL DEFAULT 0.70,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  db_modify_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_pattern (key_pattern, source_repo),
  KEY idx_domain (domain_id),
  FULLTEXT KEY ft_search (key_pattern, description) WITH PARSER ngram
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS panorama_cron_redis_op (
  cron_id         BIGINT NOT NULL,
  redis_id        BIGINT NOT NULL,
  op_type         ENUM('READ','WRITE','BOTH','EXPIRE','DELETE') NOT NULL,
  PRIMARY KEY (cron_id, redis_id, op_type),
  KEY idx_redis (redis_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS panorama_api_redis_op (
  api_id          BIGINT NOT NULL,
  redis_id        BIGINT NOT NULL,
  op_type         ENUM('READ','WRITE','BOTH') NOT NULL,
  PRIMARY KEY (api_id, redis_id, op_type),
  KEY idx_redis (redis_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS panorama_cron_contract_call (
  cron_id         BIGINT NOT NULL,
  contract_id     BIGINT NOT NULL,
  method_name     VARCHAR(200) NOT NULL DEFAULT '',
  PRIMARY KEY (cron_id, contract_id, method_name),
  KEY idx_contract (contract_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS panorama_api_contract_call (
  api_id          BIGINT NOT NULL,
  contract_id     BIGINT NOT NULL,
  method_name     VARCHAR(200) NOT NULL DEFAULT '',
  PRIMARY KEY (api_id, contract_id, method_name),
  KEY idx_contract (contract_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> Note: `method_name` is part of the PK so we use `NOT NULL DEFAULT ''` rather than `NULL`. MySQL doesn't allow NULL columns in a PRIMARY KEY.

- [ ] Apply + verify + commit `feat(panorama-migrations): 007 contract + redis + 4 call/op junctions`.

### Task 37 — DDL 008: frontend_route + route_api_call + api_cron_call

**File:** `migrations/sql/008_frontend_route_and_calls.sql`

```sql
CREATE TABLE IF NOT EXISTS panorama_frontend_route (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  domain_id       BIGINT NULL,
  app_name        VARCHAR(100) NOT NULL,
  path            VARCHAR(500) NOT NULL,
  component       VARCHAR(200) NULL,
  repo            VARCHAR(50) NOT NULL DEFAULT 'lista-mono',
  file_path       VARCHAR(500) NOT NULL,
  is_lazy         TINYINT(1) NOT NULL DEFAULT 0,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  db_modify_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_app_path (app_name, path),
  KEY idx_domain (domain_id),
  FULLTEXT KEY ft_search (path, component) WITH PARSER ngram
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS panorama_route_api_call (
  route_id        BIGINT NOT NULL,
  api_id          BIGINT NOT NULL,
  PRIMARY KEY (route_id, api_id),
  KEY idx_api (api_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS panorama_api_cron_call (
  api_id          BIGINT NOT NULL,
  cron_id         BIGINT NOT NULL,
  call_path       VARCHAR(500) NULL,
  PRIMARY KEY (api_id, cron_id),
  KEY idx_cron (cron_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] Apply + verify (final state: 19 `panorama_*` tables) + commit `feat(panorama-migrations): 008 frontend_route + route_api_call + api_cron_call (Phase 2 schema complete)`.

---

## Ingestor Phase (Tasks 38–42)

Each ingestor is a TDD pair: failing test commit + impl commit. The patterns below are condensed; rely on Phase 1's knowledge.ts / cron.ts as the canonical examples for project setup, ts-morph use, fixture layout, etc.

### Task 38 — `api` ingestor (TDD pair, 2 commits)

**Inputs:** `lista-admin/src/modules/**/*.controller.ts`
**Outputs:** `api_endpoint` nodes; `BELONGS_TO` heuristic edge to domain (path-prefix `src/modules/{domain}/`).

**Decorator semantics:**
- `@Controller('basePath')` — base path, may be empty
- Method decorators: `@Get('sub')`, `@Post('sub')`, `@Put('sub')`, `@Delete('sub')`, `@Patch('sub')`. Argument optional → defaults to `''`.
- Full HTTP path = base + `/` + sub, normalised. Drop trailing `/`.
- `description` from method JSDoc (same logic as cron ingestor).
- `auth_required` heuristic: 1 if class or method has `@UseGuards(...)` decorator, else 0. (The `Auth` guard name matters less than the presence of any guard.)

**Fixture (`__tests__/fixtures/api/lista-admin/src/modules/moolah/moolah.controller.ts`):**

```ts
// @ts-nocheck — fixture
import { Controller, Get, Post, UseGuards } from '@nestjs/common';

@Controller('moolah')
export class MoolahController {
  /** Search vaults */
  @Get('vault/search')
  async searchVaults() { /* impl */ }

  @UseGuards(AdminGuard)
  @Post('vault/create')
  async create() { /* impl */ }
}
```

**Test assertions:** node count, method+path concat, line_no captured, auth_required=1 only on the second method, BELONGS_TO edge to `moolah` domain.

**Sanity check:** `pnpm rebuild` against real lista-admin should yield ≥10 ApiEndpoint nodes (PRD says 10 controllers; each with multiple endpoints → ≥30).

- [ ] RED commit (fixtures + failing test): `test(panorama-ingestion): api ingestor failing tests + fixtures`
- [ ] GREEN commit (impl): `feat(panorama-ingestion): api ingestor (@Controller + method decorators via ts-morph)`

### Task 39 — `entity` ingestor (TDD pair, 2 commits)

**Inputs:** `lista-admin/src/entity/**/*.entity.ts` + `lista-cron/src/entity/**/*.entity.ts` + `lista-bot/src/entity/**/*.entity.ts`
**Outputs:** `entity` nodes only (junctions come later).

**Decorator semantics:**
- `@Entity('table_name')` — class decorator; argument may be a string literal, or omitted (use class name's snake_case as fallback).
- `@Column(...)` per field — capture name (override via `{name: 'foo'}` option) and type (TS type annotation; fall back to `'unknown'`).
- `@PrimaryGeneratedColumn()` / `@PrimaryColumn()` — record the primary key column.
- `domain_id` heuristic: from path `src/entity/{domain}/...`.

**Fixture:**

```ts
// __tests__/fixtures/entity/lista-admin/src/entity/moolah/moolahMarket.entity.ts
// @ts-nocheck — fixture
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('moolah_market')
export class MoolahMarket {
  @PrimaryGeneratedColumn() id!: number;
  @Column() address!: string;
  @Column({ name: 'market_id' }) marketId!: string;
}
```

**Test assertions:** entity node with `tableName='moolah_market'`, columns_json has 3 entries with correct names (id/address/market_id), domain_id heuristic edge to `moolah`.

**Sanity check:** real ingest should yield ≥18 entity nodes (PRD says 18 in lista-admin alone).

- [ ] RED commit: `test(panorama-ingestion): entity ingestor failing tests + fixtures`
- [ ] GREEN commit: `feat(panorama-ingestion): entity ingestor (@Entity + @Column via ts-morph)`

### Task 40 — `contract` ingestor (TDD pair, 2 commits)

**Inputs:** `lista-knowledge/onchain/{bsc-mainnet,bsc-testnet,eth-mainnet,eth-sepolia}.md` + `lista-knowledge/onchain/abis/*.json`
**Outputs:** `contract` nodes (one per (chain, address) tuple).

**Markdown table parser:** chain comes from filename. Walk the markdown for Markdown tables; for each row, the first cell is the contract name and the second cell is `\`0x...\`` backtick-wrapped address (or plain). Skip header rows and any row that isn't `| name | 0x... |` shape.

```ts
// chain inference
function chainFromFile(rel: string): string | null {
  const m = rel.match(/onchain\/([a-z0-9-]+)\.md$/);
  return m ? m[1]! : null;
}

// row pattern
const ROW_RE = /^\|\s*([^|]+?)\s*\|\s*`?(0x[a-fA-F0-9]{40})`?\s*\|/;
```

**ABI matching:** if `onchain/abis/{ContractName}.json` exists, set `abi_path` to that relative path. Otherwise NULL.

**Confidence:** 1.0 (markdown is authoritative).

**Fixture:** a 5-row mainnet.md + a single `Foo.json` ABI file.

**Test assertions:** ≥4 contracts emitted (rows with valid addresses), contract with name `Foo` has `abi_path = 'onchain/abis/Foo.json'`, contract whose name has no ABI file has `abi_path = null`, chain matches filename.

**Sanity check:** real ingest should yield ≥30 contracts across the 4 mainnet/testnet files.

- [ ] RED commit: `test(panorama-ingestion): contract ingestor failing tests + fixtures`
- [ ] GREEN commit: `feat(panorama-ingestion): contract ingestor (markdown tables + ABI matching)`

### Task 41 — `frontend` ingestor (TDD pair, 2 commits)

**Inputs:** `lista-mono/apps/{appName}/src/router.tsx` + `lista-mono/apps/{appName}/src/api/*.ts`
**Outputs:** `frontend_route` nodes from router.tsx; route→api edges (Phase 2 only does the easy intra-app pattern, defers complex SSR loaders).

**router.tsx parser** (ts-morph):
- Find call expressions to `createBrowserRouter([...])`. Walk the array literal recursively.
- For each object literal, extract `path: 'string-literal'` (or any string-typed property under that key) and the lazy import target (`lazy: async () => import('@/modules/foo/page')` → component module path).
- Recurse into `children: [...]` arrays. Concatenate parent + child paths.

```ts
// component module path → component name heuristic
function deriveComponentName(modulePath: string): string {
  // '@/modules/dashboard/page' → 'Dashboard'
  const seg = modulePath.split('/').filter(s => s !== 'page').pop() ?? '';
  return seg.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/\s/g, '');
}
```

- `is_lazy: 1` if discovered via the `lazy: async () => import(...)` arrow; `0` if discovered via inline `<Component />` jsx (rare in lista-mono).
- `domain_id` heuristic: extract from module path (`/modules/{domain}/page` → `{domain}`); accept failure (NULL if no match).

**api/*.ts ingest:** scan each `apps/{app}/src/api/*.ts` for class methods. Each method becomes a candidate "API call" — Phase 2 builds the route↔api edge ONLY when the route's component module imports from the same `api/` directory; the orchestrator handles this in Task 43.

**Fixture:** trimmed router.tsx with 3 routes (1 lazy, 1 nested) + a small `api/foo.ts` class.

**Test assertions:** 3 frontend_route nodes; nested route's path is parent+child; is_lazy correct; component name matches heuristic.

**Sanity check:** real ingest should yield ≥60 routes (PRD says 96+ but some are dynamic and we accept 60% coverage).

- [ ] RED commit: `test(panorama-ingestion): frontend ingestor failing tests + fixtures`
- [ ] GREEN commit: `feat(panorama-ingestion): frontend ingestor (router.tsx + api/*.ts via ts-morph)`

### Task 42 — `redis` ingestor (TDD pair, 2 commits)

**Inputs:** `lista-cron/src + lista-bot/src + lista-admin/src`
**Outputs:** `redis_key` nodes (string-literal keys at confidence 1.0; template-literal keys normalised to `{var}` at 0.8; concat at 0.5; otherwise skip).

**Detection (regex-only — ts-morph is overkill for grep semantics):** scan `*.ts` files (skip `node_modules`, `dist`, `__tests__`, `*.spec.ts`, `*.test.ts`). For each line, match:

```
\b(redisClient|redisService|RedisService|cache)\.(get|set|setNx|incr|expire|del|hget|hset|sadd|zadd|lpush|rpush)\s*\(
```

When matched, look at the first argument literal:
- `'literal-key'` or `"literal-key"` → confidence 1.0, key as-is
- `\`literal:${var}\`` → confidence 0.8, replace `${anything}` with `{anything}` (lowercase the var)
- `KEY_PREFIX + ':' + getDomain()` or other expressions → confidence 0.5, skip the key but emit a `unknown` node only if the file path includes `cache` / `redis` keywords (otherwise skip entirely)

**op_type derivation:**
- `get|hget|smembers|zrange|lrange` → READ
- `set|setNx|hset|sadd|zadd|lpush|rpush` → WRITE
- `expire` → EXPIRE
- `del|unlink` → DELETE

**Fixture:** a small file with one literal-key call, one template-literal call, and one expression call (skipped).

**Test assertions:** node count = 2 (literal + template), confidence 1.0 / 0.8, op_type correct, source_repo + source_file + source_line populated.

**Sanity check:** real ingest should yield ≥30 redis keys per PRD §4.1 estimate of "50-100".

- [ ] RED commit: `test(panorama-ingestion): redis ingestor failing tests + fixtures`
- [ ] GREEN commit: `feat(panorama-ingestion): redis ingestor (literal + template-literal regex)`

---

## Orchestrator Phase (Task 43)

### Task 43 — Orchestrator linking strategies (TDD pair, 2 commits)

Phase 2 adds 4 new linking strategies to the orchestrator. The structure of `runOrchestrator` from Phase 1 stays — we add new lookup tables and new edge-emission loops.

**New strategies (all heuristic, confidence per row):**

| Source → Target | Detection | Confidence |
|------------------|-----------|------------|
| `route` → `api` | router.tsx component module path matches `api/*.ts`; if so, emit edge for every method exported from that api class | 0.6 |
| `api` → `cron` | `callCronApi('/path')` literal in api file → match against cron `path`/`name` | 0.9 |
| `api` → `entity` | api file has `@InjectRepository(EntityName)` or `Repository<EntityName>` typing → emit BOTH op_type | 0.8 |
| `cron` → `contract` | cron file body contains contract name as identifier (constructor arg or method call) → emit edge with `method_name='*'` | 0.5 |
| `cron` → `redis` | redis ingestor source_file matches a cron's file_path → join | 0.9 |
| `api` → `redis` | redis ingestor source_file matches an api's file_path | 0.9 |

**Implementation note:** the orchestrator stays a pure function; it doesn't read the FS. To detect `callCronApi('/path')` and `Repository<EntityName>` it depends on the `api` ingestor extracting those into `meta` on the api node. So:

- Update `api` ingestor (Task 38) to also extract:
  - `callCronApiPaths: string[]` per controller — found via call expression `callCronApi('/path')`
  - `repositories: string[]` per controller — found via `@InjectRepository(EntityName)` or `Repository<EntityName>` type ref

These travel as `meta` on the api node, and the orchestrator reads them.

> **Action item:** revisit Task 38 to ensure these `meta` fields are emitted. If you've already finished Task 38 without them, either patch the api ingestor inline (preferred) or commit a follow-up before Task 43.

**Test assertions:** for each new strategy, fixture-driven test with a doc + cron + api + entity + contract + redis combo and verify the right edges appear at right confidence.

- [ ] RED commit: `test(panorama-ingestion): extended orchestrator strategies failing tests`
- [ ] GREEN commit: `feat(panorama-ingestion): orchestrator strategies (route↔api, api↔cron, api↔entity, cron↔contract, *↔redis)`

---

## Loader Phase (Task 44)

### Task 44 — Loader extension for new tables (TDD pair, 2 commits)

The loader gains 5 new entity tables and 7 new junction tables. Junction inserts happen after entity inserts so all FK-targeted IDs are resolved.

**Order in `populateStagingTables`:**

1. domains, docs, concepts, code_refs, crons (Phase 1 — keep as-is)
2. **NEW** apis (resolve domain via heuristic BELONGS_TO or Strategy A authoritative; record `apiIdByKey`)
3. **NEW** entities (resolve domain similarly; `entityIdByKey`)
4. **NEW** contracts (resolve domain via doc DESCRIBES + REFERENCES on contract docs; `contractIdByKey`)
5. **NEW** frontend_routes (`routeIdByKey`)
6. **NEW** redis_keys (`redisIdByKey`)
7. ref_link (Phase 1 generic edges — extend `polyId` to cover all 6 new types)
8. **NEW** junction tables: cron_contract_call, api_contract_call, api_entity_op, cron_redis_op, api_redis_op, route_api_call, api_cron_call

**STAGING_TABLES** array becomes 12 tables (plus 7 junctions also recreated via `LIKE` swap).

**Idempotency guard:** ensure `domain_id` resolution gracefully handles the "no DESCRIBES edge" case (NULL allowed for all entity tables).

**Test:** a new fixture-driven loader test that inserts a representative graph with all 6 entity types and asserts row counts after the swap.

- [ ] RED commit: `test(panorama-ingestion): extended loader failing tests (12 staging tables)`
- [ ] GREEN commit: `feat(panorama-ingestion): loader extends to 5 entity + 7 junction tables`

After this task, run `pnpm rebuild` end-to-end and verify all 19 panorama_* tables fill with credible counts.

---

## Webapp — Search (Tasks 45–46)

### Task 45 — `GET /api/search` (TDD, 2 commits)

**File:** `webapp/lib/search.ts`, `webapp/app/api/search/route.ts`, `webapp/__tests__/api-search.test.ts`

**Approach:** 6-table UNION FULLTEXT (one query per table, then merge in JS, sorted by score). MySQL `MATCH ... AGAINST` with ngram parser handles Chinese.

```ts
export interface SearchResult {
  type: 'domain' | 'doc' | 'cron' | 'api' | 'contract' | 'entity' | 'redis';
  id: number;
  name: string;
  subtitle: string | null;
  score: number;
  href: string;     // '/domain/{id}' for domain/doc, '/node/{type}/{id}' for nodes
}

export async function search(q: string, types?: string[]): Promise<SearchResult[]>
```

For each table:
- domain: MATCH(name) — but FULLTEXT needs ≥3-char tokens; for ≤2-char queries, fall back to LIKE
- doc: MATCH(title)
- cron: MATCH(name, description)
- api: MATCH(path, description)
- contract: MATCH(name, notes) — also exact-match the address (strip `0x` prefix; query may include or exclude prefix)
- entity: MATCH(table_name) (BTREE index, fall back to LIKE)
- redis: MATCH(key_pattern, description)

Merge results, sort by score desc, return top 25 (paged later).

**Test assertions:** searching `'emission'` returns at least one domain, doc, and cron result. Searching `'0x8F73'` returns the Moolah core contract.

- [ ] RED commit: `test(panorama-webapp): /api/search failing tests`
- [ ] GREEN commit: `feat(panorama-webapp): GET /api/search (6-table UNION FULLTEXT)`

### Task 46 — Cmd+K Command Palette (1 commit)

**File:** `webapp/components/CommandPalette.tsx`, integration in `webapp/app/layout.tsx`

Use `cmdk` library:

```bash
pnpm --filter @panorama/webapp add cmdk
```

The palette mounts globally (in layout.tsx). Keyboard shortcut: Cmd+K / Ctrl+K toggles open. Type-ahead → fetch `/api/search?q=...&types=...` debounced 200ms. Group results by type. Enter navigates.

Routing:
- `domain` → `/domain/{id}`
- `doc` → `/domain/{id}` (the doc's parent domain)
- `cron|api|contract|entity|redis` → `/node/{type}/{id}` (Task 48 builds the page)

**Test:** smoke via dev server — open palette via simulated Cmd+K (use Playwright if you want; otherwise just verify the modal renders and can dispatch search).

- [ ] Commit: `feat(panorama-webapp): Cmd+K command palette (cmdk + /api/search)`

---

## Webapp — Node Detail Drawer (Tasks 47–48)

### Task 47 — `GET /api/node/[type]/[id]` (TDD, 2 commits)

**File:** `webapp/lib/node.ts`, `webapp/app/api/node/[type]/[id]/route.ts`, `webapp/__tests__/api-node.test.ts`

```ts
export type NodeType = 'cron' | 'api' | 'contract' | 'entity' | 'redis' | 'route';

export interface NodeDetailBase {
  id: number;
  type: NodeType;
  name: string;
  domain: { id: number; name: string; displayName: string } | null;
  filePath: string | null;
  lineNo: number | null;
  description: string | null;
  // upstream/downstream relations
  usedBy: Array<{ type: NodeType | 'doc' | 'domain'; id: number; name: string }>;
  calls: Array<{ type: NodeType; id: number; name: string }>;
  // type-specific data
  extra: Record<string, unknown>;
}

export async function fetchNodeDetail(type: NodeType, id: number): Promise<NodeDetailBase | null>
```

Per-type `extra`:
- `cron`: schedule, jobId, handlerClass, confidence
- `api`: httpMethod, path, controller, authRequired
- `contract`: address, chain, abiPath, deployedAt
- `entity`: tableName, columns
- `redis`: keyPattern, redisType, ttlSeconds, sourceRepo
- `route`: appName, path, component, isLazy

**`usedBy` and `calls` queries:** UNION across the 7 junction tables filtered by the node id. Phase 1's `panorama_ref_link` covers domain→{doc,concept,code_ref} relations.

**Test:** for a cron node, expect `usedBy` to include at least the doc that REFERENCES it (Strategy A path) and `calls` to include any contract junctions seeded by Task 43.

- [ ] RED commit: `test(panorama-webapp): /api/node failing tests`
- [ ] GREEN commit: `feat(panorama-webapp): GET /api/node/{type}/{id} (detail + usedBy + calls)`

### Task 48 — Drawer + per-type details (1 commit)

**Files:**
- `webapp/components/NodeDrawer/DrawerContainer.tsx` (radix dialog wrapper)
- `webapp/components/NodeDrawer/{Cron,Api,Contract,Entity,Redis,Route}Detail.tsx`
- `webapp/components/NodeDrawer/RelationsPanel.tsx`
- `webapp/app/node/[type]/[id]/page.tsx` (server component that opens the drawer + renders fallback content)

```bash
pnpm --filter @panorama/webapp add @radix-ui/react-dialog
```

The drawer slides in from the right (420-460px wide). Backdrop dims the main content. Esc / ✕ / backdrop click closes. URL is `/node/{type}/{id}` so links can be shared.

Per-type detail components render the `extra` fields plus the upstream/downstream relations. The Contract detail shows two BscScan buttons (mainnet + testnet) when both addresses exist.

- [ ] Commit: `feat(panorama-webapp): node detail drawer (6 types + relations panel)`

---

## Webapp — Implementation Tabs Extended (Task 49)

### Task 49 — Enable api/contract/entity/redis tabs (1 commit)

**Files:**
- `webapp/lib/domain.ts` — extend `fetchDomainDetail` to populate `apis`, `entities`, `contracts`, `routes`, `redisKeys`. Stats for all 4 cards.
- `webapp/components/DomainDetail/{Api,Contract,Entity,Redis,Frontend}Tab.tsx` — table layouts mirroring Phase 1's CronTab.
- `webapp/components/DomainDetail/ImplementationTabs.tsx` — flip all 6 tabs to enabled.

**Stats card mapping:** Cron Jobs / API Endpoints / Contracts / Storage Keys (entity + redis combined for the "Storage" stat per PRD §6.2).

- [ ] Commit: `feat(panorama-webapp): enable all 6 implementation tabs (api/contract/entity/redis/frontend)`

---

## Webapp — React Flow Business Chart (Tasks 50–52)

### Task 50 — `GET /api/domain/[id]/flow` (TDD, 2 commits)

**File:** `webapp/lib/flow.ts`, `webapp/app/api/domain/[id]/flow/route.ts`, `webapp/__tests__/api-flow.test.ts`

Returns:

```ts
interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
  // dagre-precomputed positions (server side)
}

interface FlowNode {
  id: string;             // '{type}:{id}' e.g. 'cron:7'
  type: 'panoramaNode';
  data: {
    kind: 'ui' | 'api' | 'cron' | 'contract' | 'db' | 'redis';
    name: string;
    subtitle: string | null;
    confidence: number;
    selected?: boolean;
  };
  position: { x: number; y: number };
}

interface FlowEdge {
  id: string;
  source: string;
  target: string;
  type: 'smoothstep';
  data: { method?: string; confidence: number };
  // animated when confidence < 1 (heuristic)
  animated?: boolean;
}
```

Build the graph from the same junction tables as Task 47, but scoped to a single domain. Limit to confidence ≥ 0.6 by default (per R10 risk mitigation).

**Layout:** dagre with `rankdir: 'TB'` (top-bottom), 6 lanes by `kind`. Lane order: `ui → api → cron → contract → db → redis`.

```bash
pnpm --filter @panorama/webapp add reactflow dagre @types/dagre
```

**Test assertions:** for a domain with at least one cron→contract relation, the flow graph contains both nodes + the edge with the right confidence and method label (if any).

- [ ] RED commit: `test(panorama-webapp): /api/domain/{id}/flow failing tests`
- [ ] GREEN commit: `feat(panorama-webapp): GET /api/domain/{id}/flow (dagre layout)`

### Task 51 — `FlowChart` + `PanoramaNode`/`PanoramaEdge` (1 commit)

**Files:**
- `webapp/components/DomainDetail/FlowChart.tsx` — ReactFlow shell, loads from `/api/domain/{id}/flow`
- `webapp/components/DomainDetail/PanoramaNode.tsx` — custom node with type color band, name, optional subtitle, action chips (BscScan for contracts, ABI viewer)
- `webapp/components/DomainDetail/PanoramaEdge.tsx` — smoothstep with conditional animation
- Mount in `webapp/app/domain/[id]/page.tsx` (lazy-load via `dynamic(() => import(...), { ssr: false })`)

ReactFlow needs CSS: `import 'reactflow/dist/style.css'` in the FlowChart component.

Selection: clicking a node opens the drawer (Task 48) with the corresponding `/node/{type}/{id}` URL.

- [ ] Commit: `feat(panorama-webapp): React Flow business chart (6-lane dagre layout)`

### Task 52 — Reverse relations panel (1 commit)

**File:** `webapp/components/NodeDrawer/RelationsPanel.tsx`

Already partially built in Task 48 (it lives inside the drawer). This task **fills out** the queries:

- `usedBy` for a contract: list of crons + apis + frontend_routes that call it (from `panorama_cron_contract_call` + `panorama_api_contract_call` + reverse-resolve frontend routes via api)
- `usedBy` for an entity: list of apis that read/write it (from `panorama_api_entity_op`)
- `usedBy` for a redis_key: list of crons + apis (from cron_redis_op + api_redis_op)
- `usedBy` for a cron: list of docs that REFERENCE it (Phase 1) + apis that proxy to it via `callCronApi` (from api_cron_call)

These queries replace the placeholder `usedBy: []` in the Task 47 helper.

- [ ] Commit: `feat(panorama-webapp): reverse relations across all node types`

---

## Acceptance & Cleanup (Tasks 53–54)

### Task 53 — Phase 2 acceptance verification (1 commit)

End-to-end check (similar to Task 33 but covering Phase 2 user stories):

```
[ ] pnpm rebuild end-to-end against real repos completes successfully
[ ] All 19 panorama_* data tables non-empty (counts in expected ranges)
[ ] /api/search?q=emission returns ≥3 result types (domain + doc + cron)
[ ] /api/search?q=0x8F73 returns the Moolah core contract
[ ] Cmd+K opens palette, typing surfaces grouped results, Enter navigates
[ ] /domain/{moolah-id} renders ReactFlow chart with ≥6 nodes spanning ≥3 lanes
[ ] Clicking a contract node in the chart opens the drawer with BscScan link + ABI summary
[ ] Drawer "Used by" lists ≥1 caller for the contract
[ ] All 4 PRD §4.2 user stories addressable from the platform — write a 1-paragraph walkthrough for each in the commit body
[ ] Test count: at least 35 tests pass across all packages (Phase 1 had 28; Phase 2 adds at least 7)
```

Update `.meta.json` to mark phase-2 complete; tag `panorama-phase-2-complete`; push.

- [ ] Commit + tag: `chore(panorama): Phase 2 acceptance complete; advance .meta.json`

### Task 54 — Phase 1 follow-up cleanup (1 commit, optional)

Roll up the two Phase 1 follow-ups discovered during acceptance:
1. `pnpm -r test` shared-DB race — pick a fix (sequential script `pnpm test:sequential` that runs each package's `test` script in series, OR per-suite table prefix). Recommend the script approach for now.
2. `panorama_broken_ref` integ-* orphan rows — add `afterAll` to `pipeline.integration.test.ts` that deletes rows where `build_id LIKE 'integ-%'`.

- [ ] Commit: `chore(panorama): Phase 1 follow-up — sequential test script + integ-* cleanup`

---

## Self-review checklist (controller — run after writing this plan)

1. **Spec coverage:** every Phase 2 deliverable from PRD §10 + tech-design §12 is covered.
   - api/contract/entity/frontend/redis ingestor → Tasks 38-42 ✓
   - React Flow business chart → Tasks 50-51 ✓
   - Cmd+K search → Tasks 45-46 ✓
   - L3 抽屉 node detail → Tasks 47-48 ✓
   - 反向关联 → Task 52 ✓

2. **Placeholder scan:** none — every task has explicit code patterns or fixture descriptions.

3. **Type consistency:** `IngestorOutput` shape from Phase 1 is unchanged; new node types (`api`, `entity`, `contract`, `route`, `redis`) are added to the `NodeKind` union via Task 38's first commit. The orchestrator's `polyId` lookup extends to all 6 entity types in Task 44. Junction tables follow naming `{source}_{target}_{op}` consistently.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-02-panorama-phase-2-full-data-search.md`.

Two execution paths:

**1. Subagent-Driven (recommended)** — Same flow as Phase 1: dispatch implementer per task, batch tasks of similar kind, simplified review for mechanical tasks, full review for logic-heavy ones.

**2. Inline Execution** — Execute tasks in this session directly. Faster but less audit trail.

If continuing autonomously per Phase 1, the first dispatch should be Task 34 (worktree + env setup), then Tasks 35-37 (DDL batch), then Task 38 (api ingestor TDD pair) onwards.
