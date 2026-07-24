# console-ui 规格增量

## ADDED Requirements

### Requirement: 操作台提供固定的引导回看入口

Source: docs/product/pages/main-left-sidebar.md#底部应用操作

`OperatorConsole` MUST 在侧边栏底部的“设置”上方渲染受控的“重新查看引导”操作。该操作 MUST 使用与侧栏导航行一致的视觉和键盘交互模式，并 MUST 通过回调把进入意图交给 desktop renderer，而不是自行读取 marker、路由或 IPC。

#### Scenario: 键盘访问底部操作

- **GIVEN** 主页面侧边栏已打开
- **WHEN** 用户按视觉顺序遍历侧栏交互控件
- **THEN** “重新查看引导”位于“设置”之前
- **AND** 两者都有可读的辅助名称和悬停说明。

### Requirement: 引导壳区分首启与回看模式

Source: docs/product/pages/onboarding.md#重新查看引导

`OnboardingShell` MUST 通过显式输入区分 `first-run` 与 `replay`。回看模式 MUST 显示“回看引导”、可操作的“退出”和末步“完成回看”；首启模式 MUST 继续显示“首次启动”和末步“开始使用”，且 MUST NOT 获得可跳过首启硬门禁的退出入口。

#### Scenario: 已完成用户回看引导

- **GIVEN** shell 以 `replay` 模式渲染
- **WHEN** 用户从第 1 步进入或到达第 4 步
- **THEN** 标题栏显示“回看引导”和“退出”
- **AND** 第 4 步主 CTA 显示“完成回看”。

#### Scenario: 全新用户首次启动

- **GIVEN** shell 以 `first-run` 模式渲染
- **WHEN** 用户查看标题栏和第 4 步
- **THEN** 标题栏显示“首次启动”且没有退出操作
- **AND** 第 4 步主 CTA 仍为“开始使用”。
