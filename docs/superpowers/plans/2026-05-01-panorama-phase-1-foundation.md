# Panorama Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up Panorama's foundation — MySQL schema, knowledge + cron ingestors with file:line cross-source linking, business tree navigation, and L2 domain detail page. End state: a Next.js webapp on internal staging where a QA can navigate the 9 business domains, drill into Moolah → Emission, and see the full markdown doc rendered with cron list + Mermaid figures.

**Architecture:**
- Greenfield repo (`panorama/`) with three top-level packages: `webapp/` (Next.js 14 App Router + SSR), `ingestion/` (Node.js + ts-morph orchestrator + 2 ingestors for Phase 1), `migrations/` (forward-only `.sql` files + tiny TypeScript runner).
- Source repos (`lista-knowledge`, `lista-cron`, `lista-bot`) are read-only via filesystem path (`REPOS_PATH=~/Documents/code` in dev; PVC in prod).
- MySQL `lista-qa` instance (existing) holds all Panorama tables under `panorama_*` prefix; ingestion writes via staging-table + `RENAME TABLE` swap (atomic, retryable).
- One ingestion command rebuilds everything: `pnpm rebuild` → 7-step pipeline → MySQL. Phase 1 wires only `knowledge` + `cron` ingestors; Phase 2/3 add the rest.

**Tech Stack:** Node 20 + pnpm 9, TypeScript 5 strict, Next.js 14 (App Router), Tailwind + shadcn/ui, react-arborist (virtualised tree), mysql2/promise, ts-morph (AST), gray-matter (frontmatter), mermaid v10 (lazy), vitest (unit + integration), Playwright (deferred to Phase 2).

**Out-of-scope for Phase 1** (deferred to Phase 2/3): React Flow business-flow chart, Cmd+K search, L3 node-detail drawer, Monaco code browser, the 5 other ingestors (api/entity/contract/frontend/redis), reverse-relations panel, K8s production deploy, OIDC/SSO.

---

## File Structure

```
panorama/
├── package.json                              # pnpm workspaces root
├── pnpm-workspace.yaml
├── tsconfig.base.json                        # shared compiler options
├── .gitignore
├── .env.example                              # MYSQL_*, REPOS_PATH, BASIC_AUTH_*
├── docker-compose.yml                        # webapp + ingestion(profile=build)
├── README.md                                 # dev quickstart
│
├── migrations/
│   ├── package.json                          # mysql2, dotenv, tsx
│   ├── tsconfig.json
│   ├── src/
│   │   ├── runner.ts                         # forward-only migration runner
│   │   └── connection.ts                     # mysql2 pool factory
│   ├── sql/
│   │   ├── 001_business_domain_and_doc.sql
│   │   ├── 002_concept_and_doc_concept_rel.sql
│   │   ├── 003_code_ref_and_ref_link.sql
│   │   ├── 004_cron_job.sql
│   │   ├── 005_build_meta_and_broken_ref.sql
│   │   └── 999_migration_history.sql         # tracks applied filenames
│   └── __tests__/
│       └── runner.test.ts                    # apply twice = idempotent
│
├── ingestion/
│   ├── package.json                          # ts-morph, gray-matter, mysql2, vitest
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── src/
│   │   ├── types.ts                          # IngestorOutput, NodeData, EdgeData
│   │   ├── db.ts                             # mysql2 pool (shared)
│   │   ├── env.ts                            # process.env validation (zod-light or manual)
│   │   ├── log.ts                            # tiny logger (console + JSON)
│   │   ├── ingestors/
│   │   │   ├── knowledge.ts                  # frontmatter + body + CodeRefs
│   │   │   ├── knowledge-coderef.ts          # extract `repo/path:line` patterns
│   │   │   └── cron.ts                       # @XxlJobHandler / @Cron AST
│   │   ├── orchestrator.ts                   # merge + Strategy A linking + broken_refs
│   │   ├── broken-refs.ts                    # file existence + ±3-line fingerprint
│   │   ├── loader.ts                         # staging _new + RENAME swap
│   │   ├── lock.ts                           # GET_LOCK / RELEASE_LOCK
│   │   └── cli.ts                            # entry: `pnpm rebuild`
│   └── __tests__/
│       ├── fixtures/
│       │   ├── knowledge/
│       │   │   ├── moolah/emission.md        # trimmed real-content fixture
│       │   │   └── _template.md              # must be skipped
│       │   └── cron/
│       │       └── stake/foo.service.ts      # @XxlJobHandler fixture
│       ├── knowledge.test.ts
│       ├── cron.test.ts
│       ├── orchestrator.test.ts
│       ├── broken-refs.test.ts
│       ├── loader.test.ts
│       └── pipeline.integration.test.ts
│
└── webapp/
    ├── package.json                          # next, mysql2, react-arborist, mermaid, tailwind
    ├── tsconfig.json
    ├── next.config.js
    ├── tailwind.config.ts                    # Lista palette tokens (§7.1 of tech-design)
    ├── postcss.config.js
    ├── middleware.ts                         # basic-auth gate
    ├── app/
    │   ├── layout.tsx                        # left-tree + right-content shell
    │   ├── globals.css                       # CSS vars + Tailwind base
    │   ├── page.tsx                          # / default landing
    │   ├── domain/[id]/page.tsx              # SSR domain detail
    │   └── api/
    │       ├── tree/route.ts                 # GET /api/tree?parent_id=
    │       ├── domain/[id]/route.ts          # GET /api/domain/{id}
    │       ├── build/latest/route.ts         # GET /api/build/latest
    │       └── health/route.ts               # GET /api/health (mysql ping)
    ├── components/
    │   ├── BusinessTree.tsx                  # react-arborist wrapper
    │   ├── DomainDetail/
    │   │   ├── HeroBlock.tsx
    │   │   ├── StatsRow.tsx
    │   │   ├── ImplementationTabs.tsx        # Phase 1: only Cron tab populated
    │   │   ├── CronTab.tsx
    │   │   └── KnowledgeMermaid.tsx          # client-only, lazy mermaid
    │   ├── SyncIndicator.tsx                 # header pill: last build time
    │   └── ui/                               # shadcn/ui generated components
    ├── lib/
    │   ├── db.ts                             # mysql2 pool (server-only)
    │   ├── domain.ts                         # SQL queries: tree, domain detail
    │   └── markdown.ts                       # render md → html (server-side)
    └── __tests__/
        ├── api-tree.test.ts                  # vitest + mysql2 against test DB
        └── api-domain.test.ts
```

---

## Pre-flight (Task 0)

Resolve before Task 1. The user has confirmed `bijieprd` should have DDL on `lista-qa`, but Task 0 verifies it before any migrations land.

**Files:**
- Modify: `~/.lista/config.json` (or shell env) — add `MYSQL_PASSWORD` for `bijieprd`

- [ ] **Step 1: Smoke MySQL connection from local**

```bash
mysql -h tf-saasbiz-qa-common-db.cluster-ctq8ac28izd2.ap-southeast-1.rds.amazonaws.com \
      -P 3306 -u bijieprd -p lista-qa \
      -e "SELECT CURRENT_USER(), DATABASE(), VERSION();"
```

Expected: a single row showing `bijieprd@%`, `lista-qa`, MySQL `8.x.x`. If the connection times out, the user is off VPN — reconnect and retry.

- [ ] **Step 2: Verify DDL permission with a throwaway table**

```bash
mysql -h <host> -u bijieprd -p lista-qa <<'SQL'
CREATE TABLE _panorama_perm_check (id INT) ENGINE=InnoDB;
DROP TABLE _panorama_perm_check;
SELECT 'DDL OK' AS result;
SQL
```

Expected: `DDL OK`. If you get `ERROR 1142 (42000): CREATE command denied`, **stop** and ask the DBA to grant `ALL PRIVILEGES ON \`lista-qa\`.\`panorama_*\` TO 'bijieprd'@'%';` (or escalate per the open question O1 in PRD §9.2).

- [ ] **Step 3: Record outcome in `.meta.json`**

Update `panorama/.meta.json` `open_questions` — strike through O1 with the verification timestamp:

```json
"open_questions": [
  "[RESOLVED 2026-05-XX] DB 账号 bijieprd 是否有 lista-qa 库 DDL 权限？ — 已验证，CREATE/DROP TABLE OK",
  "5 个上游仓库 git checkout 同步方案选哪个 (git-sync sidecar / CI 镜像 / 卷挂载)？",
  ...
]
```

- [ ] **Step 4: Commit pre-flight result**

```bash
git add panorama/.meta.json
git commit -m "chore(panorama): resolve DDL permission pre-flight (O1)"
```

---

### Task 1: Repo scaffold (pnpm workspaces + tooling)

**Files:**
- Create: `panorama/package.json`
- Create: `panorama/pnpm-workspace.yaml`
- Create: `panorama/tsconfig.base.json`
- Create: `panorama/.gitignore`
- Create: `panorama/.env.example`
- Create: `panorama/.editorconfig`

- [ ] **Step 1: Initialise root workspace**

```bash
cd /Users/quansong/Documents/code/panorama
mkdir -p webapp ingestion migrations
```

Write `panorama/package.json`:

```json
{
  "name": "panorama",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@9.10.0",
  "engines": { "node": ">=20.10.0" },
  "scripts": {
    "migrate": "pnpm --filter migrations run apply",
    "rebuild": "pnpm --filter ingestion run rebuild",
    "dev": "pnpm --filter webapp run dev",
    "build": "pnpm -r run build",
    "test": "pnpm -r run test",
    "lint": "pnpm -r run lint"
  }
}
```

Write `panorama/pnpm-workspace.yaml`:

```yaml
packages:
  - 'webapp'
  - 'ingestion'
  - 'migrations'
```

Write `panorama/tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": false,
    "sourceMap": true
  }
}
```

Write `panorama/.gitignore`:

```
node_modules/
.next/
out/
dist/
.env
.env.local
*.log
.DS_Store
.turbo/
coverage/
```

Write `panorama/.env.example`:

```
# MySQL — required
MYSQL_HOST=tf-saasbiz-qa-common-db.cluster-ctq8ac28izd2.ap-southeast-1.rds.amazonaws.com
MYSQL_PORT=3306
MYSQL_USER=bijieprd
MYSQL_PASSWORD=
MYSQL_DATABASE=lista-qa

# Source repos root (must contain lista-knowledge, lista-cron, lista-bot, ...)
REPOS_PATH=/Users/quansong/Documents/code

# Webapp basic auth (Phase 1 staging; replaced by OIDC in Phase 3)
BASIC_AUTH_USER=panorama
BASIC_AUTH_PASS=
```

Write `panorama/.editorconfig`:

```
root = true
[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true
```

- [ ] **Step 2: Verify workspace boots**

```bash
cd /Users/quansong/Documents/code/panorama
pnpm install
pnpm -r exec node -e "console.log(process.cwd())"
```

Expected: `pnpm install` reports "+ 0 dependencies" (no children yet) and exits 0. The exec command prints the workspace root once.

- [ ] **Step 3: Commit**

```bash
git add panorama/package.json panorama/pnpm-workspace.yaml panorama/tsconfig.base.json \
        panorama/.gitignore panorama/.env.example panorama/.editorconfig
git commit -m "chore(panorama): scaffold pnpm workspace"
```

---

### Task 2: Migrations runner (TypeScript) — failing test first

**Files:**
- Create: `panorama/migrations/package.json`
- Create: `panorama/migrations/tsconfig.json`
- Create: `panorama/migrations/vitest.config.ts`
- Create: `panorama/migrations/src/connection.ts`
- Create: `panorama/migrations/src/runner.ts`
- Create: `panorama/migrations/sql/999_migration_history.sql`
- Create: `panorama/migrations/__tests__/runner.test.ts`

- [ ] **Step 1: Initialise package**

```bash
cd /Users/quansong/Documents/code/panorama/migrations
```

Write `migrations/package.json`:

```json
{
  "name": "@panorama/migrations",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "apply": "tsx src/runner.ts apply",
    "status": "tsx src/runner.ts status",
    "test": "vitest run"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "mysql2": "^3.11.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.0"
  }
}
```

Write `migrations/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*", "__tests__/**/*"]
}
```

Write `migrations/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { globals: false, include: ['__tests__/**/*.test.ts'], testTimeout: 30_000 }
});
```

```bash
cd /Users/quansong/Documents/code/panorama && pnpm install
```

Expected: pnpm fetches mysql2, dotenv, tsx, vitest. Exit 0.

- [ ] **Step 2: Write the failing test**

Write `migrations/__tests__/runner.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConnection } from '../src/connection.js';
import { applyMigrations, listApplied, listPending } from '../src/runner.js';

const TEST_DB = process.env.MYSQL_DATABASE ?? 'lista-qa';

async function reset(conn: Awaited<ReturnType<typeof createConnection>>) {
  // Clean up any table created by 001-005 plus the history table.
  const cleanup = [
    'panorama_broken_ref', 'panorama_build_meta',
    'panorama_cron_job',
    'panorama_ref_link', 'panorama_code_ref',
    'panorama_doc_concept_rel', 'panorama_concept',
    'panorama_knowledge_doc', 'panorama_business_domain',
    'panorama_migration_history'
  ];
  for (const t of cleanup) await conn.query(`DROP TABLE IF EXISTS \`${t}\``);
}

