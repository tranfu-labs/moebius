# 提案：local-runtime-supervision-and-override-rerun

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/agent-conversation.md` | `#最新活动`、`#运行耗时` | 真实进展才刷新监督；总时长只报告；可识别服务繁忙默认五分钟停止 | 已写入 |
| `docs/product/pages/agent-conversation.md` | `#停下`、`#重试与恢复`、`#页面状态` | 异常终局保留半截正文；终局可选择一次性 CLI/model/effort 重跑 | 已写入 |
| `docs/product/pages/agent-conversation.md` | `#指标与验收`、`#待讨论` | 固化结构化终局、语义空转、内容保留和一次性重跑判据，移除卡住判据缺口 | 已写入 |
| `docs/product/pages/main-conversation.md` | `#运行异常与中断事实`、`#Agent-执行与恢复` | 三引擎统一终局，不把无结果 turn 当成功，不依赖字符串猜中断或超时 | 已写入 |
| `docs/product/pages/main-conversation.md` | `#停下`、`#重试`、`#侧边栏状态点的触发` | 增加额度/服务异常事实、红点和仅本次生效的换执行配置重跑 | 已写入 |

产品决策来自 2026-07-30 本地共享时间线：用户要求额度或服务异常尽早暴露，不接受 120 分钟硬上限，并要求能在当前对话停止、换模型后原地重跑。主理人将可重试服务繁忙收敛为“运行中可见 + 默认五分钟独立闸”，该默认值属于集中配置中的可调参数；自动切引擎明确不在范围内。

## 背景

当前问题不是单一文案错误，而是三层契约同时失真：

1. Codex、Claude、Kimi 仍以 `ok + reason` 和开放式字符串约定终局。Kimi 的 `KIMI_ACP_INTERRUPTED`、`kimi-acp-timeout` 没有进入通用中断/超时识别；新增引擎映射遗漏不会编译失败。
2. Kimi ACP 把多数 failed turn 压成 `stopReason: "end_turn"`；`src/kimi.ts` 又忽略 `stopReason` 并返回 `ok: true`。额度失败可能因此被当成正常完成。真正的 JSON-RPC error 也会在传输层丢失 code/message/data。
3. 三引擎的 idle 都被任意 stdout 或任意 `session/update` 刷新。配置更新、重试回显和心跳能让没有实际进展的 run 一直存活，最后只剩本地 120 分钟总时长上限。
4. `liveMarkdown` 只存在于活动快照；run 进入中断或异常终局后半截正文消失。终局卡片也不能原位选择另一模型重跑。

现有 `profileFingerprint` 不会自动为换引擎创建合法 full：恢复规划遇到 profile/engine mismatch 会 fail closed，而当前 canonical provider 身份又绑定冻结团队快照。一次性换执行配置必须成为显式的新身份模型，不能用“现有 mismatch 会自动 full”作为方案前提。

## 提案

1. 新增三引擎共享、穷尽的执行终局与进展契约。终局至少区分 `completed`、`interrupted{user,system}`、`timeout{idle,tool,max}`、`quota-exhausted`、`rate-limited`、`auth`、`crashed`；所有适配器和消费方以判别联合及 `assertNever` 收口，不再解析 reason 前缀。
2. Kimi ACP 保留本次子进程直接返回的 JSON-RPC error code/message/data 到受信任诊断；检查 `stopReason` 和最终响应有效性。`end_turn` 但没有可验证完整回复时形成保守的“没有产出完整结果”，不得提交成功 Agent 回复。可靠额度路径只来自本次 ACP JSON-RPC error 的结构化 `403 + retryable:false`，或本次 Kimi 子进程 stderr 中已由 Moebius 捕获进 run 目录的等价结构化诊断；后者只是 best-effort 增强。实现绝不主动读取或依赖 `~/.kimi-code` 内部诊断文件，两个直接来源都缺失时继续使用保守文案。
3. 将进展归一化为 Agent 正文、reasoning、工具起止、文件改动等语义事件。只有新且非空的真实进展刷新 idle；状态、配置、usage、心跳和 provider retry 不刷新。工具 started 到匹配 finished/result 之间属于已知在途工作，通用 idle 让位给默认三十分钟、集中可配的独立工具闸；合法长命令不被三分钟 idle 误杀，挂死工具也不会无限运行。工具结束后重新计时。local console 不再向执行器传 120 分钟总时长 kill；长运行只生成一次可见报告。仅在 provider 确实提供可识别 retry 信号时进入独立繁忙状态；真实 Kimi 是否提供该信号仍待协议取证，不能把 shim 能力写成生产保证。
4. 把中断或异常前的可见 Agent Markdown 与结构化终局一起持久化，在时间线渲染为“内容不完整 + 终局事实”，不伪装成成功消息。
5. 为已停下、额度/服务异常及无完整结果终局增加“换执行配置重跑”。选择器复用团队页执行能力 registry，默认只作用于此次新 run。新 run 使用“基础 Agent 身份 + 一次性 override id”的派生 provider 身份 full；正常退出可恢复同一临时 session，终局后普通消息继续使用原成员配置和原 canonical link。

## 影响

主要影响：

