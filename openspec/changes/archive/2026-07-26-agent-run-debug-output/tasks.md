# 任务：agent-run-debug-output

- [x] 用户已裁决 R2：展示 token 统计、过滤 reasoning；已同步 PRD、proposal、design、spec delta 与验收。
- [x] 在 `codex-rollout.ts` 增加受信任根内的 attempt invocation / metadata 读取，覆盖 system / developer / user 层、模型元数据、缺层、损坏、身份变化与有界大小。
- [x] 扩展 `process-history.ts` 的 attempt meta，并在 runtime / server 增加按 `sessionId + runId` 读取 prompt stack 的窄接口；保持原过程分页、append cursor 与 unavailable 语义。
- [x] 将 `process-event-projector.ts` 改为未脱敏 debug DTO：保留原始协议类型、时间戳、call id、参数、结果、路径、内部标识和 unknown payload；reasoning / token 按已裁决边界显式投影或过滤，不得经 unknown fallback 意外泄漏或丢失。
- [x] 在 `desktop/src/console-page/state-sync.ts` 与 `app.tsx` 接入 invocation 惰性读取、Abort、run key 校验、缓存、失败与重试，不让慢旧响应覆盖新 tab / session。
- [x] 在 `ProcessTab` / `ProcessEvent` 实现 attempt 调试概览、三层 prompt disclosure、原始事件、精确时间戳、结束状态、常驻敏感信息提示与终端控制字符可见转义。
- [x] 更新 `packages/console-ui/DESIGN.md` 的调试披露组件模式，并同步 `docs/product/pages/main-right-sidebar.wireframe.html` 已由 MD 确认的版式。
- [x] 补 local-console 纯逻辑 / 分页测试、console-ui 组件测试、desktop 异步竞态测试；覆盖 `design.md#测试设计` 的失败、恢复与环境假设。
- [x] 保留 Kimi 运行记录的局部降级：活动、计时和最终回复可见，原位不可用说明清楚且无可点击空入口；补回归测试与真实桌面验收。
- [x] 运行定向 Vitest、`pnpm test`、`pnpm typecheck`、`pnpm --filter @moebius/console-ui build` 与 `pnpm --filter @moebius/desktop build`，所有命令退出码为 0。
- [x] 按 `proposal.md#真实运行验收清单` 在真实桌面应用逐条生成入口与可观察信号证据，再做方案符合度反思；未取得 UI 运行证据不得声明 `code-verified`。
