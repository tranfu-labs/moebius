# 任务：remove-new-conversation-readiness-hint

- [x] 从 `NewConversationPage` 删除 readiness prop、成员兼容性计算、提示 DOM、专用图标和 console i18n 文案；从 `OperatorConsole` 删除透传契约。
- [x] 按 `design.md` 第 2 节的逐项边界，从普通桌面操作台删除 readiness state/apply/read/prop 展示链；保留安装状态 refs、安装轮询/subscription、目标 CLI 成功复检、onboarding IPC/preload 和退出协调。
- [x] 更新 console-ui 与 desktop 定向测试：通过既有 `installApi` fixture 覆盖任意 readiness、冷启动及 IPC deferred/rejected，断言正常操作台 readiness API 调用为 0；覆盖父级重渲染和发送使能不变。
- [x] 在 zh-CN 与 en 下断言旧提示 DOM/人数/CLI 准备与调整文案均不存在，并用全仓 `rg` 确认旧 console i18n key、compatibility helper、test id 和新对话 readiness 透传无残留引用。
- [x] 运行 onboarding readiness、安装、登录/不可验证和 AI 建队相关回归测试，确认引导能力未被误删。
- [x] 运行首次消息真实 driver 失败与硬 CLI 路由测试，确认 session/消息/快照、失败反馈和另一 CLI 零调用保持不变。
- [x] 运行相关测试、`pnpm typecheck`、`pnpm --filter @moebius/console-ui check:storybook` 与 `pnpm --filter @moebius/desktop build`，只从重定向日志读取关键结果。
- [x] 在真实开发态桌面按 `design.md` 的实际本机状态、zh-CN/en、导航重渲染、发送使能和真实 driver 失败场景验收；不向生产代码加入状态注入能力，将 DOM/文本、API/SQLite、进程计数和退出码 evidence 写入系统临时目录。
- [x] 对照 proposal、PRD 与 spec delta 做符合度反思，确认没有残留新对话准备概念、没有扩大到 onboarding/runtime 行为，并报告未验证项与剩余风险。
