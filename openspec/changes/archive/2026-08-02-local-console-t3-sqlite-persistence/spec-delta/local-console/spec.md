# local-console spec delta：local-console-t3-sqlite-persistence

T3 将 T2 demo 级本地 SQLite 消息表升级为数据正确级统一持久化。该 delta 只规定会话持久化、旧 `.state` JSON 迁移和 GitHub 模式零漂移；不规定 T4 桌面台完整 UI、T5 本地全功能对等或 T6 启动 flag 互斥切换。

## 新增行为规则

### 统一 SQLite 持久化
- MUST 使用同一 SQLite 数据库保存本地会话时间线、会话基础数据、会话树关系、role thread state、goal ledger state、GitHub response intake state 和 agent context state。
- MUST 基于 T2 已落地的 SQLite 最小消息表升级，不得另起一套与 T2 数据断开的持久化文件。
- MUST 用 schema migration 记录已执行迁移，并保证迁移幂等。
- MUST 让 SQLite 初始化、迁移、读写和 observer 读取有界返回；若使用同步 SQLite API，则必须放在 worker 或等价隔离执行单元内，使主线程 timeout 能终止卡住的执行单元并释放 session / issue 推进锁。
- MUST 在 SQLite busy、永久挂起、慢成功超过 timeout 或 store worker 卡住时返回可见错误或诊断；不得永久占用 local session、issue in-flight 状态或 observer 渲染。
- MUST 将本地消息持久化为 session timeline；同一数据根重启后，user 消息、agent 回复、system 消息、消息状态、run id、run dir 和错误摘要仍可读取。
- MUST 持久化 session 基础数据和 session tree 关系；T3 只要求数据模型与持久化能力，不要求桌面 UI 展示完整会话树。
- MUST 将 local session 和 GitHub issue 都映射为 session key；GitHub issue session key 必须由 owner、repo、issue number 确定性派生。
- MUST 在 GitHub 模式保持一 issue 一 session 的内部隔离，同时保持 GitHub 用户可见语义不变。

### 旧 JSON state 兼容迁移
- MUST 在启动或 state store 初始化时执行一次性兼容迁移：旧 `.state/role-threads.json`、`.state/goal-ledger.json`、`.state/github-response-intake.json`、`.state/agent-contexts.json` 存在且合法时导入 SQLite。
- MUST 在旧 JSON 缺失时沿用现有空态或默认态语义。
- MUST 在旧 JSON 损坏时沿用现有错误或诊断语义；不得静默修正、不得伪造成功迁移。
- MUST 按 legacy source 隔离迁移事务；一个 legacy 文件损坏或导入失败不得阻断无关 state source 的读取或 observer 诊断展示。
- MUST 只在单个 legacy source 的导入 transaction 成功提交后记录该 source 的 imported marker；导入中抛错、进程崩溃或 worker 被终止时不得记录成功 marker。
- MUST 在迁移成功后以 SQLite 作为运行时事实源；runner 不得继续写旧 `.state/*.json`。
- MUST NOT 删除旧 JSON 文件作为迁移成功的必要条件；旧文件可保留为审计和回滚输入。
- MUST NOT 让后续启动用旧 JSON 反向覆盖 SQLite 中更新后的 state。
- MUST 在 SQLite 已存在未标记来源的新事实且 legacy source 仍存在时返回冲突诊断，不得猜测覆盖方向。

### Store 行为兼容
- MUST 保留 role thread state 的 issue/session + role entry-level merge 语义；并发保存不得覆盖同 session 其他 role。
- MUST 保留 agent context state 的 issue/session + entry key merge 语义，以及 workspace access / main status / legacy migration 字段。
- MUST 保留 GitHub response intake 的 repository idle scan、issue active/idle、failure retry、dead-letter、no-mention fallback route decision ledger 和 active 上限语义。
- MUST 保留 goal ledger 的 schema 校验、entry-level merge、ready gate、phase projection、acceptance fact、integration event 和 timeout / AbortSignal IO 语义。
- MUST 保持 observer 只读；迁移到 SQLite 后仍不得写 state、调用 GitHub 或调用 Codex。

