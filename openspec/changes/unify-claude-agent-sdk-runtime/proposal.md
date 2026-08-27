# 提案：unify-claude-agent-sdk-runtime

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-conversation.md` | `Claude 运行记录表面` | 普通 Claude 不再展示实时 PTY；最终回复、完整过程和 usage 通过现有运行块与右侧栏历史查看 | 已写入 |
| `docs/product/pages/main-conversation.md` | `Agent 执行与恢复` | 普通 Claude 与 AI 建队统一使用 Agent SDK query；保留 canonical session/resume、原生配置归属与安全失败边界 | 已写入 |
| `docs/product/pages/main-conversation.md` | `89` | 版本门禁从 print/TUI 运行方式改为 SDK query 前的实际 executable 版本门禁；两条 Claude 入口共享 adapter | 已写入 |

本次方向由用户确认：普通 Claude 会话和 AI Team Builder 都替换为统一实现；不需要实时可见终端，但必须能像 Codex CLI 一样从历史记录查看过程与 usage。

## 背景

仓库当前普通 Claude 使用持久 PTY/TUI，AI Team Builder 使用独立的 print/stream-json 子进程适配器。两条路径重复处理 session、MCP、错误、输出和 CLI 进程边界，普通路径还把原始终端表面暴露给页面。已完成的最小实践证明 Agent SDK 能在当前工作区完成首次调用、同一 session resume、JSON Schema 输出、usage/cache 记录和 stdio MCP 工具调用。

## 提案

引入一个共享的 Claude Agent SDK adapter，使用仓库现有的 Claude executable 解析与版本门禁，并把普通 Claude 和 AI Team Builder 的差异收敛为两套受约束的运行 profile：

- 普通 Claude：继承原生用户/项目 Claude 配置，保留 model、effort、session/resume、托管 MCP 和既有失败归类；不再创建 PTY、TUI lifecycle 或 raw-terminal trace。
- AI Team Builder：保留隔离工作目录、`dontAsk`、`Read/Glob/Grep` 限制、严格 MCP 配置和 JSON Schema 输出；full/resume 也走同一个 adapter。
- 两条路径都让 Claude 原生 JSONL 作为完整过程与 usage 的事实源，复用现有 provider trace/history 投影；Moebius 不保存第二份 provider 原生过程内容。

## 影响

- 运行时：新增 `@anthropic-ai/claude-agent-sdk` 生产依赖和共享 provider adapter，移除普通 Claude 的 PTY 生产执行链，并让 AI Team Builder 不再直接调用 `claude-print.ts`。
- 历史与 UI：保留 canonical external session link、右侧栏完整输出、thinking/tool/error/usage 投影；移除 Claude 专属实时终端数据流与对应页面表面。
- 安全与生命周期：SDK query 使用显式 `AbortController`、每轮有终局；托管进程能力通过现有 stdio MCP bridge 注入，不使用 shell 后台化或不可见交互等待。
- 兼容边界：本变更不改 Codex、Kimi 或 Pi 的运行语义，不改变 Claude 原生认证、用户/项目设置和 provider JSONL 的所有权。
