# 提案：agent-team-snapshot-traceability-and-apply

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-conversation.md` | 用户场景 / 团队按钮展开 / 选择工作空间与团队 | 新增丰富团队菜单、当前历史快照身份、分类变化提示，以及任一按钮应用完整团队版本的边界 | 已写入并通过产品复评 |
| `docs/product/pages/main-conversation.md` | Agent 头像与当时信息 | 新增 run 级团队、成员定义、CLI/model/effort、载入时间及只读 `AGENT.md` 追溯入口 | 已写入并通过产品复评 |
| `docs/product/pages/main-conversation.md` | 重试 / 页面状态 / 指标与验收 | 明确应用等待、失败、同版本重试、取消、历史步骤复现和验收 99–102 | 已写入并通过产品复评 |
| `docs/product/pages/agent-teams.md` | 保存后的生效反馈 / 修改团队信息 / 切换主 Agent / 编辑与保存 `AGENT.md` | 新增无需重启、部分成功、外部有效修改和“保存全部并离开”的反馈落点 | 已写入并通过产品复评 |
| `docs/product/pages/agent-teams.md` | 指标与验收 | 新增验收 38，约束成功、部分失败和失败草稿隔离 | 已写入并通过产品复评 |
| `docs/product/pages/main-conversation.prototype.html` | 团队菜单 / 变化与应用 / 头像信息卡 / 保存反馈 | 高保真原型覆盖交互、键盘、窄窗、亮暗主题和减少动态效果；信息卡已改为锚定消息并可上翻 | 已确认 |

本 change 只引用上述事实源，不复制 PRD 的产品理由。原型用于视觉和交互核对；生产代码不得 import、复制或运行时读取 `prototypes/` 或该 HTML。

## 背景

现有实现已经能在创建或明确切换团队时冻结成员 `AGENT.md` 与 CLI/model/effort，也有 effective/pending 两个团队槽、`awaiting-team` 消息和 run execution context。但用户仍无法判断“这一条发言当时用了什么”，也不能把当前团队的已保存更新显式应用到旧对话：

- 会话快照没有团队名称、用途、来源、同名辨认信息、成员可读身份或实际载入时间；renderer 只能用当前团队目录回填，因此团队改名后会把历史身份显示成现在的值。
- `SessionTeamMenu` 只列名称，`NewConversationPage` 仍使用原生 `<select>`，不能展示用途、主 Agent、成员构成或完整名单。
- run execution context 已保存成员 Markdown 与执行配置，却没有所属完整团队快照身份；开始执行证据也没有面向该信息卡的稳定投影。
- 现有 pending 团队机制只表达“切到另一支团队”，没有同团队完整版本的变化分类、冻结目标、失败重试与取消状态。
- 团队页保存只更新局部编辑状态，没有统一的“已保存、无需重启”反馈，也没有把“保存全部并离开”的成功反馈带回列表页。

三个原始痛点因此汇合为一个缺口：会话与 run 的团队版本已经部分冻结，但缺少完整身份、可观察性和显式更新控制面。

## 提案

### 1. 完整团队快照与兼容迁移

把会话 effective/pending snapshot 扩展为完整团队版本：稳定团队身份、名称、用途、来源与同名辨认信息、主 Agent、有序成员身份、每名成员完整 `AGENT.md` 与 CLI/model/effort、内部版本键、捕获时间和生效载入时间。内部版本键只用于一致性、排队和比较，永不展示给用户。

既有 snapshot 行原位兼容：保留成员 Markdown、执行配置、顺序和绑定；无法证明的团队身份、载入时间或运行字段保持缺失，由 UI 显示“此项未记录”，不得从当前团队目录补写历史。

### 2. 分类变化检测与完整版本应用

local-console 通过桌面壳注入的完整团队版本 resolver 读取当前有效磁盘版本，并在 domain 层比较 effective snapshot：

- 任一成员完整已保存 `AGENT.md` 内容变化（包括身份 frontmatter）归为 `agent-definition`；
- CLI/model/effort 变化归为 `execution-profile`；
- 团队名称、用途、主 Agent、成员增删/顺序、slug 或从 `AGENT.md` 解析出的成员可读身份变化另归为 `team-information`。因此只修改 `display_name` / `description` 等身份 frontmatter 时，两类提示同时出现。

任一「应用」都冻结同一个完整候选版本。应用 intent、旧版本工作代次、目标版本和失败状态持久化；旧版本已启动/排队工作继续，点击后的用户消息进入可编辑、可移除的 `awaiting-team` 队列。旧代次清空后原子提升目标 snapshot 并重新解析等待消息。失败保留旧 effective 与同一目标；重试不重读新版本，取消才释放等待消息并重算变化。

### 3. run 级历史追溯

扩展 JSONL run execution context，使每次新 run 在 provider 解析和启动前就冻结完整团队审计块。新增窄只读查询，只按 session + run + role 返回信息卡 DTO；完整 `AGENT.md` 由第二个显式只读请求按同一持久事实返回，不读取当前磁盘文件。

执行事实分三层投影：可信 process-start/provider 证据为“实际执行配置”；明确启动前终局且无开始证据为“计划尝试·未开始执行”；旧记录只能证明绑定时为“绑定配置·是否开始未记录”。一次性重跑直接读取该 run context 的实际 override profile。

### 4. 生产组件和桌面装配

- 扩展 `packages/console-ui` 的 `SessionTeamMenu`，提取新对话、分析新会话和已有会话共用的团队选项；复用 `AgentInitialAvatar`、Radix Dropdown/Popover/Dialog 与现有令牌。
- 在 `packages/console-ui` 新增呈现型团队更新提示、Agent run 信息 Popover 和只读 `AGENT.md` Dialog；desktop 只传 DTO 与 intent callback，不私建副本、不复制状态机。
- 团队页复用同一反馈组件，单项成功、部分成功、外部载入和“保存全部并离开”分别由真实持久化结果驱动。
- 原型保持生产隔离，只作为验收对照。

## 影响

### 业务域

- `local-console`：完整会话快照、更新 intent/队列状态机、run 审计事实、只读查询和 SQLite 兼容迁移。
- `desktop-shell`：完整团队版本 resolver、API client/controller 装配、团队保存反馈和目录刷新。
- `console-ui`：丰富团队菜单、分类提示、信息 Popover、只读 Dialog、保存反馈和可访问交互。

### 数据与兼容

- SQLite 以加法方式扩展 snapshot metadata/member 字段、candidate/pending/update intent 与队列代次；迁移必须幂等、事务化并保留外键与现有 effective/pending 内容。
- JSONL run execution context 新增可选审计块和外部执行开始事实；旧事件保持可读，不重写历史日志。
- 当前团队目录仍是“现在已保存版本”的来源；历史消息只读 run/session 持久事实。

### 明确不在范围

- 不显示版本指纹、源文件 `mtime`、路径、内部 ID、前后 diff 或版本选择。
- 不提供单独应用 `AGENT.md` 或运行配置；不允许混合快照。
- 不自动中止、重放或改写旧 run；历史步骤重试/重新运行/恢复继续用原 run context。
- 不新增 CLI readiness 探测，不以保存成功宣称 CLI 已启动。
- 不修改 provider 选择、团队健康门禁、附件、工作空间或分析会话的既有产品语义。
- 本轮只落 OpenSpec 方案，不修改生产代码、当前 specs 或既有 PRD/原型文件。
