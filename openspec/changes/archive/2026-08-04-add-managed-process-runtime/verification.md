# 符合度反思：add-managed-process-runtime

日期：2026-08-04

结论：首次独立复核提出的 B1–B3 已完成返工并通过二次独立复核；A1–A14 的实现与约定证据均已完成。合并前唯一一次完整 `pnpm test` 已通过，可以回流事实源并归档。

## 验证门禁

| 门禁 | 结果 |
| --- | --- |
| `pnpm run test --scope a47b629c` | 退出码 0；100 个受影响测试文件，根套件 447 passed / 4 skipped，desktop 175 passed，console-ui 420 passed |
| `pnpm typecheck` | 退出码 0；root、desktop、console-ui 均通过 |
| `pnpm --filter @moebius/desktop build` | 退出码 0 |
| `pnpm --filter @moebius/console-ui check:storybook` | 退出码 0；静态产物写系统临时目录 |
| `pnpm check:boundaries` | 退出码 0；643 source / 551 production / 3 roots |
| `git diff --check` | 退出码 0 |
| `pnpm test` | 唯一一次完整闸门退出码 0；root 751 passed / 4 skipped，slow 64 passed，desktop 604 passed，console-ui 469 passed；日志位于系统临时目录 `moebius-managed-process-full-test.Ng7mBC` |

## A1–A14

证据目录均位于系统临时目录；下表只记录目录 basename，避免把本机绝对路径写入仓库。

| # | 实现与自动化证据 | 真实运行证据 | 结论 |
| --- | --- | --- | --- |
| A1 | `execution-driver.ts`、supervisor、Codex 单轮 MCP override；scope 内 provider/contract/runtime 测试 | `moebius-managed-electron-evidence-KfakKV/evidence.json`：Codex 两个服务跨 full/resume 保持相同 processId，HTTP 200，顶栏显示 `2 个运行项` | 符合 |
| A2 | Claude run-local MCP config 与 invocation 后清理；provider adapter 测试 | `moebius-managed-provider-acceptance-89hmQD/evidence.json` 与主 Electron evidence：同一 schema、processId 跨回合、面板停止后端口关闭 | 符合 |
| A3 | Kimi ACP `mcpServers` 注入与 post-tool sliding settle timer；Kimi 定向测试覆盖后续普通工具暂停、完成重臂、语义进展延后与最终 timeout | 主 Electron evidence 完成真实 Kimi full/resume/stop；`moebius-managed-kimi-hang-evidence-xkXPrj/evidence.json` 证明 MCP 返回后悬挂有界失败、可重试且端口可由面板关闭 | 符合 |
| A4 | session-scoped registry、request revision/abort、来源 revision 隔离、exited acknowledgement 纯模型与组件测试 | `moebius-managed-electron-evidence-vJm2SN/evidence.json`：单项/多项、切换空会话不串项；最后显示 `2 个已结束`、确认后入口不占位；失败保留由 hook/component 行为测试覆盖 | 符合 |
| A5 | readiness reducer 与 tcp/http/stdout probe；loopback endpoint admission | 主 Electron evidence：观察 starting→ready、系统打开边界收到已校验 URL、endpoint HTTP 200 | 符合 |
| A6 | 有界 stdout/stderr ring、cursor 与独立 truncated fact；domain/UI 测试 | 主 Electron evidence：日志洪泛后面板保留尾部并显示截断标记 | 符合 |
| A7 | launchd 精确 service stop、幂等 promise、无裸 PID/PGID supervisor 清理 | 主 Electron evidence：逐项停止时第一端口关闭而第二项仍 HTTP 200，最终两项均 exited/端口关闭 | 符合 |
| A8 | Desktop shutdown snapshot 与统一 close；退出保护定向测试 | `moebius-managed-lifecycle-evidence-A4b7P3/evidence.json`：首次 Command+Q 取消后服务存活；确认后应用/端口退出，重启 registry=0、执行次数仍 1 | 符合 |
| A9 | HMAC ownership manifest、精确 launchd target、`launchctl print` 只按退出码判断；reconcile 逐项隔离坏 manifest，记录 blocked 后继续清理其他有效项；真实 adapter 测试覆盖伪造 manifest、缺失 plist 和无关同名进程存活 | lifecycle evidence：host crash 与 wrapper loss 后重启精确清理、旧命令未重跑；`moebius-managed-process-acceptance-2NAJAe/evidence.json` 再证自动重启=false | 符合 |
| A10 | admission 拒绝 shell、绝对/越界 cwd、外部 endpoint/readiness、跨 session capability；contract/supervisor/HTTP 测试断言拒绝前不 spawn | `moebius-managed-bridge-evidence-Tf2GAj/evidence.json`：真实打包 Electron bridge 在 stdin EOF 或 capability 撤销后退出 0，无 Helper，token 已移除 | 符合 |
| A11 | 独立 `managedRunningCount` 只驱动归档/项目移除 guard；项目强制移除 stop-before-commit；client/model/UI 测试覆盖失败不提交 | `moebius-managed-electron-evidence-vJm2SN/evidence.json`：仅余托管项时侧栏状态点为 `none`、无“正在运行”可访问声明，但归档仍禁用；既有主 Electron evidence 证明项目移除先停进程再提交 | 符合；只补 reachability guard，未新增归档形态 |
| A12 | 三家 full/resume 共享 schema；每家 preflight 故障测试均断言 Provider spawn=0、capability 撤销，因此 registry/target/成功回复/后台 shell 回退均不可发生 | provider evidence：三家真实 full/resume 成功，Claude 临时文件删除，用户全局配置 hash/mtime/mode 与 Claude MCP registry 均未变化；主 Electron 每轮 bridge/helper/token 数归零 | 符合 |
| A13 | Provider run 与 managed process 独立状态机；托管计数不进入 Agent `runningCount`、结果卡或 ChangeTab；Kimi timeout 不写 completed message | `moebius-managed-electron-evidence-vJm2SN/evidence.json`：中止 Agent run 后两个托管端口仍 HTTP 200，侧栏状态点为 `none` 且归档仍禁用；Kimi hang evidence：无 completed Agent message、运行项继续存在并可停止 | 符合 |
| A14 | `pnpm start` 与 Desktop 复用同一 composition root、supervisor 与 close；非 Darwin adapter 测试 fail closed 且 target spawn=0 | `moebius-managed-cli-evidence-Lnfomx/evidence.json`：真实 Codex 服务跨回合、HTTP 200，local entry SIGTERM 后精确 job/端口消失、启动计数仍 1，验收驱动退出 0 | 符合；未新增 CLI 产品面 |

