# Panorama 业务全景图平台 — 技术设计文档

## 1. 文档信息

| 字段 | 值 |
|------|-----|
| 文档名称 | Panorama 技术设计 |
| 版本 | v0.2 |
| 状态 | 评审中（Phase 0 完成） |
| 作者 | Sunny + Claude Code |
| 创建日期 | 2026-05-01 |
| 最后更新 | 2026-05-01（v0.2: 增补 Redis 节点 / React Flow / 抽屉式详情 / Lista 品牌色） |
| 关联文档 | [01-PRD.md](./01-PRD.md)、[design/mockup.html](../design/mockup.html) |

本文是 PRD 的实现侧补充。读本文前请先阅读 PRD 确认产品诉求。

---

## 2. 系统架构图

```
┌──────────────────────────────────────────────────────────────────┐
│ 数据源层（5 个上游仓库 + 1 个知识库）                              │
│                                                                  │
│  lista-knowledge/   lista-cron/   lista-bot/                     │
│       business/        @Cron          @Cron                      │
│       onchain/         @XxlJob                                   │
│                                                                  │
│  lista-admin/       lista-mono/                                  │
│     @Controller        routerPaths.ts                            │
│     @Entity            router.tsx + API class                    │
└────────────────┬─────────────────────────────────────────────────┘
                 │ git checkout 卷挂载
                 ▼
┌──────────────────────────────────────────────────────────────────┐
│ Ingestion 层（Node.js + ts-morph）                               │
│                                                                  │
│   7 个独立 ingestor                                              │
│   ┌─────────────┐ ┌────────┐ ┌────────┐ ┌──────┐               │
│   │ knowledge   │ │ cron   │ │ api    │ │ redis│               │
│   ├─────────────┤ ├────────┤ ├────────┤ └──────┘               │
│   │ entity      │ │contract│ │frontend│                         │
│   └──────┬──────┘ └───┬────┘ └────┬───┘                         │
│          │            │           │                             │
│          └────────────┼───────────┘                             │
│                       ▼                                         │
│              Orchestrator (merge + 跨源关联)                     │
│                       │                                         │
│                       ▼                                         │
│             out/{knowledge,cron,...,redis}.json                 │
│                       │                                         │
│                       ▼                                         │
│              MySQL Loader (事务 truncate + insert)              │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│ 存储层（MySQL，复用 lista_qa 实例）                               │
│                                                                  │
│  panorama_business_domain  panorama_knowledge_doc                │
│  panorama_cron_job         panorama_api_endpoint                 │
│  panorama_entity           panorama_contract                     │
│  panorama_frontend_route   panorama_redis_key                    │
│  panorama_code_ref         panorama_ref_link                     │
│  panorama_build_meta       panorama_broken_ref                   │
└──────────────────────┬───────────────────────────────────────────┘
                       │ mysql2/promise
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│ API 层（Next.js Route Handler）                                   │
│  GET /api/tree         GET /api/node/{type}/{id}                 │
│  GET /api/source/...   GET /api/search                           │
│  POST /api/admin/rebuild                                         │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│ 前端层（Next.js 14 App Router）                                   │
│  左：业务树（react-arborist）                                     │
│  中：业务详情（Hero + 4 stats + React Flow 流程图 + 6 Tab 清单）  │
│  右：节点详情抽屉（slide-in overlay，Monaco 代码片段 + 关联）       │
└──────────────────────────────────────────────────────────────────┘
```

**关键架构决策：**

| 决策 | 选择 | 理由 |
|------|------|------|
| 存储引擎 | **MySQL（复用 lista_qa）** | 节点 < 1000，关系明确，外键即可表达；图数据库引入运维成本不划算 |
| Ingestion 模式 | **批量全量重建** | 49 文档 + 4 代码库 全量扫描估 2-3 分钟，增量复杂度爆炸 |
| 触发方式 | **Cron 调度（每日 02:00）+ UI 一键 rebuild** | 不做跨仓库 GitHub Actions（PAT/repository_dispatch 配置成本 > 收益） |
| 前端渲染 | **SSR（Next.js）+ MySQL 直查** | 数据日级别更新，SSR 简单；不需要 BFF |
| 可视化形态 | **左树 + 中流程图 + 右抽屉详情** | 树承担导航；中央 React Flow 6 lane 自动布局展示业务全链路；详情抽屉 overlay 不挤占流程图空间 |
| 流程图技术 | **React Flow + dagre**（auto-layout） | 节点用 React 组件自由定制；dagre 自动 6 lane 分层；性能足以处理 < 200 节点单业务 |
| 业务流程图 vs 知识库手写图 | **共存**：React Flow 渲染 auto-generated 图（来自 graph data，永远准确）；mermaid 渲染 lista-knowledge markdown 中的人工图（折叠面板，业务意图参考） | 两者互补：auto 图反映"代码当前是什么"，手写图反映"业务期望是什么"；漂移自动检出 |

---

## 3. 数据模型（MySQL Schema）

所有表统一加 `panorama_` 前缀，避免与 lista_qa 已有表冲突。所有时间戳字段命名 `db_create_time` / `db_modify_time`，与 `lista-cron` 现有约定保持一致。

### 3.1 业务树相关

