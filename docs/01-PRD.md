# Panorama 业务全景图平台 — 产品需求文档（PRD）

## 1. 文档信息

| 字段 | 值 |
|------|-----|
| 文档名称 | Panorama 业务全景图平台 PRD |
| 版本 | v0.2 |
| 状态 | 评审中（Phase 0 完成） |
| 作者 | Sunny (QA) + Claude Code |
| 创建日期 | 2026-05-01 |
| 最后更新 | 2026-05-01（v0.2: 同步 8 版 mockup 设计成果） |
| 评审人 | 待定（建议：QA Lead、后端 Lead、前端 Lead 各 1 人） |
| 关联文档 | [02-tech-design.md](./02-tech-design.md) |

---

## 2. 背景与动机

### 2.1 现状痛点

Lista DAO 当前业务知识、代码、合约信息分散在 5 个独立项目中：

| 项目 | 职责 | 规模 |
|------|------|------|
| `lista-mono` | React 前端 monorepo | 96+ 路由、12+ API client class |
| `lista-admin` | NestJS Admin API | 10 个 Controller、18 个 Entity |
| `lista-bot` | NestJS 自动化任务 | 5 个 @Cron 装饰器 |
| `lista-cron` | NestJS 定时任务 | 315 个 @XxlJobHandler / @Cron |
| `lista-knowledge` | 业务知识库 | 9 业务域、49 个文档、288 处 Mermaid 图 |

具体痛点：

**痛点 1：跨项目跳转成本高。** QA 设计一条"借贷 emission 自动领取"的测试用例时，要打开 lista-knowledge 看业务说明 → lista-cron 找 `moolahEmissionTask.service.ts` → BscScan 查合约方法 → lista-mono 找前端入口；至少 4 个上下文切换。

**痛点 2：业务影响面缺乏反向视图。** 研发改动 `MerkleDistributor` 合约时，没有"哪些 Cron / API / 前端调用了这个合约"的反向查询能力，全凭记忆 + grep。

**痛点 3：新人 onboarding 慢。** 新研发理解协议结构需要逐个项目走读 + 反复问人，没有"协议地图"作为导览。

**痛点 4：业务文档与代码脱节。** lista-knowledge 已经手写了大量"业务→实现"映射（如 [emission.md L306-320](../../../lista-knowledge/business/moolah/emission.md) 列出了前端 hook + API + Bot + Cron + 合约地址），但代码重构后行号引用会腐烂，没有自动化校验机制。

### 2.2 为什么现在做

- **素材成熟度已过临界点**：lista-knowledge 9 个业务域、288 处 Mermaid、frontmatter 元数据已经成体系；代码侧装饰器命名统一（@Cron / @Controller / @Entity 都可静态发现）。前期"内容沉淀"工作已经完成，差工程化整合。
- **AI 协作模式确立**：单人 + Claude Code agent 团队让"3 个月跨项目工程"在过去不可行，现在可行。
- **knowledge-gaps 反馈闭环需要可视化入口**：当前 ask-knowledge skill 已经能识别知识盲区，但缺乏一个"看到全貌、定位空白"的浏览界面。

### 2.3 不做的代价

| 维度 | 不做的代价 |
|------|------------|
| 人效 | QA 每次设计测试用例多花 30-60 分钟跨项目定位；新人 onboarding 多花 1-2 周 |
| 知识资产 | lista-knowledge 已有的"业务→实现"映射继续腐烂，broken_refs 累积无人修 |
| 协作 | 业务方 / 产品理解协议结构依赖口口相传，无 self-service 入口 |

---

## 3. 目标与非目标

### 3.1 In-Scope（本平台要做的）

