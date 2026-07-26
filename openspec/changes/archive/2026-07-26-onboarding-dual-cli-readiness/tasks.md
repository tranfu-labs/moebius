# 任务：onboarding-dual-cli-readiness

- [x] 定义双 CLI readiness / install 白名单契约与纯状态规则，补齐组合、revision 和脱敏单测。
- [x] 实现复用 capability probe 的 onboarding readiness service，覆盖版本、认证/模型能力和安全分类。
- [x] 实现 main-only 受信任安装 registry、并发任务 manager、阶段订阅、取消、超时和退出协调。
- [x] 扩展 onboarding IPC、preload 与 renderer route，保证页面只提交 CLI 枚举并按单 CLI revision 收敛。
- [x] 按已确认原型实现双行环境卡、播放安装、持续反馈、始终可用的重新检查和标题栏聚合。
- [x] 实现团队卡、完成页与新建对话的 CLI 兼容提示及修复后自动消失。
- [x] 让 AI 建队选择当前可用 CLI、冻结草稿引擎/profile/session，并保证失败不跨 CLI 降级。
- [x] 补齐 desktop、console-ui、AI builder 与安全边界测试，并更新 Storybook fixture。
- [x] 运行功能验收，修复所有不符合项。
- [x] 运行亮暗主题、窄窗口、键盘、焦点、aria-live 与 reduced-motion 视觉验收，修复所有不符合项。
- [x] 运行根测试、typecheck、console-ui Storybook build、desktop build并反思代码与方案符合度。
