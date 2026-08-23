# 提案：claude-tui-resume

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-conversation.md` | [#Agent 执行与恢复](../../../docs/product/pages/main-conversation.md#agent-执行与恢复) | 把 Claude 的每轮 headless print/stream-json 调用改为持久交互 PTY；补充私有生命周期 hooks、终端流、idle 后 resume 的产品边界 | 已写入 |

## 背景

现有 Claude adapter 每轮以 `-p --output-format stream-json` 新建子进程，输出先被解析为 Markdown；这既无法维持真实 Claude Code TUI，也不能把完整终端输出实时呈现。当前 per-invocation managed-process MCP capability 也会在一轮结束时关闭，不能直接复用于持久 TUI。

## 提案

仅替换 Claude Code 的执行与恢复 transport：首轮启动真实 PTY，后续未 idle 的人类消息写回同一 PTY；hook receiver 仅把 lifecycle 传给控制器；最终正文与 usage 继续从严格匹配 canonical session 的 transcript resolver 取得。TUI idle 后退出，下一轮显式 `--resume` 同一 canonical ID。为持久 TUI 增加按 provider run 轮换的 managed-process capability lease，并把原始 PTY 输出送往只读终端 UI。

## 影响

- `local-console`：Claude provider adapter、执行驱动、运行态、managed-process bridge、transcript trace 与 Claude 专属行为规格。
- `console-ui`：新增 Claude raw-terminal surface，替代该引擎的 Markdown live-stream 呈现。
- `desktop`：原生 `node-pty` 依赖需要外置、解包和 macOS arm64 helper 执行位验证。
- 不影响：Codex、Kimi、Pi 的 adapter、resume 语义或 UI 路径。
