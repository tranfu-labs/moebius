# console-ui delta：desktop-auto-update-reminder

## MODIFIED Requirements

### Requirement: 设置更新状态与安装入口语义独立

Source: docs/product/pages/settings.md#关于

`SettingsDialog` MUST 在 ready 状态的更新信息旁呈现“重启并安装”，无论该版本是否被用户跳过；该入口 MUST 只提交上层安装意图。`SettingsDialog` MUST 在安装失败状态显示独立的安装失败说明和安装入口，MUST NOT 复用检查失败或网络失败文案。

#### Scenario: 跳过版本后仍可从 About 安装

- **GIVEN** 更新包为 ready 且当前版本等于用户跳过的版本
- **WHEN** 用户查看 About
- **THEN** 页面显示已跳过说明与“重启并安装”
- **AND** 用户不需要先执行再次检查或寻找侧栏入口

#### Scenario: About 区分安装失败

- **GIVEN** 最近一次安装未完成
- **WHEN** 用户查看 About
- **THEN** 页面显示安装失败语义和安装入口
- **AND** 页面不把该结果显示为检查失败或网络失败

### Requirement: 更新安装失败结果在当前界面可见

Source: docs/product/flows/app-auto-update.md#任务未能停止或安装未能完成

`UpdatePromptDialog` MUST 支持独立的安装失败模式。任务停止失败时 MUST 说明安装尚未开始、仍有多少任务运行，并提供“继续工作”和“重试”；安装已开始但未完成，或零任务安装未完成时 MUST 说明实际安装结果及任务/会话后果，并提供“稍后重试”和“重试安装”。

#### Scenario: 任务停止失败

- **GIVEN** 安装失败结果表示任务停止未完成
- **WHEN** 失败弹窗打开
- **THEN** 用户能看到仍在运行的任务数和安装尚未开始
- **AND** “继续工作”关闭弹窗，“重试”重新进入安装保护

#### Scenario: 安装阶段失败

- **GIVEN** 安装失败结果表示任务已经停止或原本没有运行任务
- **WHEN** 失败弹窗打开
- **THEN** 用户能看到安装未完成以及任务和会话的实际后果
- **AND** “稍后重试”只关闭弹窗，“重试安装”重新进入安装保护

#### Scenario: 失败弹窗关闭不自动重试

- **GIVEN** 安装失败弹窗处于打开状态
- **WHEN** 用户按 Escape、点击蒙版或选择左侧退路
- **THEN** 失败弹窗关闭
- **AND** 不自动发起新的安装

### Requirement: 任务数量文案必须匹配真实数量

Source: docs/product/flows/app-auto-update.md#6-安装确认

更新安装确认与任务停止失败反馈 MUST 按当前任务数量使用正确的单复数表达；英文界面显示
一个任务时 MUST 使用 `1 running task`，不得显示 `1 running tasks`。失败反馈中的任务状态
也 MUST 与桌面运行时提供的终态 DTO 一致：尚未归零时不能使用“任务已停止”说明。

#### Scenario: 单任务安装确认

- **GIVEN** 当前有一个真实运行任务
- **WHEN** 用户从任一安装入口打开确认
- **THEN** 英文确认显示一个 running task，并保留停止任务的危险操作层级

#### Scenario: 停止未完成的失败反馈

- **GIVEN** 停止请求返回但仍有任务显示运行
- **WHEN** 任务停止失败弹窗打开
- **THEN** 弹窗显示仍在运行的任务数与“安装尚未开始”
- **AND** 不显示任务已停止、安装已开始或任务需要重新启动的结论
