# 设计：agent-md-revision-and-default-agent

## 方案

### 分层与文件职责

**domain（纯函数，可直接单测，无 fs/SQLite/IPC 依赖）**

- `desktop/src/agent-revision-plan.ts`（新）
  - 段落切块：按空行 / 标题边界把 Markdown 切成块；不假设固定标题结构（`seeds/general-assistant` 的 `AGENT.md` 没有任何标题，切块规则必须在空标题输入下退化为"整份视为一个块"而不是报错或漏切）。
  - 归属传播：给定"上一条修订的块归属表"与"这一条的新块序列"，做块级文本相等比较——相等块沿用上一条的作者标签，不相等块打上这一条的作者与时间。首次修订（没有上一条）全部归属这一条自己。
  - 输出只用于 UI 呈现，不返回给任何合并调用方。
- `desktop/src/team-official-plan.ts`（扩展）
  - `AppliedOfficialTeamState` 新增内容快照字段（内容本身，不只是指纹；指纹字段保留用于快速比较，避免所有比较都要读全文）。
  - 新增纯函数 `planAppliedBaselineMigration(input: { legacyFingerprint: string; currentContent: TeamContent }): { confidence: "verified" | "conservative"; backfillContent: TeamContent | null }`：当前内容指纹等于旧指纹 → `verified` + 回填当前内容；不等 → `conservative` + 不回填（内容未知）。

**adapter（fs / SQLite / provider 调用）**

- `src/sqlite-state-worker.ts`（扩展迁移，沿用现有 `schema_migrations` + 幂等双跑模式）
  - 新表 `agent_markdown_revisions`：`id`、`team_stable_id`、`member_slug`、`content`（全文）、`author_kind`（`user | official | agent`）、`author_label`（`official` 时存版本号，其余可空）、`summary`（可空）、`summary_status`（`pending | ready | unavailable`）、`created_at`、`batch_id`（可空，本 change 恒为空，change 2 使用）。索引 `(team_stable_id, member_slug, created_at)`。
- `desktop/src/agent-revision-store.ts`（新）：对上表的 CRUD——`createRevision`、`listRevisions(team, member)`、`getRevision(id)`、`updateSummary(id, summary, status)`。
- `desktop/src/default-agent-config-store.ts`（新）：应用级单例 JSON 文档（cli/model/effort/provider 引用），落在数据根、团队内容目录之外，与 `team-management-document-codec.ts` 同级模式。
- `desktop/src/team-official-management.ts`（扩展）：官方基线迁移的一次性执行入口——读旧状态、调 `planAppliedBaselineMigration`、写新状态；`conservative` 分支额外调用 `agent-revision-store` 补一条 `author=user` 的起点修订。迁移失败时旧状态原样保留，不产生半迁移结果（复用仓库既有"失败保留旧状态"的模式，如 `team-management-document-codec.ts` 现有写入约定）。

**application（编排端口与时序）**

- `desktop/src/agent-revision-service.ts`（新）：AGENT.md 保存成功（团队页保存路径与 `team-external-change.ts` 检测到的 Finder 外部变更路径）之后，同步调 `agent-revision-plan` 算归属表、`agent-revision-store.createRevision` 落一条 `author=user` 的修订；随后异步派发摘要任务，不阻塞保存反馈返回。
- `desktop/src/agent-revision-summary-job.ts`（新）：读默认 Agent 配置，调 provider 驱动做一次性单轮补全（system 提示要求"用一句日常语言说明这次改了什么"），写回摘要；默认 Agent 未配置、凭据失效或调用失败 → `summary_status = "unavailable"`，不重试。
- `team-ipc.ts` / `team-ipc-contract.ts`（扩展）：新增 `agent-teams:member-revisions:list`、`agent-teams:member-revisions:restore`（读目标修订内容、当前内容写盘 → 触发 `agent-revision-service` 产生一条新修订，回退因此也留痕）、`agent-teams:default-agent:get`、`agent-teams:default-agent:save`。
- `desktop-team-ipc-wiring.ts` / `desktop-team-wiring.ts`（装配）：挂载新 store / service；应用启动时跑一次官方基线迁移（幂等——已经是新结构的状态直接跳过）。

**view（`packages/console-ui`，纯展示，不读数据根、不调 provider）**

- `agent-markdown-mention-editor.tsx`（扩展）：新增 `changeMarkers: Array<{ blockRange; authorKind; authorLabel; timeLabel; previousText }>` 输入；左侧色条使用 `border-line` / `bg-accent` 令牌，hover 才显形署名（不常驻抢注意力），点击就地展开 `previousText`（不跳转）。
- `agent-markdown-revision-timeline.tsx`（新）：时间线面板，纯展示 revision 列表 + `onRestore(revisionId)` 回调。
- `agent-team-detail.tsx`（扩展）：`AGENT.md` 标题行接入"最近变化"摘要与"全部 ▾/▴"展开态。
- `execution-profile-fields.tsx`（新，从 `agent-team-detail.tsx` 现有内联 JSX 提取）：CLI / Provider / 模型 / 思考程度选择器，供团队成员运行配置与设置页默认 Agent 共用；提取时保持现有静态校验、旧值保留规则的行为不变（回归，不是重写）。
- `settings-dialog.tsx`（扩展）：常规分类新增默认 Agent 设置组，复用 `execution-profile-fields.tsx`。