### GitHub 模式零漂移
- MUST 保持 GitHub issue timeline、comment sink、reaction target、artifact publisher、issue media handling、issue worktree path、branch naming 和 driver pool 调度的用户可见行为不变。
- MUST NOT 为了 session key 改变 GitHub comment body、role envelope、stage marker、CEO guardrail、mention trigger 或 acceptance pre-pass 语义。
- MUST 让现有 GitHub 全测试套件继续全绿。

## 新增场景

### 场景 LC-T3.1：本地重启后会话与 runner state 一致
Given 同一数据根下启动 T2 极简 local console 或 desktop 壳
And 本地跑过一轮含合法 agent mention 的对话
And SQLite 中已有 role thread、goal ledger、intake 和 agent context state
When 关闭进程并用同一数据根重启
Then 页面或 API 仍能看到重启前的会话历史
And role thread state 与重启前一致
And goal ledger state 与重启前一致
And GitHub response intake state 与重启前一致
And agent context state 与重启前一致

### 场景 LC-T3.2：旧 JSON state 合法时导入 SQLite
Given 数据根中存在合法 `.state/role-threads.json`、`.state/goal-ledger.json`、`.state/github-response-intake.json` 和 `.state/agent-contexts.json`
And SQLite 尚未记录对应迁移
When state store 初始化
Then 这些 state 可从 SQLite 读取到等价内容
And 后续保存只更新 SQLite
And 旧 JSON 文件不被继续写入

### 场景 LC-T3.3：旧 JSON state 缺失或损坏沿用旧语义
Given 数据根中旧 JSON state 文件缺失
When state store 初始化
Then 对应 state 读取结果沿用现有空态或默认态

Given 数据根中旧 JSON state 文件损坏
When state store 初始化
Then 对应 state 读取结果沿用现有错误或 observer 诊断语义
And 不写入伪造成功的 SQLite state

### 场景 LC-T3.4：迁移部分失败不会记录成功 marker
Given 数据根中存在合法 legacy JSON state
And SQLite migration 在部分表写入后被注入抛错或进程崩溃
When 下次用同一数据根初始化 state store
Then SQLite 不存在该 legacy source 的 imported marker
And 初始化结果不得重复导入、漏导入或用旧 JSON 覆盖已确认的新 SQLite 事实
And 失败 source 返回可见诊断或错误

### 场景 LC-T3.5：SQLite 永久挂起有界失败
Given SQLite store 初始化、读写、迁移或 observer 读取被注入永久挂起
When local console、runner state store 或 observer 调用该 store
Then 调用在配置 timeout 内返回可见错误或诊断
And 不启动 Codex
And 不永久占用 local session 或 issue in-flight 状态
And 解除故障后下一条消息或下一轮 state 保存可继续

### 场景 LC-T3.6：GitHub issue 映射为稳定 session key
Given GitHub source 为 owner `tranfu-labs`、repo `moebius`、issue `101`
When runner 读写 role thread、agent context 或 intake issue state
Then 内部 session key 稳定派生自该 GitHub source
And 同一 issue 的同一 role 仍复用原 thread state
And 不同 issue 不共享 role thread 或 agent context

### 场景 LC-T3.7：迁移后不再写旧 JSON
Given legacy role thread、agent context、GitHub intake 和 goal ledger state 已成功迁移进 SQLite
When runner 保存这些 state
Then 只有 SQLite 内容更新
And 旧 `.state/*.json` 的 mtime 和内容不再变化

### 场景 LC-T3.8：GitHub runner 回归零漂移
Given 现有 GitHub runner 全测试套件
When 运行 `pnpm test`
Then 测试应全部通过
And GitHub 模式用户可见评论、reaction、artifact、worktree 和调度行为无差异

## 验收约束

- MUST 在 `code-verified` 证据中包含本地重启后一致性的可核查输出或截图。
- MUST 在 `code-verified` 证据中包含 `pnpm test` 全绿输出。
- MUST 在实现完成后把 T3 验收证据追记到 `docs/roadmap/milestone-4-local-console.md` 的 T3 下方并勾选。
