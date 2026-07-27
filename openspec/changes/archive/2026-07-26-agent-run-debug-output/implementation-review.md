# 实现符合度反思

## 结论

实现符合已确认的 A + R2 范围：Codex 完整输出按 attempt 展示真实 prompt stack、运行元数据、未脱敏调用与结果及 token usage；reasoning 文本与 encrypted reasoning payload 保持过滤。Kimi 没有新增恢复能力，只提供明确的局部不可用状态。

## 对照检查

- 数据源：prompt 与模型事实直接来自身份校验后的 Codex rollout；只有 rollout 缺少元数据时才使用同一 run 的 immutable execution context，未使用当前团队配置重组历史值。
- 分层：`SYSTEM_PROMPT`、`DEVELOPER_PROMPT`、`USER_INPUT` 独立读取和展示，缺层局部标记。
- 原始事件：保留精确时间戳、协议类型、call id、参数、结果、绝对路径、内部标识与 unknown payload；终端控制字符转为可见文本。
- 性能与竞态：事件保持反向分页、append cursor 与虚拟列表；prompt 独立惰性加载并按 run key 缓存，Abort 与响应身份检查阻止跨 tab / session 覆盖。
- 边界：token usage 可见；reasoning 与 encrypted payload 在 projector 与 unknown fallback 两层过滤。
- 降级：单个 attempt rollout 缺失只影响自身；Kimi 没有空入口，也不借用 Codex 记录。

## 实现期发现与修正

真实桌面首次验收发现 Kimi 的未启动失败记录只显示失败事实，没有原位解释完整输出不可用。实现补充了 terminal outcome 的 Kimi 不可用说明和组件回归测试；重启桌面后复验通过。

独立 QA 随后发现：同一步中断后重试时，前端以 `sessionId + runId` 作为标签来源，导致两次 attempt 各建一个标签；无 role 的 system 中断事实还会产生“成员未知”。修复后，过程标签以 `sessionId + stepId` 作为稳定身份，`runId` 只保留为聚合过程读取锚点；终态标题从同一步消息或聚合响应的 role 修正。旧版已持久化的 run-key 标签会在同一 run 再次打开或会话消息恢复后升级到 step-key。

第二次独立 QA 发现：过程标签在 attempt 仍为 `running` 时打开，append 轮询只更新步骤级 `settled`，没有刷新 attempt 的终态元数据，导致标签保留旧 `running` header 直到 renderer 重载。修复后，`running → settled` 边沿会以同一 `sessionId + runId` 立即重读一次权威过程元数据；已经 settled 的后续轮询仍保持单次 append 请求，新的 retry 通过既有 cursor-invalid 路径恢复全量。组件渲染始终以最新 `attempts` 元数据覆盖虚拟事件中的旧 header，终态合并保留已分页事件、previous cursor 和阅读位置。

## 范围外改动

没有引入调试导出、搜索、筛选、自动脱敏、Kimi rollout 恢复或无关重构。根 `AGENTS.md` 未更新，因为本次没有新增命令、顶层目录、红线或域指针。

## 验证

- `pnpm test`：四个分片共 1369 项测试通过。
- `pnpm typecheck`：通过。
- `pnpm --filter @moebius/console-ui build`：通过。
- `pnpm --filter @moebius/desktop build`：通过。
- 真实 Electron 桌面 10 条验收均通过，证据见 `artifacts/acceptance/agent-run-debug-output-evidence.json`。

独立 QA 报告缺陷修复后的开发复验：

- 同一步中断事实与重试成功回复分别打开时只保留一个成员名正确的标签，组件定向回归通过。
- `pnpm test`：四个分片共 1374 项测试通过。
- `pnpm typecheck` 与桌面生产构建通过。
- 隔离数据根中的真实 Codex `interrupt → retry` Electron 验收通过；两次 run 的 `stepId` 相同，标签唯一且同时显示 interrupted / completed attempts，证据已追加到同一验收文件。

第二次独立 QA 报告缺陷修复后的开发复验：

- `pnpm test`：四个分片共 1383 项测试通过。
- `pnpm typecheck`：三套类型检查通过。
- `pnpm --filter @moebius/console-ui build` 与 `pnpm --filter @moebius/desktop build`：通过。
- 定向回归覆盖 `running → completed / failed / interrupted` 的终态重读与渲染，另覆盖 settled 后不重复全量读取、cursor-invalid retry 恢复，以及终态合并不丢已分页事件与 previous cursor。
- 隔离数据根的真实 Electron 中，保持过程标签打开且不重载 renderer：真实 Codex `sleep 12` 完成后由「第 1 次执行 · running」自动变为 `completed` 并显示完成时间；另一真实 `sleep 30` run 经 interrupt API 后自动变为 `interrupted`，旧 `running` 文案消失。证据已追加到同一验收文件。