- ✅ 提供"业务树"层次导航（业务域 → 子业务 → 实现分类 → 具体节点）
- ✅ 在业务详情页展示 4 个 stats 卡片（Cron Jobs / Contracts / API Endpoints / Storage Keys 计数）
- ✅ **业务流程图**：React Flow + dagre 自动布局，6 lane（UI / API / Cron / Contract / DB / Redis），节点可点击
- ✅ 业务详情页"实现清单" 6 Tab：UI / API / Cron / Contract / DB / Redis
- ✅ **节点详情抽屉**（slide-in 从右）：元数据 + 关联代码片段 + 上下游引用
- ✅ 合约节点提供主网 / 测试网 BscScan 一键跳转 + ABI 查看
- ✅ 选中节点时高亮直接关联节点（紫色 ring）+ 淡化无关节点（70% 透明度）
- ✅ 全局搜索 6 类索引（业务名、合约名/地址、Cron 名、API 路径、Entity 表名、Redis key 模式）
- ✅ 嵌入式源码浏览（Monaco 渲染 5 个上游仓库的源码，敏感信息脱敏）
- ✅ 反向关联查询（"哪些业务用了这个合约"）
- ✅ 内网部署，QA + 研发可访问

### 3.2 Out-of-Scope（明确不做）

- ❌ **链上实时数据**：不查链上余额、Apollo Config 实时值、当前 emission rate
- ❌ **权限分级**：不做按角色控制可见性（内网用户均可读全量）
- ❌ **编辑能力**：用户不能在 Panorama 修改业务文档（写入仍走 biz-doc agent）
- ❌ **手机端适配**：仅桌面浏览器
- ❌ **替代 ask-knowledge skill**：不做自然语言问答（与 ask-knowledge 互补）
- ❌ **替代 lista-knowledge 维护流程**：不做知识库写入、frontmatter 校验（这是 biz-doc + scripts 的职责）
- ❌ **跨链桥接业务建模**：仅展示已经在 lista-knowledge 文档化的业务

---

## 4. 用户与场景

### 4.1 用户画像

| 用户 | 占比预估 | 主要使用方式 |
|------|---------|-------------|
| QA 工程师 | 40% | 设计测试用例时定位业务全链路；归档知识 |
| 后端研发 | 25% | 评估改动影响面；查找业务依赖 |
| 前端研发 | 15% | 找前端路由对应的后端 API；查合约接口 |
| 新人 onboarding | 10% | 浏览协议结构；理解业务关系 |
| 产品 / 业务方 | 10% | 自助查询业务概况，不深入代码 |

### 4.2 关键场景（User Stories）

#### S1：QA 设计测试用例时定位业务全链路（高频）

**Given** 我（QA）收到一个 JIRA：测试 "Moolah Emission Auto-Claim 自动领取功能"
**When** 我打开 Panorama，在左侧树展开 `Lista DAO > Moolah > Emission > Cron Jobs`
**Then** 我能在右侧看到：
- 该业务关联的所有 Cron（包括 50007/50008/50011/50012/50013 共 5 个）+ schedule
- 自动领取调用的合约（`MerkleDistributor` + `RewardRouter` 4 个实例）+ 方法名
- 前端入口（`apps/lista/src/modules/reward/hooks/`）
- 涉及的 DB 表（emission_reward_log 等）
- 知识库文档链接（emission.md），可一键跳转到 ask-knowledge 提问

**验收**：5 分钟内定位完测试用例需要的所有上下文，不需要打开 5 个项目目录。

#### S2：研发评估 Cron 改动的业务影响面（中频）

**Given** 我（后端研发）准备修改 `lista-cron/.../moolahLiquidationTask.service.ts`
**When** 我在 Panorama 搜索 `moolahLiquidationTask`
**Then** 我能看到：
- 该 Cron 所属业务域（Moolah > Liquidation）
- 它写入的 DB 表
- 它调用的合约 + 方法
- **反向查询**：哪些前端路由 / API endpoint 间接依赖这个业务流（"被引用"面板）

**验收**：能在 PR 描述中准确列出影响面，不漏一个下游消费方。

#### S3：新人 onboarding 浏览协议结构（低频高价值）

**Given** 我是新入职的研发，第一周熟悉 Lista 协议
**When** 我打开 Panorama 默认页 `/`
**Then** 我看到：
- 9 个业务域的树状导航（Moolah / Staking / CDP / Governance / Revenue / Infrastructure / Credit / RWA / Operations）
- 每个业务域顶层有概览段落 + 入口 Mermaid 图
- 可以从任一节点点击 "在 ask-knowledge 中提问" 触发自然语言探索