### 数据链路

```
保存 AGENT.md（团队页 / Finder）
  → team-ipc 写盘成功
  → agent-revision-service：算归属表 → agent-revision-store.createRevision（同步，author=user）
  → IPC 返回保存反馈（不等摘要）
  → agent-revision-summary-job（异步）：读默认 Agent 配置 → 单次调用 provider → updateSummary
  → renderer 下次拉取修订列表时看到摘要（非实时推送）
```

```
应用启动
  → 检测 AppliedOfficialTeamState 是否已是新结构
  → 否：读旧指纹 + 当前内容 → planAppliedBaselineMigration
      → verified：回填内容，写新状态
      → conservative：写新状态（内容缺失标记），补一条 author=user 的起点修订
  → 是：跳过，正常进入现有官方更新流程（本 change 不改这条流程本身）
```

## 权衡

**为什么段落切块和合并单位必须是两套独立代码路径，而不是共享同一个"结构化解析"再各自消费**：如果呈现层的分块结果被合并逻辑复用，切块规则的正确性就从"呈现好不好看"升级为"合并对不对"，而 `seeds/` 里的 `AGENT.md` 标题结构互不相同（`general-assistant` 没有标题），任何依赖标题结构的通用切块规则在真实数据上都会碎掉。保持两套路径，呈现层可以用简单启发式（错了只是标记位置不好看），合并层永远拿完整原文交给默认 Agent 判断（这是 change 2 的事，本 change 不实现，但接口边界现在就要定好，避免 change 2 被迫复用一个不该被复用的分块结果）。

**为什么默认 Agent 用单次调用而不是会话**：PRD 的核心判据是"用户从不参与也能得到一支持续变好的团队"。如果摘要或合并调用走会话/run 生命周期，用户的会话列表里会冒出自己没有发起过的条目，直接违背这条判据。事后追溯需求由修订摘要本身和"点开看原文"承担，不需要完整会话记录。代价是这次调用不会出现在现有的 run 审计（`docs/product/pages/main-conversation.md#Agent-头像与当时信息`）里——这是可接受的，因为那套审计是为"用户发起的工作"设计的，默认 Agent 的后台调用是另一类事件，混进去反而会让用户在会话历史里看到不属于自己的记录。

**为什么 `conservative` 基线在本 change 里只标记不合并**：技术上"没有 A 也能做二路合并"是可行的，但产品上不可接受——没有 A，无法分辨用户主动删掉的官方内容和官方新加的内容，最可能的错误是把用户明确删掉的东西又塞回去，而这批用户恰恰是被旧机制坑得最久、最反感这类"自作主张"的人。把"要不要冒这个险"的判断交还给用户（change 2 的一次性显式入口），比默认帮他赌更安全。

**为什么提取 `execution-profile-fields.tsx`**：`settings.md` 明确要求默认 Agent"复用团队页成员运行配置的同一套选择方式……不新增第二套控件语言"，这不是重构偏好，是产品硬性要求；不提取就必然产生两份平行实现和两次维护成本。

## 风险

- **编辑器交互不确定性**：`agent-markdown-mention-editor.tsx` 现在是纯文本编辑框，加"左侧色条 + hover 显形 + 点击就地展开"这套交互，在实现前无法 100% 确定能否干净地叠加在现有输入框结构上。落地策略：先做 Page Story 验证交互；如果发现结构性冲突（例如就地展开需要打断输入框的连续文本流），停下来找 @product-delivery-lead 另行安排一次隔离 prototype 探索，不强行糊一个能跑但体验劣化的版本。
- **官方基线迁移是一次性、不可逆的存量数据变更**：迁移函数必须在失败时保证旧状态完整可读（不产生半迁移的官方来源身份丢失），设计上复用仓库现有"写入前校验、失败原样保留"模式；测试需覆盖迁移中途崩溃重启的幂等性。
- **默认 Agent 单次调用复用哪一层 provider 驱动**：现有 Codex/Claude/Kimi/Pi 驱动都是为交互式会话设计的，需要在实现阶段确认是否存在足够轻量的单轮补全入口，或者需要新增一个窄的"one-shot completion"适配层。如果现有驱动无法干净地降级为单轮调用，这里的实现成本会高于预期，需要回来更新本设计。
- **回滚思路**：修订表和默认 Agent 配置都是加法数据，回滚只需停止写入新表、编辑器 UI 回退到不带标记的版本；不影响现有团队保存/读取路径，因为本 change 不改动 `team-management-store` 的既有写入语义。
