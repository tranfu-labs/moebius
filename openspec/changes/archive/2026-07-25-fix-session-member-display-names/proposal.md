# 提案：fix-session-member-display-names

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/agent-teams.md` | `Agent 身份与说明` | 无；沿用“稳定 slug 是机器引用、`display_name` 是可读名称”的现有产品意图 | 无需修改 |
| `docs/product/pages/main-conversation.md` | `时间线`、`团队推进中` | 无；沿用历史消息与活动记录显示真实团队成员身份的现有产品意图 | 无需修改 |
| `docs/product/pages/main-right-sidebar.md` | `过程标签`、`标签条` | 无；沿用过程标签标题就是成员名的现有产品意图 | 无需修改 |

本次是实现未遵守既有产品意图的缺陷修复，不新增产品规则，不改页面版式。按任务要求用 change 留下诊断、方案与验收证据；PRD 不重复写入同一规则。

## 背景

报告中的会话使用两名自定义成员：

- `plan-supervisor`，快照中的 `display_name` 为“方案监督者”；
- `plan-executor`，快照中的 `display_name` 为“方案执行者”。

JSONL 的会话创建事件已经持久化这两个 slug、对应 `AGENT.md` 内容和显示名称；后续 `codex_thread_link`、进度事件及最终消息的 `role` 也始终使用正确 slug。持久化层没有把两个成员写反。

错配发生在展示链路：

1. local-console state / session view 只向 renderer 暴露消息和 run 的 `role` slug，没有暴露会话 effective 团队快照中的最小可见身份。
2. console UI 在历史消息、活动 run、终态事实与过程标签等位置分别维护内置角色白名单。
3. 自定义 slug 不在白名单时，会按区域降级成“团队成员”“协作者”或“成员未知”，导致两个不同成员看起来相同，同一成员在不同区域名称也不一致。

另有一个与名称错配独立的团队内容矛盾：团队定义的权威 `primaryAgentSlug` 是 `plan-supervisor`，但 `plan-executor/AGENT.md` 的自然语言描述自称“主 Agent”。runtime 按团队定义与会话快照首成员运行是当前契约要求；本 change 不替用户改写团队文件，也不改变主 Agent。

## 提案

1. local-console 从每段会话的 effective 团队快照派生只含 `slug` 与 `displayName` 的可见成员身份投影，并随主 state 与子会话 view 返回；完整 `AGENT.md`、persona 和团队规则继续只留在服务端。
2. console UI 建立一个纯成员名解析模块，以会话身份投影为第一优先级；内置角色映射只保留为未绑定存量会话的兼容兜底。
3. 历史消息、活动 run、终态事实、停止动作的可访问名称、过程标签及子任务视图统一消费该解析结果，删除这些路径上的分散硬编码。
4. 不迁移、不重写 JSONL 或 SQLite 消息。旧会话已保存正确 role 与团队快照，升级后通过重新投影即可显示正确名称。

## 影响

### 受影响模块

- `src/local-console/`：会话成员身份的安全投影、state / session view DTO。
- `desktop/src/console-page/`：接收并传递会话身份投影，移除重复角色本地化。
- `packages/console-ui/src/console/`：集中成员名解析并统一所有会话展示面。
- 对应 local-console、desktop state-sync 与 console-ui 单元测试。

### 不在范围

- 不修改团队 `team.json` 或成员 `AGENT.md`。
- 不改变 `primaryAgentSlug`、成员顺序、路由、交棒、恢复或并发语义。
- 不修改 JSONL 事件格式，不回填历史日志，不迁移既有消息 role。
- 不改变 Agent 团队管理页的编辑规则、提及存储格式或页面版式。