**验收**：1 天内能讲清楚协议主要业务模块和大致依赖关系，不再依赖逐个项目走读。

#### S4：应急排障时快速定位业务依赖的合约 / API（低频高紧急）

**Given** 监控告警 `MerkleDistributor 0xABCD` 出现异常调用
**When** 我在 Panorama 全局搜索 `0xABCD` 或 `MerkleDistributor`
**Then** 我能看到：
- 该合约对应的业务（Moolah Emission）
- 调用它的所有 Cron / API / 前端路由（即"风暴半径"）
- 关联的 DB 表（用于排查数据一致性）
- 跳转到合约对应的 ABI 和最近一次 last_verified 日期

**验收**：5 分钟内列出受影响范围 + 主要 owner，缩短 MTTR。

---

## 5. 信息架构

### 5.1 业务树层次

业务树从根到叶最多 5 层：

```
L0: Lista DAO (root)
└── L1: 业务域（9 个，对应 lista-knowledge/business/{moolah,staking,cdp,...}）
    └── L2: 子业务（如 Moolah > Emission / Liquidation / Supply&Borrow）
        └── L3: 实现分类（Cron Jobs / APIs / Entities / Contracts / Routes）
            └── L4: 具体节点（单个 cron 任务 / API endpoint / Entity / Contract / Route）
```

L1 / L2 节点来自 `lista-knowledge/business/`目录结构 + `business-outline.md` 顶层目录定义。
L3 是固定的 5 类聚合视图。
L4 是 ingestion 从代码库自动抽取的具体实体。

### 5.2 节点类型清单

**6 类业务实体节点**（流程图 + 详情抽屉的展示对象）：

| 节点类型 | 类型色 | 来源 | 关键属性 |
|---------|------|------|---------|
| **FrontendRoute** (UI) | `#5BC0DE` 青 | lista-mono routerPaths.ts + router.tsx | app, path, component |
| **ApiEndpoint** (API) | `#5DE090` 绿 | lista-admin Controller 扫描 | method, path, controller, file:line |
| **CronJob** (CRON) | `#FFB840` 黄 | lista-cron/lista-bot 装饰器扫描 | name, schedule, file:line, handler_class |
| **Contract** (SOL) | `#F87171` 红 | lista-knowledge/onchain + abis | name, address (mainnet+testnet), chain, abi |
| **Entity** (DB) | `#B19DFF` 紫 | NestJS @Entity 装饰器 | tableName, columns |
| **RedisKey** (RDS) | `#F58BC2` 粉 | lista-cron/lista-bot 代码扫描 redis ops | key_pattern, redis_type, ttl |

**辅助节点**（不在流程图主舞台展示，承担数据组织职责）：

