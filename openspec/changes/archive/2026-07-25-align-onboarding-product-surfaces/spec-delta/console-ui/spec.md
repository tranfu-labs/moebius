# console-ui 规格增量

## ADDED Requirements

### Requirement: 引导通过态只展示调用方提供的真实版本

Source: docs/product/pages/onboarding.md#页面结构

`OnboardingShell` 的 Codex 通过态 MUST 原样展示调用方提供的最近一次检测 `detail`，MUST NOT 在组件或 Storybook 中补充硬编码版本。当调用方未提供版本 `detail` 时，组件 MUST 使用不含具体版本号的通用就绪文案。

#### Scenario: 展示真实检测版本

- **GIVEN** shell 收到 `ready` 环境状态和版本文本 A
- **WHEN** 第 1 步通过态渲染
- **THEN** 页面展示版本文本 A
- **AND** 不展示另一个固定或占位版本。

#### Scenario: 静态评审没有真实检测输入

- **GIVEN** Storybook 或其他静态评审表面以 `ready` 状态渲染但没有真实版本 `detail`
- **WHEN** 第 1 步通过态渲染
- **THEN** 页面显示通用就绪文案
- **AND** 不显示任何具体版本号。

## MODIFIED Requirements

### Requirement: 引导壳区分首启与回看模式

Source: docs/product/pages/onboarding.md#重新查看引导

`OnboardingShell` MUST 通过显式输入区分 `first-run` 与 `replay`。回看模式 MUST 显示“回看引导”和可操作的“退出”，但第 4 步 MUST 与首启模式一样显示“开始使用”；首启模式 MUST 显示“首次启动”，且 MUST NOT 获得可跳过首启硬门禁的退出入口。相同 CTA 文案的完成语义 MUST 由上层 mode 回调决定，组件不得自行写 completion marker 或团队偏好。

#### Scenario: 已完成用户回看引导

- **GIVEN** shell 以 `replay` 模式渲染
- **WHEN** 用户从第 1 步进入或到达第 4 步
- **THEN** 标题栏显示“回看引导”和“退出”
- **AND** 第 4 步主 CTA 显示“开始使用”
- **AND** 页面不显示“完成回看”。

#### Scenario: 全新用户首次启动

- **GIVEN** shell 以 `first-run` 模式渲染
- **WHEN** 用户查看标题栏和第 4 步
- **THEN** 标题栏显示“首次启动”且没有退出操作
- **AND** 第 4 步主 CTA 为“开始使用”。
