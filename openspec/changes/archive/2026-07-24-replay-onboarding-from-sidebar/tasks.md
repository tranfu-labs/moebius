# 任务：replay-onboarding-from-sidebar

- [x] 为 `OperatorConsole` 增加固定在设置上方的受控“重新查看引导”入口及顺序/可访问性测试。
- [x] 为 `OnboardingShell` 增加 `first-run | replay` 模式、退出操作、回看文案与单元测试。
- [x] 在 desktop renderer 接入临时 replay 展示态，保持操作台挂载并在退出/完成后恢复焦点与原状态。
- [x] 增加 renderer 级验证，证明 replay 不调用 `completeOnboarding`、不生成 pending team，首启行为保持不变。
- [x] 运行目标测试、类型检查和 desktop build，并完成可见界面验证。
