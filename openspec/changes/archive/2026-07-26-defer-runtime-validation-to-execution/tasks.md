# 任务：defer-runtime-validation-to-execution

- [x] 更新 Agent 团队、主对话与 onboarding PRD：静态管理、首次真实启动、既有 readiness 提示保持为参考、独立诊断页为非目标。
- [x] 收窄团队运行配置 contract：删除 capability/status/refresh 字段与 IPC，成员 DTO 提供静态 binding/recommendation/effective profile。
- [x] 修改团队 store/IPC 适配：读取、保存、恢复推荐和列表路径零 Codex/Kimi 探测，保留官方推荐/覆盖及旧数据兼容。
- [x] 修改团队详情编辑器：CLI 枚举、model/effort 文本输入、静态校验、即时初始化、逐成员草稿与保存失败保护。
- [x] 删除团队列表运行配置健康状态与 renderer 的团队 capability refresh 透传；停止普通 App 挂载/shell-ready 自动 readiness 检查，保留 onboarding / 安装延续检查及新对话已有提示。
- [x] 补齐 desktop IPC、console-ui 组件和新对话回归测试，覆盖父级重渲染、成员切换、trim、空值拒绝、未知非空值可保存、零探测，以及 readiness 只提示不阻止发送。
- [x] 补齐 App 边界与 runtime 集成测试，证明先持久化 session/message/snapshot 再直接启动绑定 CLI，第一及后续发送不增加 readiness/capability 调用、失败可见且不跨 CLI。
- [x] 补齐团队配置快照边界测试：团队页修改后，旧会话后续发送和重试继续使用原快照，新会话才采用新配置。
- [x] 更新 `docs/architecture/module-map.md` 的 desktop-shell 边界：团队管理只做静态运行配置，能力探测只由 onboarding/AI 建队等明确流程消费。
- [x] 运行定向测试、完整 `pnpm test`、`pnpm typecheck`、console-ui/desktop 必要构建，长日志落盘后只检查退出码与关键摘要。
- [x] 按 design 的六步真实桌面验收采集 DOM、shim 参数/计数和 API/SQLite 证据，并完成实现符合度反思。

## 实施备注

- 真实桌面验收发现普通 App 启动仍由旧状态页 doctor 执行一次 `codex --version`。为满足“普通操作台启动到发送前零探测”，该轻量检查改为只在用户显式打开现有状态页时执行；未新增诊断页面，也未改变 onboarding 检查。
- App 边界回归沿用 `desktop/tests/onboarding-app-routing.test.tsx`，没有另建 design 中的候选测试文件；该测试已覆盖挂载、shell-ready 与进入团队页均不触发 readiness。