- `src/codex.ts`、`src/claude.ts`、`src/kimi.ts`：三引擎事件与终局归一化，Kimi 原始 ACP error 保留和 stopReason 校验。
- `src/execution-contract.ts`、`src/run-supervisor.ts`（新增纯模块）：跨引擎判别联合、穷尽映射、语义进展类型和监督状态机。
- `src/local-console/execution-driver.ts`、`runtime.ts`、`execution-context.ts`、`types.ts`、`store.ts`：监督状态机、终局持久化、一次性 override 身份与 retry intent。
- `src/config.ts`：服务繁忙默认五分钟、长运行报告阈值等集中参数；local console 不再使用总时长 kill。
- `packages/console-ui`、`desktop/src/console-page`：运行中服务繁忙投影、异常终局半截正文、异步执行能力选择器与重跑 API。
- local-console / console-ui OpenSpec；归档时回流 `docs/architecture/local-runtime-supervision.svg`。

需要保持：

- GitHub issue runner 的既有执行时限和失败/死信语义不随 local-console 的总时长策略改变；共享结果类型迁移后必须有等价回归测试。
- 团队成员配置、会话冻结快照、原 canonical provider link、已有文件改动和历史尝试不可被一次性 override 改写。
- 不增加 console-ui 对 runtime、SQLite、provider 或 shell 的反向依赖；renderer 只消费 DTO 与回调。
- 不自动切换引擎，不自动重试用户任务，不回滚文件，不读取 Kimi 用户目录里的内部诊断文件。

## 验收清单

| # | 可核查行为 | 必需证据 |
| --- | --- | --- |
| A1 | 停止一个已输出部分正文的 Kimi run 后，终局显示「你让这一步停下了」，不显示「这一步没跑起来」 | 生产桌面主会话入口；可见终局文本、runId 定向停止记录和 Kimi shim 中断信号 |
| A2 | Kimi failed/end_turn 且没有有效完整回复时不生成成功 Agent 消息、不出现蓝点 | 生产桌面主会话入口；时间线终局、sidebar 红点、session JSONL/SQLite 中无 completed Agent reply |
| A3 | 配置更新、心跳或重试回显持续到来但没有真实进展时，run 仍在配置的分钟级 idle 窗口内进入卡住/无进展终局 | 真实 local-console + 协议 shim；事件时间线、终局时刻及配置值，证明伪活动没有延后 deadline |
| A4 | provider 明确提供结构化繁忙信号时，活动行显示观察到的重试次数并由独立闸收束；没有该信号时不猜服务繁忙 | adapter fixture + 生产 renderer shim 只证明条件能力；真实 Kimi 信号形态列为待取证，基线由 no-complete-result/idle 保守暴露 |
| A5 | 正文/reasoning/工具起止/文件改动刷新 idle；工具 started 到匹配 finished/result 之间由独立工具闸监督，超过普通 idle 但短于工具闸的合法长工具仍能完成，超过工具闸的挂死工具被停止；缺失 ID 与 ID 复用不会泄漏或误关工具状态；长运行报告只提醒、不停止 | 三引擎 adapter 生命周期测试 + 两组真实 Electron 工具运行，分别断言合法长工具完成、挂死工具在工具闸后形成明确 timeout |
| A6 | 用户停止或引擎异常后，中断前已经显示的 Markdown 在终局、刷新和应用重启后仍可见，并标明内容不完整 | 生产桌面主会话入口；停止前、终局后、重启后三次 DOM 文本及持久事实 |
| A7 | 用户可从 interrupted/timeout/quota/rate/auth/no-result 终局选择另一 CLI/model/effort，在当前会话、同一步产生下一次尝试并成功 full 重跑；同配置再次显式提交仍产生新尝试 | 生产桌面操作；步骤/attempt/run 关联、每次提交 nonce、实际 CLI invocation、immutable execution context 和成功回复 |
| A8 | 一次性 override 不修改团队配置、会话冻结快照或原 provider link；下一次普通运行恢复使用原配置 | 重跑前后团队 IPC/store、session snapshot、canonical links 和两次 CLI invocation 对照 |
| A9 | 执行能力 registry 慢返回、失败、父级重渲染或回调身份变化时，终局内容不丢、不会重复提交或使用过期选择 | 组件/renderer 集成测试，覆盖 slow/failure/rerender/callback identity |
| A10 | Codex、Claude、Kimi 所有终局映射均穷尽，未知机器 payload 走 `crashed/unknown` 安全分支且原始内容不进 renderer | 类型检查、映射 fixture、快照/DTO 安全测试 |
| A11 | 共享 Codex 结果类型迁移后，GitHub mode 的 max-duration、普通失败 retry、达到预算后的 dead-letter 及 cursor 推进条件与变更前一致 | `runner`/issue-processing 定向回归：受控 Codex fixture 分别触发 max-duration、一次失败后成功、耗尽 retry；断言评论/死信数量、failure count、role cursor、调用次数和退出分类，并跑现有 github-issue-runner 测试集 |
| A12 | 本次 ACP JSON-RPC error 或本次子进程已捕获 stderr 提供明确 `403 + retryable:false` quota 信号时，终局准确显示额度不可用；没有该信号时仍使用保守文案 | Kimi 协议 shim 两组真实 local-console/renderer 运行：结构化 403 组断言 quota terminal 和确认文案，end_turn 空结果组断言 no-complete-result 保守文案；两组 raw payload 均不进入 DOM |

实现完成后必须同时提供定向测试、`pnpm test`、`pnpm typecheck`、console-ui Storybook 门禁和 A1–A12 的真实运行/调用链证据。仅有测试计数、build 成功或 Story fixture 不足以声明 `code-verified`。
