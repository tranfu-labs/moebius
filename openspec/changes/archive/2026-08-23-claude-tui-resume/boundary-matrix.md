# 边界矩阵：claude-tui-resume

本矩阵只覆盖本 change 新增或替换的 Claude TUI 路径；Codex、Kimi、Pi 保持原有 transport 与 resume 语义。每个单元的测试引用将在本步回归中执行。

| 功能单元 | 空输入 | 非法或超限输入 | 并发或重入 | 无权限 | 失败恢复 |
| --- | --- | --- | --- | --- | --- |
| PTY transport、首轮输入与 resume | `writeHumanInput("")` 拒绝 `claude-tui-empty-human-input`，且不写合成命令；`claude-tui-transport.test.ts`。 | 非整数／非正终端尺寸拒绝 `claude-tui-invalid-size`；同一测试。人类正文保持 opaque，不擅自截断。 | 同时只能有一个 generation；重复 start 和 stopping 期间写入均拒绝；同一测试。 | 复用「工作区信任」单元：未获显式信任前，不向 PTY 写原始任务；`claude.test.ts` 的 trust-gate 用例。 | idle 后 SIGTERM/SIGKILL 有界收束；非零退出释放 generation，下一请求才可新建／精确 resume；`claude-tui-transport.test.ts`、`claude.test.ts`。 |
| 私有 lifecycle hook 与 transcript resolver | 空／非 JSON hook body 作为 malformed 拒绝，不改变 lifecycle；`claude-tui-lifecycle.test.ts`。 | 错 session／不支持 event 为 400，超过 body 上限为 413；同一测试。 | `UserPromptSubmit` 重试幂等，PTY owner 才能登记 session-start；`claude-tui-lifecycle.test.ts`。 | 缺失或错误 capability 为 403，payload 不成为正文；同一测试。 | Stop 后仅对暂未落盘 final 有界重读；身份、路径、重复候选失败立即 fail-closed；`claude.test.ts`、`claude-tui-transcript.test.ts`。 |
| 原生工作区信任 gate（HTTP／UI／同 PTY） | 空 `runId` 为 400，controller 不会被调用；`local-console-claude-workspace-trust.test.ts`。 | 非 `trust`／`decline` 的 decision 为 400；同一测试。 | 已结算或不匹配 run 的第二次选择为 409 stale；同一测试。 | 未显式信任不写任务；真实 UI 的 Escape 不能绕过，拒绝写 Esc 并安全结束；`claude.test.ts`、`claude-tui-electron.ts`。 | 信任后等待 Claude 正常输入提示，再把保留任务写回同一 PTY；拒绝后可安全终止；`claude.test.ts`、真实 CLI 验收。 |
| Claude managed-process relay lease | 仅 `managed_process_list` 可用空对象参数；bridge 不把空人类输入转为工具调用；`claude-tui-managed-process-lease.test.ts`。 | 非法 JSON 返回 MCP `-32700`，不把正文当 shell；`managed-process-supervisor.test.ts`。 | lease 操作串行；旧 lease close 不可撤销新 lease；`claude-tui-managed-process-lease.test.ts`。 | capability 文件为 `0600`、不进 argv／协议输出；撤销或跨 session capability 被拒绝；`claude-tui-managed-process-lease.test.ts`、`managed-process-supervisor.test.ts`。 | relay readiness 可从 transient failure 恢复，cleanup 失败保留 ownership 并可重试；`managed-process-supervisor.test.ts`。 |
| Claude terminal trace、只读 UI 与桌面轮询 | 初始 cursor 按 0 请求；没有新的 chunk 时保持已渲染状态；`use-claude-terminal-traces.test.tsx`。 | 非法 cursor 为 409；原始 ANSI／非 UTF-8／HTML-like bytes 仅进入只读 xterm；`local-console-claude-terminal-trace.test.ts`、`claude-terminal-surface.test.tsx`。 | 单次 poll 有 in-flight guard、cursor 单调并按 session/run target 隔离；`use-claude-terminal-traces.test.tsx`。 | 错 session 请求为 404，不能读到别的 active trace；`local-console-claude-terminal-trace.test.ts`。 | transient 请求错误保留已有终端内容并进入 reconnecting；`use-claude-terminal-traces.test.tsx`。 |

## 本步验证与基线对比

- `pnpm exec vitest run tests/local-console-claude-workspace-trust.test.ts`：退出 0，1 文件／1 测试通过，1.00 秒；包含空 `runId` 与非法 decision 均返回 400、且不调用 trust controller 的新增断言。
- `pnpm run test --scope HEAD^`：退出 0。根套件 65 文件通过／1 文件跳过、586 测试通过／6 跳过（102.44 秒）；desktop 39 文件／266 测试通过（19.58 秒）；console-ui 48 文件／580 测试通过（8.95 秒）。跳过的是未设置真机 opt-in 的 `claude-real.acceptance.test.ts` 6 项；真实 Claude CLI/Electron 已在本 change 的独立真机命令中另行执行。

| 指标 | 步骤 1 基线 | 本步精确复跑 | 对比 |
| --- | ---: | ---: | --- |
| 命令退出码 | 1 | 0 | 基线的 `database is locked` 失败本次未复现；不将未复现表述为已定位修复。 |
| 根套件文件 | 52（50 通过／1 跳过／1 失败） | 66（65 通过／1 跳过） | +14 个受影响文件；失败 -1。 |
| 根套件测试 | 544（539 通过／4 跳过／1 失败） | 592（586 通过／6 跳过） | +48 个受影响测试；通过 +47、跳过 +2、失败 -1。 |
| 根套件耗时 | 107.73 秒 | 102.44 秒 | -5.29 秒。 |

## 真机交叉验证

- 真实 Claude CLI：显式信任、同一 live PTY、idle 精确 `--resume`、raw terminal 和 transcript cache-read usage。
- 真实 Electron 主页面：真实 onboarding、Claude 选择、项目选择、Escape 不可绕过信任、显式信任、三轮发送、只读终端与 idle resume，共 12 项断言。

## 待核实

- 成功的 Electron 验收仍打印 4 条 Chromium `404` resource diagnostic 和一条 macOS IMK warning；断言未失败，但来源尚未定位。
