# 设计：kimi-acp-empty-response-failure

## 1. 目标与不变量

本 change 把“Kimi ACP 请求已结束”与“Kimi 本轮有可交付结果”拆开。必须同时守住：

- 裸 `end_turn` 只是 ACP 控制面终止元数据，不能覆盖缺失的 Agent 文本或工具结果。
- 终态有效性只依据当前 ACP turn 已观察事件，不读取 wire，不解释 provider 根因。
- provider external id 一旦合法观察，canonical session 仍必须持久化并用于后续 resume。
- 只有具备有效终态证据的 attempt 才提交可持久读取过程的
  `execution_session_link`。
- 空响应失败不得提交 Agent 回复或推进公开时间线 cursor，不得调用其他 CLI。
- Codex/Claude 的 identity、link、失败与过程记录语义保持不变。

## 2. ACP 终态证据模型

### 2.1 协议边界

当前 Kimi 官方 ACP adapter 使用 ACP v1：`session/prompt` 的
`PromptResponse` 只有 `stopReason`，Agent 内容与工具事实通过 `session/update`
发送。ACP v1 把 `end_turn` 描述为成功结束，但 Kimi 当前会在 provider 请求没有产生
任何响应时仍返回它，因此 Moebius 必须增加 provider-specific output validation。

建议在 `src/kimi.ts` 内实现不依赖 UI/文件 IO 的纯状态：

```ts
interface KimiTerminalEvidence {
  hasVisibleText: boolean;
  terminalToolCallIds: ReadonlySet<string>;
}

type KimiTerminalDecision =
  | { ok: true; kind: "visible-text" | "terminal-tool-result" }
  | { ok: false; code: "KIMI_EMPTY_RESPONSE" };
```

事件投影规则：

| ACP 事实 | 是否构成有效终态证据 | 理由 |
| --- | --- | --- |
| 非空 `agent_message_chunk.content.text` | 是 | 可提交的 Agent 可见文本 |
| 兼容字段中的非空 prompt result text | 是 | 当前 adapter 已支持的可见文本 |
| `tool_call` / `tool_call_update` status=`completed` | 是 | ACP 明确工具已成功终止 |
| `tool_call` / `tool_call_update` status=`failed` | 是 | ACP 明确工具已失败终止，仍是工具结果事实 |
| whitespace-only Agent text | 否 | 不产生可见内容 |
| tool status=`pending|in_progress` | 否 | 只有开始/进行，没有结果 |
| thought、plan、usage、config、available commands | 否 | 不是用户可交付终态 |
| prompt `stopReason=end_turn` | 否 | 仅控制元数据 |
| 未识别 update / `_meta` | 否 | 不对扩展字段猜语义 |

终态工具 status 本身就是 ACP 的完成/失败事实；不强制 `content` 或 `rawOutput` 非空，
因为“成功且无输出”的写文件类工具是合法结果。使用 `toolCallId` 去重，同一个工具的
多次 update 只触发一次 process-link 提交。

### 2.2 合法空回复与 fail-closed 边界

以下结果合法：

- final text 非空，无工具调用；
- final text 为空，但至少一个工具调用到达 `completed` 或 `failed`；
- 工具结果先到、随后 Agent 文本到，仍只提交一次 execution link。

Kimi success result 增加显式 `completionKind: "visible-text" |
"terminal-tool-result"`（具体类型名实现时可等价调整）。`terminal-tool-result` 且
`finalText === ""` 时，runtime 正常结束 lifecycle、保留 execution link、执行必要
workspace-diff 收口并推进该 Agent 的 timeline cursor，但不调用
`recordAgentResponse`，也不运行依赖可见回复文本的 handoff/control 解析。这样合法
无文本完成不会制造空白 Agent bubble，后续 resume 也不会重复接收同一输入。这个分支
只由 Kimi 明确 completion kind 触发，不改变 Codex/Claude 既有空文本兼容行为。

以下结果返回 `KIMI_EMPTY_RESPONSE`：

- 无任何 update 的裸 `end_turn`；
- 只有 whitespace text；
- 只有 thinking/plan/usage/config；
- 只有 pending/in-progress 工具；
- prompt 文本包含“无需回复”“不要回答”等自然语言，但没有协议证据。

最后一条是刻意的 fail-closed 选择：当前 ACP v1 没有 intentional-silence 信号，
按 prompt 文义放行会同时把额度、认证或服务错误伪装成成功。未来若 Kimi/ACP 增加明确
且受支持的 intentional completion 内容，必须另行扩充判定与公共投影，不能通过 unknown
字段自动放行。

