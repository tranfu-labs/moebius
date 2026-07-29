# 提案：analyze-conversation-from-sidebar

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/flows/session-analysis.md` | `从来源消息或对话开始分析`、`收集静态文本片段` | 增加整段对话入口，并明确两种入口只改变片段内容 | 已写入并评审 |
| `docs/product/pages/main-left-sidebar.md` | `项目与对话菜单`、`在右侧栏分析这段对话` | 增加对话菜单入口、禁用规则和非当前对话原子切换 | 已写入并评审 |
| `docs/product/pages/main-conversation.md` | `在右侧栏分析这条消息`、`从消息开始分析对话` | 消息菜单改为消息对象文案并补齐右键、按钮、键盘等价入口 | 已写入并评审 |
| `docs/product/pages/main-right-sidebar.md` | `入口与去向`、`新会话与已有会话标签` | 两种入口进入同一个 sidebar chat，仅片段不同 | 已写入并评审 |

PRD 于 2026-07-29 完成用户采访、关联页面同步与用户视角评审；用户随后明确回复「开始开发」。

## 背景

现有生产链路只从 Agent 消息或 run 记录打开 sidebar chat，界面文案仍把一条消息称为「当前对话」。左侧栏对话菜单没有分析入口。与此同时，现有 `reference-text` 在没有 `runId` 时会选择最近一次外部执行，这会让整段对话入口错误地猜测某一次 run；无法匹配外部执行时也不会明确写出「未建立」。

本次变更必须把用户对象统一为「消息」与「对话」，同时保留现有 sidebar chat 草稿、标签、发送和方案闸门模型。对非当前对话触发时，左侧选择、主内容与右侧草稿必须作为一个可观察结果提交，不能留下半切换界面。

## 提案

1. 为消息和左侧栏对话行分别提供「在右侧栏分析这条消息」与「在右侧栏分析这段对话」，右键、菜单按钮和键盘上下文操作打开同一菜单并绑定同一来源对象。
2. 使用显式的 `message` / `conversation` 片段范围请求可信 local-console 生成静态文本：消息级精确绑定 run 并在无外部会话时写「未建立」；对话级只包含记录路径。
3. 在 desktop renderer 中把分析入口归一为带来源种类的命令。当前对话复用现有打开逻辑；非当前对话先准备来源视图、片段、草稿与标签，全部成功后一次提交选择、主内容与右侧栏状态，失败保留进入前现场。
4. 记录路径不可用时禁用对话级入口并提供可读原因；项目目录不可用不阻止打开草稿，发送能力继续由草稿当前项目决定。
5. 扩展 `Page/Console/SessionAnalysis`，用确定性 fixture 和真实生产导出展示两种菜单、启用/禁用状态、非当前对话切换结果及两类片段差异。

## 影响

- `packages/console-ui`：`ConversationSidebar`、`OperatorConsole`、`RunBlock`、中英文资源、共置测试与 SessionAnalysis Page Story。
- `desktop/src/console-page`：分析命令编排、session 选择/呈现路由、reference-text client、草稿和标签提交。
- `src/local-console`：reference-text 请求契约与片段格式化。
- OpenSpec delta：`console-ui`、`desktop-shell`、`local-console`。
- 不改变 sidebar chat 的持久化模型、方案确认闸门、团队选择、普通附件、首次发送或后续对话行为。
- 不引入 prototype，不新增分析专用页面，不归档 change、不回流现状 specs，直至功能与视觉验收完成。
