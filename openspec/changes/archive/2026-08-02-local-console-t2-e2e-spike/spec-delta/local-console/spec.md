# local-console spec delta：local-console-t2-e2e-spike

新增业务域「本地对话操作台」的 T2 demo 级端到端 spike。该 delta 只规定最小本地闭环行为；完整会话树、统一持久化、桌面台、运行直播、中断、ledger / guardrail / artifact 本地对等由后续 T3-T6 delta 承接。

## 新增行为规则

### T2 最小本地闭环
- MUST 让 `pnpm start` 启动一个只监听 loopback 地址的最小 local console HTTP server。
- MUST 让 local console 在没有 configured repository、没有 `gh auth` 的环境下可打开、可提交本地消息、可显示本地消息处理状态。
- MUST 提供一个本地单会话消息表，使用 SQLite 保存 user 输入、agent 输出与必要运行状态。
- MUST 让本地 user 消息经 local intake adapter 转为共享时间线，并复用现有 agent mention 解析和 mention trigger 规则；代码块和 inline backtick 内的 mention 仍不得触发。
- MUST 在本地最新消息命中合法 agent mention 时调用真实 Codex driver，并把 Codex final response 经 local sink 写回 SQLite。
- MUST 让最小 HTTP 页面展示 user 原文、运行中状态、agent 回复和失败摘要。
- MUST 保持同一 local session 串行执行；已有本地消息运行中时，后续待处理消息不得并发启动第二个 Codex run。
- MUST 在 Codex 失败时把失败写回本地消息状态或 system 消息，使页面可见，不得静默吞掉。
- MUST 让 SQLite store 调用有界：写入、claim pending message、状态迁移、sink 写回和读取快照都必须在配置的 store timeout 内完成或返回可见错误。
- MUST 在 SQLite 写入快速失败、`SQLITE_BUSY`、只读数据库、建表失败或 store timeout 时，不启动 Codex，不把 user 消息标记为 completed，并让 HTTP API 或页面显示失败摘要。
- MUST 使用原子 claim 把 local user 消息从 `pending` 转为 `running` 后才启动 Codex；claim 失败或超时不得启动 Codex。
- MUST 在 Codex idle / max-duration timeout 后把 local user 消息标记为 failed 或追加 system error，并释放 session，使后续本地消息仍可处理。
- MUST 修复 stale running 状态：启动或轮询时发现运行中消息超过 Codex 最大运行时长加 grace，必须转为 failed 或追加 system error，避免页面永久 running。
- MUST 在同一 local session 已 running 时拒绝或禁用第二条提交；本轮不得排队并发启动第二个 Codex run。

### Adapter 边界
- MUST 把 local intake / sink adapter 放在 runner 外圈；MUST NOT 修改 `conversation`、`triggers`、`codex` 的业务语义来适配本地通道。
- MUST NOT 让 local console path 调用 GitHub comment sink、GitHub reaction、GitHub release artifact publisher、GitHub issue media downloader 或 GitHub issue worktree capability。
- MUST NOT 要求 T2 实现会话树、多会话导航、完整 SQLite 持久化模型、role thread resume、goal-ledger 本地化、CEO guardrail 本地对等、Electron renderer 接入或 console-ui 接入。
- SHOULD 记录 T2 spike 结论，说明 adapter 边界、本地通道协议、SQLite 表形态以及后续 T3-T6 需要补齐的缺口。

### 验收约束
- MUST 提供端到端验收路径：PATH 前置 fake `gh`，以空 repository 配置启动 `pnpm start`，在 local console 发本地消息，看到真实 Codex 回复显示，且 fake `gh` 调用日志为空。
- MUST 提供本地页面验收截图、Codex run 输出摘要和 fake `gh` 零调用日志作为 `code-verified` 证据。
- MUST NOT 仅以单元 mock 证明 fake `gh` 零调用；零调用验收必须覆盖本地 HTTP 输入、local intake、Codex 执行与 local sink 显示链路。

## 新增场景

### 场景 LC-T2.1：无 repository / 无 gh auth 的本地闭环
Given 数据根中没有 configured repository
And PATH 前置一个会记录调用的 fake `gh`
And 本机 `codex` CLI 可用
When 开发者运行 `pnpm start`
And 在 local console 页面发送本地消息 `@dev 帮我写个 hello`
Then 页面显示该 user 消息进入运行中
And Codex 被真实调用一次
And 页面最终显示 dev 的回复
And fake `gh` 调用日志为空

### 场景 LC-T2.2：本地消息复用 mention trigger
Given local console SQLite 中最新 user 消息包含代码区域外的合法 `@dev`
When local intake adapter 构造 timeline 并调用 trigger
Then trigger 结果为运行 dev agent

### 场景 LC-T2.3：代码区域内 mention 不触发
Given local console SQLite 中最新 user 消息只在 inline code 或 fenced code block 内包含 `@dev`
When local intake adapter 构造 timeline 并调用 trigger
Then trigger 结果为 no-trigger
And 不调用 Codex

### 场景 LC-T2.4：Codex 失败本地可见
Given local console 已接收一条合法 mention 消息
And Codex driver 返回失败
When local sink 写回结果
Then 原 user 消息状态为 failed 或页面出现 system error 消息
And 页面刷新后仍能看到失败摘要

### 场景 LC-T2.5：不触发 GitHub 专属副作用
Given PATH 前置 fake `gh`
And local console 收到合法 mention 消息
When 本地闭环完成并显示 agent 回复
Then fake `gh` 调用日志为空
And 本轮没有 GitHub reaction、GitHub comment、release artifact upload 或 GitHub issue worktree 操作

### 场景 LC-T2.6：SQLite 写入快速失败不启动 Codex
Given local console 的 SQLite store 被注入写入快速失败
When 用户通过 HTTP API 提交本地消息
Then API 在 store timeout 内返回可见错误
And 页面或 API 快照包含失败摘要
And 不调用 Codex
And 不存在 completed 的 user 消息

### 场景 LC-T2.7：SQLite busy 或永久挂起有界失败
Given local console 的 SQLite store 被注入 busy timeout 或永久挂起
When local runtime 尝试写入、claim 或 sink 写回
Then runtime 在 store timeout 内释放 session
And 页面或 API 显示 store failure 摘要
And 清除故障后下一条本地消息仍可处理

### 场景 LC-T2.8：Codex timeout 后释放 session
Given local console 收到合法 mention 消息
And Codex driver 被注入静默不退出
When Codex idle 或 max-duration timeout 触发
Then 页面显示 failed 或 system error
And session 被释放
And 后续本地消息可继续处理
And fake `gh` 调用日志为空

### 场景 LC-T2.9：运行中第二条消息不并发
Given local console 正在处理一条合法 mention 消息
And Codex driver 被注入慢成功
When 用户在 running 状态提交第二条本地消息
Then UI 禁用提交或 API 返回 409
And 同一 session 同时最多一个 Codex run
And 第二条消息不得并发启动 Codex