describe('migrations runner', () => {
  let conn: Awaited<ReturnType<typeof createConnection>>;

  beforeEach(async () => { conn = await createConnection(); await reset(conn); });
  afterEach(async () => { await reset(conn); await conn.end(); });

  it('applies 999_migration_history.sql first and tracks subsequent files', async () => {
    const result = await applyMigrations({ conn, sqlDir: 'sql' });
    expect(result.applied).toContain('999_migration_history.sql');

    const applied = await listApplied(conn);
    expect(applied).toEqual(expect.arrayContaining(['999_migration_history.sql']));
  });

  it('is idempotent — second apply is a no-op', async () => {
    await applyMigrations({ conn, sqlDir: 'sql' });
    const second = await applyMigrations({ conn, sqlDir: 'sql' });
    expect(second.applied).toEqual([]);
  });

  it('lists pending files when nothing is applied yet', async () => {
    const pending = await listPending({ conn, sqlDir: 'sql' });
    expect(pending).toContain('999_migration_history.sql');
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

```bash
cd /Users/quansong/Documents/code/panorama/migrations
cp ../.env.example .env && echo "MYSQL_PASSWORD=<paste>" >> .env
pnpm test
```

Expected: FAIL with `Cannot find module '../src/connection.js'` (and similarly for runner). This is the red of red-green-refactor.

- [ ] **Step 4: Implement connection + runner**

Write `migrations/src/connection.ts`:

```ts
import 'dotenv/config';
import mysql from 'mysql2/promise';

export async function createConnection() {
  const required = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'] as const;
  for (const k of required) {
    if (!process.env[k]) throw new Error(`Missing env ${k}`);
  }
  return mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    multipleStatements: true,
    timezone: 'Z'
  });
}
```

Write `migrations/sql/999_migration_history.sql`:

```sql
CREATE TABLE IF NOT EXISTS panorama_migration_history (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  filename        VARCHAR(200) NOT NULL UNIQUE,
  applied_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  checksum_sha1   CHAR(40) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Write `migrations/src/runner.ts`:

```ts
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Connection } from 'mysql2/promise';
import { createConnection } from './connection.js';

interface ApplyOpts { conn: Connection; sqlDir: string; }

export async function listApplied(conn: Connection): Promise<string[]> {
  try {
    const [rows] = await conn.query<any[]>(
      'SELECT filename FROM panorama_migration_history ORDER BY filename'
    );
    return rows.map((r: any) => r.filename);
  } catch (err: any) {
    if (err?.code === 'ER_NO_SUCH_TABLE') return [];
    throw err;
  }
}

export async function listPending({ conn, sqlDir }: ApplyOpts): Promise<string[]> {
  const all = (await readdir(sqlDir)).filter(f => f.endsWith('.sql')).sort();
  const applied = new Set(await listApplied(conn));
  return all.filter(f => !applied.has(f));
}

export async function applyMigrations(opts: ApplyOpts): Promise<{ applied: string[] }> {
  const pending = await listPending(opts);
  const applied: string[] = [];
  for (const filename of pending) {
    const path = join(opts.sqlDir, filename);
    const sql = await readFile(path, 'utf8');
    const checksum = createHash('sha1').update(sql).digest('hex');
    await opts.conn.query(sql);
    // history table only exists *after* 999_*.sql ran the first time, so skip recording it on first pass.
    const historyExists = await tableExists(opts.conn, 'panorama_migration_history');
    if (historyExists) {
      await opts.conn.query(
        'INSERT INTO panorama_migration_history (filename, checksum_sha1) VALUES (?, ?) ' +
        'ON DUPLICATE KEY UPDATE checksum_sha1 = VALUES(checksum_sha1)',
        [filename, checksum]
      );
    }
    applied.push(filename);
  }
  return { applied };
}

async function tableExists(conn: Connection, name: string): Promise<boolean> {
  const [rows] = await conn.query<any[]>(
    'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
    [name]
  );
  return rows.length > 0;
}

if (process.argv[2] === 'apply') {
  const conn = await createConnection();
  const out = await applyMigrations({ conn, sqlDir: 'sql' });
  console.log('Applied:', out.applied.length ? out.applied.join(', ') : '(none — already up to date)');
  await conn.end();
} else if (process.argv[2] === 'status') {
  const conn = await createConnection();
  const applied = await listApplied(conn);
  const pending = await listPending({ conn, sqlDir: 'sql' });
  console.log(`Applied (${applied.length}):`, applied);
  console.log(`Pending (${pending.length}):`, pending);
  await conn.end();
}
```

- [ ] **Step 5: Run the test — should pass**

```bash
cd /Users/quansong/Documents/code/panorama/migrations
pnpm test
```

Expected: 3 tests pass. The runner connects, applies `999_migration_history.sql`, records it, second apply is a no-op.

- [ ] **Step 6: Commit**

```bash
git add panorama/migrations
git commit -m "feat(panorama-migrations): forward-only sql runner with checksum tracking"
```

---

### Task 3: DDL — business_domain + knowledge_doc

**Files:**
- Create: `panorama/migrations/sql/001_business_domain_and_doc.sql`

- [ ] **Step 1: Write the migration**

Write `migrations/sql/001_business_domain_and_doc.sql`:

```sql
-- panorama_business_domain: adjacency-list tree, root + 9 L1 + L2 sub-domains
CREATE TABLE panorama_business_domain (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(100) NOT NULL,
  display_name    VARCHAR(200) NOT NULL,
  parent_id       BIGINT NULL,
  description     TEXT NULL,
  file_type       VARCHAR(50) NULL,
  knowledge_path  VARCHAR(500) NULL,
  sort_order      INT NOT NULL DEFAULT 0,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  db_modify_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_parent (parent_id),
  KEY idx_name (name),
  CONSTRAINT fk_domain_parent FOREIGN KEY (parent_id)
    REFERENCES panorama_business_domain(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- panorama_knowledge_doc: per-md-file metadata; body kept on filesystem and read at request time
CREATE TABLE panorama_knowledge_doc (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  domain_id         BIGINT NOT NULL,
  path              VARCHAR(500) NOT NULL UNIQUE,
  title             VARCHAR(300) NULL,
  last_verified     DATE NULL,
  frontmatter_json  JSON NULL,
  body_md_path      VARCHAR(500) NULL,
  word_count        INT NOT NULL DEFAULT 0,
  db_create_time    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  db_modify_time    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_domain (domain_id),
  FULLTEXT KEY ft_title (title)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 2: Apply and verify**

```bash
cd /Users/quansong/Documents/code/panorama/migrations
pnpm apply
pnpm status
```

Expected:
- `pnpm apply` prints `Applied: 999_migration_history.sql, 001_business_domain_and_doc.sql` (or just `001` if 999 was already applied by Task 2).
- `pnpm status` shows both files in the Applied list, Pending empty.

Spot-check via mysql:

```bash
mysql -h <host> -u bijieprd -p lista-qa -e \
  "SHOW CREATE TABLE panorama_business_domain\G" | head -20
```

Expected: includes `fk_domain_parent` foreign key clause and `idx_parent`/`idx_name` indexes.

- [ ] **Step 3: Commit**

```bash
git add panorama/migrations/sql/001_business_domain_and_doc.sql
git commit -m "feat(panorama-migrations): 001 business_domain + knowledge_doc"
```

---

### Task 4: DDL — concept + doc_concept_rel

**Files:**
- Create: `panorama/migrations/sql/002_concept_and_doc_concept_rel.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE panorama_concept (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(100) NOT NULL UNIQUE,
  aliases_json    JSON NULL,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE panorama_doc_concept_rel (
  doc_id          BIGINT NOT NULL,
  concept_id      BIGINT NOT NULL,
  PRIMARY KEY (doc_id, concept_id),
  KEY idx_concept (concept_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 2: Apply and verify**

```bash
cd /Users/quansong/Documents/code/panorama/migrations && pnpm apply
mysql -h <host> -u bijieprd -p lista-qa -e \
  "SELECT table_name FROM information_schema.tables WHERE table_schema='lista-qa' AND table_name LIKE 'panorama_%';"
```

Expected: 5 rows — `panorama_business_domain`, `panorama_concept`, `panorama_doc_concept_rel`, `panorama_knowledge_doc`, `panorama_migration_history`.

- [ ] **Step 3: Commit**

```bash
git add panorama/migrations/sql/002_concept_and_doc_concept_rel.sql
git commit -m "feat(panorama-migrations): 002 concept + doc_concept_rel"
```

---

### Task 5: DDL — code_ref + ref_link

**Files:**
- Create: `panorama/migrations/sql/003_code_ref_and_ref_link.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Generic code anchor — shared by ingestors. Unique on (repo, file_path, line_no).
CREATE TABLE panorama_code_ref (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  repo            VARCHAR(50) NOT NULL,
  file_path       VARCHAR(500) NOT NULL,
  line_no         INT NULL,
  snippet         TEXT NULL,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_loc (repo, file_path, line_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Polymorphic edge table. Phase 1 only writes DESCRIBES (doc -> domain) and REFERENCES (doc -> code_ref).
CREATE TABLE panorama_ref_link (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_type     VARCHAR(30) NOT NULL,
  source_id       BIGINT NOT NULL,
  target_type     VARCHAR(30) NOT NULL,
  target_id       BIGINT NOT NULL,
  link_type       VARCHAR(50) NOT NULL,
  confidence      DECIMAL(3,2) NOT NULL DEFAULT 1.00,
  meta_json       JSON NULL,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_source (source_type, source_id),
  KEY idx_target (target_type, target_id),
  KEY idx_type (link_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 2: Apply and verify**

```bash
cd /Users/quansong/Documents/code/panorama/migrations && pnpm apply
mysql -h <host> -u bijieprd -p lista-qa -e \
  "DESCRIBE panorama_ref_link;"
```

Expected: 9 columns ending with `db_create_time`.

- [ ] **Step 3: Commit**

```bash
git add panorama/migrations/sql/003_code_ref_and_ref_link.sql
git commit -m "feat(panorama-migrations): 003 code_ref + ref_link"
```

---

### Task 6: DDL — cron_job

**Files:**
- Create: `panorama/migrations/sql/004_cron_job.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE panorama_cron_job (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  domain_id       BIGINT NULL,
  name            VARCHAR(200) NOT NULL,
  schedule        VARCHAR(100) NULL,
  job_id          VARCHAR(100) NULL,
  repo            VARCHAR(50) NOT NULL,
  file_path       VARCHAR(500) NOT NULL,
  line_no         INT NULL,
  handler_class   VARCHAR(200) NULL,
  description     TEXT NULL,
  confidence      DECIMAL(3,2) NOT NULL DEFAULT 1.00,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  db_modify_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_domain (domain_id),
  KEY idx_name (name),
  KEY idx_repo_file (repo, file_path),
  FULLTEXT KEY ft_search (name, description)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 2: Apply and verify**

```bash
cd /Users/quansong/Documents/code/panorama/migrations && pnpm apply
mysql -h <host> -u bijieprd -p lista-qa -e "DESCRIBE panorama_cron_job;"
```

Expected: 13 columns. `idx_repo_file` covers the orchestrator's Strategy A lookup (cron rows by `(repo, file_path)`).

- [ ] **Step 3: Commit**

```bash
git add panorama/migrations/sql/004_cron_job.sql
git commit -m "feat(panorama-migrations): 004 cron_job"
```

---

### Task 7: DDL — build_meta + broken_ref

**Files:**
- Create: `panorama/migrations/sql/005_build_meta_and_broken_ref.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE panorama_build_meta (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  build_id        VARCHAR(40) NOT NULL UNIQUE,
  status          ENUM('running', 'success', 'failed') NOT NULL,
  started_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at     TIMESTAMP NULL,
  duration_ms     INT NULL,
  trigger_type    VARCHAR(20) NOT NULL,
  triggered_by    VARCHAR(100) NULL,
  commit_shas     JSON NULL,
  stats_json      JSON NULL,
  error_log       TEXT NULL,
  KEY idx_status (status),
  KEY idx_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE panorama_broken_ref (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  build_id        VARCHAR(40) NOT NULL,
  doc_path        VARCHAR(500) NOT NULL,
  doc_line_no     INT NULL,
  ref_repo        VARCHAR(50) NOT NULL,
  ref_file_path   VARCHAR(500) NOT NULL,
  ref_line_no     INT NULL,
  reason          VARCHAR(200) NULL,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_build (build_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 2: Apply and verify schema is complete**

```bash
cd /Users/quansong/Documents/code/panorama/migrations && pnpm apply
mysql -h <host> -u bijieprd -p lista-qa -e \
  "SELECT table_name FROM information_schema.tables WHERE table_schema='lista-qa' AND table_name LIKE 'panorama_%' ORDER BY 1;"
```

Expected: 9 rows —
```
panorama_broken_ref
panorama_build_meta
panorama_business_domain
panorama_code_ref
panorama_concept
panorama_cron_job
panorama_doc_concept_rel
panorama_knowledge_doc
panorama_migration_history
panorama_ref_link
```

(10 if you count `panorama_migration_history`. The remaining 9 cover Phase 1 needs; api/entity/contract/frontend_route/redis_key etc. land in Phase 2.)

- [ ] **Step 3: Commit**

```bash
git add panorama/migrations/sql/005_build_meta_and_broken_ref.sql
git commit -m "feat(panorama-migrations): 005 build_meta + broken_ref (Phase 1 schema complete)"
```

---

### Task 8: Ingestion package scaffold + shared types

**Files:**
- Create: `panorama/ingestion/package.json`
- Create: `panorama/ingestion/tsconfig.json`
- Create: `panorama/ingestion/vitest.config.ts`
- Create: `panorama/ingestion/src/types.ts`
- Create: `panorama/ingestion/src/env.ts`
- Create: `panorama/ingestion/src/log.ts`
- Create: `panorama/ingestion/src/db.ts`

- [ ] **Step 1: Initialise package**

Write `ingestion/package.json`:

```json
{
  "name": "@panorama/ingestion",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "rebuild": "tsx src/cli.ts rebuild",
    "build:check": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@types/node": "^20.14.0",
    "dotenv": "^16.4.5",
    "gray-matter": "^4.0.3",
    "mysql2": "^3.11.0",
    "ts-morph": "^23.0.0"
  },
  "devDependencies": {
    "tsx": "^4.16.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.0"
  }
}
```

Write `ingestion/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "." },
  "include": ["src/**/*", "__tests__/**/*"]
}
```

Write `ingestion/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { globals: false, include: ['__tests__/**/*.test.ts'], testTimeout: 60_000 }
});
```

```bash
cd /Users/quansong/Documents/code/panorama && pnpm install
```

- [ ] **Step 2: Define ingestor I/O contract**

Write `ingestion/src/types.ts`:

```ts
export type NodeKind =
  | 'domain' | 'doc' | 'concept'
  | 'cron' | 'code_ref';

export interface IngestorNode {
  type: NodeKind;
  /** Stable natural key — used to deduplicate across ingestor runs. */
  key: string;
  data: Record<string, unknown>;
}

export interface IngestorEdge {
  sourceType: NodeKind;
  sourceKey: string;
  targetType: NodeKind;
  targetKey: string;
  linkType: 'DESCRIBES' | 'REFERENCES' | 'BELONGS_TO' | 'MENTIONS';
  confidence: number;       // 0..1
  meta?: Record<string, unknown>;
}

export interface BrokenRef {
  docPath: string;
  docLineNo: number | null;
  refRepo: string;
  refFilePath: string;
  refLineNo: number | null;
  reason: 'file_not_found' | 'content_drift' | 'invalid_pattern';
}

export interface IngestorOutput {
  ingestor: string;          // 'knowledge' | 'cron' | ...
  nodes: IngestorNode[];
  edges: IngestorEdge[];
  brokenRefs: BrokenRef[];
}
```

Write `ingestion/src/env.ts`:

```ts
import 'dotenv/config';

const REQUIRED = [
  'MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE', 'REPOS_PATH'
] as const;

export function loadEnv() {
  for (const k of REQUIRED) {
    if (!process.env[k]) throw new Error(`Missing env ${k}`);
  }
  return {
    mysqlHost: process.env.MYSQL_HOST!,
    mysqlPort: Number(process.env.MYSQL_PORT ?? 3306),
    mysqlUser: process.env.MYSQL_USER!,
    mysqlPassword: process.env.MYSQL_PASSWORD!,
    mysqlDatabase: process.env.MYSQL_DATABASE!,
    reposPath: process.env.REPOS_PATH!
  };
}
```

Write `ingestion/src/log.ts`:

```ts
type Level = 'info' | 'warn' | 'error';
export function log(level: Level, msg: string, data?: Record<string, unknown>) {
  const line = { ts: new Date().toISOString(), level, msg, ...data };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));
}
```

Write `ingestion/src/db.ts`:

```ts
import mysql, { type Pool } from 'mysql2/promise';
import { loadEnv } from './env.js';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  const e = loadEnv();
  pool = mysql.createPool({
    host: e.mysqlHost,
    port: e.mysqlPort,
    user: e.mysqlUser,
    password: e.mysqlPassword,
    database: e.mysqlDatabase,
    connectionLimit: 4,
    multipleStatements: true,
    timezone: 'Z'
  });
  return pool;
}

export async function closePool() {
  if (pool) { await pool.end(); pool = null; }
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd /Users/quansong/Documents/code/panorama/ingestion
pnpm build:check
```

Expected: zero output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add panorama/ingestion/package.json panorama/ingestion/tsconfig.json \
        panorama/ingestion/vitest.config.ts panorama/ingestion/src
git commit -m "chore(panorama-ingestion): scaffold package + shared types"
```

---

### Task 9: Knowledge ingestor — failing tests for frontmatter + tree

**Files:**
- Create: `panorama/ingestion/__tests__/fixtures/knowledge/business/business-outline.md`
- Create: `panorama/ingestion/__tests__/fixtures/knowledge/business/moolah/overview.md`
- Create: `panorama/ingestion/__tests__/fixtures/knowledge/business/moolah/emission.md`
- Create: `panorama/ingestion/__tests__/fixtures/knowledge/business/_template.md`
- Create: `panorama/ingestion/__tests__/knowledge.test.ts`

- [ ] **Step 1: Set up fixture directory mirroring real repo layout**

```bash
cd /Users/quansong/Documents/code/panorama/ingestion
mkdir -p __tests__/fixtures/knowledge/business/moolah
```

Write `__tests__/fixtures/knowledge/business/business-outline.md`:

```markdown
---
domain: infrastructure
file_type: index
parent: business/infrastructure/overview.md
last_verified: 2026-04-30
---

# Lista DAO 业务知识库索引

## 借贷 (moolah/)
| 文档 | 说明 |
|------|------|
| [emission.md](moolah/emission.md) | Moolah 排放奖励 |
```

Write `__tests__/fixtures/knowledge/business/moolah/overview.md`:

```markdown
---
domain: moolah
file_type: overview
last_verified: 2026-04-21
concepts:
  - moolah_market
aliases:
  - Moolah 市场
---

# Moolah — 概览

借贷协议主入口。
```

Write `__tests__/fixtures/knowledge/business/moolah/emission.md`:

```markdown
---
domain: moolah
file_type: shard
parent: business/moolah/overview.md
concepts:
  - emission
  - merkle_root
aliases:
  - Moolah 排放
last_verified: 2026-04-27
---

# Moolah — Emission 奖励分发

实现入口：[lista-cron/src/modules/moolah/emission.service.ts:42](../../../lista-cron/src/modules/moolah/emission.service.ts).
另见 `lista-cron/src/modules/moolah/snapshot.service.ts:88`.
```

Write `__tests__/fixtures/knowledge/business/_template.md`:

```markdown
---
file_type: template
---

# 模板 — 不应被 ingest
```

- [ ] **Step 2: Write the failing test**

Write `__tests__/knowledge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { ingestKnowledge } from '../src/ingestors/knowledge.js';

const FIXTURE = join(__dirname, 'fixtures/knowledge');

describe('knowledge ingestor', () => {
  it('emits BusinessDomain nodes for moolah and infrastructure', async () => {
    const out = await ingestKnowledge({ knowledgeRoot: FIXTURE });
    const domainKeys = out.nodes.filter(n => n.type === 'domain').map(n => n.key);
    expect(domainKeys).toEqual(expect.arrayContaining(['moolah', 'moolah/emission']));
  });

  it('skips files starting with underscore', async () => {
    const out = await ingestKnowledge({ knowledgeRoot: FIXTURE });
    const docPaths = out.nodes.filter(n => n.type === 'doc').map(n => (n.data as any).path);
    expect(docPaths).not.toContain('business/_template.md');
  });

  it('parses frontmatter concepts and emits one Concept node per name', async () => {
    const out = await ingestKnowledge({ knowledgeRoot: FIXTURE });
    const conceptKeys = out.nodes.filter(n => n.type === 'concept').map(n => n.key);
    expect(conceptKeys).toEqual(expect.arrayContaining(['emission', 'merkle_root']));
  });

  it('emits DESCRIBES edge from doc to its domain', async () => {
    const out = await ingestKnowledge({ knowledgeRoot: FIXTURE });
    const describes = out.edges.filter(e => e.linkType === 'DESCRIBES');
    expect(describes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceType: 'doc',
        sourceKey: 'business/moolah/emission.md',
        targetType: 'domain',
        targetKey: 'moolah/emission',
        confidence: 1.0
      })
    ]));
  });

  it('extracts code references with file:line patterns', async () => {
    const out = await ingestKnowledge({ knowledgeRoot: FIXTURE });
    const refs = out.nodes.filter(n => n.type === 'code_ref').map(n => n.key);
    expect(refs).toEqual(expect.arrayContaining([
      'lista-cron:src/modules/moolah/emission.service.ts:42',
      'lista-cron:src/modules/moolah/snapshot.service.ts:88'
    ]));
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

```bash
cd /Users/quansong/Documents/code/panorama/ingestion
pnpm test
```

Expected: 5 tests fail with `Cannot find module '../src/ingestors/knowledge.js'`.

- [ ] **Step 4: Commit the failing tests + fixtures**

```bash
git add panorama/ingestion/__tests__
git commit -m "test(panorama-ingestion): knowledge ingestor failing tests + fixtures"
```

---

### Task 10: Knowledge ingestor — minimal implementation to pass tests

**Files:**
- Create: `panorama/ingestion/src/ingestors/knowledge.ts`
- Create: `panorama/ingestion/src/ingestors/knowledge-coderef.ts`

- [ ] **Step 1: Implement code-ref extractor**

Write `ingestion/src/ingestors/knowledge-coderef.ts`:

```ts
const REPOS = ['lista-mono', 'lista-admin', 'lista-bot', 'lista-cron', 'lista-knowledge'] as const;

// Match bare paths and markdown links. Examples that should match:
//   lista-cron/src/modules/moolah/emission.service.ts:42
//   `lista-cron/src/foo.ts:88`
//   [emission.service.ts:42](../../../lista-cron/src/modules/moolah/emission.service.ts)
const PATH_RE = new RegExp(
  '(?:^|[\\s`(\\[/])((?:' + REPOS.join('|') + ')/[A-Za-z0-9_./\\-]+\\.(?:ts|tsx|js|jsx|sol|py|sql|md))(?::(\\d+))?',
  'g'
);

export interface CodeRefHit {
  repo: string;
  filePath: string;
  lineNo: number | null;
  /** 1-based line of the markdown source where the ref appeared. */
  docLineNo: number;
}

export function extractCodeRefs(markdown: string): CodeRefHit[] {
  const hits: CodeRefHit[] = [];
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    PATH_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PATH_RE.exec(line)) !== null) {
      const fullPath = m[1]!;
      const repo = REPOS.find(r => fullPath.startsWith(r + '/'))!;
      const filePath = fullPath.slice(repo.length + 1);
      hits.push({
        repo,
        filePath,
        lineNo: m[2] ? Number(m[2]) : null,
        docLineNo: i + 1
      });
    }
  }
  return hits;
}
```

- [ ] **Step 2: Implement the knowledge ingestor**

Write `ingestion/src/ingestors/knowledge.ts`:

```ts
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, posix } from 'node:path';
import matter from 'gray-matter';
import type { IngestorNode, IngestorEdge, IngestorOutput, BrokenRef } from '../types.js';
import { extractCodeRefs } from './knowledge-coderef.js';

interface Opts { knowledgeRoot: string; }

const SKIP_PREFIX = '_';
const SKIP_DIRS = new Set(['scripts', 'sites']);  // not business-domain content
const KEEP_EXT = new Set(['.md']);

/** business/moolah/emission.md → "moolah/emission". business/moolah/overview.md → "moolah". */
function deriveDomainKey(relPath: string): string {
  const parts = relPath.replace(/\\/g, '/').split('/');
  // parts: ['business', 'moolah', 'emission.md']
  if (parts[0] !== 'business') return parts.slice(0, -1).join('/');
  const segs = parts.slice(1, -1);                   // ['moolah']
  const filename = parts[parts.length - 1]!;         // 'emission.md'
  const stem = filename.replace(/\.md$/, '');
  if (stem === 'overview' || segs.length === 0) return segs.join('/') || 'root';
  return [...segs, stem].join('/');
}

function deriveDisplayName(domainKey: string): string {
  const last = domainKey.split('/').pop()!;
  return last.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

async function walkMarkdown(root: string): Promise<string[]> {
  const out: string[] = [];
  async function go(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(SKIP_PREFIX)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        await go(full);
      } else if (e.isFile() && KEEP_EXT.has('.' + e.name.split('.').pop()!)) {
        out.push(full);
      }
    }
  }
  await go(root);
  return out.sort();
}

export async function ingestKnowledge(opts: Opts): Promise<IngestorOutput> {
  const businessRoot = join(opts.knowledgeRoot, 'business');
  const exists = await stat(businessRoot).catch(() => null);
  if (!exists) throw new Error(`knowledge: ${businessRoot} not found`);

  const files = await walkMarkdown(businessRoot);
  const nodes: IngestorNode[] = [];
  const edges: IngestorEdge[] = [];
  const brokenRefs: BrokenRef[] = [];
  const conceptSeen = new Set<string>();
  const domainSeen = new Set<string>();

  for (const abs of files) {
    const rel = posix.normalize('business/' + relative(businessRoot, abs).replace(/\\/g, '/'));
    const raw = await readFile(abs, 'utf8');
    const parsed = matter(raw);
    const fm = parsed.data as Record<string, unknown>;
    const body = parsed.content;

    const domainKey = deriveDomainKey(rel);

    // 1. Domain node — emit once per unique key.
    if (!domainSeen.has(domainKey)) {
      domainSeen.add(domainKey);
      // Parent: 'moolah/emission' → parent 'moolah'; 'moolah' → no parent.
      const parts = domainKey.split('/');
      const parentKey = parts.length > 1 ? parts.slice(0, -1).join('/') : null;
      nodes.push({
        type: 'domain', key: domainKey,
        data: {
          name: parts[parts.length - 1]!,
          displayName: deriveDisplayName(domainKey),
          parentKey,
          fileType: fm.file_type ?? null,
          knowledgePath: rel,
          description: typeof fm.summary === 'string' ? fm.summary : null
        }
      });
    }

    // 2. Doc node.
    nodes.push({
      type: 'doc', key: rel,
      data: {
        path: rel,
        title: extractTitle(body) ?? rel,
        lastVerified: typeof fm.last_verified === 'string' ? fm.last_verified : null,
        frontmatter: fm,
        bodyMdPath: rel,
        wordCount: body.split(/\s+/).filter(Boolean).length
      }
    });

    // 3. DESCRIBES edge: doc → domain.
    edges.push({
      sourceType: 'doc', sourceKey: rel,
      targetType: 'domain', targetKey: domainKey,
      linkType: 'DESCRIBES', confidence: 1.0
    });

    // 4. Concepts — frontmatter.concepts is a string[] of canonical names.
    const concepts = Array.isArray(fm.concepts) ? (fm.concepts as unknown[]).filter((c): c is string => typeof c === 'string') : [];
    const aliases = Array.isArray(fm.aliases) ? (fm.aliases as unknown[]).filter((a): a is string => typeof a === 'string') : [];
    for (const c of concepts) {
      if (!conceptSeen.has(c)) {
        conceptSeen.add(c);
        nodes.push({
          type: 'concept', key: c,
          data: { name: c, aliases: aliases.filter(a => a.toLowerCase().includes(c.toLowerCase())) }
        });
      }
      edges.push({
        sourceType: 'doc', sourceKey: rel,
        targetType: 'concept', targetKey: c,
        linkType: 'MENTIONS', confidence: 1.0
      });
    }

    // 5. Code references in body.
    const hits = extractCodeRefs(body);
    for (const h of hits) {
      const codeRefKey = `${h.repo}:${h.filePath}:${h.lineNo ?? ''}`;
      nodes.push({
        type: 'code_ref', key: codeRefKey,
        data: { repo: h.repo, filePath: h.filePath, lineNo: h.lineNo, docLineNo: h.docLineNo }
      });
      edges.push({
        sourceType: 'doc', sourceKey: rel,
        targetType: 'code_ref', targetKey: codeRefKey,
        linkType: 'REFERENCES', confidence: 1.0,
        meta: { docLineNo: h.docLineNo }
      });
    }
  }

  // Dedup code_ref nodes (same key emitted by multiple docs is fine; we keep first).
  const seen = new Set<string>();
  const dedupedNodes = nodes.filter(n => {
    const k = `${n.type}:${n.key}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { ingestor: 'knowledge', nodes: dedupedNodes, edges, brokenRefs };
}

function extractTitle(md: string): string | null {
  const m = md.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1]! : null;
}
```

- [ ] **Step 3: Run tests — should pass**

```bash
cd /Users/quansong/Documents/code/panorama/ingestion
pnpm test
```

Expected: 5 tests pass.

- [ ] **Step 4: Sanity check against the real lista-knowledge repo**

```bash
cd /Users/quansong/Documents/code/panorama/ingestion
node --import tsx -e "
import { ingestKnowledge } from './src/ingestors/knowledge.ts';
const out = await ingestKnowledge({ knowledgeRoot: '/Users/quansong/Documents/code/lista-knowledge' });
console.log('domains:', out.nodes.filter(n => n.type === 'domain').length);
console.log('docs:', out.nodes.filter(n => n.type === 'doc').length);
console.log('concepts:', out.nodes.filter(n => n.type === 'concept').length);
console.log('code_refs:', out.nodes.filter(n => n.type === 'code_ref').length);
console.log('describes edges:', out.edges.filter(e => e.linkType === 'DESCRIBES').length);
"
```

Expected magnitudes (per PRD §2.1 + tech-design §15.2):
- domains: 50–80 (9 L1 + their L2 children)
- docs: 45–55 (PRD says 49)
- concepts: 100–300
- code_refs: 50+ (most docs reference code)

If `code_refs` is 0, the regex didn't match real-world style — adjust before committing.

- [ ] **Step 5: Commit**

```bash
git add panorama/ingestion/src/ingestors
git commit -m "feat(panorama-ingestion): knowledge ingestor (frontmatter + concepts + code refs)"
```

---

### Task 11: Cron ingestor — failing tests against fixture

**Files:**
- Create: `panorama/ingestion/__tests__/fixtures/cron/lista-cron/src/modules/moolah/emission.service.ts`
- Create: `panorama/ingestion/__tests__/fixtures/cron/lista-bot/src/modules/buyback/buyback.service.ts`
- Create: `panorama/ingestion/__tests__/cron.test.ts`

- [ ] **Step 1: Build minimal fixture mirroring real decorator usage**

```bash
cd /Users/quansong/Documents/code/panorama/ingestion
mkdir -p __tests__/fixtures/cron/lista-cron/src/modules/moolah
mkdir -p __tests__/fixtures/cron/lista-bot/src/modules/buyback
```

Write `__tests__/fixtures/cron/lista-cron/src/modules/moolah/emission.service.ts`:

```ts
// @ts-nocheck — fixture, decorators not resolved
import { Injectable } from '@nestjs/common';
import { XxlJobHandler } from '@xxl/nest';

@Injectable()
export class MoolahEmissionService {
  /** 每周三计算 Merkle Root */
  @XxlJobHandler('moolahEmissionWeeklySnapshot')
  async snapshot() { /* impl */ }

  @XxlJobHandler('moolahEmissionAcceptRoot')
  async accept() { /* impl */ }
}
```

Write `__tests__/fixtures/cron/lista-bot/src/modules/buyback/buyback.service.ts`:

```ts
// @ts-nocheck — fixture
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class BuybackService {
  /** Daily LISTA buyback */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runBuyback() { /* impl */ }
}
```

- [ ] **Step 2: Write the failing test**

Write `__tests__/cron.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { ingestCron } from '../src/ingestors/cron.js';

const FIXTURE = join(__dirname, 'fixtures/cron');

describe('cron ingestor', () => {
  it('extracts @XxlJobHandler decorators with the job id literal', async () => {
    const out = await ingestCron({
      reposPath: FIXTURE,
      repos: ['lista-cron']
    });
    const cronJobs = out.nodes.filter(n => n.type === 'cron');
    expect(cronJobs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'cron',
        key: 'lista-cron:moolahEmissionWeeklySnapshot',
        data: expect.objectContaining({
          name: 'moolahEmissionWeeklySnapshot',
          handlerClass: 'MoolahEmissionService',
          repo: 'lista-cron',
          filePath: 'src/modules/moolah/emission.service.ts'
        })
      }),
      expect.objectContaining({
        key: 'lista-cron:moolahEmissionAcceptRoot'
      })
    ]));
  });

  it('extracts @Cron decorators with schedule expression', async () => {
    const out = await ingestCron({
      reposPath: FIXTURE,
      repos: ['lista-bot']
    });
    const cronJobs = out.nodes.filter(n => n.type === 'cron');
    const buyback = cronJobs.find(n => n.data.handlerClass === 'BuybackService' && n.data.name === 'runBuyback');
    expect(buyback).toBeDefined();
    expect(buyback!.data.schedule).toBe('CronExpression.EVERY_DAY_AT_MIDNIGHT');
  });

  it('captures file_path + line_no for the decorator location', async () => {
    const out = await ingestCron({ reposPath: FIXTURE, repos: ['lista-cron'] });
    const job = out.nodes.find(n => n.type === 'cron' && (n.data as any).name === 'moolahEmissionWeeklySnapshot');
    expect((job!.data as any).lineNo).toBeGreaterThan(0);
  });

  it('infers domainKey from path when "src/modules/{domain}" is present', async () => {
    const out = await ingestCron({ reposPath: FIXTURE, repos: ['lista-cron'] });
    const edge = out.edges.find(e => e.linkType === 'BELONGS_TO' && e.sourceKey === 'lista-cron:moolahEmissionWeeklySnapshot');
    expect(edge).toBeDefined();
    expect(edge!.targetKey).toBe('moolah');
    expect(edge!.confidence).toBeGreaterThanOrEqual(0.6);  // heuristic
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

```bash
pnpm test cron.test.ts
```

Expected: FAIL with `Cannot find module '../src/ingestors/cron.js'`.

- [ ] **Step 4: Commit failing tests**

```bash
git add panorama/ingestion/__tests__/fixtures/cron panorama/ingestion/__tests__/cron.test.ts
git commit -m "test(panorama-ingestion): cron ingestor failing tests + fixtures"
```

---

### Task 12: Cron ingestor — implementation

**Files:**
- Create: `panorama/ingestion/src/ingestors/cron.ts`

- [ ] **Step 1: Implement cron ingestor with ts-morph**

Write `ingestion/src/ingestors/cron.ts`:

```ts
import { Project, SyntaxKind, Decorator, ClassDeclaration, MethodDeclaration } from 'ts-morph';
import { join, relative, posix } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import type { IngestorNode, IngestorEdge, IngestorOutput } from '../types.js';

interface Opts {
  reposPath: string;
  repos: string[];        // e.g. ['lista-cron', 'lista-bot']
}

const SUPPORTED_DECORATORS = new Set(['XxlJobHandler', 'Cron']);
const FILE_GLOB = /\.service\.ts$/;
// Only scan src/modules/** to skip tests and infra code.
const KEEP_DIR = /\bsrc\/modules\b/;

async function walkServiceFiles(repoRoot: string): Promise<string[]> {
  const out: string[] = [];
  async function go(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name === '__tests__') continue;
        await go(full);
      } else if (e.isFile() && FILE_GLOB.test(e.name) && KEEP_DIR.test(full)) {
        out.push(full);
      }
    }
  }
  await go(repoRoot);
  return out.sort();
}

/** "src/modules/moolah/emission.service.ts" → "moolah" */
function inferDomainKey(filePath: string): string | null {
  const m = filePath.match(/src\/modules\/([^/]+)\//);
  return m ? m[1]! : null;
}

function getDecoratorArg(d: Decorator): string | null {
  const args = d.getArguments();
  if (args.length === 0) return null;
  const first = args[0]!;
  if (first.getKind() === SyntaxKind.StringLiteral) {
    return first.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText();
  }
  // CronExpression.EVERY_DAY_AT_MIDNIGHT — return the source text.
  return first.getText();
}

function extractDescription(method: MethodDeclaration): string | null {
  const ranges = method.getLeadingCommentRanges();
  if (ranges.length === 0) return null;
  const last = ranges[ranges.length - 1]!.getText();
  return last
    .replace(/^\/\*\*?/, '').replace(/\*\/$/, '')
    .replace(/^\s*\*\s?/gm, '')
    .trim() || null;
}

function processClass(cls: ClassDeclaration, repo: string, filePath: string): { nodes: IngestorNode[]; edges: IngestorEdge[] } {
  const nodes: IngestorNode[] = [];
  const edges: IngestorEdge[] = [];
  const handlerClass = cls.getName() ?? '';

  for (const method of cls.getMethods()) {
    for (const dec of method.getDecorators()) {
      const decName = dec.getName();
      if (!SUPPORTED_DECORATORS.has(decName)) continue;

      const arg = getDecoratorArg(dec);
      if (!arg) continue;

      const isXxl = decName === 'XxlJobHandler';
      const name = isXxl ? arg : method.getName();
      const schedule = isXxl ? null : arg;
      const jobId = isXxl ? arg : null;
      const lineNo = dec.getStartLineNumber();
      const key = `${repo}:${name}`;

      nodes.push({
        type: 'cron', key,
        data: {
          name, schedule, jobId,
          repo, filePath, lineNo,
          handlerClass,
          description: extractDescription(method),
          confidence: 1.0
        }
      });

      const domainKey = inferDomainKey(filePath);
      if (domainKey) {
        edges.push({
          sourceType: 'cron', sourceKey: key,
          targetType: 'domain', targetKey: domainKey,
          linkType: 'BELONGS_TO', confidence: 0.6,         // heuristic — file path inference
          meta: { strategy: 'path-prefix' }
        });
      }
    }
  }
  return { nodes, edges };
}

export async function ingestCron(opts: Opts): Promise<IngestorOutput> {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: false, target: 99 /* ESNext */ }
  });

  const nodes: IngestorNode[] = [];
  const edges: IngestorEdge[] = [];

  for (const repo of opts.repos) {
    const repoRoot = join(opts.reposPath, repo);
    const exists = await stat(repoRoot).catch(() => null);
    if (!exists) continue;

    const files = await walkServiceFiles(repoRoot);
    for (const abs of files) {
      const filePath = posix.normalize(relative(repoRoot, abs).replace(/\\/g, '/'));
      const sf = project.addSourceFileAtPath(abs);
      for (const cls of sf.getClasses()) {
        const out = processClass(cls, repo, filePath);
        nodes.push(...out.nodes);
        edges.push(...out.edges);
      }
      project.removeSourceFile(sf);
    }
  }

  return { ingestor: 'cron', nodes, edges, brokenRefs: [] };
}
```

- [ ] **Step 2: Run cron tests — should pass**

```bash
cd /Users/quansong/Documents/code/panorama/ingestion
pnpm test cron.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 3: Sanity check against real lista-cron**

```bash
node --import tsx -e "
import { ingestCron } from './src/ingestors/cron.ts';
const out = await ingestCron({
  reposPath: '/Users/quansong/Documents/code',
  repos: ['lista-cron', 'lista-bot']
});
const xxl = out.nodes.filter(n => n.type === 'cron' && n.data.jobId).length;
const cron = out.nodes.filter(n => n.type === 'cron' && n.data.schedule).length;
console.log('XxlJob:', xxl, 'Cron:', cron, 'total:', out.nodes.length);
"
```

Expected magnitudes: XxlJob ≥ 200 (PRD says 315 in lista-cron), Cron ≥ 5 (lista-bot). If counts are dramatically lower, the AST visitor is missing decorator names — log decorator names that hit `SUPPORTED_DECORATORS.has(decName)===false` and check spec.

- [ ] **Step 4: Commit**

```bash
git add panorama/ingestion/src/ingestors/cron.ts
git commit -m "feat(panorama-ingestion): cron ingestor (@XxlJobHandler + @Cron via ts-morph)"
```

---

### Task 13: Orchestrator + Strategy A linking — failing tests

**Files:**
- Create: `panorama/ingestion/__tests__/orchestrator.test.ts`

- [ ] **Step 1: Write the failing tests**

Write `__tests__/orchestrator.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { runOrchestrator } from '../src/orchestrator.js';
import type { IngestorOutput } from '../src/types.js';

function knowledgeFixture(): IngestorOutput {
  return {
    ingestor: 'knowledge',
    nodes: [
      { type: 'domain', key: 'moolah', data: { name: 'moolah', displayName: 'Moolah', parentKey: null } },
      { type: 'domain', key: 'moolah/emission', data: { name: 'emission', displayName: 'Emission', parentKey: 'moolah' } },
      { type: 'doc', key: 'business/moolah/emission.md', data: { path: 'business/moolah/emission.md' } },
      { type: 'code_ref', key: 'lista-cron:src/modules/moolah/emission.service.ts:42',
        data: { repo: 'lista-cron', filePath: 'src/modules/moolah/emission.service.ts', lineNo: 42 } }
    ],
    edges: [
      { sourceType: 'doc', sourceKey: 'business/moolah/emission.md',
        targetType: 'domain', targetKey: 'moolah/emission', linkType: 'DESCRIBES', confidence: 1.0 },
      { sourceType: 'doc', sourceKey: 'business/moolah/emission.md',
        targetType: 'code_ref', targetKey: 'lista-cron:src/modules/moolah/emission.service.ts:42',
        linkType: 'REFERENCES', confidence: 1.0 }
    ],
    brokenRefs: []
  };
}

function cronFixture(): IngestorOutput {
  return {
    ingestor: 'cron',
    nodes: [
      { type: 'cron', key: 'lista-cron:moolahEmissionWeeklySnapshot',
        data: { name: 'moolahEmissionWeeklySnapshot', repo: 'lista-cron',
                filePath: 'src/modules/moolah/emission.service.ts', lineNo: 42 } }
    ],
    edges: [
      { sourceType: 'cron', sourceKey: 'lista-cron:moolahEmissionWeeklySnapshot',
        targetType: 'domain', targetKey: 'moolah', linkType: 'BELONGS_TO', confidence: 0.6 }
    ],
    brokenRefs: []
  };
}

describe('orchestrator', () => {
  it('Strategy A: links cron to its domain via knowledge code_ref (confidence 1.0)', () => {
    const merged = runOrchestrator([knowledgeFixture(), cronFixture()]);
    const link = merged.edges.find(
      e => e.linkType === 'BELONGS_TO'
        && e.sourceKey === 'lista-cron:moolahEmissionWeeklySnapshot'
        && e.targetKey === 'moolah/emission'
    );
    expect(link).toBeDefined();
    expect(link!.confidence).toBe(1.0);
  });

  it('keeps the heuristic edge but with lower confidence than authoritative', () => {
    const merged = runOrchestrator([knowledgeFixture(), cronFixture()]);
    const heuristic = merged.edges.find(
      e => e.targetKey === 'moolah' && e.sourceKey === 'lista-cron:moolahEmissionWeeklySnapshot'
        && e.confidence < 1.0
    );
    expect(heuristic).toBeDefined();
  });

  it('deduplicates nodes across ingestors by (type,key)', () => {
    const merged = runOrchestrator([knowledgeFixture(), cronFixture()]);
    const cronNodes = merged.nodes.filter(n => n.type === 'cron');
    expect(cronNodes.length).toBe(1);
  });

  it('preserves brokenRefs from all ingestors', () => {
    const merged = runOrchestrator([
      { ...knowledgeFixture(), brokenRefs: [
        { docPath: 'a.md', docLineNo: 1, refRepo: 'lista-cron', refFilePath: 'x.ts', refLineNo: null, reason: 'file_not_found' }
      ]},
      cronFixture()
    ]);
    expect(merged.brokenRefs).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — confirm failure**

```bash
pnpm test orchestrator.test.ts
```

Expected: 4 tests fail with `Cannot find module '../src/orchestrator.js'`.

- [ ] **Step 3: Commit failing tests**

```bash
git add panorama/ingestion/__tests__/orchestrator.test.ts
git commit -m "test(panorama-ingestion): orchestrator failing tests"
```

---

### Task 14: Orchestrator implementation

**Files:**
- Create: `panorama/ingestion/src/orchestrator.ts`

- [ ] **Step 1: Implement the orchestrator**

Write `ingestion/src/orchestrator.ts`:

```ts
import type { IngestorEdge, IngestorNode, IngestorOutput, BrokenRef } from './types.js';

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
 *   and a cron entity exists at that exact (repo, file_path) — possibly with
 *   matching line — *and* the doc DESCRIBES a domain, emit an authoritative
 *   BELONGS_TO edge from cron → that domain with confidence 1.0.
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
  // (a) doc → domain it DESCRIBES
  const docToDomain = new Map<string, string>();
  // (b) doc → list of code_refs it REFERENCES
  const docToCodeRefs = new Map<string, string[]>();
  // (c) cron entity by (repo, filePath) — Strategy A target
  const cronByLoc = new Map<string, IngestorNode[]>();

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
        const repo = (n.data as any).repo as string;
        const filePath = (n.data as any).filePath as string;
        const k = `${repo}:${filePath}`;
        const arr = cronByLoc.get(k) ?? [];
        arr.push(n);
        cronByLoc.set(k, arr);
      }
    }
  }

  // 3. All edges merged.
  const edges: IngestorEdge[] = [];
  for (const o of outputs) edges.push(...o.edges);

  // 4. Strategy A: emit authoritative cron → domain edges.
  for (const [docKey, codeRefKeys] of docToCodeRefs) {
    const domainKey = docToDomain.get(docKey);
    if (!domainKey) continue;
    for (const refKey of codeRefKeys) {
      // refKey format: "{repo}:{filePath}:{lineNo?}"
      const [repo, filePath /*, lineNo*/] = refKey.split(':');
      const locKey = `${repo}:${filePath}`;
      const cronEntities = cronByLoc.get(locKey) ?? [];
      for (const cronNode of cronEntities) {
        edges.push({
          sourceType: 'cron', sourceKey: cronNode.key,
          targetType: 'domain', targetKey: domainKey,
          linkType: 'BELONGS_TO', confidence: 1.0,
          meta: { strategy: 'A-doc-coderef', viaDoc: docKey, viaCodeRef: refKey }
        });
      }
    }
  }

  // 5. brokenRefs union.
  const brokenRefs: BrokenRef[] = [];
  for (const o of outputs) brokenRefs.push(...o.brokenRefs);

  // 6. Stats per ingestor.
  const stats: MergedGraph['stats'] = {};
  for (const o of outputs) {
    stats[o.ingestor] = { nodes: o.nodes.length, edges: o.edges.length, brokenRefs: o.brokenRefs.length };
  }

  return { nodes: [...nodeMap.values()], edges, brokenRefs, stats };
}
```

- [ ] **Step 2: Run orchestrator tests — should pass**

```bash
pnpm test orchestrator.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add panorama/ingestion/src/orchestrator.ts
git commit -m "feat(panorama-ingestion): orchestrator (Strategy A doc→cron→domain linking)"
```

---

### Task 15: Broken-refs detector — failing tests

**Files:**
- Create: `panorama/ingestion/__tests__/broken-refs.test.ts`
- Create: `panorama/ingestion/__tests__/fixtures/broken-refs/lista-cron/src/exists.ts`

- [ ] **Step 1: Build fixture**

```bash
cd /Users/quansong/Documents/code/panorama/ingestion
mkdir -p __tests__/fixtures/broken-refs/lista-cron/src
```

Write `__tests__/fixtures/broken-refs/lista-cron/src/exists.ts`:

```ts
// line 1
// line 2
export function foo() {     // line 3
  return 42;                // line 4
}
```

- [ ] **Step 2: Write failing tests**

Write `__tests__/broken-refs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { detectBrokenRefs } from '../src/broken-refs.js';
import type { IngestorNode } from '../src/types.js';

const REPOS = join(__dirname, 'fixtures/broken-refs');

function ref(repo: string, filePath: string, lineNo: number | null, docPath = 'a.md'): IngestorNode {
  return {
    type: 'code_ref',
    key: `${repo}:${filePath}:${lineNo ?? ''}`,
    data: { repo, filePath, lineNo, docPath, docLineNo: 1 }
  };
}

describe('broken-refs detector', () => {
  it('flags missing file', async () => {
    const nodes = [ref('lista-cron', 'src/missing.ts', 5)];
    const broken = await detectBrokenRefs({ nodes, reposPath: REPOS });
    expect(broken).toEqual([
      expect.objectContaining({ refFilePath: 'src/missing.ts', reason: 'file_not_found' })
    ]);
  });

  it('passes a valid file:line that resolves to existing content', async () => {
    const nodes = [ref('lista-cron', 'src/exists.ts', 3)];
    const broken = await detectBrokenRefs({ nodes, reposPath: REPOS });
    expect(broken).toEqual([]);
  });

  it('passes when lineNo is null (file exists, line not asserted)', async () => {
    const nodes = [ref('lista-cron', 'src/exists.ts', null)];
    const broken = await detectBrokenRefs({ nodes, reposPath: REPOS });
    expect(broken).toEqual([]);
  });
});
```

- [ ] **Step 3: Run, confirm failure**

```bash
pnpm test broken-refs.test.ts
```

Expected: FAIL with `Cannot find module '../src/broken-refs.js'`.

- [ ] **Step 4: Commit failing tests + fixture**

```bash
git add panorama/ingestion/__tests__/fixtures/broken-refs panorama/ingestion/__tests__/broken-refs.test.ts
git commit -m "test(panorama-ingestion): broken-refs detector failing tests"
```

---

### Task 16: Broken-refs detector — implementation

**Files:**
- Create: `panorama/ingestion/src/broken-refs.ts`

- [ ] **Step 1: Implement detector**

Write `ingestion/src/broken-refs.ts`:

```ts
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrokenRef, IngestorNode } from './types.js';