| 节点类型 | 来源 | 关键属性 |
|---------|------|---------|
| BusinessDomain | lista-knowledge/business 目录结构 | name, parent, description |
| KnowledgeDoc | lista-knowledge/business/*.md | path, title, frontmatter |
| Concept | frontmatter.concepts/aliases | name, aliases |
| CodeRef | 知识库正文 file:line 引用 | repo, file, line, snippet |

### 5.3 关联类型

实体之间的关系是平台核心价值所在：

| 关系 | 示例 |
|------|------|
| Doc DESCRIBES Domain | `emission.md` 描述 `Moolah > Emission` |
| Cron BELONGS_TO Domain | `moolahEmissionTask` 属于 `Moolah > Emission` |
| Cron CALLS_CONTRACT | `moolahEmissionTask` 调用 `MerkleDistributor.setMerkleRoot` |
| Cron WRITES Entity | `moolahEmissionTask` 写入 `emission_reward_log` |
| **Cron READS/WRITES RedisKey** | `moolahEmissionTask` 写 `moolah:emission:pending_root` |
| Api READS/WRITES Entity | API endpoint 读写哪些表 |
| **Api READS/WRITES RedisKey** | `/api/moolah/rewards/claimable` 读 `moolah:claim_status:{addr}` |
| Api CALLS_CONTRACT | API 直接读合约（如 `isClaimed` 查询） |
| Api CALLS_CRON | `callCronApi()` 模式（lista-admin → lista-cron 代理调用） |
| FrontendRoute CALLS_API | `/dashboard/rewards` 调用 `/api/moolah/rewards` |
| Doc REFERENCES CodeRef | 知识库引用具体 file:line |

---

## 6. UX 流程

### 6.1 默认入口（`/`）

- 左侧业务树展开到 L1（9 个业务域可见，L2 折叠）
- 右侧显示 Lista 协议总览 README（取自 `lista-knowledge/README.md` 或 `business-outline.md`）
- 顶部导航：搜索框（Cmd+K）+ "立即重建"按钮（管理员可见）+ 上次构建时间戳

### 6.2 业务详情（`/domain/{id}`）

点击树中的 L1 / L2 节点（如 `Moolah > Emission`），主内容区从上到下：

1. **面包屑**：`Lista DAO / Moolah / Emission`
2. **Hero 卡**：H1 业务名 + 描述段 + concepts 标签 + 右上角 verified meta（last_verified 日期 + 来源 PR）
3. **Stats 卡片行**（4 个）：Cron Jobs / Contracts / API Endpoints / Storage Keys 的计数统计
4. **业务流程图**（核心）：
   - **React Flow + dagre 自动布局**生成的 6 lane 流程图（UI / API / CRON / CONTRACT / DB / REDIS）
   - 节点根据类型染色 + 左侧色条标识；节点上有快捷动作（合约的 🌐主网 / 🧪测试网 / ≡ ABI）
   - 边类型：实线 = 权威关系（confidence=1）；虚线 = 启发式推断；选中节点的相关边变紫色 + 数据流动效
   - 节点点击 → 右侧抽屉滑入显示详情
   - 工具栏（缩放 / 重置 / minimap 缩略图 / "auto layout" 按钮）
5. **实现清单 6 Tab 表格**：UI / API / Cron / Contract / DB / Redis
   - 每行点击 → 跳到对应节点详情抽屉
   - Contract Tab 列出主网/测试网双地址 + BscScan 链接
6. **完整业务文档**：折叠面板，展开后显示 emission.md 完整 markdown 渲染（含手写 Mermaid 流程图，作为业务意图参考）
7. **关联面板**：相关业务域、相关 Concepts

### 6.3 节点详情（抽屉式 slide-in）

点击流程图节点 / 实现清单某行 / 树叶子 / 搜索结果：

- **抽屉行为**：
  - 默认收起；点击触发后从右侧滑入（420-460px 宽，overlay 在主内容上）
  - 主内容区会有轻微 backdrop 暗化（提示焦点切换）
  - 关闭：✕ / Esc / 点击 backdrop / 抽屉外右侧标签
  - 抽屉关闭后流程图恢复全宽

- **抽屉内容**（按节点类型动态调整）：
  - **顶部**：类型徽章 + 节点路径面包屑（`Moolah / Emission`）+ 大标题 + verified 状态
  - **基本信息**：file:line / 最后修改 / 所属业务域 / 描述
  - **特定字段**：
    - Contract 节点：主网 + 测试网双地址卡（含 copy / BscScan / Read Contract 按钮）+ ABI 主要方法预览
    - Cron 节点：schedule / handler class / 上次运行时间
    - Entity 节点：columns 列表
    - RedisKey 节点：key 模式 / TTL / Redis 数据类型
  - **代码片段**：Monaco 渲染该文件首 100 行（脱敏后）+ "在云代码中打开"按钮跳到 `/code/{repo}/...`
  - **关联（Used by / Calls）**：
    - 上游：哪些节点引用了它
    - 下游：它引用了哪些节点
  - **Ask Panorama**（可选）：建议问题 + 自由问答输入框，调用 ask-knowledge skill
  - **底部固定**：📖 业务文档 / ↗ GitHub 源码 快捷按钮

### 6.4 全局搜索（Cmd+K）

模态搜索框，支持 6 类索引：

| 类型 | 匹配字段 | 结果跳转 |
|------|---------|---------|
| BusinessDomain | name + concepts | `/domain/{id}` |
| Contract | name + address | `/node/contract/{id}` |
| CronJob | name + description | `/node/cron/{id}` |
| ApiEndpoint | path + controller | `/node/api/{id}` |
| Entity | tableName | `/node/entity/{id}` |
| **RedisKey** | key_pattern | `/node/redis/{id}` |

结果按类型分组展示，每组最多 5 条，回车跳转。

### 6.5 反向关联

L3 节点详情里的"关联面板"是反向关联的核心载体：

- 在 Contract 节点详情看 "Used by"：列出所有调用这个合约的 Cron / API / Frontend Route
- 在 Entity 节点详情看 "Used by"：列出读写这张表的 API / Cron
- 在 BusinessDomain 详情看 "Implements" 列表

### 6.6 云代码浏览（`/code/{repo}/{path}`）

独立页面，左侧文件树（按目录懒加载），右侧 Monaco 渲染源码：

- 文件白名单：仅 `lista-mono / lista-admin / lista-bot / lista-cron / lista-knowledge` 5 个仓库
- 文件黑名单：`*.env*` / `*secret*` / `*.key` / `*.pem` 直接 404
- 内容脱敏：响应前过滤私钥模式（64 hex 字符）
- 顶部 breadcrumb + "复制 file:line 引用"按钮（生成 `repo/path/file.ts:42` 格式，方便贴到知识库）

---

## 7. 成功指标

### 7.1 量化指标（上线 3 个月内）

| 指标 | 目标 | 测量方式 |
|------|------|---------|
| **QA 测试用例覆盖率** | 80% 用例可从 Panorama 单平台找到链路信息 | 月度抽样 20 条新用例，统计是否需要跳出平台 |
| **新人 onboarding 时长** | 从 X 天降到 Y 天（目标 -30%）| 入职第 1 周末做协议结构问答测试 |
| **broken_refs 数量** | 月度环比下降 | ingestion 自动产出 broken_refs.md，统计条目数 |
| **平台 DAU** | QA + 研发团队 60% 周活 | webapp 后端日志 |

### 7.2 定性指标

- 新人在 onboarding 周结束时，能独立画出 Lista 协议的业务关系图
- QA 在设计 emission / liquidation 等复杂业务测试时，不再需要研发陪同走读
- 应急排障时，能在 5 分钟内列出受影响业务

---

## 8. 与现有工具的关系

```
                ┌──────────────┐
                │ lista-knowledge │  ← 唯一可信源（SSOT）
                │  (49 docs)      │
                └─────┬────┬──────┘
                      │    │
        只读消费 ─────┘    └───── biz-doc agent 写入
                │                  + scripts/validate-frontmatter.py
                │                  (唯一写入通道)
                ▼
        ┌──────────────┐         ┌─────────────────┐
        │  Panorama    │         │ ask-knowledge   │
        │  (浏览/导航)  │←─互补──→│  (自然语言问答)  │
        └──────────────┘         └─────────────────┘
                │
                ▼
            QA / 研发 / 业务方
```

**核心边界：**

| 工具 | 职责 | 与 Panorama 的关系 |
|------|------|-------------------|
| `lista-knowledge` | 知识库 SSOT | Panorama 只读消费，绝不写入 |
| `biz-doc` agent | 知识库写入 | 用户在 Panorama 看到内容缺失 → 转到 biz-doc 流程补 |
| `ask-knowledge` skill | 自然语言问答 | Panorama 节点详情提供"在 ask-knowledge 中提问"快捷入口 |
| `validate-frontmatter.py` | frontmatter 校验 | Panorama ingestion 复用其 schema 定义 |
| `code-review` skill | 代码审查 | Panorama 不替代，互不影响 |

---

## 9. 风险与开放问题

### 9.1 已知风险（详见 02-tech-design.md 风险登记）

| ID | 风险 | 严重度 | 缓解 |
|----|------|--------|------|
| R1 | 知识库 file:line 引用腐烂 | 中 | ingestion 时校验 + broken_refs 报告 |
| R2 | 合约地址多链多环境冲突 | 中 | 以 lista-knowledge/onchain 为 SSOT |
| R3 | 前端动态 import 路由抓不到 | 低 | 仅静态 JSX，覆盖 60% 即可 |
| R4 | 内网部署需要 IT 协调 | 中 | Phase 3 才需要，提前打报告 |
| R5 | 源码暴露敏感信息 | 高 | 文件白名单 + 私钥模式脱敏 |

### 9.2 开放问题（待评审决策）

| ID | 问题 | 备选方案 |
|----|------|---------|
| O1 | DB 账号写权限：`bijieprd` 是否有 `lista-qa` 库的 DDL 权限？ | A. 直接用 / B. 申请新账号 / C. 用单独 schema |
| O2 | 5 个上游仓库 git checkout 怎么同步到生产 K8s pod？ | A. CI 推镜像 / B. 卷挂载 / C. ssh git clone |
| O3 | SSO 接公司 OIDC 的优先级？ | A. Phase 1 就接 / B. Phase 3 接 / C. 永远 basic auth + IP 白名单 |
| O4 | 是否需要给业务方提供"简化视图"（隐藏 Cron / Entity / Route 技术细节）？ | A. 单一视图 / B. 加视图切换 / C. Phase 2 评估再定 |

---

## 10. 里程碑与发布节奏

| 阶段 | 时长 | 交付 | 状态 |
|------|------|------|------|
| **Phase 0** | 1-2 周 | PRD + Tech Design + UI Mockup（v1 → v8 共 8 版迭代） | ✅ **已完成** |
| **Phase 1** | 4 周 | MySQL schema + knowledge/cron ingestor + 树形导航 + L2 只读 | 待启动 |
| **Phase 2** | 4 周 | api/contract/entity/frontend/redis ingestor + Cmd+K 搜索 + L3 抽屉 + React Flow 业务流程图 | 待启动 |
| **Phase 3** | 4 周 | Monaco 代码浏览器 + 源码脱敏 + 反向关联 + 内网部署 + SSO（Phase 1 用 basic auth） | 待启动 |

**评审节奏：** 每个 Phase 末做一次 Demo + 收集反馈，下一个 Phase 起开 Kick-off 同步 backlog。

---

## 11. 附录

### 11.1 术语表

| 术语 | 含义 |
|------|------|
| Panorama | 本平台名 |
| Domain | 业务域，如 Moolah / Staking |
| ingestion | 从代码 / 知识库抽取数据写入 MySQL 的过程 |
| broken_refs | 知识库中失效的 file:line 引用 |
| SSOT | Single Source of Truth |

### 11.2 数据源清单

- `lista-knowledge/business/*.md`（49 个文档）
- `lista-knowledge/onchain/{bsc,eth}-mainnet.md` + `onchain/abis/*.json`
- `lista-cron`、`lista-bot`、`lista-admin`、`lista-mono` 四个代码库

### 11.3 Mock UI 设计稿

Phase 0 已交付 8 版迭代，最终版 [`design/mockup.html`](../design/mockup.html)（v8）：

| 版本 | 核心改动 |
|------|---------|
| v1 | 五类节点初版（UI / Cron / API / Entity / Contract） |
| v2 | "On-chain Engineering Console" 风格（衬线斜体 + CAD 角括号），过度设计 |
| v3 | 回归 Lista 主站视觉语言（紫色主交互 + Inter sans）|
| v4 | 顶栏精简 + 抽屉化 + 流程图打磨（lane 背景 / 数据流动效）|
| v5 | 严格 3 列网格 + 提亮文字 + 边端点精确到节点中心 |
| v6 | 节点 flex 布局 + ellipsis + 合约 header 简化 + bypass 边从合约左侧进入 |
| v7 | 节点高度修复（line-height 影响）+ 文字不再裁切 |
| **v8** | **画布拉宽到 1480px，列间距 480，节点宽 240** |

历史迭代见 [`design/iterations/`](../design/iterations/)，主站参考截图见 [`design/assets/`](../design/assets/)。

### 11.4 参考实现 / 灵感来源

- Spotify Backstage Software Catalog（树形 + 实体卡片范式）
- VS Code Explorer + 文件预览（左树右内容布局）
- GitHub.dev / Sourcegraph（嵌入式代码浏览）
- Internal Developer Portal 业界实践（Cortex / Port / OpsLevel）
