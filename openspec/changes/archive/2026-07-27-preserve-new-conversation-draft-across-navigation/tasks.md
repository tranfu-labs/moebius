# 任务：preserve-new-conversation-draft-across-navigation

- [x] 更新主页面会话区 PRD，明确新对话草稿的上下文范围、导航恢复、成功消费与失败保留边界。
- [x] 将新对话的页面展示状态与草稿生命周期分离，并保持已有会话草稿互不覆盖。
- [x] 在 session 与首条消息创建成功后消费正文和附件草稿，失败时保留全部上下文供重试。
- [x] 增加状态机与独立工作空间导航恢复的定向测试。
- [x] 运行相关定向测试、TypeScript 类型检查及 Desktop / console-ui 构建。