interface Opts { nodes: IngestorNode[]; reposPath: string; }

export async function detectBrokenRefs({ nodes, reposPath }: Opts): Promise<BrokenRef[]> {
  const broken: BrokenRef[] = [];
  for (const n of nodes) {
    if (n.type !== 'code_ref') continue;
    const repo = (n.data as any).repo as string;
    const filePath = (n.data as any).filePath as string;
    const lineNo = ((n.data as any).lineNo ?? null) as number | null;
    const docPath = ((n.data as any).docPath ?? 'unknown') as string;
    const docLineNo = ((n.data as any).docLineNo ?? null) as number | null;

    const abs = join(reposPath, repo, filePath);
    const fileStat = await stat(abs).catch(() => null);
    if (!fileStat || !fileStat.isFile()) {
      broken.push({ docPath, docLineNo, refRepo: repo, refFilePath: filePath, refLineNo: lineNo, reason: 'file_not_found' });
      continue;
    }

    if (lineNo !== null) {
      const content = await readFile(abs, 'utf8');
      const lines = content.split('\n');
      if (lineNo < 1 || lineNo > lines.length) {
        broken.push({ docPath, docLineNo, refRepo: repo, refFilePath: filePath, refLineNo: lineNo, reason: 'invalid_pattern' });
      }
    }
  }
  return broken;
}
```

- [ ] **Step 2: Run tests — should pass**

```bash
pnpm test broken-refs.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add panorama/ingestion/src/broken-refs.ts
git commit -m "feat(panorama-ingestion): broken-refs detector (file existence + line bounds)"
```

> **Note on content drift:** The PRD §4.4 mentions ±3-line fingerprint comparison. Phase 1 only implements file/line-bounds detection — content drift requires the lista-knowledge ref to record an expected fingerprint, which is a separate workflow (the doc author would need to commit the fingerprint). Defer to Phase 2 once the ingest output exists and the lista-knowledge team can decide.

---

### Task 17: Loader — staging swap, advisory lock — failing tests

**Files:**
- Create: `panorama/ingestion/__tests__/loader.test.ts`

- [ ] **Step 1: Write failing tests**

Write `__tests__/loader.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadGraph } from '../src/loader.js';
import { getPool, closePool } from '../src/db.js';
import { runOrchestrator } from '../src/orchestrator.js';
import type { IngestorOutput } from '../src/types.js';

