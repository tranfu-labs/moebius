# 提案：local-console-t3-sqlite-persistence

## 背景
里程碑 4 的 T2 已经落地最小 local console 闭环：本地 HTTP 页面、单会话 SQLite `local_messages` 表、local intake / sink adapter，以及真实 Codex 调用路径。T3 要把这条 spike 结论推进到 `数据正确级`：本地会话历史与 runner 自身状态必须能在重启后保持一致，同时 GitHub 模式既有持久化行为保持零漂移。

当前缺口集中在持久化层：

- 本地会话时间线只覆盖 T2 单表消息，缺少会话表、会话树和可重启恢复的统一状态模型。
- `role-threads`、`goal-ledger`、`github-response-intake`、`agent-contexts` 仍分别写 `.state/*.json`，并各自维护原子写入、entry-level merge 或 IO timeout 逻辑。
- GitHub runner 调度、role resume、goal ledger、workspace context 等测试都以 issue key 为事实 key；T3 需要内部切到 session key，但不能改变 GitHub 用户可见行为。

product-manager 已确认 T3 边界：旧 `.state/*.json` 需要一次性兼容迁移进 SQLite；GitHub issue 内部映射为确定性 session key；会话树本轮只要求数据模型与持久化能力；本地重启验收以 T2 极简 local console / desktop 壳路径和同一数据根为准；不承接 T4/T5/T6，不做本地与 GitHub 数据互通，不改核心链路业务语义。

## 提案
在 T2 SQLite 基础上扩展为统一持久化层：

1. 引入 worker-isolated SQLite state store 和 schema migrations，复用数据根下的 T2 SQLite 文件作为 T3 事实库，避免另起数据库，同时保证同步 SQLite 卡住时调用方能有界失败。
2. 新增 session 基础表与会话树关系表；本地默认会话和 GitHub issue 映射都写入 `sessions`，GitHub session key 采用确定性格式，例如 `github:<owner>/<repo>#<issue>`。
3. 将 T2 `local_messages` 迁移为统一的 session timeline 表，保留本地 user / agent / system 消息、状态、run id / run dir 和错误摘要。
4. 将 `role-threads`、`goal-ledger`、`github-response-intake`、`agent-contexts` 的 runtime store 从 JSON 文件切到 SQLite；优先保留现有 TypeScript 状态 schema 与纯业务校验，只替换读写载体，降低行为漂移风险。
5. 启动时执行一次性兼容迁移：旧 JSON 存在且合法时按 source-local transaction 导入 SQLite；旧 JSON 缺失时沿用现有空态；旧 JSON 损坏时沿用现有错误或空态语义，不静默修正、不伪造成功。只有单个 source 导入 transaction 成功提交后才记录 migration marker。迁移后运行时只以 SQLite 为事实源，不再写 `.state/*.json`。
6. 在 runner / local console 装配边界统一生成 session key：本地使用 local session id，GitHub 使用 issue source 的确定性 session key；外部 GitHub comment、reaction、artifact、issue worktree 等语义保持不变。
7. 更新 observer / desktop 只读状态读取路径，使其从 SQLite 读取同等诊断数据；T3 不新增完整会话树 UI 和操作体验。
8. 补齐迁移、重启一致性和 GitHub 零漂移回归测试，并在实现完成后把 T3 验收证据追记到 `docs/roadmap/milestone-4-local-console.md`。

## 影响
受影响模块：

- `src/local-console/*`：从 T2 单表 store 升级到 session timeline store，并保留 local console API 兼容。
- `src/state.ts`、`src/goal-ledger-state.ts`、`src/github-intake-state.ts`、`src/agent-context-state.ts`、`src/state-persister.ts`：改为 SQLite-backed store，函数级行为保持兼容。
- `src/config.ts`：集中 SQLite 路径、迁移开关和 store timeout 相关常量。
- `src/runner.ts`、`src/scanner.ts`、`src/issue-dispatcher.ts`、workspace pre scripts：在边界处使用 session key，不改核心业务语义。
- `src/observer/*`、`desktop/src/*`：读取 SQLite state 以保持只读观察与桌面重启验收可用。
- `tests/*`：迁移现有 JSON state 测试到 SQLite 临时数据根，并保留 GitHub runner 全套回归。

对外行为：

- 本地模式：同一数据根重启后会话历史和 runner 状态保持一致。
- GitHub 模式：GitHub issue 时间线、评论、reaction、artifact、worktree 路径和调度语义不应出现用户可见变化。
- `.state/*.json` 不再作为运行时事实源；旧文件仅作为一次性迁移输入和人工回滚参考保留。
