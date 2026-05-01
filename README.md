# Panorama

Lista DAO 业务全景图平台 — 树形导航 + 流程图 + 实现清单 + 源码浏览。

> **状态：** Phase 0 设计阶段（PRD + Tech Design + UI Mockup 已完成，待评审后进入实现）

---

## 是什么

让 QA / 研发 / 业务方从一棵业务树进入，**一屏看到该业务的完整实现链路**：

- 前端路由（lista-mono）
- 后端 API（lista-admin）
- 定时任务（lista-cron / lista-bot）
- 智能合约（含主网/测试网地址 + ABI + 一键跳 BscScan）
- 数据库表（MySQL Entity）
- Redis 缓存键

并就地浏览源码与 lista-knowledge 业务文档。

## 目录结构

```
panorama/
├── README.md                       # 本文件
├── .meta.json                      # Phase / status / 关键决策
├── docs/                           # 设计文档
│   ├── 01-PRD.md                   # 产品需求文档（场景 / 信息架构 / 成功指标）
│   └── 02-tech-design.md           # 技术设计（MySQL DDL / Ingestion / API / 部署）
└── design/                         # UI 设计稿
    ├── mockup.html                 # 当前最新版（v8）— 在浏览器打开直接看
    ├── iterations/                 # 历史迭代版本 v1 → v8
    │   ├── v1.html ~ v8.html
    └── assets/                     # 参考素材（Lista 主站截图）
        ├── lista-borrow.png
        └── lista-home.png
```

## 关键决策（已对齐）

| 维度 | 决策 |
|------|------|
| 存储 | MySQL（复用 lista_qa 实例，新建 `panorama_*` 前缀表） |
| 可视化 | 左侧业务树 + 右侧抽屉式节点详情；流程图用 React Flow 实现 |
| 触发更新 | Cron 每日 02:00 + UI 一键 rebuild（不做跨仓库 GitHub Actions） |
| 节点类型 | 6 类：UI / API / Cron / Contract / DB / Redis |
| 团队 | 单人 + AI agent 协作（Sunny + Claude Code） |
| 共存 | 与 lista-knowledge / ask-knowledge / biz-doc 互补，仅只读消费 |

## 阶段计划

| 阶段 | 时长 | 交付 |
|------|------|------|
| **Phase 0**（当前） | — | PRD + Tech Design + UI Mockup |
| **Phase 1** | 4 周 | MySQL schema + knowledge/cron ingestor + 树 + L2 只读 |
| **Phase 2** | 4 周 | api/contract/entity/frontend ingestor + Cmd+K 搜索 + L3 节点详情 |
| **Phase 3** | 4 周 | Monaco 代码浏览器 + 源码脱敏 + 反向关联 + 内网部署 + SSO |

详见 [docs/02-tech-design.md §12](./docs/02-tech-design.md)。

## 数据源

| 来源 | 用途 |
|------|------|
| `lista-knowledge/business/*.md` | 业务概述 + frontmatter + Mermaid 图（49 文档） |
| `lista-knowledge/onchain/{bsc,eth}-mainnet.md` + `abis/` | 合约地址 + ABI（30+ 合约） |
| `lista-cron`、`lista-bot` | @Cron / @XxlJobHandler 装饰器扫描 |
| `lista-admin` | @Controller / @Entity 装饰器扫描 |
| `lista-mono` | routerPaths.ts + router.tsx + API class |

## 计划技术栈

- **前端**：Next.js 14 App Router + React Flow + Monaco Editor
- **后端**：Next.js Route Handler（无独立 BFF）
- **存储**：MySQL（复用 lista_qa）
- **Ingestion**：Node.js + ts-morph + git-sync
- **部署**：K8s + 内网 ingress

## 待协调清单

| 项 | Owner | 时机 |
|----|------|------|
| `lista_qa` 库 DDL 权限确认 | DBA | Phase 1 W1 |
| K8s namespace + ingress 申请 | DevOps | Phase 1 W4 |
| 5 个上游仓库 deploy key | DevOps | Phase 1 W4 |
| OIDC SSO 配置 | IT | Phase 3 W12 |

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
# 期望: "Applied: 000_migration_history.sql, 001_..., 002_..., ..."
```

### 日常开发

```bash
# 拉最新业务知识 + 代码后，重建数据
pnpm rebuild

# 启动 webapp（开发模式，热重载）
pnpm dev
# → http://localhost:3000

# 跑测试（所有包）
pnpm test
```

### Docker 模式（贴近生产）

```bash
docker compose up webapp -d                              # webapp 起在 :3000
docker compose --profile build run --rm ingestion        # 一次性 ingestion
docker compose down
```

### Phase 1 验收清单

- [ ] `pnpm migrate` 应用 6 个 SQL 迁移（000 + 001-005）无错
- [ ] `pnpm rebuild` 成功结束，build_meta status = success
- [ ] 访问 `/` 看到 9+ 个业务域树
- [ ] 点击 Moolah → Emission，看到 frontmatter concepts、cron 列表、完整 markdown + mermaid 渲染
- [ ] 顶栏 SyncIndicator 显示最近一次成功 build 的相对时间
- [ ] `panorama_broken_ref` 表数量已知（作为 lista-knowledge 维护 backlog 的起点）
- [ ] 设置 `BASIC_AUTH_USER` + `BASIC_AUTH_PASS` 后 `/` 返回 401，`/api/health` 仍返回 200

## License

Internal — Lista DAO