function fixture(): IngestorOutput[] {
  return [{
    ingestor: 'knowledge',
    nodes: [
      { type: 'domain', key: 'moolah', data: { name: 'moolah', displayName: 'Moolah', parentKey: null } },
      { type: 'domain', key: 'moolah/emission', data: { name: 'emission', displayName: 'Emission', parentKey: 'moolah' } },
      { type: 'doc', key: 'business/moolah/emission.md',
        data: { path: 'business/moolah/emission.md', title: 'Emission', frontmatter: {}, lastVerified: '2026-04-27', wordCount: 100 } }
    ],
    edges: [
      { sourceType: 'doc', sourceKey: 'business/moolah/emission.md',
        targetType: 'domain', targetKey: 'moolah/emission', linkType: 'DESCRIBES', confidence: 1.0 }
    ],
    brokenRefs: []
  }, {
    ingestor: 'cron',
    nodes: [
      { type: 'cron', key: 'lista-cron:moolahEmissionWeeklySnapshot',
        data: { name: 'moolahEmissionWeeklySnapshot', repo: 'lista-cron',
                filePath: 'src/modules/moolah/emission.service.ts', lineNo: 42,
                handlerClass: 'MoolahEmissionService', confidence: 1.0 } }
    ],
    edges: [
      { sourceType: 'cron', sourceKey: 'lista-cron:moolahEmissionWeeklySnapshot',
        targetType: 'domain', targetKey: 'moolah', linkType: 'BELONGS_TO', confidence: 0.6 }
    ],
    brokenRefs: []
  }];
}

