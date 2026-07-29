# 实现符合度反思

## 结论

实现符合已确认目标：普通新对话页彻底删除“成员准备”产品概念，不再读取 onboarding readiness，也不展示人数、CLI 准备信息或调整引导。发送条件、团队快照绑定、硬 CLI 路由和真实 driver 启动失败反馈保持原行为；onboarding 内的检测、安装、登录与安装成功复检保持存在。

## 对照检查

- 展示链：`NewConversationPage` 已删除 readiness prop、兼容性 helper、提示 DOM、图标和专用 i18n key；`OperatorConsole` 已删除 readiness 透传。
- 桌面链：普通操作台已删除 readiness state、状态转换、初始读取和轮询读取；安装状态 refs、安装轮询/subscription 与安装成功后目标 CLI `checkOnboardingCliReadiness(cli)` 仍在。
- 状态矩阵：既有 `installApi` fixture 覆盖 checking、ready、missing、needs-login、unavailable、deferred 和 rejected，正常操作台对 readiness state/check API 调用均为 0。
- 重渲染与语言：组件测试覆盖父级重渲染和 zh-CN/en 切换；真实桌面覆盖现有会话、设置语言、Agent teams 与新对话之间的导航重渲染。
- 运行边界：新对话仍按项目、团队、消息和附件决定是否允许发送，不做 CLI capability 预检；首个 run 仍按绑定快照启动指定 CLI，并在启动失败后提供可恢复的失败反馈。
- 引导边界：真实 onboarding replay 仍展示 Codex/Kimi 检测结果、安装说明与重新检查入口；readiness、installer、IPC 和退出协调自动化回归通过。

## 零残留与范围

全仓静态检查确认普通操作台生产代码中没有旧 console i18n key、compatibility helper、旧 test id、`cliReadiness` prop 或 `getOnboardingCliReadinessState` 调用。`DesktopApi` / preload / onboarding 契约中的 readiness 能力按设计保留，仅服务 onboarding。

没有新增生产调试 IPC、持久化字段、CLI 探针或全局 readiness 重构；没有修改团队静态 CLI 配置、运行时硬路由、onboarding 安装/登录语义或根 `AGENTS.md`。

## 验证

- 定向 console-ui：2 files、104 tests 通过。
- 定向 desktop routing：1 file、25 tests 通过。
- onboarding readiness / installer / IPC / shutdown：4 files、18 tests 通过。
- 首次消息 driver 失败与硬路由：1 file、8 tests 通过。
- `pnpm test` 最终全量复跑：四个分片共 1533 tests 通过。
- `pnpm typecheck`：通过。
- `pnpm --filter @moebius/console-ui check:storybook`：通过。
- `pnpm --filter @moebius/desktop build`：通过。
- 真实 Electron：zh-CN/en 新对话 DOM 均有主列、compatibility 节点为 0、旧准备文案不匹配；导航重渲染后结论不变。发送前按钮可用，受控 Codex shim 在 run 启动时失败后显示“这一步没跑起来”/“This step did not start”与重试入口。
- 真实运行事实：API 报告 session `failed`、`run-not-started`、error count 1；SQLite 中首条消息、系统失败事实、团队成员快照和 `profile.cli = codex` 均存在；shim 计数 Codex 1、Kimi 0；桌面进程退出码 0。
- 临时证据：`/tmp/moebius-readiness-acceptance.7dfwAE/evidence.json`。

## 未验证项与剩余风险

checking、ready、missing、needs-login、unavailable 及 readiness IPC 延迟/失败没有在真实桌面伪造；这是 design 明确的生产边界，已由 renderer fixture 覆盖。真实桌面只验证了当前主机实际状态与受控运行失败。

全量测试首次运行曾有一个无关的 15 秒时序用例超时；该用例隔离复跑 2.76 秒通过，最终全量复跑 1533 项全部通过。除此之外没有已知的范围内未验证项。
