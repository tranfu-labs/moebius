# 提案：agent-run-debug-output

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-right-sidebar.md` | `页面结构 / 过程标签` | 把友好过程时间线升级为分层、未脱敏的单次 Agent 调试调用链 | 已写入 |
| `docs/product/pages/main-right-sidebar.md` | `区域与信息 / 过程标签` | 明确 prompt stack、模型元数据、原始事件字段与历史降级；展示 token 统计并过滤 reasoning | 已写入 |
| `docs/product/pages/main-right-sidebar.md` | `指标与验收` | 把 SYSTEM_PROMPT、调用结果、时间戳、模型和结束状态纳入逐条验收 | 已写入 |
| `docs/product/pages/main-right-sidebar.md` | `现状参考与产品缺口 / 非目标` | 记录当前清洗投影与目标调试视图的差距，收紧本次非目标 | 已写入 |

本次产品决策来自本地会话确认：选择完整调用链方案 A，包含组装后的 `SYSTEM_PROMPT`、用户输入、工具调用与结果、原始输出、时间戳、模型及结束状态；调试面板分区展示，长内容默认折叠，不脱敏。

该确认没有直接提及 reasoning 与 token 统计，因此曾作为实现前阻塞决策列出：

- **R1：两者都展示**。最符合“rollout 可见内容尽量完整”的调试口径；需要为 reasoning 文本 / encrypted payload 与 token_count 增加独立事件类型、折叠展示、分页与敏感信息提示，并补充大体积与不可读 payload 测试。
- **R2：只展示 token 统计，继续排除 reasoning**。可调试上下文消耗、缓存命中和限额问题，同时不开放 reasoning 内容；需要增加 usage DTO 与展示，但保留 reasoning 的显式过滤。
- **R3：两者都继续排除**。维持当前边界、实现量最小；“完整调用链”将明确表示完整输入、调用、输出和运行事实，而不是 rollout 全记录。

用户已选择 **R2**：展示 token 统计，继续过滤 reasoning。`token_count` / usage 以独立调试事件显示上下文消耗、缓存命中和限额相关原始统计；`reasoning`、`agent_reasoning` 与 encrypted reasoning payload 显式过滤，未知事件兜底不得绕过该边界。

## 背景

当前「完整输出」实际是面向普通用户的安全过程时间线。`src/local-console/process-event-projector.ts` 主动过滤 `session_meta`、developer / user prompt、模型上下文、token 和 reasoning，并清洗绝对路径与内部 id；`packages/console-ui/src/console/process-event.tsx` 又做一次路径和 id 脱敏。结果适合解释“做了什么”，但不足以调试“这一轮究竟带着什么指令、调用了什么、为什么这样结束”。

现有 Codex rollout 已经记录：

- `session_meta.base_instructions.text` 与 provider / CLI 元数据；
- developer 层和 user 层 message；
- `turn_context` 中的 model / effort / cwd 等运行上下文；
- 带时间戳的 Agent 输出、命令、函数、工具 / MCP、文件、错误和生命周期事件。

因此缺口主要是读取契约、投影边界和 UI 信息架构，不需要新造一份 prompt 或复制 rollout。

## 提案

1. 将过程标签改成按 attempt 分区的调试调用链。每个 attempt 顶部显示模型、effort、provider、CLI、开始 / 完成时间、Moebius 结束状态与原始标识。
2. 为每个 attempt 提供可按需展开的 `SYSTEM_PROMPT`、`DEVELOPER_PROMPT`、`USER_INPUT` 三层。内容直接读取该 run 关联的 Codex rollout，缺失时按层显示未记录，不事后重组。
3. 事件流保留原始协议类型、精确时间戳、call id、参数、结果、状态、绝对路径和内部标识；长内容默认折叠，展开后不截断。
4. 展示 `token_count` / usage 统计并显式过滤 reasoning。其他未知事件显示原始类型和 payload，不再用无信息占位吞掉调试线索。
5. 继续复用 `runId → Codex thread` 稳定关联和受信任 Codex sessions 根，不复制 rollout，不用 stdout tail 或最终回复冒充。
6. prompt stack 采用 attempt 级按需读取，过程事件继续反向分页和增量追加；避免每一页重复携带大段 prompt，也避免一次性把大型 rollout 挂进 DOM。
7. 调试原文只以文本方式渲染。终端控制字符转成可见转义，HTML / Markdown / 脚本不获得执行能力。

## 影响

- `src/local-console/codex-rollout.ts`：增加只读 invocation/debug metadata 提取，维持受信任根与文件身份校验。
- `src/local-console/process-event-projector.ts`：从友好脱敏投影改为明确边界下的 lossless debug 投影。
- `src/local-console/process-history.ts`、`src/local-console/runtime.ts`、`src/local-console/server.ts`：扩展 attempt 元数据并增加按 run 读取 prompt stack 的窄接口。
- `desktop/src/console-page/state-sync.ts`、`desktop/src/console-page/app.tsx`：接入 prompt stack 的惰性加载、失败与竞态收敛。
- `packages/console-ui/src/console/process-tab.tsx`、`process-event.tsx`：实现 attempt 概览、prompt 分层、原始事件、精确时间戳和调试风险提示。
- `packages/console-ui/DESIGN.md`：登记调试披露组这一新组件模式。
- `docs/product/pages/main-right-sidebar.wireframe.html`：实现阶段同步已经写入 MD 的调试调用链结构，不新增产品事实。
- `openspec/specs/local-console/spec.md`、`openspec/specs/console-ui/spec.md`：实现验证后由本 change 的 delta 回流。

模块依赖方向不变：`console-ui` 只消费展示 DTO；rollout 读取和文件系统约束继续留在 `local-console`；desktop renderer 只负责 HTTP 适配和异步状态。

## 真实运行验收清单

| # | 页面入口 | 真实运行可观察信号 |
| --- | --- | --- |
| 1 | `pnpm desktop` → 打开已有或新建会话 → 让 Codex 成员完成一步 → 在该 Agent 历史消息下点击「完整输出」 | 右侧栏聚焦该步骤唯一标签，标题显示「成员名 · 这一步的调试调用链」，并出现「第 1 次执行」与本地原始调试信息提示 |
| 2 | 同一过程标签 → 展开 `SYSTEM_PROMPT`、`DEVELOPER_PROMPT`、`USER_INPUT` | 三层分别显示 rollout 中的原文；`USER_INPUT` 能找到本轮发送的唯一文本标记，任一 rollout 未记录的层明确显示「该层未记录」而不显示其他层内容 |
| 3 | 让该 Agent 执行一个会输出唯一标记的命令，再打开「完整输出」 | 调用事件显示精确 ISO 时间戳、原始协议类型、call id 与未改写参数；结果事件显示完整唯一输出标记 |
| 4 | 让命令输出 `pwd` 并让工具参数携带唯一 `runId=debug-marker` 文本 | 展开后看到完整绝对路径和 `runId=debug-marker`，不出现 `…/文件名` 或「内部标识已隐藏」 |
| 5 | 查看一次已结束的 run 与一次运行中的 run | attempt 概览分别显示实际 model / effort / provider / CLI、开始时间；已结束 run 还显示完成时间和 completed / failed / interrupted / stuck 等真实结束状态，运行中 run 显示 running |
| 6 | 制造超过 20 行的工具输出并保持过程标签打开 | 长 prompt / 参数 / 输出默认折叠；展开后首行、中间行、末行都可见且可选择复制，调用链继续增量追加，不抢走向上阅读位置 |
| 7 | 同一步失败后重试，再重启桌面应用并重新打开该过程标签 | 第 1、2 次执行各自保留自己的 prompt stack、模型、计时、结束状态和事件；重启后仍从各自 rollout 恢复，不发生跨 attempt 串线 |
| 8 | 删除或移走其中一次 attempt 的 rollout 后重新打开 | 仅该 attempt 显示过程记录不可用；其他 attempt 正常显示，不出现 stdout tail 或最终回复伪装内容 |
| 9 | `pnpm desktop` → 使用 Kimi 成员运行一步 → 查看该运行记录 | 最新活动、计时和最终回复照常显示；完整输出原位明确显示「完整输出不可用 · 当前 Kimi 执行不提供可恢复的完整过程记录」，没有可点击后才发现空白的入口，也不打开 Codex 过程标签 |
| 10 | 让 Codex 完成一次有 token usage 的执行并打开「完整输出」 | 调用链显示 token 统计的原始协议类型与 input / cached input / output / total 等实际存在字段；页面中找不到 reasoning 文本或 encrypted reasoning payload |

## 非范围

- Kimi 完整输出的数据采集与恢复能力；当前仅保留清晰的局部不可用状态。现有执行链只为 Codex 建立 `codex_thread_link` 并通过 `resolveCodexRollout()` 读取受信任 rollout；Kimi 的通用 `externalSessionId` 只支持恢复执行，不能据此定位可验证、可分页的完整过程记录。
- 原始 reasoning 文本与 encrypted reasoning payload；token 统计属于本次范围。
- 自动脱敏副本、调试链导出、搜索和筛选；
- 把 rollout 复制进 Moebius session JSONL / SQLite；
- 改变主时间线的安全活动摘要、完整输出入口位置或右侧栏标签去重规则。
