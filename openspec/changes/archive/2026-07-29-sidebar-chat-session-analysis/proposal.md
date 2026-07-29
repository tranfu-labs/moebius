# 提案：sidebar-chat-session-analysis

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/flows/session-analysis.md` | `# 会话分析与优化` | 新增从来源会话进入 sidebar chat、收集静态文本片段、确认方案后写入、找回与来源失效降级的完整流程 | 已写入并通过用户视角评审 |
| `docs/product/pages/main-conversation.md` | `### 右侧栏中的分析新会话`、`### 分析当前对话入口`、`### 从时间线开始分析会话` | 新增运行中、历史回复和异常终态入口；定义文本胶囊、候选问题及首次发送后的普通会话复用 | 已写入并通过用户视角评审 |
| `docs/product/pages/main-right-sidebar.md` | `### 新会话与已有会话标签`、`### 标签全部关闭`、`### 关闭标签`、`### 会话归档与来源迁移` | 右侧栏承载普通会话；零标签关闭；定义草稿丢弃、兄弟标签和生命周期清理 | 已写入并通过用户视角评审 |
| `docs/product/pages/main-left-sidebar.md` | `### 对话行`、`### 选择对话`、`### 组合路由中的来源即时失效`、`### 归档` | sidebar chat 作为普通用户会话列出，并恢复来源主内容与右侧会话的组合路由 | 已写入并通过用户视角评审 |
| `docs/product/pages/search.md` | `## 操作与反馈`、`### 键盘焦点与来源失效`、`## 指标与验收` | 搜索、恢复并打开活动或归档 sidebar chat，处理晚到结果与来源失效 | 已写入并通过用户视角评审 |
| `docs/product/pages/agent-teams.md` | `### 「通用助手」官方基线`、`### 既有安装首次登记「通用助手」`、`### 新建对话中的团队预选` | 新增单成员官方团队，并把它作为 sidebar chat 的可改初始预选 | 已写入并通过用户视角评审 |

PRD 变更来自当前本地会话中已完成的用户采访与逐页只读评审。本 change 只保留实现追溯指针，不复制产品理由和指标口径。

## 背景

当前右侧栏只能承载改动、项目文件、文件引用、过程与子任务。它在最后一个标签关闭后会补出内容标签，不能承载一段普通、持久、可从左侧栏找回的并排会话。主时间线也没有把当前会话或某次 run 的静态标识送入新 sidebar chat 的入口。

现有新对话只有一份应用级草稿；右侧栏标签按主会话存在 localStorage；renderer 的主选择、主内容承载会话和左侧栏选中会话是同一个对象。要支持已确认旅程，必须在不复制第二套会话 UI 的前提下，把普通会话能力扩展为可嵌入右侧栏的受控实例，并让组合路由、持久化、搜索、归档和恢复共享同一组会话事实。

## 提案

1. 在 `@moebius/console-ui` 中让右侧栏新增普通会话标签类型，嵌入复用 `NewConversationPage` 与既有会话时间线/输入框的生产导出；新增静态文本胶囊、候选问题和时间线更多菜单，但不新增“分析页面”或“分析会话布局”。
2. 在 desktop renderer 中建立版本化 sidebar chat 草稿与组合路由状态，分别记录左侧栏选中会话、主内容承载会话和右侧会话；右侧会话通过现有 session view API 独立加载。
3. 在 local-console 会话事实中增加可信来源导航元数据、入口策略和消息文本片段。文本片段与首条用户消息原子提交，但保持普通文本语义，不被应用解析或用于授予权限。
4. 为「分析当前对话」入口创建的会话启用确认前只读策略：普通诊断运行使用 provider 的只读执行能力；当前方案获得自然语言确认后，只为对应执行放行正常会话权限。手动创建的普通 sidebar chat 不启用该策略。
5. 新增活动/归档会话标题搜索与恢复路由；归档、项目移除和来源失效原子更新组合选择及全部受影响标签现场。
6. 新增官方 `general-assistant` 团队种子和既有安装登记/冲突恢复；它只负责 sidebar chat 初始预选，不承载分析权限。
7. 新增确定性 production Page Story `Page/Console/SessionAnalysis`，直接渲染 `OperatorConsole` 的生产导出，覆盖关键页面状态；Story 不接真实 IPC、SQLite、runner 或用户数据。

## 影响

- `packages/console-ui`：会话容器复用、右侧栏标签状态、文本胶囊、候选问题、更多菜单、团队重名辨认、搜索与 Page Story。
- `desktop/src/console-page`：版本化草稿、组合路由、独立会话视图、标签持久化与迁移、搜索请求隔离、归档/恢复协调。
- `src/local-console` 与 SQLite/JSONL：会话来源/入口策略、文本片段、搜索/恢复、写入闸门事实与执行权限投影。
- `desktop/src/team-*` 与 `seeds/teams`：`general-assistant` 官方团队首次登记、推荐配置、冲突恢复和 UI 状态。
- `docs/architecture`：local-console operator 与 Agent 团队运行绑定的数据流增加 sidebar chat 和入口策略。
- 不改变 GitHub issue runner、observer、目标账本、prototype 沙盒或正式发行平台。