## 3. Session identity 与 execution link 分相

### 3.1 现状问题

当前单一 `onSessionStarted` 同时承担五件事：

1. 记录 active run 的 external id；
2. 写 `provider_session_observed`；
3. 写 canonical `agent_session_link`；
4. 写 attempt `execution_session_link`；
5. Codex 兼容路径写 `codex_thread_link`。

Kimi 在 prompt 前调用它，所以 prompt 后再返回失败无法撤销已经追加的 JSONL facts。
append-only 事实也不应通过“删除 link”修复。

### 3.2 两阶段回调

把执行边界拆为：

```ts
onSessionObserved({ engine, externalSessionId })
onExecutionTraceReady({ engine, externalSessionId })
```

`onSessionObserved`：

- 设置 active run thread/session id；
- 写 `provider_session_observed`；
- 建立或幂等确认 canonical `agent_session_link`；
- 不写 attempt 过程 link。

`onExecutionTraceReady`：

- 要求同一 invocation 已观察完全相同的 engine/external id；
- 幂等写 `execution_session_link`；
- Codex 路径同时写兼容 `codex_thread_link`；
- 冲突、乱序或 fact 写入失败一律 fail closed。

provider 时机：

| Provider | observed | trace ready |
| --- | --- | --- |
| Codex | 当前 `thread.started` identity 核验点 | 同一点 |
| Claude | 当前 matching `system/init.session_id` 核验点 | 同一点 |
| Kimi | `session/new|resume` id 一致性核验后 | 本 turn 首个非空 Agent text 或终态 tool result |

Kimi adapter 用单调 Promise tail 串行执行一次 `onExecutionTraceReady`。同步
`session/update` listener 只更新纯证据并排队 callback；在返回成功前必须 await tail。
callback 失败时不得返回成功或提交公开回复。

### 3.3 失败与恢复后果

空响应的事实形状：

- 有 `provider_session_observed`；
- 有 canonical `agent_session_link`；
- provider invocation terminal outcome 为 failed；
- 没有该 run 的 `execution_session_link`；
- 没有 Agent response 和 timeline cursor；
- run lifecycle 为 failed，页面显示可重试终态。

后续 retry/re-run/edit-resend 仍由 creation evidence + canonical link 规划为 resume S。
它不得因为原 attempt 没有 execution link 而执行 `session/new`。这保留现有
“provider id 在后续 output validation 失败前已观察，下一次 resume 同一 id”的恢复
不变量，同时让 provider trace resolver 无法再用失败 attempt 读取 wire。上一轮额度
403 下借空成功提交 execution link 的取证办法因此关闭。

恢复同一未完成 run（`continuingSameRun`）已经有 canonical identity 时，两阶段回调只做
同 id 校验；若恢复段产生有效证据，仍为原 run 幂等补齐 execution link。不同 id
继续 fail closed。

失败发生在任何 provider session id 被观察之前时，沿用既有恢复语义：显式 retry 消费
冻结的旧 run context 并以 `full-fallback` 再试一次，而不是误判成
`session-link-missing`。这不适用于 Kimi empty failure——empty 判定发生在
`session/new|resume` 和 identity observation 之后，因此它始终 resume canonical S。

## 4. 稳定失败与诊断边界

新增：

```text
internal KimiAcpError.code = KIMI_EMPTY_RESPONSE
CodexRunFailure.code      = kimi-empty-response
CodexRunResult.reason     = kimi-empty-response
safe message              = Kimi 没有返回可用回复。请在终端直接运行 kimi 查看详细错误，然后重试。
```

最终安全文案采用：
`Kimi 没有返回可用回复。请在终端直接运行 kimi 查看详细错误，然后重试。`。这里的
`kimi` 是用户可执行的 CLI 名称，不是本机绝对路径；文案只提供自查动作，不断言额度、
认证、模型或网络是成因。

`runKimiAcpWithTransport()` 在完成证据判定后抛出内部错误；外层
`runKimiAcp()` 复用现有 cleanup、`appendKimiFailureDiagnostic()` 与失败分类。诊断
可以记录 bounded 的 stopReason、可见文本字节数、terminal tool 数与内部错误码，但
不得把整份 prompt、wire 或 provider payload塞入普通 timeline/renderer DTO。

console-ui 把 `kimi-empty-response` 加入安全终态 code 白名单，显示 failure message 与
「重试」。不根据本机日志把文案改成额度、认证或模型判断，也不显示空白 Agent bubble。

