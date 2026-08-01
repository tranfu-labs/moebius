# 提案：repair-local-console-acceptance-scripts

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-conversation.md` | `#Agent 执行与恢复` | 不改产品意图；验收 fixture 跟随既有 provider session identity 契约 | 无需修改 |
| `openspec/specs/local-console/spec.md` | `Kimi 空响应`、`每个 Agent run 持久化到 provider session` | 不改现行行为事实；修正脚本对既有事实的错误投影 | 无需修改 |
| `docs/architecture/module-map.md` | `console-ui` 的本地执行监督验收边界 | 不改依赖或职责；脚本继续只用生产 Electron、local-console API 与可控 CLI | 无需修改 |

本次只维护验收脚本，不改变产品行为、产品意图、模块边界或外部契约，因此不写 PRD、spec delta、ADR 或架构图。团队已要求本批仍保留“方案落盘后停点”，故建立此 change；实现完成后按归档规则再次核对事实源。

## 背景

三条验收入口因各自的测试前提漂移而不能继续提供证据：

1. `local-runtime-supervision.ts` 的 A2 仍要求正文包含“可能是额度或服务问题”，但 `2bc009d` 的 `src/kimi.ts` 已经使用专属 Kimi 空响应安全说明；当前 spec 要求稳定 `kimi-empty-response`、安全可操作说明、终端 `kimi` 自查引导，且 renderer DTO 不含 provider HTTP 状态。旧断言要求呈现成因猜测，与现行要求不相容。A2 抛错后，同一脚本后续 A12/A7/A8 不会执行。
2. `local-console-t5.ts` 的共享成功 fixture `codexOk()` 返回 `threadId: null`。`7300fc2` 引入成功 run 的 provider identity fail-closed 时，同一提交已经把常规 local-console 测试 fixture 改成“full 产生非空 ID、resume 返回请求 ID”，唯独 T5 验收 fixture 遗漏。生产 Codex 正常成功会消费 `thread.started`，等待持久化 callback 后返回同一 ID；没有 ID 的所谓成功必须成为 `provider-session-id-missing`，不能放宽产品 guard。
3. `local-console-agent-handoff-resume.ts` 同时钉死作者机器的数据根和一组历史 session/run/message/provider ID。只把路径换成参数仍会把不可移植的历史样本依赖转嫁给调用者；只读核查还确认该路径下指定 JSONL 与 session 记录现已不存在，因此简单参数化无法满足“换一个数据根后脚本成功跑完”的验收要求。

三项都是验收基础设施偏离既有产品事实，不是产品回归。实现不得修改 `src/kimi.ts`、provider identity guard、resume/repair 规则或 renderer。

## 提案

- A2 改为核对稳定语义：`crashed + kimi-empty-response`、安全终端自查引导、没有 Agent 回复、侧边栏失败状态，并明确拒绝把额度/服务猜测重新当成空响应契约。完整运行监督脚本，证明 A2 后的 A12/A7/A8 均实际执行。
- 把 T5 的共享成功 fixture 改成真实 adapter 形状：full run 生成按 run 隔离的非空 thread ID，resume 原样返回请求 ID，并在返回成功前调用 `onThreadStarted`。产品端 `provider-session-id-missing` 保持不变。
- 把 handoff-resume 的历史输入改为脚本自己在系统临时目录构造：先经生产 local-console server/store 与受控 provider 建立 manager→QA handoff、canonical ID 和 graceful intent，再只把 fact log 转成既有 legacy `agent + pending` footprint；随后继续完整复制到第二个临时数据根，并用生产 Electron 验证 startup repair、同 run/thread resume、exact-source 隔离、历史不重写、重复启动幂等与源数据根未写。
- session/run/message/provider ID 全部从准备阶段的真实返回值捕获，不保留作者路径或历史数字常量。evidence 同时记录随机 source data root、copied data root、准备前提及原有断言结果。

## 影响

- `scripts/acceptance/local-runtime-supervision.ts`
- `scripts/acceptance/local-console-t5.ts`
- `scripts/acceptance/local-console-agent-handoff-resume.ts`
- 如 legacy footprint 重写需要与现有测试共享，仅允许抽取到 `src/testing/` 的纯 fixture helper，并同步改用它的既有测试；不得把 fixture 构造放进生产 local-console 模块。
- 不新增真实 I/O 测试；只修复三条已经存在的验收入口。完整运行证据继续写系统临时目录，不提交用户数据、SQLite、JSONL 或 artifacts。
