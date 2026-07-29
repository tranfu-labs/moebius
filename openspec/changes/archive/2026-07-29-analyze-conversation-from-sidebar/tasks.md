# 任务：analyze-conversation-from-sidebar

- [x] 读取四份已确认 PRD、console-ui 设计语言、域 specs、模块地图与邻近生产实现。
- [x] 落盘 proposal、design、tasks、三域 spec delta 与触发链路架构快照，并完成实现前方案反思。
- [x] 为 local-console reference-text 增加显式 message/conversation scope，覆盖精确 run、未建立与不猜测最近 run。
- [x] 为 `ConversationSidebar` 增加对话分析菜单、禁用原因及右键/按钮/键盘等价入口与测试。
- [x] 将 Agent 消息菜单文案和三种打开方式收敛到消息级入口，并补测试。
- [x] 在 desktop renderer 统一两类分析 intent，实现非当前对话 prepare/commit 原子路由及项目目录不可用边界。
- [x] 扩展 `Page/Console/SessionAnalysis` 确定性 fullscreen Story，覆盖菜单、禁用、非当前切换和片段差异。
- [x] 运行受影响 Vitest、console-ui/desktop/根级 typecheck 与 `check:storybook`。
- [x] 在真实 Page Story 逐项确认菜单文案、禁用原因、唯一选中、主内容来源、右侧草稿与片段文本。
- [x] 对照四份 PRD 和本 change 反思漏做、多做与边界偏移，整理真实运行验收语句交棒。