async function clean() {
  const pool = getPool();
  for (const t of ['panorama_cron_job', 'panorama_knowledge_doc', 'panorama_business_domain', 'panorama_ref_link', 'panorama_code_ref']) {
    await pool.query(`DELETE FROM \`${t}\``);
  }
}

describe('loader', () => {
  beforeEach(clean);
  afterAll(closePool);

  it('writes all 3 domains, 1 doc, 1 cron after loadGraph', async () => {
    const merged = runOrchestrator(fixture());
    const buildId = await loadGraph({ merged, buildId: 'test-' + Date.now(), triggerType: 'manual' });
    expect(buildId).toMatch(/^test-/);

    const pool = getPool();
    const [d] = await pool.query<any[]>('SELECT COUNT(*) c FROM panorama_business_domain');
    expect(d[0].c).toBe(2);
    const [doc] = await pool.query<any[]>('SELECT COUNT(*) c FROM panorama_knowledge_doc');
    expect(doc[0].c).toBe(1);
    const [c] = await pool.query<any[]>('SELECT COUNT(*) c FROM panorama_cron_job');
    expect(c[0].c).toBe(1);
  });

  it('domain parent_id resolves correctly after swap', async () => {
    const merged = runOrchestrator(fixture());
    await loadGraph({ merged, buildId: 'test-' + Date.now(), triggerType: 'manual' });

    const pool = getPool();
    const [rows] = await pool.query<any[]>(`
      SELECT child.name AS child, parent.name AS parent
      FROM panorama_business_domain child
      LEFT JOIN panorama_business_domain parent ON parent.id = child.parent_id
      WHERE child.name = 'emission'
    `);
    expect(rows[0]).toMatchObject({ child: 'emission', parent: 'moolah' });
  });

  it('writes a build_meta row with status=success and ingestor stats', async () => {
    const merged = runOrchestrator(fixture());
    const buildId = 'test-' + Date.now();
    await loadGraph({ merged, buildId, triggerType: 'manual' });

    const pool = getPool();
    const [rows] = await pool.query<any[]>(`SELECT status, stats_json FROM panorama_build_meta WHERE build_id = ?`, [buildId]);
    expect(rows[0].status).toBe('success');
    const stats = typeof rows[0].stats_json === 'string' ? JSON.parse(rows[0].stats_json) : rows[0].stats_json;
    expect(stats.knowledge.nodes).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
pnpm test loader.test.ts
```

Expected: 3 failures with `Cannot find module '../src/loader.js'`.

- [ ] **Step 3: Commit failing tests**

```bash
git add panorama/ingestion/__tests__/loader.test.ts
git commit -m "test(panorama-ingestion): loader failing tests (staging swap + build_meta)"
```

---

### Task 18: Advisory lock helper

**Files:**
- Create: `panorama/ingestion/src/lock.ts`

- [ ] **Step 1: Implement lock helper**

Write `ingestion/src/lock.ts`:

```ts
import type { Pool } from 'mysql2/promise';

const LOCK_NAME = 'panorama_rebuild';

/** Try to acquire MySQL advisory lock with 0s timeout. Returns true if acquired. */
export async function tryLock(pool: Pool): Promise<boolean> {
  const [rows] = await pool.query<any[]>('SELECT GET_LOCK(?, 0) AS got', [LOCK_NAME]);
  return rows[0]?.got === 1;
}

export async function releaseLock(pool: Pool): Promise<void> {
  await pool.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
}

export async function withLock<T>(pool: Pool, fn: () => Promise<T>): Promise<T> {
  const got = await tryLock(pool);
  if (!got) throw new Error('Another rebuild is in progress (advisory lock held)');
  try { return await fn(); }
  finally { await releaseLock(pool); }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /Users/quansong/Documents/code/panorama/ingestion
pnpm build:check
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add panorama/ingestion/src/lock.ts
git commit -m "feat(panorama-ingestion): MySQL advisory lock helper (GET_LOCK/RELEASE_LOCK)"
```

---

### Task 19: Loader implementation — staging swap

**Files:**
- Create: `panorama/ingestion/src/loader.ts`

- [ ] **Step 1: Implement loader**

Write `ingestion/src/loader.ts`:

```ts
import type { Connection, Pool, RowDataPacket } from 'mysql2/promise';
import { getPool } from './db.js';
import { withLock } from './lock.js';
import { log } from './log.js';
import type { IngestorEdge, IngestorNode } from './types.js';
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
  } catch (err: any) {
    log('error', 'load failed', { buildId: opts.buildId, error: err.message });
    await pool.query(
      `UPDATE panorama_build_meta SET status = 'failed', finished_at = ?, error_log = ? WHERE build_id = ?`,
      [new Date(), String(err?.stack ?? err), opts.buildId]
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

async function populateStagingTables(pool: Pool, merged: MergedGraph) {
  // Step 1: insert domains so we can resolve parent_id by name.
  const domains = merged.nodes.filter(n => n.type === 'domain');
  const domainIdByKey = new Map<string, number>();
  for (const d of domains) {
    const data: any = d.data;
    const [res] = await pool.query<any>(
      `INSERT INTO panorama_business_domain_new
        (name, display_name, parent_id, description, file_type, knowledge_path, sort_order)
       VALUES (?, ?, NULL, ?, ?, ?, 0)`,
      [data.name, data.displayName, data.description ?? null, data.fileType ?? null, data.knowledgePath ?? null]
    );
    domainIdByKey.set(d.key, (res as any).insertId);
  }
  // Step 2: resolve parent links now that we have IDs.
  for (const d of domains) {
    const data: any = d.data;
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
    const data: any = doc.data;
    // Resolve domain_id via DESCRIBES edge.
    const describes = merged.edges.find(
      e => e.sourceType === 'doc' && e.sourceKey === doc.key && e.linkType === 'DESCRIBES'
    );
    const domainId = describes ? domainIdByKey.get(describes.targetKey) ?? null : null;
    if (domainId === null) continue;        // skip orphan docs in Phase 1
    const [res] = await pool.query<any>(
      `INSERT INTO panorama_knowledge_doc_new
        (domain_id, path, title, last_verified, frontmatter_json, body_md_path, word_count)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?)`,
      [domainId, data.path, data.title ?? null, data.lastVerified ?? null,
       JSON.stringify(data.frontmatter ?? {}), data.bodyMdPath ?? data.path, data.wordCount ?? 0]
    );
    docIdByKey.set(doc.key, (res as any).insertId);
  }

  // Step 4: concepts + doc_concept_rel.
  const concepts = merged.nodes.filter(n => n.type === 'concept');
  const conceptIdByKey = new Map<string, number>();
  for (const c of concepts) {
    const data: any = c.data;
    const [res] = await pool.query<any>(
      `INSERT INTO panorama_concept_new (name, aliases_json) VALUES (?, CAST(? AS JSON))`,
      [data.name, JSON.stringify(data.aliases ?? [])]
    );
    conceptIdByKey.set(c.key, (res as any).insertId);
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
    const data: any = cr.data;
    const [res] = await pool.query<any>(
      `INSERT INTO panorama_code_ref_new (repo, file_path, line_no, snippet) VALUES (?, ?, ?, NULL)`,
      [data.repo, data.filePath, data.lineNo ?? null]
    );
    codeRefIdByKey.set(cr.key, (res as any).insertId);
  }

  // Step 6: cron jobs (resolve domain_id via authoritative BELONGS_TO; fall back to heuristic).
  const crons = merged.nodes.filter(n => n.type === 'cron');
  const cronIdByKey = new Map<string, number>();
  for (const c of crons) {
    const data: any = c.data;
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

    const [res] = await pool.query<any>(
      `INSERT INTO panorama_cron_job_new
        (domain_id, name, schedule, job_id, repo, file_path, line_no, handler_class, description, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [domainId, data.name, data.schedule ?? null, data.jobId ?? null,
       data.repo, data.filePath, data.lineNo ?? null,
       data.handlerClass ?? null, data.description ?? null,
       winner?.confidence ?? data.confidence ?? 1.0]
    );
    cronIdByKey.set(c.key, (res as any).insertId);
  }

  // Step 7: ref_link — generic relations (DESCRIBES, REFERENCES, BELONGS_TO, MENTIONS).
  const polyId = (type: string, key: string): number | null => {
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
  // Single ALTER swap is atomic per MySQL docs.
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
```

- [ ] **Step 2: Run loader tests against the real DB**

```bash
cd /Users/quansong/Documents/code/panorama/ingestion
cp ../.env.example .env
# add MYSQL_PASSWORD and REPOS_PATH
pnpm test loader.test.ts
```

Expected: 3 tests pass. Each takes ~1–2 seconds against the remote DB.

If you see `ER_NO_SUCH_TABLE` for `panorama_*_new`, ensure migrations 001–005 are applied (run `pnpm --filter migrations run apply` from the workspace root).

- [ ] **Step 3: Verify atomicity by killing mid-write**

```bash
# Open two terminals.
# Term 1: run loader test that intentionally fails
node --import tsx -e "
import { runOrchestrator } from './src/orchestrator.js';
import { loadGraph } from './src/loader.js';
const merged = runOrchestrator([{
  ingestor: 'broken',
  nodes: [{ type: 'domain', key: 'x', data: { name: 'x', displayName: 'X', parentKey: 'NONEXISTENT' } }],
  edges: [],
  brokenRefs: []
}]);
try { await loadGraph({ merged, buildId: 'fail-' + Date.now(), triggerType: 'manual' }); }
catch (e) { console.log('Caught:', e.message); }
"
# Verify the live tables are still readable and unchanged.
mysql -h <host> -u bijieprd -p lista-qa -e "SHOW TABLES LIKE 'panorama_%_new';"
```

Expected: `SHOW TABLES` returns 0 `_new` rows (cleanup ran). Original tables untouched.

- [ ] **Step 4: Commit**

```bash
git add panorama/ingestion/src/loader.ts
git commit -m "feat(panorama-ingestion): loader (staging swap + advisory lock + build_meta)"
```

---

### Task 20: End-to-end pipeline integration test

**Files:**
- Create: `panorama/ingestion/__tests__/pipeline.integration.test.ts`

- [ ] **Step 1: Write integration test using real fixture trees**

Write `__tests__/pipeline.integration.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { ingestKnowledge } from '../src/ingestors/knowledge.js';
import { ingestCron } from '../src/ingestors/cron.js';
import { runOrchestrator } from '../src/orchestrator.js';
import { detectBrokenRefs } from '../src/broken-refs.js';
import { loadGraph } from '../src/loader.js';
import { getPool, closePool } from '../src/db.js';

describe('full pipeline (knowledge + cron → MySQL)', () => {
  afterAll(closePool);

  it('runs end-to-end on combined fixtures and produces queryable results', async () => {
    const knowledgeOut = await ingestKnowledge({
      knowledgeRoot: join(__dirname, 'fixtures/knowledge')
    });
    const cronOut = await ingestCron({
      reposPath: join(__dirname, 'fixtures/cron'),
      repos: ['lista-cron', 'lista-bot']
    });
    const merged = runOrchestrator([knowledgeOut, cronOut]);
    merged.brokenRefs.push(...await detectBrokenRefs({
      nodes: merged.nodes,
      reposPath: join(__dirname, 'fixtures/cron')
    }));

    const buildId = 'integ-' + Date.now();
    await loadGraph({ merged, buildId, triggerType: 'manual' });

    const pool = getPool();
    const [crons] = await pool.query<any[]>(`
      SELECT cj.name, bd.name AS domain
      FROM panorama_cron_job cj
      LEFT JOIN panorama_business_domain bd ON bd.id = cj.domain_id
      WHERE cj.repo = 'lista-cron'
    `);
    expect(crons.length).toBeGreaterThanOrEqual(2);
    expect(crons.find((r: any) => r.name === 'moolahEmissionWeeklySnapshot')?.domain).toMatch(/moolah/);
  });
});
```

- [ ] **Step 2: Run — should pass**

```bash
pnpm test pipeline.integration.test.ts
```

Expected: 1 test passes in ~3–5 seconds.

- [ ] **Step 3: Commit**

```bash
git add panorama/ingestion/__tests__/pipeline.integration.test.ts
git commit -m "test(panorama-ingestion): full pipeline integration test"
```

---

### Task 21: CLI — `pnpm rebuild`

**Files:**
- Create: `panorama/ingestion/src/cli.ts`

- [ ] **Step 1: Wire CLI**

Write `ingestion/src/cli.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { ingestKnowledge } from './ingestors/knowledge.js';
import { ingestCron } from './ingestors/cron.js';
import { runOrchestrator } from './orchestrator.js';
import { detectBrokenRefs } from './broken-refs.js';
import { loadGraph } from './loader.js';
import { closePool } from './db.js';
import { loadEnv } from './env.js';
import { log } from './log.js';

async function rebuild() {
  const env = loadEnv();
  const buildId = randomUUID();
  const triggerType = (process.env.TRIGGER_TYPE === 'cron' ? 'cron' : 'manual') as 'cron' | 'manual';
  const triggeredBy = process.env.TRIGGERED_BY ?? process.env.USER ?? 'unknown';

  log('info', 'rebuild start', { buildId, triggerType, triggeredBy });

  const knowledgeOut = await ingestKnowledge({
    knowledgeRoot: `${env.reposPath}/lista-knowledge`
  });
  log('info', 'knowledge done', { nodes: knowledgeOut.nodes.length, edges: knowledgeOut.edges.length });

  const cronOut = await ingestCron({
    reposPath: env.reposPath,
    repos: ['lista-cron', 'lista-bot']
  });
  log('info', 'cron done', { nodes: cronOut.nodes.length, edges: cronOut.edges.length });

  const merged = runOrchestrator([knowledgeOut, cronOut]);
  merged.brokenRefs.push(...await detectBrokenRefs({
    nodes: merged.nodes, reposPath: env.reposPath
  }));
  log('info', 'orchestrate done', { brokenRefs: merged.brokenRefs.length });

  await loadGraph({ merged, buildId, triggerType, triggeredBy });
  log('info', 'rebuild ok', { buildId, durationMsApprox: 'see build_meta.duration_ms' });
}

const cmd = process.argv[2];
try {
  if (cmd === 'rebuild') await rebuild();
  else { console.log('Usage: pnpm rebuild'); process.exit(1); }
} catch (err: any) {
  log('error', 'rebuild failed', { error: err.message, stack: err.stack });
  process.exit(2);
} finally {
  await closePool();
}
```

- [ ] **Step 2: Run end-to-end against real repos**

```bash
cd /Users/quansong/Documents/code/panorama/ingestion
pnpm rebuild
```

Expected (timing rough — your machine, network to AWS RDS):
- `knowledge done`: 1–3 sec (≈49 docs)
- `cron done`: 30–90 sec (lista-cron has ≈315 service files)
- `orchestrate done`: <1 sec
- Final write: 5–20 sec

Verify in MySQL:

```bash
mysql -h <host> -u bijieprd -p lista-qa -e "
SELECT
  (SELECT COUNT(*) FROM panorama_business_domain) AS domains,
  (SELECT COUNT(*) FROM panorama_knowledge_doc) AS docs,
  (SELECT COUNT(*) FROM panorama_concept) AS concepts,
  (SELECT COUNT(*) FROM panorama_cron_job) AS crons,
  (SELECT COUNT(*) FROM panorama_code_ref) AS code_refs,
  (SELECT COUNT(*) FROM panorama_ref_link) AS ref_links;
"
```

Expected (orders of magnitude per PRD):
- domains: 50–80
- docs: ~49
- concepts: 100–300
- crons: 280–320
- code_refs: 50–500
- ref_links: 500–2000

If any number is 0, debug the corresponding ingestor before proceeding.

- [ ] **Step 3: Commit**

```bash
git add panorama/ingestion/src/cli.ts
git commit -m "feat(panorama-ingestion): pnpm rebuild CLI (knowledge + cron pipeline)"
```

---

### Task 22: Webapp scaffold (Next.js 14 + Tailwind)

**Files:**
- Create: `panorama/webapp/package.json`
- Create: `panorama/webapp/tsconfig.json`
- Create: `panorama/webapp/next.config.js`
- Create: `panorama/webapp/tailwind.config.ts`
- Create: `panorama/webapp/postcss.config.js`
- Create: `panorama/webapp/app/layout.tsx`
- Create: `panorama/webapp/app/page.tsx`
- Create: `panorama/webapp/app/globals.css`
- Create: `panorama/webapp/lib/db.ts`
- Create: `panorama/webapp/app/api/health/route.ts`

- [ ] **Step 1: Initialise package**

Write `webapp/package.json`:

```json
{
  "name": "@panorama/webapp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "next": "14.2.5",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "mysql2": "^3.11.0",
    "react-arborist": "^3.4.0",
    "mermaid": "^10.9.1",
    "marked": "^14.0.0",
    "clsx": "^2.1.1",
    "tailwindcss": "^3.4.7",
    "postcss": "^8.4.40",
    "autoprefixer": "^10.4.19"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.0"
  }
}
```

Write `webapp/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "module": "esnext",
    "moduleResolution": "bundler",
    "noEmit": true,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Write `webapp/next.config.js`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { serverComponentsExternalPackages: ['mysql2'] }
};
module.exports = nextConfig;
```

Write `webapp/tailwind.config.ts`:

```ts
import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#8378FF', glow: 'rgba(131,120,255,0.40)' },
        bg: { DEFAULT: '#141522', 1: '#1C1D2C', 2: '#25273A', 3: '#303248' },
        text: { DEFAULT: '#F4F5FC', 2: '#C4C7DB', 3: '#888BA4' },
        type: {
          ui: '#5BC0DE', api: '#5DE090', cron: '#FFB840',
          contract: '#F87171', db: '#B19DFF', redis: '#F58BC2'
        }
      },
      fontFamily: { sans: ['Inter', 'system-ui'], mono: ['JetBrains Mono', 'monospace'] }
    }
  },
  plugins: []
} satisfies Config;
```

Write `webapp/postcss.config.js`:

```js
module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

Write `webapp/app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root { color-scheme: dark; }
html, body { background: #141522; color: #F4F5FC; }
```

Write `webapp/app/layout.tsx`:

```tsx
import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Panorama', description: 'Lista DAO 业务全景图' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="font-sans">
        <div className="flex h-screen">
          <aside className="w-80 bg-bg-1 border-r border-bg-3 overflow-y-auto" id="sidebar">
            {/* Tree mounts here in Task 24 */}
          </aside>
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
```

Write `webapp/app/page.tsx`:

```tsx
export default function Home() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Panorama</h1>
      <p className="text-text-2 mt-2">Lista DAO 业务全景图 — 选择左侧业务域查看详情。</p>
    </div>
  );
}
```

Write `webapp/lib/db.ts`:

```ts
import 'server-only';
import mysql, { type Pool } from 'mysql2/promise';

let pool: Pool | null = null;
export function getPool(): Pool {
  if (pool) return pool;
  const required = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'] as const;
  for (const k of required) if (!process.env[k]) throw new Error(`Missing env ${k}`);
  pool = mysql.createPool({
    host: process.env.MYSQL_HOST!,
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER!,
    password: process.env.MYSQL_PASSWORD!,
    database: process.env.MYSQL_DATABASE!,
    connectionLimit: 8,
    timezone: 'Z'
  });
  return pool;
}
```

Write `webapp/app/api/health/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [rows] = await getPool().query('SELECT 1 AS ok');
    return NextResponse.json({ ok: true, db: rows });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
```

```bash
cd /Users/quansong/Documents/code/panorama && pnpm install
```

- [ ] **Step 2: Verify webapp boots**

```bash
cd /Users/quansong/Documents/code/panorama/webapp
cp ../.env.example .env.local
# fill MYSQL_PASSWORD
pnpm dev
```

Open `http://localhost:3000/api/health` in a browser. Expected JSON: `{"ok":true,"db":[{"ok":1}]}`.
Open `http://localhost:3000/` — should show the dark "Panorama" landing.

Stop with Ctrl-C.

- [ ] **Step 3: Commit**

```bash
git add panorama/webapp
git commit -m "feat(panorama-webapp): scaffold next.js + tailwind + health endpoint"
```

---

### Task 23: GET /api/tree — failing test → implementation

**Files:**
- Create: `panorama/webapp/lib/domain.ts`
- Create: `panorama/webapp/app/api/tree/route.ts`
- Create: `panorama/webapp/__tests__/api-tree.test.ts`

- [ ] **Step 1: Write the failing test**

Write `webapp/__tests__/api-tree.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fetchTreeChildren } from '../lib/domain';

describe('GET /api/tree', () => {
  it('returns top-level domains when parent_id is omitted', async () => {
    const rows = await fetchTreeChildren(null);
    const names = rows.map(r => r.name);
    expect(names).toEqual(expect.arrayContaining(['moolah']));
    for (const r of rows) {
      expect(r.parentId).toBeNull();
      expect(typeof r.id).toBe('number');
    }
  });

  it('returns sub-domains for a given parent_id', async () => {
    const top = await fetchTreeChildren(null);
    const moolah = top.find(r => r.name === 'moolah');
    expect(moolah).toBeDefined();
    const children = await fetchTreeChildren(moolah!.id);
    expect(children.length).toBeGreaterThan(0);
    expect(children.every(c => c.parentId === moolah!.id)).toBe(true);
  });

  it('flags hasChildren=true when domain has descendants', async () => {
    const top = await fetchTreeChildren(null);
    const moolah = top.find(r => r.name === 'moolah');
    expect(moolah!.hasChildren).toBe(true);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
cd /Users/quansong/Documents/code/panorama/webapp
pnpm test
```

Expected: 3 failures with `Cannot find module '../lib/domain'`.

- [ ] **Step 3: Implement query helper**

Write `webapp/lib/domain.ts`:

```ts
import 'server-only';
import { getPool } from './db';

export interface TreeRow {
  id: number;
  name: string;
  displayName: string;
  parentId: number | null;
  hasChildren: boolean;
  cronCount: number;
}

export async function fetchTreeChildren(parentId: number | null): Promise<TreeRow[]> {
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT
        d.id, d.name, d.display_name AS displayName, d.parent_id AS parentId,
        EXISTS(SELECT 1 FROM panorama_business_domain c WHERE c.parent_id = d.id) AS hasChildren,
        (SELECT COUNT(*) FROM panorama_cron_job cj WHERE cj.domain_id = d.id) AS cronCount
       FROM panorama_business_domain d
       WHERE ${parentId === null ? 'd.parent_id IS NULL' : 'd.parent_id = ?'}
       ORDER BY d.sort_order, d.name`,
    parentId === null ? [] : [parentId]
  );
  return rows.map((r: any) => ({
    id: Number(r.id),
    name: r.name,
    displayName: r.displayName,
    parentId: r.parentId === null ? null : Number(r.parentId),
    hasChildren: Boolean(r.hasChildren),
    cronCount: Number(r.cronCount)
  }));
}
```

- [ ] **Step 4: Wire route handler**

Write `webapp/app/api/tree/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { fetchTreeChildren } from '@/lib/domain';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get('parent_id');
  const parentId = raw === null || raw === '' ? null : Number(raw);
  if (parentId !== null && Number.isNaN(parentId)) {
    return NextResponse.json({ error: 'parent_id must be numeric' }, { status: 400 });
  }
  const rows = await fetchTreeChildren(parentId);
  return NextResponse.json({ data: rows });
}
```

- [ ] **Step 5: Run tests — should pass**

```bash
cd /Users/quansong/Documents/code/panorama/webapp
pnpm test
```

Expected: 3 tests pass (against the real DB seeded by Task 21).

- [ ] **Step 6: Smoke test in browser**

```bash
pnpm dev
```

`curl http://localhost:3000/api/tree` → JSON of L1 domains.
`curl 'http://localhost:3000/api/tree?parent_id=<moolah_id>'` → its children.

- [ ] **Step 7: Commit**

```bash
git add panorama/webapp/lib/domain.ts panorama/webapp/app/api/tree panorama/webapp/__tests__/api-tree.test.ts
git commit -m "feat(panorama-webapp): GET /api/tree (parent-id navigation)"
```

---

### Task 24: BusinessTree component + sidebar wiring

**Files:**
- Create: `panorama/webapp/components/BusinessTree.tsx`
- Modify: `panorama/webapp/app/layout.tsx`

- [ ] **Step 1: Implement the tree component**

Write `webapp/components/BusinessTree.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Node {
  id: number;
  name: string;
  displayName: string;
  parentId: number | null;
  hasChildren: boolean;
  cronCount: number;
  children?: Node[];   // populated lazily
  loading?: boolean;
  expanded?: boolean;
}

async function fetchChildren(parentId: number | null): Promise<Node[]> {
  const url = parentId === null ? '/api/tree' : `/api/tree?parent_id=${parentId}`;
  const res = await fetch(url, { cache: 'no-store' });
  const json = await res.json();
  return json.data;
}

export default function BusinessTree() {
  const router = useRouter();
  const [roots, setRoots] = useState<Node[]>([]);

  useEffect(() => { fetchChildren(null).then(setRoots); }, []);

  const toggle = async (node: Node) => {
    if (node.expanded) {
      node.expanded = false;
      setRoots([...roots]);
      return;
    }
    if (!node.children) {
      node.loading = true;
      setRoots([...roots]);
      node.children = await fetchChildren(node.id);
      node.loading = false;
    }
    node.expanded = true;
    setRoots([...roots]);
  };

  const renderNode = (node: Node, depth: number): React.ReactNode => (
    <li key={node.id}>
      <div
        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-2 cursor-pointer text-sm"
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {node.hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); toggle(node); }}
            className="text-text-3 w-4"
            aria-label={node.expanded ? 'collapse' : 'expand'}
          >
            {node.expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <span
          className="flex-1 truncate"
          onClick={() => router.push(`/domain/${node.id}`)}
        >
          {node.displayName}
        </span>
        {node.cronCount > 0 && (
          <span className="text-xs text-text-3 font-mono">{node.cronCount}</span>
        )}
      </div>
      {node.expanded && node.children && (
        <ul>{node.children.map((c) => renderNode(c, depth + 1))}</ul>
      )}
    </li>
  );

  return <ul className="py-2">{roots.map((n) => renderNode(n, 0))}</ul>;
}
```

> Note: We picked a hand-rolled tree over `react-arborist` for Phase 1 because lazy expand-on-click is simple here and avoids fighting the library's controlled-state model. Phase 2 may swap to `react-arborist` for keyboard nav + virtualisation if the tree grows large.

- [ ] **Step 2: Mount in layout**

Edit `webapp/app/layout.tsx` — replace the empty `<aside>` body:

```tsx
import './globals.css';
import type { Metadata } from 'next';
import BusinessTree from '@/components/BusinessTree';

export const metadata: Metadata = { title: 'Panorama', description: 'Lista DAO 业务全景图' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="font-sans">
        <div className="flex h-screen">
          <aside className="w-80 bg-bg-1 border-r border-bg-3 overflow-y-auto" id="sidebar">
            <div className="px-4 py-3 border-b border-bg-3 text-sm font-semibold">Lista DAO</div>
            <BusinessTree />
          </aside>
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Boot and verify**

```bash
pnpm dev
```

Open `http://localhost:3000/`. Expected:
- Sidebar lists all L1 domains (moolah, staking, cdp, ...).
- Click `▸` on Moolah → expands to show emission, liquidation, etc.
- Click on a domain name → navigates to `/domain/<id>` (404 page for now; populated in Task 26).

- [ ] **Step 4: Commit**

```bash
git add panorama/webapp/components/BusinessTree.tsx panorama/webapp/app/layout.tsx
git commit -m "feat(panorama-webapp): BusinessTree (lazy expand from /api/tree)"
```

---

### Task 25: GET /api/domain/[id] — failing test → implementation

**Files:**
- Create: `panorama/webapp/__tests__/api-domain.test.ts`
- Create: `panorama/webapp/app/api/domain/[id]/route.ts`
- Modify: `panorama/webapp/lib/domain.ts`

- [ ] **Step 1: Write failing test**

Write `webapp/__tests__/api-domain.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fetchDomainDetail, fetchTreeChildren } from '../lib/domain';

describe('GET /api/domain/{id}', () => {
  it('returns domain row + doc + cron list + stats', async () => {
    const top = await fetchTreeChildren(null);
    const moolah = top.find(r => r.name === 'moolah')!;
    const children = await fetchTreeChildren(moolah.id);
    const emission = children.find(c => c.name === 'emission');
    if (!emission) throw new Error('test data missing — run pnpm rebuild first');

    const detail = await fetchDomainDetail(emission.id);
    expect(detail.domain.name).toBe('emission');
    expect(detail.docs.length).toBeGreaterThanOrEqual(1);
    expect(detail.docs[0]).toHaveProperty('frontmatter');
    expect(detail.crons.length).toBeGreaterThanOrEqual(1);
    expect(detail.stats).toMatchObject({
      cronCount: expect.any(Number),
      apiCount: expect.any(Number),       // 0 in Phase 1
      contractCount: expect.any(Number),  // 0 in Phase 1
      storageCount: expect.any(Number)    // 0 in Phase 1
    });
  });

  it('returns null for non-existent id', async () => {
    const detail = await fetchDomainDetail(99_999_999);
    expect(detail).toBeNull();
  });
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
pnpm test api-domain.test.ts
```

Expected: FAIL — `fetchDomainDetail` not exported.

- [ ] **Step 3: Implement query helper**

Append to `webapp/lib/domain.ts`:

```ts
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
  apiCount: number;       // Phase 2
  contractCount: number;  // Phase 2
  storageCount: number;   // Phase 2 (entities + redis)
}

export interface DomainDetail {
  domain: { id: number; name: string; displayName: string; description: string | null; knowledgePath: string | null };
  docs: DomainDoc[];
  crons: DomainCron[];
  stats: DomainStats;
}

export async function fetchDomainDetail(id: number): Promise<DomainDetail | null> {
  const pool = getPool();
  const [domains] = await pool.query<any[]>(
    `SELECT id, name, display_name AS displayName, description, knowledge_path AS knowledgePath
       FROM panorama_business_domain WHERE id = ?`, [id]);
  if (domains.length === 0) return null;

  const [docs] = await pool.query<any[]>(
    `SELECT id, path, title, last_verified AS lastVerified, frontmatter_json AS frontmatter,
            body_md_path AS bodyMdPath, word_count AS wordCount
       FROM panorama_knowledge_doc WHERE domain_id = ? ORDER BY path`, [id]);

  const [crons] = await pool.query<any[]>(
    `SELECT id, name, schedule, job_id AS jobId, repo, file_path AS filePath, line_no AS lineNo,
            handler_class AS handlerClass, description, confidence
       FROM panorama_cron_job WHERE domain_id = ? ORDER BY name`, [id]);

  const stats: DomainStats = {
    cronCount: crons.length,
    apiCount: 0, contractCount: 0, storageCount: 0
  };

  return {
    domain: domains[0],
    docs: docs.map((d: any) => ({
      ...d,
      frontmatter: typeof d.frontmatter === 'string' ? JSON.parse(d.frontmatter) : (d.frontmatter ?? {})
    })),
    crons,
    stats
  };
}
```

- [ ] **Step 4: Wire route handler**

Write `webapp/app/api/domain/[id]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { fetchDomainDetail } from '@/lib/domain';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (Number.isNaN(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const detail = await fetchDomainDetail(id);
  if (!detail) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ data: detail });
}
```

- [ ] **Step 5: Run tests — should pass**

```bash
pnpm test api-domain.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add panorama/webapp/lib/domain.ts panorama/webapp/app/api/domain panorama/webapp/__tests__/api-domain.test.ts
git commit -m "feat(panorama-webapp): GET /api/domain/{id} (detail + stats)"
```

---

### Task 26: Domain detail page (SSR)

**Files:**
- Create: `panorama/webapp/app/domain/[id]/page.tsx`
- Create: `panorama/webapp/components/DomainDetail/HeroBlock.tsx`
- Create: `panorama/webapp/components/DomainDetail/StatsRow.tsx`
- Create: `panorama/webapp/components/DomainDetail/CronTab.tsx`
- Create: `panorama/webapp/components/DomainDetail/ImplementationTabs.tsx`

- [ ] **Step 1: Hero block**

Write `webapp/components/DomainDetail/HeroBlock.tsx`:

```tsx
import type { DomainDetail } from '@/lib/domain';

export function HeroBlock({ detail }: { detail: DomainDetail }) {
  const lastVerified = detail.docs[0]?.lastVerified ?? null;
  const concepts = (detail.docs[0]?.frontmatter as any)?.concepts ?? [];
  return (
    <header className="border-b border-bg-3 pb-4 mb-6">
      <h1 className="text-2xl font-semibold">{detail.domain.displayName}</h1>
      {detail.domain.description && (
        <p className="text-text-2 mt-2 max-w-prose">{detail.domain.description}</p>
      )}
      <div className="flex items-center gap-3 mt-3 text-sm">
        {Array.isArray(concepts) && concepts.map((c: string) => (
          <span key={c} className="px-2 py-0.5 rounded bg-bg-2 text-text-2">#{c}</span>
        ))}
        {lastVerified && (
          <span className="ml-auto text-text-3 font-mono text-xs">verified {lastVerified}</span>
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Stats row**

Write `webapp/components/DomainDetail/StatsRow.tsx`:

```tsx
import type { DomainStats } from '@/lib/domain';

interface Stat { label: string; value: number; color: string; }

export function StatsRow({ stats }: { stats: DomainStats }) {
  const cards: Stat[] = [
    { label: 'Cron Jobs', value: stats.cronCount, color: 'border-type-cron' },
    { label: 'API Endpoints', value: stats.apiCount, color: 'border-type-api' },
    { label: 'Contracts', value: stats.contractCount, color: 'border-type-contract' },
    { label: 'Storage Keys', value: stats.storageCount, color: 'border-type-db' }
  ];
  return (
    <div className="grid grid-cols-4 gap-3 mb-6">
      {cards.map(c => (
        <div key={c.label} className={`bg-bg-1 border-l-2 ${c.color} rounded px-4 py-3`}>
          <div className="text-text-3 text-xs uppercase tracking-wide">{c.label}</div>
          <div className="text-2xl font-mono mt-1">{c.value}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Cron tab**

Write `webapp/components/DomainDetail/CronTab.tsx`:

```tsx
import type { DomainCron } from '@/lib/domain';

export function CronTab({ crons }: { crons: DomainCron[] }) {
  if (crons.length === 0) return <p className="text-text-3">No cron jobs linked to this domain.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-text-3 text-xs uppercase">
        <tr><th className="text-left py-2">Name</th><th className="text-left">Schedule / Job ID</th><th className="text-left">Handler</th><th className="text-left">File</th><th>Confidence</th></tr>
      </thead>
      <tbody>
        {crons.map(c => (
          <tr key={c.id} className="border-t border-bg-3">
            <td className="py-2 font-mono">{c.name}</td>
            <td className="font-mono text-text-2">{c.jobId ?? c.schedule ?? '—'}</td>
            <td className="text-text-2">{c.handlerClass ?? '—'}</td>
            <td className="text-text-3 font-mono text-xs">{c.repo}/{c.filePath}{c.lineNo ? `:${c.lineNo}` : ''}</td>
            <td className="text-center font-mono text-xs">{c.confidence.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Tab container (only Cron populated in Phase 1)**

Write `webapp/components/DomainDetail/ImplementationTabs.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { CronTab } from './CronTab';
import type { DomainCron } from '@/lib/domain';

const TABS = [
  { id: 'ui', label: 'UI', enabled: false },
  { id: 'api', label: 'API', enabled: false },
  { id: 'cron', label: 'Cron', enabled: true },
  { id: 'contract', label: 'Contract', enabled: false },
  { id: 'db', label: 'DB', enabled: false },
  { id: 'redis', label: 'Redis', enabled: false }
] as const;

export function ImplementationTabs({ crons }: { crons: DomainCron[] }) {
  const [active, setActive] = useState<typeof TABS[number]['id']>('cron');
  return (
    <section>
      <div className="flex border-b border-bg-3 mb-4">
        {TABS.map(t => (
          <button
            key={t.id}
            disabled={!t.enabled}
            onClick={() => setActive(t.id)}
            className={`px-4 py-2 text-sm border-b-2 transition-colors ${
              active === t.id ? 'border-primary text-text' : 'border-transparent text-text-3 hover:text-text-2'
            } ${!t.enabled ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {t.label}{!t.enabled && ' (Phase 2)'}
          </button>
        ))}
      </div>
      {active === 'cron' && <CronTab crons={crons} />}
    </section>
  );
}
```

- [ ] **Step 5: Wire the page**

Write `webapp/app/domain/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { fetchDomainDetail } from '@/lib/domain';
import { HeroBlock } from '@/components/DomainDetail/HeroBlock';
import { StatsRow } from '@/components/DomainDetail/StatsRow';
import { ImplementationTabs } from '@/components/DomainDetail/ImplementationTabs';

export const dynamic = 'force-dynamic';

export default async function DomainPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (Number.isNaN(id)) notFound();
  const detail = await fetchDomainDetail(id);
  if (!detail) notFound();

  return (
    <article>
      <HeroBlock detail={detail} />
      <StatsRow stats={detail.stats} />
      <ImplementationTabs crons={detail.crons} />
    </article>
  );
}
```

- [ ] **Step 6: Boot and verify**

```bash
pnpm dev
```

Open `http://localhost:3000/`, click Moolah → Emission. Expected:
- Hero shows "Emission" + frontmatter concepts as tags + verified date.
- Stats row shows Cron count > 0, others 0.
- Implementation Tabs default to Cron with the cron-job table populated.

- [ ] **Step 7: Commit**

```bash
git add panorama/webapp/app/domain panorama/webapp/components/DomainDetail
git commit -m "feat(panorama-webapp): domain detail page (hero + stats + cron tab)"
```

---

### Task 27: Markdown body rendering + KnowledgeMermaid

**Files:**
- Create: `panorama/webapp/lib/markdown.ts`
- Create: `panorama/webapp/components/DomainDetail/KnowledgeMermaid.tsx`
- Modify: `panorama/webapp/app/domain/[id]/page.tsx`

- [ ] **Step 1: Server-side markdown renderer**

Write `webapp/lib/markdown.ts`:

```ts
import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { marked } from 'marked';

const REPOS_PATH = process.env.REPOS_PATH ?? '/var/repos';

/**
 * Read a markdown body from lista-knowledge by relative path (e.g. "business/moolah/emission.md")
 * and return both the rendered HTML for prose and the raw fenced ```mermaid blocks for client-side render.
 */
export async function loadMarkdown(relPath: string): Promise<{ html: string; mermaidBlocks: string[] }> {
  const abs = join(REPOS_PATH, 'lista-knowledge', relPath);
  const raw = await readFile(abs, 'utf8');
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '');     // strip frontmatter

  const mermaidBlocks: string[] = [];
  const stripped = body.replace(/```mermaid\n([\s\S]*?)```/g, (_m, code) => {
    const idx = mermaidBlocks.length;
    mermaidBlocks.push(code);
    return `<div data-mermaid-placeholder="${idx}"></div>`;
  });

  marked.setOptions({ gfm: true, breaks: false });
  const html = await marked.parse(stripped);
  return { html, mermaidBlocks };
}
```

- [ ] **Step 2: Mermaid client component (lazy)**

Write `webapp/components/DomainDetail/KnowledgeMermaid.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';

export function KnowledgeMermaid({ html, mermaidBlocks }: { html: string; mermaidBlocks: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || !containerRef.current) return;
    let mounted = true;
    (async () => {
      const mermaid = (await import('mermaid')).default;
      mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
      const placeholders = containerRef.current!.querySelectorAll('[data-mermaid-placeholder]');
      for (const ph of Array.from(placeholders)) {
        const idx = Number(ph.getAttribute('data-mermaid-placeholder'));
        const code = mermaidBlocks[idx];
        if (!code) continue;
        try {
          const { svg } = await mermaid.render(`mmd-${idx}-${Date.now()}`, code);
          if (mounted) ph.innerHTML = svg;
        } catch (err: any) {
          ph.innerHTML = `<pre class="text-type-contract">mermaid render failed: ${err.message}</pre>`;
        }
      }
    })();
    return () => { mounted = false; };
  }, [open, mermaidBlocks]);

  return (
    <details className="mt-6 border border-bg-3 rounded" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer px-4 py-2 select-none text-sm font-medium">完整业务文档（含手写 Mermaid 流程图）</summary>
      <div
        ref={containerRef}
        className="p-4 prose prose-invert max-w-none"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </details>
  );
}
```

> Tailwind typography: install only if needed — for Phase 1 the inherited `prose` styles are optional. If `prose` classes look unstyled, add `@tailwindcss/typography` to webapp/package.json and to plugins in tailwind.config.ts.

- [ ] **Step 3: Wire into page**

Edit `webapp/app/domain/[id]/page.tsx` to load + render the first doc body:

```tsx
import { notFound } from 'next/navigation';
import { fetchDomainDetail } from '@/lib/domain';
import { loadMarkdown } from '@/lib/markdown';
import { HeroBlock } from '@/components/DomainDetail/HeroBlock';
import { StatsRow } from '@/components/DomainDetail/StatsRow';
import { ImplementationTabs } from '@/components/DomainDetail/ImplementationTabs';
import { KnowledgeMermaid } from '@/components/DomainDetail/KnowledgeMermaid';

export const dynamic = 'force-dynamic';

export default async function DomainPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (Number.isNaN(id)) notFound();
  const detail = await fetchDomainDetail(id);
  if (!detail) notFound();

  let body: { html: string; mermaidBlocks: string[] } | null = null;
  if (detail.docs[0]?.bodyMdPath) {
    body = await loadMarkdown(detail.docs[0].bodyMdPath).catch(() => null);
  }

  return (
    <article>
      <HeroBlock detail={detail} />
      <StatsRow stats={detail.stats} />
      <ImplementationTabs crons={detail.crons} />
      {body && <KnowledgeMermaid html={body.html} mermaidBlocks={body.mermaidBlocks} />}
    </article>
  );
}
```

- [ ] **Step 4: Boot and verify**

```bash
pnpm dev
```

Visit `/domain/<emission_id>`. Expand "完整业务文档" → markdown renders, mermaid blocks become SVG diagrams.

- [ ] **Step 5: Commit**

```bash
git add panorama/webapp/lib/markdown.ts panorama/webapp/components/DomainDetail/KnowledgeMermaid.tsx panorama/webapp/app/domain/[id]/page.tsx
git commit -m "feat(panorama-webapp): markdown body + lazy mermaid render"
```

---

### Task 28: GET /api/build/latest + sync indicator

**Files:**
- Create: `panorama/webapp/app/api/build/latest/route.ts`
- Create: `panorama/webapp/components/SyncIndicator.tsx`
- Modify: `panorama/webapp/app/layout.tsx`

- [ ] **Step 1: Route handler**

Write `webapp/app/api/build/latest/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [rows] = await getPool().query<any[]>(
    `SELECT build_id AS buildId, status, started_at AS startedAt, finished_at AS finishedAt,
            duration_ms AS durationMs, trigger_type AS triggerType, stats_json AS statsJson
       FROM panorama_build_meta WHERE status = 'success' ORDER BY started_at DESC LIMIT 1`
  );
  return NextResponse.json({ data: rows[0] ?? null });
}
```

- [ ] **Step 2: SyncIndicator component**

Write `webapp/components/SyncIndicator.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';

interface BuildMeta {
  buildId: string; status: string; startedAt: string; finishedAt: string | null;
  durationMs: number | null; triggerType: string;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function SyncIndicator() {
  const [meta, setMeta] = useState<BuildMeta | null>(null);
  useEffect(() => {
    fetch('/api/build/latest', { cache: 'no-store' })
      .then(r => r.json()).then(j => setMeta(j.data));
  }, []);
  if (!meta) return <span className="text-text-3 text-xs">—</span>;
  return (
    <span className="text-xs text-text-2 font-mono">
      <span className="text-type-api">●</span> Synced {relativeTime(meta.finishedAt ?? meta.startedAt)}
    </span>
  );
}
```

- [ ] **Step 3: Mount in layout header**

Edit `webapp/app/layout.tsx` — wrap main content with header bar:

```tsx
import './globals.css';
import type { Metadata } from 'next';
import BusinessTree from '@/components/BusinessTree';
import { SyncIndicator } from '@/components/SyncIndicator';

export const metadata: Metadata = { title: 'Panorama', description: 'Lista DAO 业务全景图' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="font-sans">
        <div className="flex h-screen flex-col">
          <header className="h-12 border-b border-bg-3 px-4 flex items-center gap-4 bg-bg-1">
            <span className="font-semibold">Panorama</span>
            <SyncIndicator />
          </header>
          <div className="flex flex-1 overflow-hidden">
            <aside className="w-80 bg-bg-1 border-r border-bg-3 overflow-y-auto">
              <BusinessTree />
            </aside>
            <main className="flex-1 overflow-y-auto p-6">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Verify**

```bash
pnpm dev
```

Header should show `● Synced Xm ago` based on the most recent successful build.

- [ ] **Step 5: Commit**

```bash
git add panorama/webapp/app/api/build panorama/webapp/components/SyncIndicator.tsx panorama/webapp/app/layout.tsx
git commit -m "feat(panorama-webapp): /api/build/latest + sync indicator in header"
```

---

### Task 29: Basic-auth middleware

**Files:**
- Create: `panorama/webapp/middleware.ts`

- [ ] **Step 1: Implement middleware**

Write `webapp/middleware.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';

const REALM = 'Panorama (internal)';

function unauthorized(): NextResponse {
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': `Basic realm="${REALM}"` }
  });
}

export function middleware(req: NextRequest): NextResponse | undefined {
  // Skip when basic auth not configured (e.g. local dev where envs are unset).
  const expectedUser = process.env.BASIC_AUTH_USER;
  const expectedPass = process.env.BASIC_AUTH_PASS;
  if (!expectedUser || !expectedPass) return NextResponse.next();

  // Skip health check so K8s probes don't need creds.
  if (req.nextUrl.pathname === '/api/health') return NextResponse.next();

  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Basic ')) return unauthorized();

  let decoded: string;
  try { decoded = atob(auth.slice('Basic '.length)); }
  catch { return unauthorized(); }

  const [user, pass] = decoded.split(':');
  if (user !== expectedUser || pass !== expectedPass) return unauthorized();

  return NextResponse.next();
}

export const config = {
  // Apply to everything except Next.js internals + static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
```

- [ ] **Step 2: Verify behaviour**

```bash
# In webapp/.env.local: leave BASIC_AUTH_USER / BASIC_AUTH_PASS blank for unprotected local dev.
pnpm dev
curl -i http://localhost:3000/  # → 200 OK (no auth required)

# Now turn it on
echo 'BASIC_AUTH_USER=panorama' >> .env.local
echo 'BASIC_AUTH_PASS=local-test' >> .env.local
# restart dev server
curl -i http://localhost:3000/  # → 401 Authentication required
curl -i -u panorama:local-test http://localhost:3000/  # → 200 OK
curl -i http://localhost:3000/api/health  # → 200 OK (bypasses auth)
```

Expected: 401 without creds; 200 with correct creds; health bypass works for probes.

- [ ] **Step 3: Commit**

```bash
git add panorama/webapp/middleware.ts
git commit -m "feat(panorama-webapp): basic-auth middleware (env-gated, /api/health bypass)"
```

---

### Task 30: docker-compose for local development

**Files:**
- Create: `panorama/docker-compose.yml`
- Create: `panorama/webapp/Dockerfile`
- Create: `panorama/ingestion/Dockerfile`
- Create: `panorama/.dockerignore`

- [ ] **Step 1: Webapp Dockerfile**

Write `webapp/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.6
FROM node:20-alpine AS deps
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY webapp/package.json webapp/
RUN pnpm install --frozen-lockfile --filter @panorama/webapp...

FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY --from=deps /repo /repo
COPY webapp/ webapp/
RUN pnpm --filter @panorama/webapp build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/webapp/.next ./.next
COPY --from=build /repo/webapp/public ./public
COPY --from=build /repo/webapp/package.json ./package.json
COPY --from=build /repo/node_modules ./node_modules
EXPOSE 3000
CMD ["node_modules/.bin/next", "start"]
```

- [ ] **Step 2: Ingestion Dockerfile**

Write `ingestion/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.6
FROM node:20-alpine
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY ingestion/package.json ingestion/
RUN pnpm install --frozen-lockfile --filter @panorama/ingestion...
COPY ingestion/ ingestion/
WORKDIR /repo/ingestion
ENV TRIGGER_TYPE=cron
CMD ["pnpm", "rebuild"]
```

- [ ] **Step 3: docker-compose**

Write `docker-compose.yml`:

```yaml
version: '3.8'
services:
  webapp:
    build:
      context: .
      dockerfile: webapp/Dockerfile
    ports: ["3000:3000"]
    environment:
      MYSQL_HOST: ${MYSQL_HOST}
      MYSQL_PORT: ${MYSQL_PORT}
      MYSQL_USER: ${MYSQL_USER}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
      MYSQL_DATABASE: ${MYSQL_DATABASE}
      REPOS_PATH: /var/repos
      BASIC_AUTH_USER: ${BASIC_AUTH_USER}
      BASIC_AUTH_PASS: ${BASIC_AUTH_PASS}
    volumes:
      - ${REPOS_PATH}:/var/repos:ro

  ingestion:
    build:
      context: .
      dockerfile: ingestion/Dockerfile
    profiles: ["build"]
    environment:
      MYSQL_HOST: ${MYSQL_HOST}
      MYSQL_PORT: ${MYSQL_PORT}
      MYSQL_USER: ${MYSQL_USER}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
      MYSQL_DATABASE: ${MYSQL_DATABASE}
      REPOS_PATH: /var/repos
      TRIGGER_TYPE: manual
    volumes:
      - ${REPOS_PATH}:/var/repos:ro
```

Write `.dockerignore`:

```
node_modules
.next
.git
.env*
!.env.example
**/__tests__
**/*.test.ts
coverage
docs
design
```

- [ ] **Step 4: Verify build + run**

```bash
cd /Users/quansong/Documents/code/panorama
docker compose build webapp
docker compose up webapp -d
curl http://localhost:3000/api/health
docker compose logs webapp | tail -20
docker compose down
```

Expected: image builds in ~3–5 minutes; `health` returns OK; logs show no errors.

```bash
# One-shot ingestion via compose:
docker compose --profile build run --rm ingestion
```

Expected: same output as `pnpm rebuild` from Task 21 — completes in 2–3 min and writes a fresh build_meta row.

- [ ] **Step 5: Commit**

```bash
git add panorama/docker-compose.yml panorama/webapp/Dockerfile panorama/ingestion/Dockerfile panorama/.dockerignore
git commit -m "chore(panorama): docker-compose for local dev (webapp + ingestion profile)"
```

---

### Task 31: README + dev quickstart

**Files:**
- Modify: `panorama/README.md` (already exists; replace dev section)

- [ ] **Step 1: Append a Phase 1 quickstart**

Edit `panorama/README.md` — under the existing "## 开发起步" heading, replace the contents with:

````markdown
## 开发起步 (Phase 1)

### 一次性 setup

```bash
# 1. 安装依赖
cd panorama
pnpm install

# 2. 配置 env
cp .env.example .env
# 填入 MYSQL_PASSWORD（向 sunny.q@lista.org 索取）+ REPOS_PATH（默认 /Users/quansong/Documents/code）

# 3. 创建数据库 schema（首次或拉了新 migration 后）
pnpm migrate
# 期望: "Applied: 999_migration_history.sql, 001_..., 002_..., ..."
```

### 日常开发

```bash
# 拉最新业务知识 + 代码后，重建数据
pnpm rebuild

# 启动 webapp（开发模式，热重载）
pnpm dev
# → http://localhost:3000

# 跑测试
pnpm test
```

### Docker 模式（贴近生产）

```bash
docker compose up webapp -d                    # webapp 起在 :3000
docker compose --profile build run --rm ingestion   # 一次性 ingestion
docker compose down
```

### Phase 1 验收清单

- [ ] `pnpm migrate` 应用 5 个 SQL 迁移无错
- [ ] `pnpm rebuild` 成功结束，build_meta status = success
- [ ] 访问 `/` 看到 Lista DAO 9 个业务域树
- [ ] 点击 Moolah → Emission，看到 frontmatter concepts、cron 列表、完整 markdown + mermaid 渲染
- [ ] `panorama_broken_ref` 表数量已知（作为 lista-knowledge 维护 backlog 的起点）
````

- [ ] **Step 2: Commit**

```bash
git add panorama/README.md
git commit -m "docs(panorama): Phase 1 quickstart in README"
```

---

### Task 32: Internal staging deploy + smoke

**Files:**
- Create: `panorama/scripts/deploy-staging.sh` (or document the manual flow if no infra YAML yet)

> **Why this is documentation, not code:** Phase 1 acceptance only requires a reachable internal staging — Phase 3 covers the proper K8s manifests + git-sync. For Phase 1 we either run docker compose on a designated VM, or deploy via the team's existing internal K8s namespace if one is already provisioned. Pick whichever path is reachable today.

- [ ] **Step 1: Document the chosen staging path**

Write `panorama/scripts/deploy-staging.sh` (or `deploy-staging.md` if scripted infra isn't viable yet):

```bash
#!/usr/bin/env bash
# Phase 1 staging deploy — runs on the assigned internal VM.
# Prerequisites:
#   - Docker + docker compose installed
#   - .env populated with MYSQL_*, REPOS_PATH=/var/repos, BASIC_AUTH_*
#   - /var/repos already contains lista-knowledge, lista-cron, lista-bot (cloned and kept current via crontab)

set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> pulling latest panorama"
git pull

echo "==> applying migrations"
docker compose --profile build run --rm ingestion sh -c "cd /repo/migrations && pnpm apply"

echo "==> rebuilding ingestion data"
docker compose --profile build run --rm ingestion

echo "==> deploying webapp"
docker compose up -d --build webapp

echo "==> health check"
sleep 5
curl -fsS http://localhost:3000/api/health | grep '"ok":true'
echo "OK — open https://panorama.staging.lista.internal/"
```

```bash
chmod +x panorama/scripts/deploy-staging.sh
```

- [ ] **Step 2: Run a dry deploy locally to confirm script logic**

```bash
cd /Users/quansong/Documents/code/panorama
./scripts/deploy-staging.sh
```

Expected: script completes, webapp serves on `:3000`, basic-auth gate enforced if env is set.

> **If no internal VM/staging is provisioned yet:** open a ticket per `.meta.json` "待协调清单" → "K8s namespace + ingress 申请" with DevOps. In the meantime, expose the local docker-compose to the team via the existing VPN'd workstation as a temporary demo.

- [ ] **Step 3: Commit**

```bash
git add panorama/scripts
git commit -m "chore(panorama): staging deploy script (docker-compose flow)"
```

---

### Task 33: Phase 1 acceptance verification

**Files:** none — manual verification

Run through PRD §10 Phase 1 acceptance criteria:
> "用户能从树进入 Moolah > Emission，看到完整文档 + Mermaid + cron 列表，通过 path 跳转其他业务"

- [ ] **Step 1: Fresh build from a clean DB**

```bash
cd /Users/quansong/Documents/code/panorama
mysql -h <host> -u bijieprd -p lista-qa -e "
DELETE FROM panorama_ref_link;
DELETE FROM panorama_doc_concept_rel;
DELETE FROM panorama_concept;
DELETE FROM panorama_code_ref;
DELETE FROM panorama_cron_job;
DELETE FROM panorama_knowledge_doc;
DELETE FROM panorama_business_domain;
DELETE FROM panorama_broken_ref;
DELETE FROM panorama_build_meta;
"
pnpm rebuild
```

Expected: completes in <5 min, build_meta status = success, all panorama_* tables non-empty.

- [ ] **Step 2: User-story walkthrough (PRD §4.2 S1)**

Open `http://localhost:3000/` and record observations:

```
[ ] L1 list shows: moolah, staking, cdp, governance, revenue, infrastructure, credit, rwa, operations
[ ] Expand Moolah → see emission, liquidation, supply-borrow, vault, etc.
[ ] Click Emission → URL is /domain/<id>
[ ] Hero shows "Emission" + concepts (#emission, #merkle_root, ...) + verified date
[ ] Stats cards: Cron Jobs ≥ 5; others 0
[ ] Cron tab: at least 5 rows with file:line references
[ ] Expand "完整业务文档" → markdown body renders with at least one mermaid diagram (SVG)
[ ] /api/health returns ok=true
[ ] /api/build/latest returns the build from Step 1
```

- [ ] **Step 3: Spot-check a broken_ref**

```bash
mysql -h <host> -u bijieprd -p lista-qa -e \
  "SELECT doc_path, ref_repo, ref_file_path, reason FROM panorama_broken_ref ORDER BY id DESC LIMIT 5;"
```

Expected: 0 rows or a small list of legitimately broken refs (file moved, etc.). If hundreds → the file:line regex is matching too eagerly; fix in Task 10's `extractCodeRefs`.

- [ ] **Step 4: Run all tests one more time**

```bash
pnpm -r test
```

Expected: all packages green.

- [ ] **Step 5: Tag the milestone**

```bash
git tag -a panorama-phase-1-complete -m "Phase 1 (foundation) acceptance passed"
git push origin panorama-phase-1-complete
```

- [ ] **Step 6: Update .meta.json**

Edit `panorama/.meta.json`:

```json
"phases": [
  { "id": "phase-0", "name": "设计文档", "duration_weeks": 1, "status": "completed", ... },
  { "id": "phase-1", "name": "地基", "duration_weeks": 4, "status": "completed", "deliverables": [...] },
  { "id": "phase-2", "name": "完整数据 + 流程图 + 搜索", "duration_weeks": 4, "status": "pending", ... },
  ...
],
"next_steps": [
  "Phase 2 启动: api/contract/entity/frontend/redis ingestor + React Flow + Cmd+K",
  "邀请 1 位 QA + 1 位研发试用 staging，收集反馈"
]
```

- [ ] **Step 7: Commit + demo prep**

```bash
git add panorama/.meta.json
git commit -m "chore(panorama): Phase 1 acceptance complete; advance .meta.json"
```

Schedule a Phase 1 demo per PRD §10 ("每个 Phase 末做一次 Demo + 收集反馈").

---

## Self-Review Checklist (run after writing the plan, before execution)

Already applied while writing this plan — quick recap of what was checked:

1. **Spec coverage** — Every Phase 1 deliverable from PRD §10 + tech-design §12 is covered:
   - MySQL schema migration → Tasks 2–7
   - knowledge ingestor → Tasks 9–10
   - cron ingestor → Tasks 11–12
   - 业务树 + L2 只读 → Tasks 23–27
   - orchestrator + 跨源关联策略 A + broken_refs → Tasks 13–16
   - docker-compose + staging + basic auth → Tasks 29–32
   - Phase 1 验收 → Task 33

2. **Placeholder scan** — No "TODO", no "fill in details", no "similar to Task N" without code. Phase 2 work is explicitly marked as "(Phase 2)" in tab labels and tech-design references.

3. **Type consistency** —
   - `IngestorOutput` / `IngestorNode` / `IngestorEdge` are defined in Task 8 and used unchanged in Tasks 10, 12, 14, 16, 19, 20, 21.
   - `DomainDetail` / `DomainCron` / `DomainStats` defined in Task 25 and consumed by components in Task 26.
   - `runOrchestrator` returns `MergedGraph` (defined alongside it in Task 14); the loader (Task 19) imports `MergedGraph` from `./orchestrator.js` consistently.

---

## Execution Handoff

Plan complete and saved to `panorama/docs/superpowers/plans/2026-05-01-panorama-phase-1-foundation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for a 33-task plan; review checkpoints catch drift early.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review. Better if you want to watch each step land in real time.

Which approach?
