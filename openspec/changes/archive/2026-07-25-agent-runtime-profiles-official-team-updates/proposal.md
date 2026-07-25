# 提案：agent-runtime-profiles-official-team-updates

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/agent-teams.md` | 页面目标 / 核心流程 | 官方来源团队可编辑；Agent 拥有 CLI、model、effort；官方更新不静默覆盖 | 已写入并通过 QA |
| `docs/product/pages/agent-teams.md` | Agent 运行配置 | Codex/Kimi 硬绑定、推荐/覆盖、能力状态、复制与草稿语义 | 已写入并通过 QA |
| `docs/product/pages/agent-teams.md` | 官方版本与三方比较 | A/B/C 比较、内容指纹排除项、保护优先级 | 已写入并通过 QA |
| `docs/product/pages/agent-teams.md` | 官方成员与运行配置迁移 / 更新官方来源团队 | slug 迁移、保留副本、影响摘要、失败结果 | 已写入并通过 QA |
| `docs/product/pages/agent-teams.md` | 指标与验收 #3、#14–27 | 官方内容编辑、更新与运行配置的本次新增验收 | 已写入并通过 QA |
| `docs/product/pages/main-conversation.md` | 选择工作空间与团队 / Agent 执行与恢复 | 新建与明确换队快照、CLI 硬绑定、同 run 恢复、full fallback、旧会话兼容 | 已写入并完成目标用户视角复审 |
| `docs/product/pages/main-right-sidebar.md` | 完整输出 | 当前只定义 Codex 过程记录；Kimi 过程来源尚未裁决 | PRD 缺口 |
| `docs/product/pages/onboarding.md` | 环境准备 | 当前仍以 Codex 为唯一硬门；Kimi 环境准备尚未裁决 | PRD 缺口 |
| `docs/product/pages/main-conversation.md` | 非目标 | 运行配置无法验证/需要调整时能否创建或换队尚未裁决 | 明确保留范围外 |

本提案不复制 PRD 正文。已确认的产品事实以
`docs/product/pages/agent-teams.md` 与 `docs/product/pages/main-conversation.md`
为准；其余 PRD 缺口与暂开放项不允许由技术方案自行补写用户体验。

## 背景

当前代码存在四组与已确认 PRD 相反的假设：

1. `desktop/src/team-store.ts` 在数据层拒绝全部官方团队写入，renderer 也把
   `ownership === "system"` 直接映射为整页只读。
2. `desktop/src/team-seed.ts` 在安装包指纹变化时整体替换 `.system/`，没有 A/B/C
   三方状态，会静默覆盖用户内容。
3. 团队和会话快照只保存成员 slug 与 `AGENT.md`，没有 Agent 级 CLI、model、
   effort，也没有推荐/覆盖来源。
4. `src/local-console/runtime.ts` 只接受 `runCodex`，resume、thread link 和过程读取
   都以 Codex 为唯一执行引擎。

现有会话内容快照已经提供了正确的演进地基：新会话会把团队成员内容复制到
pending/effective snapshot，团队后续修改不追溯改变已有会话。本 change 应扩展这份
快照，而不是再造一套“对话当前配置”。

## 提案

### 切片 A：可编辑、可更新的官方来源团队

- 保留 `.system/<teamId>` 作为用户当前可编辑内容 B；安装包 `seed/teams` 只作为
  最新官方内容 C，不再在启动时覆盖 B。
- 在应用状态区保存上次已应用官方基线 A、每个稳定 slug 的当前官方推荐配置，以及
  每支团队每名 Agent 的已保存运行配置。
- 官方团队与用户团队共用团队/成员写接口；数据层只继续保护官方来源身份和“不可删
  除”，不再保护内容只读。
- 以纯状态模块计算“已自定义”“有更新”“无法检查更新”、更新影响和是否必须保留
  副本；`onboarding-orchestration.json` 与运行配置均不进入内容指纹。
- 更新先生成完整计划并预校验，再由单一 store 操作提交。需要保护时创建普通用户
  副本并固化全部已保存运行配置；官方团队采用 C，A 最后登记为 C。
- 迁移旧播种状态时绝不把未知状态当成“干净”：能由旧 marker 证明 `.system` 与旧
  seed 一致时建立干净基线；无法证明时保守标记为已自定义，更新必须保留副本。

### 切片 B：Agent 运行配置管理

- 定义 `ExecutionProfile = { cli, model, effort }` 和
  `recommended | override | explicit` 三种来源语义。普通用户团队和用户自行添加的
  官方成员只保存 explicit；官方成员可跟随当前已应用推荐或保存 override。
- 运行配置属于稳定 team id + member slug，不写进 `team.json`、`AGENT.md` 或官方
  内容目录；团队重定位不改变绑定。
- Codex 能力从本机 Codex app-server 的 `model/list` 读取；Kimi 能力从
  `kimi provider list --json` 与模型声明读取。探测失败只产生“无法验证”，不清除或
  猜测配置。
- main process 是能力校验与保存的唯一所有者；renderer 只消费白名单 DTO。保存时
  重新校验能力快照，过期能力返回可重试错误。
- 复制团队时复制当前已保存的有效值并固化为新用户团队 explicit 配置。

### 切片 C：本地会话执行引擎

- 扩展现有会话团队快照：每名成员同时保存执行配置；已有不含该字段的快照继续走
  当前 Codex 行为，不回写、不自动切 Kimi。
- 每条 run 启动时再冻结一份不可变的原团队/角色/engine/profile 执行上下文。团队
  切换继续沿用现有 effective/pending 语义，等待切换前已启动或排队的 run 全部终态
  后提升新快照；旧 run 的恢复与 full-fallback 始终使用自己的原上下文。
- local-console 依赖改为通用 execution driver registry。普通本地 Agent run 按
  快照硬路由到 Codex 或 Kimi；找不到绑定 CLI、配置无效或驱动失败时明确失败，绝不
  调用另一驱动。
- Codex adapter 复用当前 `codex exec --json`，只把 model/effort 从全局常量改为
  本次 Agent 快照，并继续保留现有 provider/sandbox/timeout 约束。
- Kimi adapter 使用官方 `kimi acp` JSON-RPC 子进程协议：initialize →
  authenticate → session/new 或 session/resume → set model/thinking →
  核验实际生效配置 → session/prompt；中止使用 `session/cancel` 后走现有有界信号
  升级。运行前核验以 ACP session 响应的 `configOptions` 与配置更新/设置响应为
  权威；CLI 回落或实际值不一致时在发送 prompt 前失败，不静默替换，也不调用 Codex。
- 外部会话关联增加 engine 字段，只有同一 engine、同一执行配置、同一未完成 run
  才能 resume；任何不匹配都用该 run 保存的原团队/engine/profile full-fallback，
  不能跨 CLI 恢复。当前团队接手必须创建新执行，不能伪装成旧 run 的恢复。

### 已确认的实施范围

本批实现切片 A、B 与切片 C 的 core driver：Agent Teams 页面、官方来源团队更新、
Agent 运行配置、会话快照，以及 Codex/Kimi 的 full/resume/cancel 内核。以下表面继续
范围外：

- 运行配置无法验证/需要调整时是否阻止新建对话；
- onboarding 如何同时呈现 Codex/Kimi 环境准备；
- Kimi 完整过程如何进入右侧栏以及历史过程的数据源；
- GitHub issue runner、AI 建队与 guardrail 是否改用 Kimi。

本 change MUST NOT 顺带修改上述页面行为，也不以这些范围外页面是否补齐作为 core
driver 的合并条件。若未来纳入其中任一表面，另按 `docs/product/prompt.md` 完成对应
PRD 裁决后再建或扩展后续 change。

## 影响

### 业务域

- `desktop-shell`：官方基线、运行配置、能力探测、更新事务、IPC 与旧播种迁移。
- `local-console`：成员执行快照、驱动选择、Codex/Kimi full/resume/cancel。
- `console-ui`：官方来源状态、可编辑详情、运行配置编辑、更新影响与结果。

### 主要代码落点

- `desktop/src/team-*.ts`：新增 official-state、execution-profile、capability 与
  official-update 纯模块/存储模块；调整 seed/store/ipc/runtime-binding。
- `src/local-console/*`：扩展 snapshot 与 execution-session fact，抽出驱动注册表。
- `src/codex.ts`：接受 per-run profile，保持 GitHub runner 和 AI 建队默认调用兼容。
- `src/kimi.ts`：ACP client、framing、能力错误脱敏、full/resume/cancel。
- `packages/console-ui/src/console/agent-team*.tsx`：状态与编辑表面。

### 数据迁移

- 新增版本化官方基线/运行配置状态文档；旧数据根首次读取时从旧 marker 与当前
  `.system` 建立保守基线。
- local-console 团队快照增加可空执行配置列/字段，并为新 run 持久化不可变执行上下文；
  旧行 NULL 表示 legacy Codex，完整执行、恢复和 fallback 统一走原兼容路径。
- 既有 Codex thread link 读取为 `engine = "codex"`；新事实显式保存 engine 与
  profile fingerprint。

### 非目标

- 自动把失败的 Codex run 切到 Kimi，或反向降级。
- 同一个未完成 run 跨引擎续跑。
- 按项目覆盖 Agent 运行配置。
- 自动合并官方 Markdown 与用户 Markdown。
- 管理 CLI provider、登录凭证或 API key。
- 改 GitHub issue runner、AI 建队、CEO guardrail 的 Codex 选择。
- 未经对应 PRD 裁决修改 onboarding、新建对话硬门或右侧过程栏。