## 5. 实现落点

### `src/kimi.ts`

- 增加纯 evidence reducer/decision。
- 从 session updates 同时收集文本和 terminal tool status。
- 裸 `end_turn` 无证据时抛 `KIMI_EMPTY_RESPONSE`。
- 分开 identity observed 与 trace-ready callback，并保证 callback once/await/错误传播。
- 分类稳定失败并写 bounded 本地诊断。

### `src/local-console/execution-driver.ts`

- 将 provider callback 映射成 observed/trace-ready 两阶段。
- 保存 observed identity 与 trace-ready identity，校验 engine/id 一致、重复幂等和乱序
  fail closed。
- Codex/Claude 维持当前同点触发；Kimi 使用 adapter 的两个时机。

### `src/local-console/runtime.ts`

- 主 Agent 与 detached worker 两条重复执行路径都拆分事实写入职责。
- observed 阶段写 observation/canonical；trace-ready 阶段写 execution/legacy Codex
  过程 link。
- fallback 只用于成功 result 且 provider 没有回调的兼容路径，并按相同顺序补齐两阶段。
- 失败不提交 Agent response、cursor、workspace-diff completion 或 handoff。
- 合法 Kimi tool-only success 完成 lifecycle、workspace diff 与 cursor，但不写空 Agent
  response，不执行依赖可见回复的 analysis-control、CEO child orchestration 或 handoff。

### `packages/console-ui`

- 增加 safe code 映射与可见文案测试；不新增组件或版式。

### 文档

- 新验收脚本成为常用命令后同步 `AGENTS.md` 与 `docs/architecture/module-map.md` 的真实
  职责；`packages/console-ui/DESIGN.md` 不变。

## 6. 测试策略

### 6.1 Kimi adapter 单测

- 裸 `end_turn`、whitespace text、thinking-only、pending/in-progress tool 均失败。
- 非空 stream text、兼容 prompt result text 均成功。
- `tool_call` 或 `tool_call_update` 的 completed/failed 在无文本时成功。
- 重复 terminal update 只触发一次 trace-ready callback。
- “无需回答” prompt 无协议证据仍失败，证明不按 prompt 猜意图。
- empty failure 返回稳定 code/message，原始 diagnostic 不进入 result。
- observed callback 发生、trace-ready callback 不发生；callback 写入失败向上 fail closed。

### 6.2 Execution/runtime 单测

- Codex/Claude link 时机与既有测试完全不变。
- Kimi empty failure 在 direct primary 与 detached worker 两条路径都进入 failed，
  不记录空 Agent response/cursor/execution link。
- 同一失败仍记录 observation/canonical，下一次 retry 精确 resume S，调用次数中没有
  replacement `session/new` 或其他 CLI。
- 有文本 Kimi 写 execution link 并正常提交 Agent response；tool-only Kimi 写
  execution link、完成并推进 cursor，但不提交空 Agent response 或文本 handoff。
- process-link/canonical-link 任一冲突或写入失败 fail closed。

### 6.3 UI 单测

- `kimi-empty-response` 显示“这一步没跑起来”、安全说明与「重试」。
- 页面不显示 403、绝对路径、session id、raw payload 或空 Agent message。
- 父级重渲染和错误 DTO 更新不改变安全映射。

## 7. 真实运行验收

新增 `pnpm exec tsx scripts/acceptance/kimi-empty-response.ts`，使用真实 Electron 窗口、
真实 Kimi CLI 与当前额度 403 环境：

1. 从 Kimi 成员页面发送唯一标记 prompt，等待 attempt 终态：
   - 页面显示「这一步没跑起来」；
   - 显示“Kimi 没有返回可用回复。请在终端直接运行 kimi 查看详细错误，然后重试。”；
   - 不出现空白 Agent 回复或 completed 状态；
   - attempt 标明 Kimi、failed、真实耗时，且「重试」可用。
2. 检查真实 session facts：
   - terminal provider invocation outcome 为 failed、reason 为 `kimi-empty-response`；
   - `provider_session_observed` 与 canonical `agent_session_link` 指向同一 S；
   - 该 run 没有 `execution_session_link`、Agent response 或 timeline cursor。
3. 在页面点击「重试」：
   - 第二个 attempt 仍进入相同安全失败；
   - Kimi 实际走 `session/resume S`，没有 `session/new`、Codex 或 Claude fallback；
   - 两次 attempts 各自保留独立状态与耗时。
