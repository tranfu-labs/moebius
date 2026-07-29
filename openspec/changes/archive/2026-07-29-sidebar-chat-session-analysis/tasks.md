# 任务：sidebar-chat-session-analysis

- [x] 1. 建立 session origin、entry template、write policy、text fragment 与 gate fact 的 TypeScript/SQLite/JSONL 数据模型和向后兼容迁移。
- [x] 2. 扩展 local-console 创建会话与消息原子提交，支持静态文本片段、可信 origin 元数据和普通/确认前只读两种策略。
- [x] 3. 实现会话引用文本窄端点，按 session/run 可信事实格式化 Moebius 路径与 provider external id，不增加读取权限。
- [x] 4. 在执行 driver 与 runtime 中实现 Codex/Kimi 只读运行、方案版本、自然语言确认控制回合和一次性 write lease，并补越界/晚到/失败恢复测试。
- [x] 5. 新增 `general-assistant` 官方种子，完成既有安装首次登记、稳定身份冲突、文件位置冲突和推荐配置测试。
- [x] 6. 重构 `OperatorConsole` 的会话生产组合，使主内容与右侧会话共享同一标题、时间线、run、composer、附件、团队菜单和恢复行为。
- [x] 7. 扩展右侧栏 tab 模型与集中式持久化，支持零标签内容选择、普通会话 draft/session locator、相邻焦点和跨 host 原子清理。
- [x] 8. 实现版本化 sidebar chat 草稿、分析入口归并、文本胶囊、候选问题、上下文预选、丢弃确认和首次发送原子消费。
- [x] 9. 在运行中记录、成功历史回复和异常终态增加一致的更多菜单入口与键盘路径。
- [x] 10. 实现 selected/main/right/host 组合路由、独立 sidebar session view、来源即时失效迁移和重启恢复。
- [x] 11. 实现活动/归档标题搜索、请求条件隔离、恢复并打开、焦点旅程及项目移除边界。
- [x] 12. 补齐所有团队选择器的用户可读重名辨认投影与辅助名称。
- [x] 13. 创建 `Page/Console/SessionAnalysis` production Page Story，覆盖六个确定性关键状态且不连接真实外部能力。
- [x] 14. 补 UI 纯模型、组件、renderer 状态、local-console、SQLite migration、team seed 与 provider 双引擎的定向自动化测试。
- [x] 15. 运行 console-ui Storybook 门禁、相关 Vitest、全量 `pnpm test`、`pnpm typecheck` 与必要 desktop build，并把日志留在系统临时目录。
- [x] 16. 对照 PRD、spec delta 和 `acceptance.md` 做方案符合度反思；修正漏做、多做与越界实现。
