# 提案：completion-handoff

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-conversation.md` | `完成交接表单` | 新增四类结束交接选择、证据保留、分支优先级与无副作用边界；表单复用运行环境已有能力 | 已写入 |

## 背景

Moebius 运行环境已有表单能力，但本仓库和当前 provider session 没有暴露其精确工具名、schema 或调用协议。仓库已有的 `moebius_managed` MCP 只负责托管进程，不承担完成交接表单。`origin/claude/agent-form-ui` 可作为表单 UI 历史线索，但最终发布与运行时接入路径仍待核实。

## 提案

采用 Skill + 既有表单能力的分层实现：

- `completion-handoff` Skill 负责何时准备交接、证据纪律、只读事实核查、四类选项和无副作用边界。
- Moebius 启动时把源 Skill 注册到数据根，并通过 Claude Code/Codex 的标准用户 Skill 根建立不覆盖冲突项的软链接，让 provider 按标准渐进式披露加载；本轮只实现 Claude/Codex，Kimi/Pi 为 TODO。
- Agent 需要用户决定时使用当前运行环境实际公开的既有表单能力；不新增 MCP server，不新增工具名、schema、bridge、preflight、SQLite 状态或 closeout 专属 UI。
- 既有表单返回的选择沿用当前会话继续修改或提供外发/清理指导；本 change 不自动 merge、push、解除 worktree 映射、移动 Trash 或发布。
- Skill 注册表不修改 provider 设置、凭据、hooks 或项目配置；冲突的用户 Skill 条目不覆盖，改为记录诊断。

## 影响

影响 Skill 源、Skill 注册表、启动入口、provider prompt 边界、Desktop 打包 seed 及对应测试与文档。现有 `moebius_managed` MCP、provider 执行、会话 JSONL 事实源、local-console 状态与 console-ui 表单保持原语义；本 change 不实现或修改完成交接 MCP 协议。