## 实现偏差与清单外改动

- Codex 在 Electron 内运行时，MCP server 的 `ELECTRON_RUN_AS_NODE=1` 必须通过 Codex MCP 配置的 TOML inline env map 直达 bridge；只给父 Provider 进程环境或使用 dotted override 都不能保证继承。Claude 使用 run-local JSON env，Kimi 使用 ACP env entries。接口 schema 与设计不变。
- Bridge 增加 stdin EOF、capability 文件撤销和 in-flight drain 三条退出链。真实打包 Electron 验收及主页面每次 invocation 均证明 bridge、Electron Helper、capability token 与 supervisor socket 无残留。
- local CLI 验收驱动修正了成功后未清理 timeout timer 的问题；这是验收可靠性修正，不改变产品运行时。
- 首次 QA 复核后修正三项阻塞：托管计数与 Agent `runningCount` 分离；Kimi settle 改为普通工具执行期间暂停、工具完成或语义进展后滑动重臂；manifest reconciliation 改为逐项 blocked、继续启动。对应 spec delta 与 design 已同步。
- 同批吸收六项非阻塞复核建议：并发 shutdown 合并为同一 promise、bridge 非法 JSON 返回 parse error 后继续、renderer 切换/失败按 revision 隔离、确认清除失败保留面板、state 计数走轻量 registry、相关规则收回纯模型并通过 import boundary。
- 除上述 Provider 适配与验收清理外，没有实现 restart、多服务编排、跨应用恢复、任意 shell、CLI 专属 UI 或第二套 supervisor。

## 独立复核返工记录

- B1：已修复。`managedRunningCount` 独立于 Agent `runningCount`；真实 Electron 从主会话入口证明托管项不点亮侧栏运行点，归档仍被保护。
- B2：已修复。managed tool 之后的普通 tool call 属于真实进展；执行中不误杀，完成与语义进展均滑动重臂，真正无终局/无进展仍有界失败。
- B3：已修复。单个伪造、损坏或缺 plist 的 manifest 只产生脱敏 blocked fact；应用继续启动并继续 reconcile 其他有效项，且绝不退化为裸 PID/PGID 清理。
- scope 首次返工运行遇到一次 SQLite `database is locked`；失败文件隔离重跑 3/3 通过，随后完整 scope 重跑退出码 0，以上表最终结果为准。
- 未纳入本轮的非阻塞建议：wrapper 历史日志目录的跨重启回收、应用崩溃时 Claude 无 secret 临时 MCP JSON 的回收、畸形百分号路由从 500 细分为稳定 400，以及 renderer 调用打开能力前再次校验 URL 仍为 loopback 的防御纵深。四项均不改变 A1–A14 的安全或生命周期结论，留待后续独立 change。

## 最终闭环

- 完整 `pnpm test` 已在二次独立复核通过后执行唯一一次并全绿。
- 三域 spec-delta、wireframe 与 architecture/after.svg 已按项目契约回流；PRD 锚点已核对，ADR-0009 已转 accepted。