```sql
-- 业务域树（root + 9 个 L1 + 若干 L2）
CREATE TABLE panorama_business_domain (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(100) NOT NULL,                -- moolah / emission / ...
  display_name    VARCHAR(200) NOT NULL,                -- "Moolah" / "Emission Rewards"
  parent_id       BIGINT NULL,                          -- 邻接列表，root 为 NULL
  description     TEXT NULL,
  file_type       VARCHAR(50) NULL,                     -- overview / shard / detail
  knowledge_path  VARCHAR(500) NULL,                    -- 对应 lista-knowledge md 路径
  sort_order      INT DEFAULT 0,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  db_modify_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_parent (parent_id),
  KEY idx_name (name),
  CONSTRAINT fk_domain_parent FOREIGN KEY (parent_id) REFERENCES panorama_business_domain(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 知识库文档元数据
CREATE TABLE panorama_knowledge_doc (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  domain_id       BIGINT NOT NULL,
  path            VARCHAR(500) NOT NULL UNIQUE,         -- business/moolah/emission.md
  title           VARCHAR(300) NULL,
  last_verified   DATE NULL,
  frontmatter_json JSON NULL,                           -- 完整 frontmatter 存 JSON
  body_md_path    VARCHAR(500) NULL,                    -- 原文相对路径，运行时读
  word_count      INT DEFAULT 0,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  db_modify_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_domain (domain_id),
  FULLTEXT KEY ft_title (title)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Concept（frontmatter.concepts/aliases 标准化）
CREATE TABLE panorama_concept (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(100) NOT NULL UNIQUE,
  aliases_json    JSON NULL,                            -- ["借款", "存款"]
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 文档-Concept 关联
CREATE TABLE panorama_doc_concept_rel (
  doc_id          BIGINT NOT NULL,
  concept_id      BIGINT NOT NULL,
  PRIMARY KEY (doc_id, concept_id),
  KEY idx_concept (concept_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 3.2 实现清单

```sql
CREATE TABLE panorama_cron_job (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  domain_id       BIGINT NULL,                          -- 可能未关联到具体业务（孤儿）
  name            VARCHAR(200) NOT NULL,                -- moolahEmissionTask
  schedule        VARCHAR(100) NULL,                    -- @Cron('0 0 * * *') 或 jobId
  job_id          VARCHAR(100) NULL,                    -- XxlJob 数字 ID
  repo            VARCHAR(50) NOT NULL,                 -- lista-cron / lista-bot
  file_path       VARCHAR(500) NOT NULL,
  line_no         INT NULL,
  handler_class   VARCHAR(200) NULL,
  description     TEXT NULL,                            -- 从注释抽取
  confidence      DECIMAL(3,2) DEFAULT 1.00,            -- 业务关联置信度
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  db_modify_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_domain (domain_id),
  KEY idx_name (name),
  FULLTEXT KEY ft_search (name, description)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE panorama_api_endpoint (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  domain_id       BIGINT NULL,
  http_method     VARCHAR(10) NOT NULL,                 -- GET / POST / ...
  path            VARCHAR(500) NOT NULL,                -- /api/admin/moolah/vault/search
  controller      VARCHAR(200) NULL,
  repo            VARCHAR(50) NOT NULL,
  file_path       VARCHAR(500) NOT NULL,
  line_no         INT NULL,
  auth_required   TINYINT(1) DEFAULT 0,
  description     TEXT NULL,
  confidence      DECIMAL(3,2) DEFAULT 1.00,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  db_modify_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_domain (domain_id),
  KEY idx_path (path),
  FULLTEXT KEY ft_search (path, description)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE panorama_entity (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  domain_id       BIGINT NULL,
  table_name      VARCHAR(100) NOT NULL,                -- moolah_vault
  repo            VARCHAR(50) NOT NULL,
  file_path       VARCHAR(500) NOT NULL,
  columns_json    JSON NULL,                            -- [{name, type, nullable}, ...]
  description     TEXT NULL,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  db_modify_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_repo_table (repo, table_name),
  KEY idx_domain (domain_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE panorama_contract (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(200) NOT NULL,                -- MerkleDistributor / Liquidator
  address         VARCHAR(42) NOT NULL,                 -- 0x...
  chain           VARCHAR(50) NOT NULL,                 -- bsc-mainnet / eth-mainnet
  abi_path        VARCHAR(500) NULL,                    -- onchain/abis/MerkleDistributor.json
  deployed_at    DATE NULL,
  notes           TEXT NULL,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  db_modify_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_chain_addr (chain, address),
  KEY idx_name (name),
  FULLTEXT KEY ft_search (name, notes)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE panorama_frontend_route (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  domain_id       BIGINT NULL,
  app_name        VARCHAR(100) NOT NULL,                -- lista / admin / vault-manager
  path            VARCHAR(500) NOT NULL,                -- /dashboard/rewards
  component       VARCHAR(200) NULL,                    -- RewardsPage
  repo            VARCHAR(50) NOT NULL DEFAULT 'lista-mono',
  file_path       VARCHAR(500) NOT NULL,
  is_lazy         TINYINT(1) DEFAULT 0,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  db_modify_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_app_path (app_name, path),
  KEY idx_domain (domain_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Redis Key（代码扫描得出，含模式 + TTL + 数据类型）
CREATE TABLE panorama_redis_key (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  domain_id       BIGINT NULL,
  key_pattern     VARCHAR(500) NOT NULL,                -- moolah:emission:pending_root / moolah:claim_status:{addr}
  redis_type      ENUM('string','hash','list','set','zset','stream','unknown') DEFAULT 'unknown',
  ttl_seconds     INT NULL,                             -- 提取自代码 expire 调用，NULL = 未知/永久
  description     TEXT NULL,                            -- 从注释抽取
  -- ingestion 来源（key 在哪些文件被读/写，不同操作可能在不同文件）
  source_repo     VARCHAR(50) NOT NULL,                 -- lista-cron / lista-bot / lista-admin
  source_file     VARCHAR(500) NOT NULL,
  source_line     INT NULL,
  confidence      DECIMAL(3,2) DEFAULT 0.70,            -- 默认低于 1（key 抽取启发式较多）
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  db_modify_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_pattern (key_pattern, source_repo),
  KEY idx_domain (domain_id),
  FULLTEXT KEY ft_search (key_pattern, description)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 3.3 关联与代码引用

```sql
-- 通用代码引用锚点（让"知识库文档里的 file:line"和"代码侧实体"通过共享主键合并）
CREATE TABLE panorama_code_ref (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  repo            VARCHAR(50) NOT NULL,
  file_path       VARCHAR(500) NOT NULL,
  line_no         INT NULL,
  snippet         TEXT NULL,                            -- 行附近 ±3 行内容指纹
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_loc (repo, file_path, line_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 通用关联表（多态：source/target 都可以是任意表）
CREATE TABLE panorama_ref_link (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_type     VARCHAR(30) NOT NULL,                 -- 'doc' / 'cron' / 'api' / ...
  source_id       BIGINT NOT NULL,
  target_type     VARCHAR(30) NOT NULL,
  target_id       BIGINT NOT NULL,
  link_type       VARCHAR(50) NOT NULL,                 -- DESCRIBES / CALLS / READS / WRITES / REFERENCES
  confidence      DECIMAL(3,2) DEFAULT 1.00,            -- 1.0 = 手写权威, < 1 = 启发式推断
  meta_json       JSON NULL,                            -- {"method": "setMerkleRoot"} 等附加属性
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_source (source_type, source_id),
  KEY idx_target (target_type, target_id),
  KEY idx_type (link_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 专用关联表（高频查询走这些，避免每次反查 ref_link）
CREATE TABLE panorama_cron_contract_call (
  cron_id         BIGINT NOT NULL,
  contract_id     BIGINT NOT NULL,
  method_name     VARCHAR(200) NULL,
  PRIMARY KEY (cron_id, contract_id, method_name),
  KEY idx_contract (contract_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE panorama_api_entity_op (
  api_id          BIGINT NOT NULL,
  entity_id       BIGINT NOT NULL,
  op_type         ENUM('READ', 'WRITE', 'BOTH') NOT NULL,
  PRIMARY KEY (api_id, entity_id),
  KEY idx_entity (entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE panorama_route_api_call (
  route_id        BIGINT NOT NULL,
  api_id          BIGINT NOT NULL,
  PRIMARY KEY (route_id, api_id),
  KEY idx_api (api_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Cron 与 Redis Key 操作
CREATE TABLE panorama_cron_redis_op (
  cron_id         BIGINT NOT NULL,
  redis_id        BIGINT NOT NULL,
  op_type         ENUM('READ','WRITE','BOTH','EXPIRE','DELETE') NOT NULL,
  PRIMARY KEY (cron_id, redis_id, op_type),
  KEY idx_redis (redis_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- API 与 Redis Key 操作
CREATE TABLE panorama_api_redis_op (
  api_id          BIGINT NOT NULL,
  redis_id        BIGINT NOT NULL,
  op_type         ENUM('READ','WRITE','BOTH') NOT NULL,
  PRIMARY KEY (api_id, redis_id, op_type),
  KEY idx_redis (redis_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- API 与合约调用（前端读 / Cron 写之外，API 也会读合约状态）
CREATE TABLE panorama_api_contract_call (
  api_id          BIGINT NOT NULL,
  contract_id     BIGINT NOT NULL,
  method_name     VARCHAR(200) NULL,
  PRIMARY KEY (api_id, contract_id, method_name),
  KEY idx_contract (contract_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- API 经 callCronApi() 调用 Cron（lista-admin → lista-cron 代理模式）
CREATE TABLE panorama_api_cron_call (
  api_id          BIGINT NOT NULL,
  cron_id         BIGINT NOT NULL,
  call_path       VARCHAR(500) NULL,                   -- 如 /api/launchpool/runFullPipeline
  PRIMARY KEY (api_id, cron_id),
  KEY idx_cron (cron_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 3.4 构建元数据

```sql
CREATE TABLE panorama_build_meta (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  build_id        VARCHAR(40) NOT NULL UNIQUE,          -- UUID
  status          ENUM('running', 'success', 'failed') NOT NULL,
  started_at      TIMESTAMP NOT NULL,
  finished_at     TIMESTAMP NULL,
  duration_ms     INT NULL,
  trigger_type    VARCHAR(20) NOT NULL,                 -- 'cron' / 'manual'
  triggered_by    VARCHAR(100) NULL,
  commit_shas     JSON NULL,                            -- {"lista-knowledge": "abc123", ...}
  stats_json      JSON NULL,                            -- {"domains": 10, "crons": 315, ...}
  error_log       TEXT NULL,
  KEY idx_status (status),
  KEY idx_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE panorama_broken_ref (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  build_id        VARCHAR(40) NOT NULL,
  doc_path        VARCHAR(500) NOT NULL,                -- 哪个 lista-knowledge 文档
  doc_line_no    INT NULL,                              -- 引用所在行
  ref_repo        VARCHAR(50) NOT NULL,
  ref_file_path   VARCHAR(500) NOT NULL,
  ref_line_no     INT NULL,
  reason          VARCHAR(200) NULL,                    -- 'file_not_found' / 'content_drift'
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_build (build_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 3.5 全文搜索索引策略

| 表 | FULLTEXT 字段 | 用途 |
|----|--------------|------|
| `panorama_business_domain` | `name`, `description` | Cmd+K 搜业务域 |
| `panorama_knowledge_doc` | `title` | Cmd+K 搜业务文档 |
| `panorama_cron_job` | `name`, `description` | Cmd+K 搜 cron |
| `panorama_api_endpoint` | `path`, `description` | Cmd+K 搜 API |
| `panorama_contract` | `name`, `notes` | Cmd+K 搜合约（含地址） |
| `panorama_entity` | `table_name` (BTREE) | 表名搜索 |
| `panorama_redis_key` | `key_pattern`, `description` | Cmd+K 搜 Redis key |

**实现：** Cmd+K 后端 6 张表 UNION 查询，按 `MATCH ... AGAINST` 分数排序前 25 条返回。中文搜索需 `WITH PARSER ngram`（MySQL 8.0+ 默认带）。

### 3.6 业务树查询性能

邻接列表 + 父查子，深度 ≤ 5，单次查询 < 5ms。无需 nested set / closure table 之类的复杂方案。

---

## 4. Ingestion 设计

### 4.1 7 个独立 ingestor

每个 ingestor 是独立的 Node.js 模块，输入是源仓库路径，输出统一格式的 JSON：

```typescript
// ingestors/types.ts
interface IngestorOutput {
  nodes: { type: string; data: object }[];
  edges: { sourceType: string; sourceKey: string;
           targetType: string; targetKey: string;
           linkType: string; confidence: number;
           meta?: object }[];
  brokenRefs: { docPath: string; refLocation: string; reason: string }[];
}
```

| Ingestor | 输入 | 输出节点 | 输出边 |
|----------|------|---------|--------|
| `knowledge` | lista-knowledge/business/*.md + onchain/*.md | BusinessDomain / KnowledgeDoc / Concept / CodeRef | DESCRIBES / MENTIONS / REFERENCES |
| `cron` | lista-cron + lista-bot src 目录 | CronJob | (待 orchestrator 关联到 Domain / Contract / Entity / Redis) |
| `api` | lista-admin src 目录 | ApiEndpoint | (待 orchestrator 关联) |
| `entity` | 所有 NestJS 仓库 src 目录 | Entity | — |
| `contract` | lista-knowledge/onchain/*.md + abis/ | Contract（含主网+测试网地址） | — |
| `frontend` | lista-mono apps/*/src | FrontendRoute | (待 orchestrator 关联到 ApiEndpoint) |
| **`redis`** | lista-cron + lista-bot + lista-admin（grep redis ops） | RedisKey | (待 orchestrator 关联到 Cron / API) |

**Redis ingestor 特殊性**：
Redis key 不像 `@Cron` 装饰器有静态标识，只能 grep `redis.set()` / `redisClient.get()` / `RedisService.X()` 等调用 + 提取字符串字面量作为 key 模板：

```typescript
// 示例：从代码扫出来的 key 模板
'moolah:emission:pending_root'              // 静态字符串 → confidence 1.0
`moolah:claim_status:${userAddress}`        // 模板字面量 → 转 'moolah:claim_status:{addr}', confidence 0.8
KEY_PREFIX + ':' + getDomain()              // 拼接表达式 → 启发式还原, confidence 0.5
```

覆盖率会显著低于其他 ingestor（默认 confidence 0.7）。运行时 op_type（READ/WRITE/EXPIRE/DELETE）从同一调用的方法名推断（`get` / `set` / `expire` / `del`）。

### 4.2 编排器（orchestrator）

```
1. 并行跑 7 个 ingestor → 各自产 out/{name}.json
2. 加载所有 JSON 到内存
3. 跨源关联 pass：
   - A. 解析 knowledge ingestor 产出的 CodeRef → 在 cron/api/entity/redis 的输出里查同 (repo, file) → 创建权威边 confidence=1
   - B. 启发式补全：对未关联的 cron/api/redis，按"文件路径含 domain name" → 推断边 confidence=0.6
   - C. callCronApi 模式识别：扫描 lista-admin 中调用 callCronApi('/path') 的位置，匹配 lista-cron 的同名 endpoint → panorama_api_cron_call
   - D. broken_refs 检测：CodeRef 指向的文件 ±10 行内容指纹 → 失效则收集
4. 写 MySQL（staging 表 + RENAME swap，原子切换）:
   - 写入 panorama_*_new 表
   - RENAME TABLE panorama_X TO panorama_X_old, panorama_X_new TO panorama_X
   - DROP TABLE panorama_X_old
   失败时清理 _new 表，不影响线上数据
```

**为什么不用事务 TRUNCATE + INSERT？** MySQL InnoDB 的 TRUNCATE 是 DDL，会隐式提交事务，无法回滚。staging + RENAME 是原子的，失败可重试。

**为什么 staging swap 而不是 upsert？**
- 49 文档 + 几百个代码节点，全量写入 < 30 秒
- 避免 upsert 的"删除节点"语义复杂度（节点被删除后边怎么处理）
- 单实例 K8s Job 跑，advisory lock 防并发（`SELECT GET_LOCK('panorama_rebuild', 0)`）

### 4.3 跨源关联策略

| 策略 | 实现 | 边的 confidence |
|------|------|---------|
| **A. 手写 file:line（权威）** | 解析 markdown 正文中的 `lista-bot/src/.../foo.service.ts:42` pattern → 匹配代码 ingestor 输出的同 repo/file 节点 | 1.0 |
| **B. 启发式补全（推断）** | 文件路径含 domain name + handler 类名词根 + 同目录传播 | 0.4-0.8 |
| **C. 代码注释（拒绝）** | 不要求研发在代码加 `// @business: moolah/emission` 注释 | — |

前端在节点详情页用实线 vs 虚线区分（confidence ≥ 0.9 为实线）。

### 4.4 broken_refs 检测

每次 ingestion 时：

```typescript
for (const ref of allCodeRefs) {
  const file = `${repos}/${ref.repo}/${ref.filePath}`;
  if (!exists(file)) {
    brokenRefs.push({ ...ref, reason: 'file_not_found' });
    continue;
  }
  const lines = readLines(file, ref.lineNo - 3, ref.lineNo + 3);
  const fingerprint = sha1(lines.join('\n'));
  if (ref.expectedFingerprint && fingerprint !== ref.expectedFingerprint) {
    brokenRefs.push({ ...ref, reason: 'content_drift' });
  }
}
```

输出物：`/var/data/panorama/broken_refs/{build_id}.md`，按 domain 分组列出失效引用，作为 lista-knowledge 维护 backlog。

---

## 5. Build Trigger Strategy

**决策：cron 调度 + UI 一键 rebuild**

### 5.1 默认调度

K8s CronJob 每日 02:00（UTC+8）：

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: panorama-rebuild
spec:
  schedule: "0 18 * * *"   # 02:00 UTC+8
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: rebuild
            image: panorama-ingestion:latest
            env:
            - name: TRIGGER_TYPE
              value: cron
          restartPolicy: OnFailure
```

### 5.2 手动触发

webapp 顶栏"立即重建"按钮（管理员可见）→ POST /api/admin/rebuild → K8s API 创建一次性 Job → 返回 build_id

前端通过 SSE 或轮询 `GET /api/build/{build_id}` 显示进度。

### 5.3 为什么不做 GitHub Actions 跨仓库触发

- 5 个上游仓库每个都要写 PR-merge 监听 workflow + repository_dispatch
- 需要 PAT 管理（过期、权限范围、轮换）
- 单人维护，配置成本 > 收益
- 日级别延迟可接受（业务变更通常不是分钟级）

如果 phase 3 后用户反馈"日级太慢"，再考虑加。

### 5.4 增量更新 vs 全量

**全量重建。** 估算耗时：

| 步骤 | 估时 |
|------|------|
| Git pull 5 个仓库 | 30-60s |
| 6 个 ingestor 并行扫描 | 60-90s（lista-mono 约 3000 .ts 文件 ts-morph 解析最慢） |
| Orchestrator 跨源关联 | 5-10s |
| MySQL 事务写入 | 10-20s |
| **总计** | **约 2-3 分钟** |

增量复杂度爆炸（要算文件依赖图、处理删除节点、保证图一致性），不做。

---

## 6. API 设计

Next.js Route Handler 实现，统一返回 `BaseResponse<T>` 格式（与 lista-admin 约定一致）：

```typescript
interface BaseResponse<T> {
  code: number;       // 0 = success
  message: string;
  data: T;
}
```

### 6.1 主要 endpoints

| Method | Path | 用途 | 返回 |
|--------|------|------|------|
| GET | `/api/tree?parent_id=` | 懒加载树节点 | `{ id, name, hasChildren, type, count? }[]` |
| GET | `/api/domain/{id}` | 业务域详情（含 frontmatter + flow graph data + 6 类实现清单 + stats） | `DomainDetail` |
| GET | `/api/domain/{id}/flow` | 单独取流程图数据（React Flow 用） | `{ nodes: FlowNode[]; edges: FlowEdge[] }` |
| GET | `/api/node/{type}/{id}` | 节点详情 + 关联面板（type ∈ ui\|api\|cron\|contract\|db\|redis） | `NodeDetail` |
| GET | `/api/source/{repo}/{...path}` | 源码（脱敏后） | `{ content: string; lines: number; truncated: boolean }` |
| GET | `/api/source-tree/{repo}?path=` | 文件树（云代码浏览器左侧） | `FileTreeItem[]` |
| GET | `/api/search?q=&types=` | Cmd+K 搜索（6 表 UNION，types 可过滤） | `SearchResult[]` |
| POST | `/api/admin/rebuild` | 触发重建 | `{ buildId }` |
| GET | `/api/build/{id}` | 构建状态 | `BuildMeta` |
| GET | `/api/build/latest` | 最近一次构建 | `BuildMeta` |

**`/api/domain/{id}/flow` 返回示例**（React Flow 直接消费）：

```typescript
{
  nodes: [
    { id: 'ui:42', type: 'panoramaNode', data: { kind: 'ui', name: '/dashboard/rewards', ... }, position: { x: 200, y: 30 } },
    { id: 'cron:7', type: 'panoramaNode', data: { kind: 'cron', name: 'moolahEmissionTask', ... }, position: { x: 200, y: 238 } },
    { id: 'contract:1', type: 'panoramaNode', data: { kind: 'contract', selected: true, ... }, position: { x: 200, y: 372 } },
    ...
  ],
  edges: [
    { id: 'e1', source: 'cron:7', target: 'contract:1', type: 'smoothstep', data: { method: 'setMerkleRoot', confidence: 1.0 } },
    ...
  ]
}
```

后端使用 dagre 预计算 layout，前端可选择应用或使用 React Flow 自动布局。

### 6.2 关键查询示例（节点详情 + 反向关联）

```sql
-- 给一个 contract_id，列出反向调用方（哪些 cron 调用过它）
SELECT c.id, c.name, c.repo, c.file_path, ccc.method_name
FROM panorama_cron_contract_call ccc
JOIN panorama_cron_job c ON c.id = ccc.cron_id
WHERE ccc.contract_id = ?;

-- 业务域详情：6 类实现清单
SELECT 'ui'    AS type, id, path AS name FROM panorama_frontend_route WHERE domain_id = ?
UNION ALL
SELECT 'api',  id, CONCAT(http_method, ' ', path)  FROM panorama_api_endpoint WHERE domain_id = ?
UNION ALL
SELECT 'cron', id, name                            FROM panorama_cron_job    WHERE domain_id = ?
UNION ALL
SELECT 'db',   id, table_name                      FROM panorama_entity      WHERE domain_id = ?
UNION ALL
SELECT 'redis', id, key_pattern                    FROM panorama_redis_key   WHERE domain_id = ?
UNION ALL
SELECT 'contract', c.id, c.name
FROM panorama_contract c
JOIN panorama_cron_contract_call ccc ON ccc.contract_id = c.id
JOIN panorama_cron_job cj ON cj.id = ccc.cron_id
WHERE cj.domain_id = ?;
```

---

## 7. 前端架构

### 7.1 技术栈

- **框架**：Next.js 14 App Router（SSR + RSC）
- **状态管理**：Zustand（轻量，无需 Redux）+ URL state（节点选中通过 query string）
- **样式**：Tailwind CSS + shadcn/ui
- **树组件**：`react-arborist`（虚拟化、键盘导航）
- **业务流程图**：**`reactflow` + `dagre`**（auto-layout）
- **知识库手写图**：`mermaid` v10（运行时渲染，仅用于折叠面板里展示 lista-knowledge markdown 中的人工流程图）
- **代码渲染**：`@monaco-editor/react`（按需加载）
- **图标**：`lucide-react`
- **抽屉**：`@radix-ui/react-dialog` 或 `vaul`（无障碍 + focus trap）

#### 字体

- **UI / 正文**：`Inter`（Google Fonts，免费）
- **代码 / 地址 / Mono**：`JetBrains Mono`

#### 品牌色（与 lista.org 主站对齐）

```css
/* 主交互色 — Lista 紫，用于选中态 / CTA / focus ring */
--primary:        #8378FF;
--primary-grad:   linear-gradient(135deg, #8378FF 0%, #6058D6 100%);
--primary-glow:   rgba(131, 120, 255, 0.40);

/* 品牌色 — Lista 黄橙渐变，仅用于 logo / 小品牌点缀 */
--brand-grad:     linear-gradient(135deg, #FFD25F 0%, #FF8F27 100%);

/* 6 节点类型色（流程图用） */
--t-ui:           #5BC0DE;  /* 青 */
--t-api:          #5DE090;  /* 绿 */
--t-cron:         #FFB840;  /* 黄 */
--t-contract:     #F87171;  /* 红 */
--t-db:           #B19DFF;  /* 紫 */
--t-redis:        #F58BC2;  /* 粉 */

/* 背景层级 */
--bg:             #141522;  /* 主背景 */
--bg-1:           #1C1D2C;  /* sidebar / 卡片 */
--bg-2:           #25273A;  /* 节点 */
--bg-3:           #303248;  /* 节点 head */

/* 文本 */
--text:           #F4F5FC;  /* 主文字 */
--text-2:         #C4C7DB;  /* 副文字 */
--text-3:         #888BA4;  /* 三级文字 / 占位符 */
```

### 7.2 页面 / 路由

```
app/
├── layout.tsx                    # 全局 Shell（左树 + 右内容）
├── page.tsx                      # / → 默认欢迎页
├── domain/
│   └── [id]/page.tsx             # /domain/{id} 业务详情
├── node/
│   └── [type]/[id]/page.tsx      # /node/{type}/{id} 节点详情
├── code/
│   └── [repo]/[...path]/page.tsx # /code/{repo}/file/path 云代码
├── search/
│   └── page.tsx                  # /search?q= 搜索结果聚合页
└── api/
    ├── tree/route.ts
    ├── domain/[id]/route.ts
    ├── node/[type]/[id]/route.ts
    ├── source/[repo]/[...path]/route.ts
    ├── search/route.ts
    └── admin/rebuild/route.ts
```

### 7.3 组件

```
components/
├── BusinessTree.tsx              # 左侧树（react-arborist 封装）
├── DomainDetail.tsx              # 业务详情主体
│   ├── HeroBlock.tsx             # 标题 + 描述 + concepts + last_verified
│   ├── StatsRow.tsx              # 4 个 stats 卡片
│   ├── FlowChart.tsx             # 业务流程图（React Flow 包装）
│   │   ├── PanoramaNode.tsx      # 自定义节点组件（6 种类型）
│   │   ├── PanoramaEdge.tsx      # smoothstep + highlight 状态
│   │   └── FlowOverlays.tsx      # 工具栏 / minimap / legend / status
│   ├── ImplementationTabs.tsx    # 6 类实现 Tab 切换
│   └── KnowledgeMermaid.tsx      # 懒加载 mermaid，仅渲染知识库手写图
├── NodeDetailDrawer.tsx          # 抽屉容器（vaul / radix dialog）
│   ├── DrawerHeader.tsx
│   ├── ContractDetail.tsx        # 合约专属内容（双地址卡 + ABI）
│   ├── CronDetail.tsx
│   ├── ApiDetail.tsx
│   ├── EntityDetail.tsx
│   ├── RedisDetail.tsx           # Redis key 专属内容（pattern + TTL + type）
│   ├── RouteDetail.tsx
│   ├── CodeSnippet.tsx           # Monaco 只读 + 跳转
│   ├── RelationsPanel.tsx        # 上下游 + 被引用
│   └── AskPanorama.tsx           # AI 问答抽屉块
├── CommandPalette.tsx            # Cmd+K 全局搜索
└── CodeBrowser.tsx               # /code 页面 Monaco 全屏
```

### 7.4 UI 布局参考

完整设计稿参见 [`design/mockup.html`](../design/mockup.html)（v8 为最终版），历史迭代见 [`design/iterations/`](../design/iterations/)。

**简版 ASCII 概览**（实际细节以 mockup.html 为准）：

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [L] Panorama  [● Block #X · Synced 2h ago]  [Search Cmd+K]  [⟳][⚙][S]    │
├──────────────────────────────────────────────────────────────────────────┤
│ 业务树            │ Lista DAO / Moolah / Emission                        │
│ ▼ Lista DAO       │                                                       │
│   ▼ Moolah        │ Moolah Emission Rewards                              │
│     ▶ Supply&Bor  │ 通过 MerkleDistributor 周期性发放...                  │
│     ▼ Emission ●  │ #emission #merkle #claim     ● Verified 2026-04-30   │
│       ▶ UI (2)    │                                                       │
│       ▶ API (3)   │ ┌─[Cron 5]──[Contract 4]──[API 3]──[Storage 5]─┐    │
│       ▶ CRON (5)  │ │  4 个 stats 卡片                              │    │
│       ▼ SOL (4) ● │ └────────────────────────────────────────────┘    │
│         · Merkle… │                                                       │
│         · Reward… │ 业务流程图  [展开全部][仅高频][Auto layout]            │
│       ▶ DB (2)    │ ┌────────────────────────────────────────────┐ ┃  │
│       ▶ RDS (3)   │ │ UI    /dashboard/rewards                    │ ┃ │
│   ▶ Staking       │ │       │                                     │ ┃ │
│   ▶ CDP           │ │ API   /api/moolah/rewards/claimable         │ ┃ 详 │
│   ▶ Gov           │ │       │      ┌─[POST /api/admin/sync]      │ ┃ 情 │
│   ▶ Revenue       │ │ CRON  ◆moolahEmissionTask  …               │ ┃ 抽 │
│   ▶ Credit        │ │       ↓ setMerkleRoot                       │ ┃ 屉 │
│   ▶ RWA           │ │ SOL   ★MerkleDistributor★  RewardRouter     │ ┃ │
│   ▶ Infra         │ │       ↓                                     │ ┃ │
│                   │ │ DB    merkle_root_log  emission_reward_log  │ ┃ │
│                   │ │                                              │ ┃ │
│                   │ │ RDS   moolah:emission:pending_root          │ ┃ │
│                   │ └────────────────────────────────────────────┘ ┃ │
│                   │                                                       │
│                   │ 实现清单 [UI][API][Cron][Contract*][DB][Redis]      │
│                   │ ┌───────────────────────────────────────────┐     │
│                   │ │ MerkleDistributor  0x6Bd0…  3 callers  ↗  │     │
│                   │ └───────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────────┘

   ★ = selected node (purple ring)        ┃ = drawer tab (collapsed)
```

### 7.5 UI 约定

| 维度 | 规范 |
|------|------|
| 流程图画布 | 1480 × 740 固定（max-width: 100%），6 lane 上下排列 |
| 节点尺寸 | 简单节点（仅 name）64×200；带 subtitle 节点 84×200 |
| 节点边框 | 顶部 2px 类型色条 + 左侧无边色（统一 var(--border-2)）|
| 节点 head | 26-28px 高，类型 tag + meta + status dot + 可选 actions |
| 节点 body | flex column + center vertical，name 字号 13 mono，sub 11 sans |
| 选中态 | 紫色 1px 描边 + 紫色发光 box-shadow，无 ring 无 pulse |
| 相关节点 | rgba 紫色边（0.45 透明度），微弱发光 |
| 无关节点 | opacity 0.7（dim 但仍可读） |
| 边类型 | smoothstep（正交折线 + 圆角），强调边 2.2px 紫色渐变 + 数据流虚线动效；推断边虚线 4px-3px 灰色 |
| 边箭头 | 高亮 8×8 紫色填充三角，普通 7×7 灰色 |
| 边标签 | 小药丸（pill），位于 50px gap 中央，font-mono 10px |
| Lane label | 左侧 16px，颜色 = lane 类型色，opacity 0.6，font-weight 700 letter-spacing 0.18em |
| Lane 背景 | 类型色 4% 渐变（顶部强 → 底部透明） |
| 网格 | 24×24 间距，1px 线，opacity 0.022，径向 mask 让中央清晰边缘消隐 |
| 抽屉 | 420-460px 宽，cubic-bezier(0.32, 0.72, 0, 1) 0.28s slide-in，关闭后流程图全宽 |
| Backdrop | 主内容区 30% slate 暗化 + 2px backdrop-blur，仅覆盖 content 不影响 sidebar |
| 浮层组件 | 工具栏 / minimap / legend / status 全部 `backdrop-filter: blur(12px)` 玻璃质感 |

---

## 8. 源码安全机制

源码暴露给内网用户存在敏感信息泄露风险（RPC URL、合约 owner、env 变量名引用、emission schedule 等）。本节定义防护机制。

### 8.1 仓库白名单

```typescript
const ALLOWED_REPOS = new Set([
  'lista-mono', 'lista-admin', 'lista-bot',
  'lista-cron', 'lista-knowledge'
]);

if (!ALLOWED_REPOS.has(repo)) return { status: 403 };
```

### 8.2 文件黑名单

```typescript
const BLOCKED_PATTERNS = [
  /\.env(\..*)?$/,           // .env, .env.local, .env.production
  /secret/i,
  /credentials/i,
  /\.(pem|key|p12|pfx)$/,
  /private[_-]?key/i,
  /apollo[_-]?config/i,      // Apollo Config Server 凭证
];

if (BLOCKED_PATTERNS.some(re => re.test(filePath))) return { status: 404 };
```

### 8.3 内容脱敏

返回前扫描内容，匹配以下 pattern 替换为 `***REDACTED***`：

```typescript
const REDACT_PATTERNS = [
  // 仅在变量名暗示私钥时才脱敏 64-hex（避免误伤 tx hash / merkle root / bytes32 常量）
  /(private[_-]?key|priv[_-]?key|signing[_-]?key|secret[_-]?key)\s*[:=]\s*['"]?(0x)?[a-fA-F0-9]{64}/gi,
  /(api[_-]?key|token|password|secret)\s*[:=]\s*["'][^"']+["']/gi,  // 硬编码凭证
  /jdbc:[^"'\s]+/g,                          // JDBC URL（含密码）
  /mongodb:\/\/[^:]+:[^@]+@/g,               // MongoDB URI（带账密）
  /redis:\/\/[^:]*:[^@]+@/g,                 // Redis URI（带账密）
];
```

**为什么不直接全局脱敏 `/0x[a-f0-9]{64}/`？** 业务代码中合法的 64-hex 字符串很多：transaction hash / merkle root / storage slot / bytes32 常量。无差别脱敏会让源码可读性大幅降低，研发吐槽。只在上下文暗示私钥时才脱敏。

### 8.4 路径穿越防护

```typescript
import path from 'path';
const repoRoot = `/var/repos/${repo}`;
const resolved = path.resolve(repoRoot, filePath);
if (!resolved.startsWith(repoRoot + path.sep)) {
  return { status: 403, error: 'path traversal detected' };
}
```

### 8.5 文件大小限制

单文件返回限制 1MB，超过截断 + 提示"该文件过大，请到代码托管平台查看完整内容"。

### 8.6 审计日志

每次 `/api/source/*` 调用记录到 `panorama_source_access_log` 表：`user_id / file_path / accessed_at / ip`。每月审计一次异常访问 pattern。

---

## 9. 部署

### 9.1 本地开发

```yaml
# docker-compose.yml
services:
  webapp:
    build: ./webapp
    ports: ["3000:3000"]
    environment:
      MYSQL_HOST: tf-saasbiz-qa-common-db.cluster-ctq8ac28izd2.ap-southeast-1.rds.amazonaws.com
      MYSQL_PORT: 3306
      MYSQL_USER: bijieprd
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
      MYSQL_DATABASE: lista_qa
      REPOS_PATH: /var/repos
    volumes:
      - ~/Documents/code:/var/repos:ro

  ingestion:
    build: ./ingestion
    profiles: ["build"]      # docker compose --profile build run ingestion
    volumes:
      - ~/Documents/code:/var/repos:ro
```

### 9.2 生产

| 组件 | 部署 |
|------|------|
| webapp | K8s Deployment（2 replicas）+ Service + Ingress `panorama.lista.internal` |
| MySQL | 复用 lista_qa 实例（不新部署） |
| ingestion | K8s CronJob（每日 02:00 UTC+8）+ 一次性 Job（手动触发） |
| 仓库源码 | git-sync sidecar 把 5 个上游仓库 clone 到 PVC，webapp pod 挂载只读 |
| 监控 | Prometheus 暴露 `/metrics`，告警接 PagerDuty/Slack |

### 9.3 git-sync 方案

每个仓库一个 git-sync Deployment：

```yaml
- name: git-sync-lista-cron
  image: registry.k8s.io/git-sync/git-sync:v4.0
  args:
    - --repo=git@github.com:Lista/lista-cron.git
    - --branch=main
    - --depth=1
    - --period=10m
    - --root=/repos/lista-cron
  volumeMounts:
    - name: repos-pvc
      mountPath: /repos
```

### 9.4 数据库账号 / 权限

- **现有账号 `bijieprd`**：先确认是否有 `lista_qa` 库的 DDL（CREATE TABLE）权限
- 如果没有：申请新账号或临时让 DBA 帮跑 migration
- 运行时账号最低权限：仅 `panorama_*` 表的 SELECT / INSERT / UPDATE / DELETE / TRUNCATE
- ingestion 账号需要额外的 TRUNCATE 权限

### 9.5 SSO / 认证

- **Phase 1**：basic auth + IP 白名单（仅公司 VPN）
- **Phase 3**：接公司 OIDC（IT 部门协调，配置 IdP redirect / scope / claims）

---

## 10. 与 ask-knowledge / biz-doc 的边界

```
                ┌──────────────┐
                │ lista-knowledge │  唯一可信源
                │  (49 docs)      │
                └─────┬────┬──────┘
        只读消费       │    │  唯一写入通道
                ┌──────┘    └──────┐
                ▼                  ▼
          ┌──────────┐       ┌─────────────────┐
          │ Panorama │       │ biz-doc agent   │
          │   (本平台) │       │ + validate-fm.py│
          └────┬─────┘       └─────────────────┘
               │
               │ "在 ask-knowledge 中提问" 链接
               ▼
          ┌──────────┐
          │ ask-     │  自然语言问答
          │knowledge │  (互补)
          └──────────┘
```

**Panorama 不做的事：**
- 不修改 lista-knowledge 任何文件
- 不维护 frontmatter
- 不做自然语言问答（让 ask-knowledge 做）
- 不写 broken_refs.md 到 lista-knowledge（只在 panorama_broken_ref 表里记录，导出 markdown 给人看）

**对 ask-knowledge 的补充：**
- ask-knowledge 是"问答"，Panorama 是"浏览"
- 节点详情页提供"在 ask-knowledge 中问 'XXX 是什么'"的快捷链接（携带上下文）

---

## 11. 测试策略

### 11.1 单元测试

每个 ingestor 用 fixture 文件断言输出：

```typescript
// ingestors/cron/__tests__/cron.test.ts
test('extracts @XxlJobHandler decorator', () => {
  const fixture = `
    @Injectable()
    export class FooService {
      @XxlJobHandler('compensateDailyApy')
      async runJob() { /* ... */ }
    }`;
  const out = parseCronFile(fixture, 'lista-cron', 'src/foo.service.ts');
  expect(out.nodes).toContainEqual({
    type: 'cron_job',
    data: { name: 'compensateDailyApy', schedule: 'compensateDailyApy',
            repo: 'lista-cron', filePath: 'src/foo.service.ts' }
  });
});
```

### 11.2 集成测试

跑完整 ingestion pipeline，断言写入 MySQL 后特定查询返回预期：

```typescript
test('emission domain has 5+ cron jobs', async () => {
  await runFullIngestion(testReposPath);
  const rows = await db.query(`
    SELECT COUNT(*) c FROM panorama_cron_job cj
    JOIN panorama_business_domain bd ON cj.domain_id = bd.id
    WHERE bd.name = 'emission' AND bd.parent_id IN (
      SELECT id FROM panorama_business_domain WHERE name = 'moolah'
    )`);
  expect(rows[0].c).toBeGreaterThanOrEqual(5);
});
```

### 11.3 E2E（Playwright）

覆盖 4 条核心路径：

1. 首页 → 展开 Moolah → 点 Emission → 看到 Mermaid + 5 个 Cron
2. Cmd+K 搜 "moolahEmissionTask" → 跳到 L3 节点详情
3. L3 点 "在云代码中打开" → /code 页面渲染源码
4. Contract 节点的 "Used by" 列出 ≥1 个调用方

### 11.4 数据库 migration

用 Knex 或 Prisma migrate，每次 schema 变更走 PR + review + 部署前手动 apply。

---

## 12. 阶段性里程碑

### Phase 1（4 周）：地基

- W1: MySQL schema migration + knowledge ingestor + 业务树 API + 前端 layout + 树渲染
- W2: cron ingestor + L2 业务详情页（只读 frontmatter + Mermaid 渲染）
- W3: orchestrator + 跨源关联策略 A 实现 + broken_refs 检测
- W4: docker-compose 跑通 + 内网 staging 部署（basic auth）+ Phase 1 demo

**Phase 1 验收：** 用户能从树进入 Moolah > Emission，看到完整文档 + Mermaid + cron 列表，通过 path 跳转其他业务。

### Phase 2（4 周）：完整数据 + 搜索

- W5: api ingestor + entity ingestor + 跨源关联策略 B（启发式）
- W6: contract ingestor + frontend ingestor
- W7: Cmd+K 全局搜索（5 表 UNION）+ L3 节点详情页
- W8: 反向关联（"Used by"）+ Phase 2 demo

**Phase 2 验收：** 4 个 user story（PRD §4.2）全部能在平台完成。

### Phase 3（4 周）：源码 + 上线

- W9: Monaco 集成 + `/code/{repo}/*` 页面 + 文件树
- W10: 源码脱敏机制（白名单 + 黑名单 + redact pattern + 路径穿越防护 + 审计日志）
- W11: K8s 生产部署 + git-sync sidecar + CronJob 调度 + 监控告警
- W12: SSO 接 OIDC（如 IT 协调到位，否则保持 basic auth）+ 用户文档 + Phase 3 demo

**Phase 3 验收：** 5+ 用户内网正式使用 1 周无 P0 bug。

---

## 13. 风险登记

| ID | 风险 | 严重度 | 缓解 | Owner |
|----|------|--------|------|------|
| R1 | 知识库 file:line 引用腐烂 | 中 | ingestion 时校验 + broken_refs 表记录 + 月度交给 biz-doc 修 | Sunny |
| R2 | 合约地址多链多环境冲突 | 中 | 以 lista-knowledge/onchain 为 SSOT，代码侧 Config.ts 仅作 reverse-link | Sunny |
| R3 | 前端动态 import 路由抓不到 | 低 | 仅静态 JSX + routerPaths.ts 解析；接受 60% 覆盖率 | Sunny |
| R4 | 内网部署需要 IT 协调（K8s ingress / OIDC） | 中 | Phase 1 用 staging 不阻塞；Phase 3 提前 2 周打 ticket | Sunny + IT |
| R5 | 源码暴露敏感信息 | 高 | §8 安全机制全套实现 + 审计日志 + 月度审计 | Sunny |
| R6 | MySQL 写入并发冲突 | 低 | rebuild 用单实例 K8s Job + advisory lock（GET_LOCK/RELEASE_LOCK） | Sunny |
| R7 | lista-mono pnpm monorepo 多 app | 低 | 每个 app 独立 ingest（app_name 字段区分） | Sunny |
| R8 | DB 账号无 DDL 权限 | 中 | Phase 1 启动前与 DBA 确认，必要时申请新账号 | Sunny + DBA |
| **R9** | **Redis key 抽取依赖启发式** | 中 | (a) 默认 confidence 0.7 而非 1.0；(b) 仅识别静态字符串 / template literal；(c) 模板变量 `${X}` 标准化为 `{X}`；(d) 拼接表达式接受失败（输出 unknown 节点）；(e) 长期靠研发在 Redis 工具类加 JSDoc `@redis-key 'foo:{bar}'` 注解提升精度 | Sunny |
| **R10** | **流程图节点超过 50+ 时 React Flow 卡顿** | 低 | (a) 默认仅展示 confidence ≥ 0.6 的节点；(b) "仅高频路径"按钮过滤；(c) 业务节点过多时分子业务展示 | Sunny |
| **R11** | **TRUNCATE 不能事务回滚** | 中 | 改用 staging 表 + RENAME swap 模式（§4.2），失败可重试不污染线上 | Sunny |
| **R12** | **私钥脱敏正则误伤合法 hash** | 中 | `0x[a-f0-9]{64}` 仅在变量名暗示私钥时（`private_key`/`signing_key`）才脱敏，避免误伤 tx hash / merkle root | Sunny |

---

## 14. 不做的事（明确划线）

| 不做项 | 理由 | 替代方案 |
|--------|------|---------|
| 链上实时数据查询 | 范围爆炸，已有 chain explorer | 显示 Cron 上次跑的时间戳（DB 查询） |
| 用户权限分级 | 内网信任边界已经足够 | 全员同等可见 |
| 编辑业务文档 | 写入 SSOT 必须走 biz-doc 流程 | 节点详情提供"跳到 lista-knowledge 仓库"链接 |
| 手机端响应式 | 桌面工作流为主 | 默认仅桌面浏览器 |
| 自然语言问答 | ask-knowledge 已经做 | 提供"在 ask-knowledge 中提问"快捷链接 |
| 跨链桥接业务建模 | lista-knowledge 暂未文档化 | 等 biz-doc 补完文档再说 |
| 代码 LSP / 跳转到定义 | 工程量爆炸 | Monaco 只读 + ctags 简单 symbol 索引（Phase 3 评估） |
| 实时构建（webhook） | 配置成本 > 收益 | cron 每日 + UI 一键 rebuild |
| 知识库写入 | 与 biz-doc 边界冲突 | 永远只读 |

---

## 15. 附录

### 15.1 完整 MySQL DDL

见 §3.1 - §3.4，可直接拷贝执行。

### 15.2 现有数据源清单

| 数据源 | 路径 | 估计规模 |
|--------|------|---------|
| lista-knowledge | `/Users/quansong/Documents/code/lista-knowledge/business/` | 49 文档，288 处 Mermaid |
| 链上合约清单（主网+测试网） | `/Users/quansong/Documents/code/lista-knowledge/onchain/{bsc-mainnet,bsc-testnet,eth-mainnet}.md` | 30+ 合约 |
| ABI 档案 | `/Users/quansong/Documents/code/lista-knowledge/onchain/abis/*.json` | 20+ ABI |
| Cron 装饰器 | `lista-cron/src/modules/**/*.service.ts` | 315 个 |
| Cron 装饰器 | `lista-bot/src/modules/**/*.service.ts` | 5 个 |
| API Controller | `lista-admin/src/modules/**/*.controller.ts` | 10 个 |
| Entity 文件 | `lista-admin/src/entity/**/*.entity.ts` | 18 个 |
| 前端路由 | `lista-mono/apps/lista/src/router.tsx` + `routerPaths.ts` | 96+ |
| 前端 API | `lista-mono/apps/lista/src/api/*.ts` | 12+ class |
| **Redis 操作** | grep `redisService.` / `redisClient.` 在 lista-cron / lista-bot / lista-admin | 估 50-100 个 key 模式 |

### 15.3 关键文件路径速查表

**业务知识库：**
- `lista-knowledge/business/business-outline.md` — L1 树根
- `lista-knowledge/business/moolah/emission.md` — 业务→实现映射范例
- `lista-knowledge/INDEX.md` — 行号索引（可参考实现 FULLTEXT）
- `lista-knowledge/scripts/validate-frontmatter.py` — frontmatter schema（ingestor 复用）

**Ingestion 入口：**
- `lista-cron/src/libs/crons/cron.ts` — `CRON_JOBS` 集中注册
- `lista-cron/src/config/moolahConfig.ts` — 合约地址配置模板
- `lista-admin/src/entity/moolah/moolahVault.entity.ts` — Entity 模板
- `lista-mono/apps/lista/src/router.tsx` — 路由静态 JSX
- `lista-mono/apps/lista/src/api/moolah.ts` — API 单例 class 模板
- `lista-cron/src/libs/redis/` （或类似 RedisService 模块）— Redis 操作集中入口
- `lista-admin/src/modules/launchpool/launchpool.service.ts:54` — `callCronApi()` 代理调用模式起点

**复用工具：**
- `lista_qa-skill/agents/biz-doc.md` — 写入流程参考
- `lista_qa-skill/skills/ask-knowledge/` — 互补查询入口

### 15.4 待协调清单（IT / DBA）

| 项 | Owner | 时机 | 备注 |
|----|------|------|------|
| `lista_qa` 库 DDL 权限 | DBA | Phase 1 W1 | 确认 `bijieprd` 是否够用 |
| K8s namespace + ingress | IT/DevOps | Phase 1 W4 | 申请 `panorama.lista.internal` 域名 |
| git-sync deploy key | DevOps | Phase 1 W4 | 5 个仓库各一个 read-only deploy key |
| OIDC IdP 配置 | IT | Phase 3 W12 | redirect URI / scope / claims |
| 监控接入（Prometheus / Slack） | DevOps | Phase 3 W11 | metrics endpoint 协议对齐 |

### 15.5 后续可考虑的增强

不在 Phase 1-3 范围，但值得记下来以备后续：

- **ChangeLog 追踪**：build_meta 之间的 diff，让用户看到"本周新增的 cron / api"
- **业务健康度评分**：每个 domain 算一个分（last_verified 新鲜度 / broken_refs 数量 / 文档覆盖率）
- **手写 vs auto 流程图漂移检测**：对比 lista-knowledge mermaid 中提到的实体名 vs 实际 ingest 出来的节点，差异列入 broken_refs
- **数据迁移看板**：显示 schema 变更 / 新增 cron / 新增合约的时间序列
- **集成 lista_qa-skill 的 verify 系列**：从 Panorama 节点一键触发 `verify market` 等运维操作
- **自动 PR 修复 broken_refs**：发现失效引用时调用 biz-doc agent 自动开 PR 修文档（从消费者升级为知识库 CI 引擎）
- **manifest 契约化降低耦合**：上游仓库可选提供 `panorama.manifest.json`，ingestion 优先读 manifest，AST 扫描作 fallback
- **VS Code 扩展**：复用 graph.json 数据，在 IDE 内查看"我正在改的 cron 影响哪些业务"
- **panorama skill**：包装查询 API 暴露给其他 AI agent，让 ask-knowledge / code-review 等可以查 panorama 数据
