# 30 批生产删除 ledger

基线：`d7373e3`。行数为基线物理行；“最后消费者”指删除前把该文件带入生产闭包的最后一条能力链，
不是文件名猜测。动态入口另列，避免静态 import 图误删。

## 整文件删除

| 文件 | 行数 | 最后生产消费者 / 删除理由 |
| --- | ---: | --- |
| `desktop/src/runner-child.ts` | 28 | Desktop build entry；只启动已退役 GitHub mode |
| `desktop/src/runner-launch.ts` | 4 | `runner-child.ts` 的 GitHub mode 常量 |
| `desktop/src/runner-supervisor.ts` | 153 | `desktop/src/main.ts` 的 GitHub child 监管 |
| `src/agent-context-state.ts` | 221 | GitHub role workspace/prompt state |
| `src/agent-prescripts/ceo-ledger-context.ts` | 267 | runner 的 GitHub goal/issue prescript |
| `src/agent-prescripts/current-repo-workspace.ts` | 15 | GitHub issue prescript registry |
| `src/agent-prescripts/dev-workspace.ts` | 310 | GitHub issue worktree prescript |
| `src/agent-prescripts/index.ts` | 28 | runner prescript dispatcher |
| `src/agent-prescripts/issue-worktree.ts` | 546 | GitHub issue worktree prescript |
| `src/agent-prescripts/types.ts` | 26 | prescript-only contracts |
| `src/conversation-interrupt.ts` | 111 | GitHub issue comment polling interruption |
| `src/driver-pool.ts` | 60 | GitHub heartbeat issue concurrency |
| `src/format-ceo.ts` | 542 | GitHub comment guardrail；local route judgment 已先提取 |
| `src/github-intake-state.ts` | 146 | GitHub scanner/intake state |
| `src/github-response-intake.ts` | 412 | GitHub issue response folding |
| `src/github-state-store.ts` | 168 | GitHub-mode state store composition |
| `src/github.ts` | 689 | runner 的 `gh` issue/comment/reaction adapter |
| `src/goal-ledger.ts` | 1,971 | 归档后可达性复核确认零个 local 生产消费者；随 GitHub runtime 一并退役 |
| `src/goal-ledger-state.ts` | 250 | GitHub runner goal-ledger adapter；纯 `goal-ledger.ts` 保留 |
| `src/issue-dispatcher.ts` | 162 | GitHub heartbeat dispatch |
| `src/issue-media.ts` | 214 | GitHub issue body media preparation |
| `src/issue-source.ts` | 32 | GitHub issue source contract |
| `src/media-assets.ts` | 470 | GitHub issue/release artifact publication |
| `src/observer/model.ts` | 994 | observer read model |
| `src/observer/read-state.ts` | 1392 | observer GitHub/ledger state reader |
| `src/observer/render.ts` | 1069 | observer HTML renderer |
| `src/observer/server.ts` | 121 | `pnpm observer` 与 Desktop observer server |
| `src/retry.ts` | 151 | GitHub `gh` transient retry policy |
| `src/runner/acceptance-prepass.ts` | 1127 | GitHub parent/child issue acceptance join |
| `src/runner/codex-execution-reaction.ts` | 89 | GitHub issue/comment reaction adapter |
| `src/runner/external-route.ts` | 349 | GitHub no-mention comment publication |
| `src/runner/runtime-contracts.ts` | 383 | GitHub runner-only ports/contracts |
| `src/runtime-mode.ts` | 15 | local/GitHub dual-mode parser |
| `src/scanner.ts` | 81 | GitHub repository issue scanner |
| `src/state-persister.ts` | 58 | GitHub runner JSON state writer |
| `src/state.ts` | 191 | GitHub role thread state |

整文件删除合计 12,845 行生产代码。连同拆分文件内删除，本批及归档后补正的生产范围
`+242/-16,931`，净删 16,689 行；新增部分是 local parser/judgment/persona 与 local-only 入口，不是把
runner 搬入新目录。

## 拆分保留

| 文件 | 处理 | 保留接缝 |
| --- | --- | --- |
| `src/ceo-orchestration.ts` | 83% similarity 迁为 `src/local-console/ceo-orchestration-parser.ts`，删除 GitHub side effects | local child-session parser/types |
| `src/runner.ts` | 2,618 物理行收为 70 行 local CLI | `pnpm start`、signal close、参数 fail-closed |
| `src/conversation.ts` / `src/triggers/**` | 删除 issue prompt/thread exports | local timeline 与 latest-message mention |
| `src/sqlite-state.ts` / worker | 删除无消费者的 GitHub commands 与 fresh-schema setup | local commands、worker pool、历史表非破坏 |
| `src/config.ts` / `src/local-config.ts` | 删除 GitHub runtime 常量；旧 repository 字段仅校验后忽略 | data root、provider、local timeout |

## 动态入口反证

- `src/sqlite-state.ts` 仍以 `new URL("./sqlite-state-worker.ts", import.meta.url)` 和 `new Worker(...)`
  启动 worker；Desktop build 继续产出 worker bundle，因此 `sqlite-state-worker.ts` 不在删除集。
- `utilityProcess.fork`、`runner-child.js` 和 Desktop runner build entry 已无生产引用。
- 剩余 `spawn` 只服务 provider CLI、git workspace、CLI installer 与开发脚本；没有 `gh` runner 调用。
