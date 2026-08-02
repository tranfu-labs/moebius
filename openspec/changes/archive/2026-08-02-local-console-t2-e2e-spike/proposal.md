# 提案：local-console-t2-e2e-spike

## 背景
里程碑 4 的 T2 是 demo 级风险优先 spike，目标不是提前交付完整桌面操作台，而是消除最大不确定性：纯本地通道能否替代 GitHub issue 做输入源与输出汇，同时让 mention trigger 与真实 Codex 执行链路继续跑通。

当前运行时以 GitHub issue 为唯一可写操作台：`pnpm start` 读取 repository 白名单，扫描 GitHub issue，命中 mention 后调用本机 `codex`，再把回复发回 GitHub。`packages/console-ui` 只是组件库，`src/observer` 是只读观察页，二者都没有真实 runner 数据流。因此 T2 需要在 runner 外圈补一条最小 local intake / sink adapter，而不是把完整 Electron renderer 或组件库集成提前塞进本轮。

product-manager 已确认本轮边界：

- 接受先做 `pnpm start` 可启动的本地 HTTP 极简页，不接完整 Electron 或 console-ui。
- 只要求跑通“本地消息 -> mention trigger -> 真实 codex -> 本地回复显示”。
- 最小 SQLite 消息表只覆盖单会话输入、输出和必要运行状态。
- fake `gh` 零调用验收必须覆盖端到端本地场景。
- 验收语句沿用 T2 原文，QA 增补需经 product-manager 或真人用户确认后才并入正式清单。

## 提案
新增一个 T2 专用的本地对话闭环：

1. `pnpm start` 同进程启动一个 loopback-only 极简 local console HTTP server。
2. HTTP 页面提供单输入框与单会话时间线，能提交含合法 agent mention 的本地消息，并轮询显示状态与 agent 回复。
3. 本地消息写入数据根下的最小 SQLite 数据库；本轮只建单张消息表，记录单会话 user / agent / system 消息、处理状态、run id / run dir 与错误摘要。
4. local intake adapter 从 SQLite 读取待处理 user 消息，构造本地共享时间线，复用 `conversation` 的 mention 解析与 `triggers` 的 mention trigger。
5. 命中 agent 后读取对应 agent persona，调用真实 `codex`；local sink adapter 将 Codex final response 写回同一 SQLite 表，HTTP 页面展示该回复。
6. 本轮显式跳过 GitHub 专属副作用：reaction、GitHub comment sink、release artifact publisher、GitHub issue media、完整 CEO guardrail / ledger 对等、issue worktree capability。它们记录为 T3-T6 的对等化范围，不在 T2 扩片。

实现策略上，SQLite adapter 必须暴露异步、有界的 store 接口。可以优先评估当前 Node 运行时可用的 `node:sqlite`，但如果同步调用无法满足 store timeout / busy 故障注入要求，必须改为 worker 隔离或受控异步 SQLite 依赖，并在 `design.md` 记录取舍。

## 影响
- 新增本地业务域代码，建议集中在 `src/local-console/`，并只让 `src/runner.ts` 在启动装配层引用。
- 新增数据根文件：`.state/local-console.sqlite` 或等价路径；不得写入 `agents/`、业务 worktree 或 GitHub state 文件。
- `pnpm start` 在无 repository 配置、无 `gh auth` 的环境下仍可打开本地极简页并跑本地闭环。
- 现有 GitHub issue runner 语义不改变；配置了 watched repositories 时原 GitHub 轮询仍按现状工作。T6 才裁决默认 local / GitHub flag 互斥模式。
- 本 change 会新增 `local-console` spec delta；实现完成归档时合并为本地对话操作台业务域事实源。
