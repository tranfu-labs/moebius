# 提案：fix-conversation-draft-switch-race

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-conversation.md` | `#输入框` | 不改产品意图；落实已有“每个会话独立保留正文与附件草稿”的规则 | 无需修改 |
| `docs/product/pages/main-conversation.md` | `#验收标准`（第 14、34、35 条） | 不改路由、草稿持久化与原子提交边界 | 无需修改 |
| `docs/product/pages/main-left-sidebar.md` | `#标记为已读与未读` | 不改产品意图；保持当前会话手动未读必须先离开、再次成功展示才清除的顺序语义 | 无需修改 |

本次是实现偏离既有产品事实的缺陷修复，不新增产品规则。`openspec/specs/console-ui/spec.md` 的「验收 19 — 草稿按新对话与会话隔离持久化」及「composer 支持纯附件与附件草稿恢复」，连同 `openspec/specs/local-console/spec.md` 的「当前会话手动未读需要一次离开」已经给出足够判据，因此不写 PRD 或 spec delta。按团队当前“方案先落盘、核验后再实现”的停点要求保留本 change；实现完成后仍按仓库归档规则核对事实源，不能把未验证行为提前并入 specs。

## 背景

`scripts/acceptance/local-console-direct-member-mention.ts` 的 `sendFromMainConversation` 点击目标会话后立即向 composer 执行 `fill`。现有 renderer 在这段时间内存在两条彼此独立的问题：

1. **脚本 timing 假设不成立**：helper 没有等待主内容区确认目标会话已经载入，就开始填写和发送。脚本因此把导航时延误当成 composer 已就绪。
2. **产品草稿归属竞态**：点击目标会话时，页面先把目标会话草稿显示进输入框，但 `selectionRef` 仍指向旧会话。紧接着发生的输入会按旧会话 draft key 持久化；异步阅读状态切换结束后，selection effect 又按目标会话 key 重读草稿，可能把刚输入的内容清空。若清空没有先发生，发送动作还存在把目标会话文字提交到旧 selection 的风险。

同样的 `transitionSessionView(...).finally(selectSession)` 结构还存在于 sidebar-conversation 打开后回到 origin 的分支；该分支的主 composer 展示 origin 草稿，却也会在 selection 尚未回到 origin 时接受输入。它属于同一归属缺陷，必须在方案中明确纳入，而不是留给实现阶段判断。

只修脚本等待会掩盖真实 UX 缺陷；只修产品竞态仍会让验收脚本依赖未承诺的导航速度。两条路径必须分别收口。

只读复现使用 `a21d4de` 当前源码重新构建 Desktop 后运行现有验收脚本：前 6 条断言通过，第三个 fallback 场景在点击会话后立即 `fill`，发送按钮持续禁用并于 30 秒超时。临时 evidence 显示此前 direct route 与前两个 fallback 均已真实到达预期角色，失败发生在下一次 UI 发送之前，不是 local runtime 路由断言失败。

## 提案

- 把主 composer 从“只有一个字符串、归属隐式取当前 selection”改为“`draft key + value` 的显式会话归属状态”，归属转换规则收敛为不依赖 React、localStorage、HTTP 或 Electron 的纯逻辑。
- 点击会话时同步切换 composer owner 与目标 selection；旧会话的 `arm-manual-unread` 和目标会话的 `viewed` 不再决定输入归属或最终 selection，但必须按用户点击顺序串行提交，不能因并发逆序破坏未读 gate。
- 同一 owner 的迟到 effect / refresh 不得用旧持久值覆盖用户刚输入的内存值；不同 owner 才读取对应持久草稿。
- 正文持久化、附件草稿 key、清理和发送都使用同一个显式 owner。阅读状态切换在途时输入保持可编辑且草稿继续写入 owner，但发送按钮禁用并显示“正在切换、草稿已保留”的可见说明；owner 与 selection 意外不一致时同样禁用发送并显示可恢复说明，底层 handler 仍独立 fail closed，不能静默丢弃点击或猜测旧 selection。
- 验收脚本在点击会话后等待主内容区标题确认目标会话已载入，再填写并发送；该等待只修复脚本 timing，不承担产品竞态回归测试职责。
- 修复后补跑同一生产 Electron 验收脚本，完成此前缺失的“优雅重启后同 run、同 provider thread resume”证据。
- 在交付收尾清理与 `main` 树内容完全一致且工作区干净的 `moebius/o4VmtqDfP2O3` worktree 与分支。

## 影响

- `desktop/src/console-page/`：主 composer 草稿状态、按点击顺序串行的阅读状态 transition、普通会话与 sidebar-conversation 点击时序、附件 draft key 和发送保护。
- `desktop/tests/`：纯状态规则测试与 renderer wiring 回归测试。
- `scripts/acceptance/local-console-direct-member-mention.ts`：等待目标会话就绪及既有重启证据恢复可达。
- 不改变 local-console API、SQLite / JSONL、direct-member 路由规则、provider resume 规则或模块依赖方向；`console-ui` 只增加一个 host 提供的窄 presentational submission-block reason，复用既有 `RoleComposer.submitDisabled`，不承载草稿 owner、未读事实或 transition 状态机。
- 不新增真实 I/O 测试；renderer 竞态用内存替身覆盖，现有生产 Electron 脚本负责自动化跨进程接缝证据。该脚本使用 Codex shim 且通过 API 预置 session，按 `docs/protocols/real-app-acceptance.md` 只能算辅助证据，不能抵扣无 shim、由 UI 产生状态的真机复核。