4. 重启 Electron 并重新打开会话：
   - 两次失败及安全文案保持；
   - 打开该 attempt 的「完整输出」只显示 Kimi 记录不可用，不借 wire、最终回复或其他
     provider 内容补造；
   - 页面与 evidence JSON 均不含 403 原文、绝对路径或 provider payload。
5. 本地 `kimi-stderr.log` 存在 bounded `KIMI_EMPTY_RESPONSE` 诊断，证明原始诊断未被
   丢失；脚本只在系统临时目录保存脱敏 evidence，不把日志内容写入仓库。
6. 重跑 `pnpm exec tsx scripts/acceptance/provider-native-process-traces.ts` 的真实
   Claude 页面链路：
   - `claudeThinkingToolAndResultVisible` 仍为 true；
   - 两个 Claude attempts 的 engine、状态、计时、模型及同源 session facts 仍为真；
   - `restartRetainsNativeTrace` 仍为 true；
   - evidence 与本 change 的 Kimi evidence 一起提交，不能只引用单元测试。

真实运行前先确认当前 CLI 仍复现空 `end_turn`。若额度刷新导致 Kimi 返回正常内容，
本验收应报告环境前提不成立而不是伪造失败；使用单测覆盖空响应注入，等待可复现 provider
状态后补真实页面证据，不得据此声明 `code-verified`。

## 8. 风险、回滚与权衡

### 误判用户要求静默

裸 `end_turn` 无法区分 intentional silence 与 provider 内部失败。选择 fail closed 会让
“无需回答”但 provider 真正零输出的请求显示失败；这是比静默吞掉额度/认证错误更可逆
的结果，用户可以重试或忽略。禁止用 prompt 关键词白名单，因为语言、否定和上下文都会
制造误判。

### Link 时机改变

把 execution link 推迟到首个有效证据会让完全无事件的活动 Kimi run 暂时没有可持久
过程入口；但 identity/canonical 已持久化，崩溃恢复仍只 resume 原 session。一旦收到
文本或终态工具结果，link 立即补齐。回滚时可恢复两阶段在 Kimi session start 同点触发，
不需迁移旧事实。

### 并发 change

`provider-native-process-traces` 尚未归档，两个 change 都触及 provider process link
Requirement。实现不修改前者的 change 文件；归档前按先前者、后本 change 的顺序重放
spec delta 并核对最终标题/语义，避免后一份 delta 覆盖 provider 泛化。

### Provider 协议演进

ACP 新增 content/intentional completion 类型时，unknown update 仍不构成成功，不会因
版本升级静默放宽。需明确实现公共投影、测试和 spec 后才能加入证据集合。

## 9. 实现后符合度反思

- 实现与终态证据表一致：只有非空可见文本或 completed/failed 工具结果构成成功证据；
  whitespace、thinking/plan、usage/config、未终态工具和未知 `_meta` 均不放宽判定。
- session observation/canonical link 与 execution link 已按设计拆开。真实 Kimi 空响应的
  两次 attempts 均保留同一 canonical session，但没有 execution link、Agent response 或
  timeline cursor；页面重试实际走 resume，未切换到其他 provider。
- tool-only success 使用显式 `terminal-tool-result` disposition，完成 lifecycle 与 cursor，
  不发布空 Agent bubble，也不进入文本 handoff/control 解析。
- 真实页面验收发现「无 execution link」分支仍使用泛化过程记录文案，已补为按 attempt
  engine 显示 `Kimi 过程记录已不可用`；全套测试又发现一个依赖 Codex session link 的
  既有用例没有模拟 provider 的 thread-start 核验点，已补齐真实 callback，避免测试依赖
  result thread id 的非契约推断；Kimi empty failure 仍不会提交 execution link。
- PRD、spec delta、稳定错误码、安全文案和本地 bounded diagnostics 已逐项核对；未把
  403、额度、认证、模型或 wire payload 写入公开结果。2026-07-31 重跑真实 Claude
  Electron 回归后，thinking、Read 工具、唯一工具结果、双 attempt facts、重启保留与
  transcript 删除降级均通过，且删除验收后 transcript 已恢复。
- `provider-native-process-traces` 仍因 Kimi 真实 thinking / tool call / tool result
  受账户计费周期额度 403 阻塞，不能先归档。为执行“分别归档”，本 change 归档时以
  当前 specs 为基线重放已验证事实，并把与 provider 泛化 Requirement 重叠的最终语义
  前移到仍开放的 provider delta；未验证的三条 Kimi 渲染事实不进入当前 specs。
