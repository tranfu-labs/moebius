# 提案：kimi-acp-empty-response-failure

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/agent-conversation.md` | 异常终态 | 明确 Kimi 裸 `end_turn` 的有效输出判据、安全失败呈现和 session/link 语义 | 已写入 |
| `docs/product/pages/agent-conversation.md` | 指标与验收 | 增加空响应失败、同 session 重试、无空白回复和无原始诊断泄漏的真实页面验收 | 已写入 |

## 背景

`runKimiAcpWithTransport()` 当前在 `session/prompt` 返回后无条件返回 `ok:true`。当 Kimi
模型请求在 provider 内失败、ACP adapter 却只返回 `{ stopReason: "end_turn" }` 且没有
任何 `agent_message_chunk` 或工具结果时，Moebius 会把空字符串作为成功 Agent 回复
提交，把 run 标成 completed。用户看到的是执行成功但回复空白，provider 的真实失败被
静默遮蔽。

本机当前账户额度耗尽时已经稳定复现这个形状：裸环境与受管环境都收到 provider 403，
ACP 层仍以空 `end_turn` 结束。这个事实只能证明“没有可用终态输出”，不能证明所有空
响应都由额度导致；修复不得读取 wire 后把具体成因猜进普通时间线。

当前 runtime 还有一个不能忽略的边界：Kimi 在 `session/new|resume` 返回 id 后、prompt
前就触发 `onSessionStarted`，该回调会同时写
`provider_session_observed`、canonical `agent_session_link` 和
`execution_session_link`。因此只在 `kimi.ts` 最后检查空字符串，虽然能把 run 改成
failed，却不能兑现“空响应 attempt 不提交过程读取 link”。本 change 必须拆开 session
身份观察与 attempt 过程 link 的提交时机。

## 已确认产品选择

1. 无非空 Agent 文本、无终态工具结果的裸 `end_turn` 是无效输出，返回稳定
   `kimi-empty-response`；不得提交空白 Agent 回复。
2. 不按 prompt 文义识别“用户要求无需回答”，也不从 wire/stderr 推断额度、认证、模型
   或网络成因。ACP v1 没有 intentional-silence 信号，裸 `end_turn` 本身不算内容。
3. 无可见文本但至少一个 ACP 工具调用到达 `completed` 或 `failed` 是合法无文本完成；
   pending/in-progress 工具、thinking、plan、usage、config 更新都不够。
4. provider session observation 与 canonical link 仍在 id 通过一致性校验后持久化，保证
   后续重试只 resume 同一 session；当前空响应 attempt 不提交
   `execution_session_link`，因此上一轮依赖该 link 的 Kimi wire 取证路径会关闭。
5. 原始诊断只写本地 Kimi stderr/diagnostic log；普通时间线只显示稳定、安全、可操作的
   Kimi 空响应说明，并引导用户在终端直接运行 `kimi` 查看 CLI 自己的详细错误；不把
   这条自查路径表述为任何具体成因判断。

## 提案

### A. 终态证据判定

- 在 Kimi adapter 内维护本轮纯状态 `KimiTerminalEvidence`，只从 ACP
  `session/update` 与 `session/prompt` 响应投影，不读取 wire。
- 非空 `agent_message_chunk.content.text` 或当前兼容的非空 prompt result text 立即构成
  可见回复证据。
- `tool_call` / `tool_call_update` 的 status 到达 `completed|failed` 构成终态工具结果；
  tool start、pending、in_progress、thought、plan、usage 和配置更新不构成成功证据。
- prompt 返回裸 `end_turn` 而证据仍为空时抛出 `KIMI_EMPTY_RESPONSE`，由既有 Kimi
  failure wrapper 归一为 `reason/failure.code = kimi-empty-response`。
- 工具终态构成的合法无文本完成使用显式 success disposition：run 完成并推进 cursor，
  但不写空白 Agent response，也不触发依赖可见回复的 handoff。

### B. Session 身份与过程 link 分相

- 将通用执行回调拆成“session identity 已观察”和“该 attempt 已具备可接受过程事实”
  两个阶段。
- Codex/Claude 在现有已核验 identity 点同时触发两阶段，保持当前 link 与过程读取语义。
- Kimi 在 `session/new|resume` id 一致性核验后提交 observation/canonical link；在本轮
  第一次出现非空 Agent 文本或终态工具结果时，才幂等提交
  `execution_session_link`。
- 空响应失败没有 execution link，但 canonical link 保留；用户重试必须 resume 原 Kimi
  session。不得为了补过程记录再次 `session/new`。

### C. 安全失败与真实运行验收

- 扩充共享 failure union、Kimi 分类器与 console-ui 安全错误白名单，显示稳定空响应
  说明、终端运行 `kimi` 的自查引导和「重试」，不显示 403、绝对路径、session id 或
  provider payload。
- 新增独立真实 Electron 验收脚本，在当前可复现额度 403 的环境中断言失败状态、无空白
  Agent 消息、canonical resume、不提交 execution link 及页面安全文案。

## 影响

### 业务域

- `local-console`：Kimi ACP 终态判定、稳定失败码、session/link 两阶段提交和恢复事实。
- `console-ui`：安全空响应说明及失败状态回归。

### 主要代码落点

- `src/kimi.ts`、`src/codex.ts`。
- `src/local-console/execution-driver.ts`、`runtime.ts`。
- `packages/console-ui/src/console/operator-console.tsx` 及 i18n/测试。
- `scripts/acceptance/kimi-empty-response.ts` 与相关定向测试。

模块依赖方向不变，Kimi adapter 不读取 process-trace resolver 或 renderer；本 change
不新增架构图或组件模式。

### 与现有 change 的关系

本 change 基于已实现但尚未归档的 `provider-native-process-traces`：它使用该 change
引入的 provider-neutral `execution_session_link` 名称，并有意让空响应 attempt 不进入
其 resolver。通常归档顺序为先 `provider-native-process-traces`、后本 change；若前者
仍被独立验收条件阻塞，则本 change 可在重放当前 specs 后单独归档，但 MUST 把已验证的
重叠 link 语义前移到仍开放的 provider delta，且不得把前者未验证事实写入当前 specs。

### 非目标

- 不识别或显示“额度不足”“认证失败”“模型不可用”等具体成因。
- 不从 Kimi wire、ACP stdout/stderr 或 prompt 文义恢复一条虚构回复。
- 不改变 Codex/Claude 的 session/link 时机、终态解析或过程记录能力。
- 不增加跨 CLI/provider 自动 fallback，不改变 Kimi provider/model 配置。
- 不修 Kimi CLI 自身把 provider 错误折叠为 `end_turn` 的行为。
