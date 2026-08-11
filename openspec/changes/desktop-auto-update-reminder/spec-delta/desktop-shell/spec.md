# desktop-shell delta：desktop-auto-update-reminder

## ADDED Requirements

### Requirement: 更新安装在任务停止后才允许执行

Source: docs/product/flows/app-auto-update.md#6-安装确认

- 所有更新安装入口 MUST 通过同一退出协调链路提交安装意图。
- 退出协调链路在执行前 MUST 重新读取当前运行任务数；用户首次确认使用的任务快照 MUST NOT 直接作为安装依据。
- 存在运行任务时，链路 MUST 停止 local-console 的活动运行项及其他受管运行项，并在允许关闭或安装前确认运行任务数为零。
- 任务停止未完成时 MUST NOT 调用更新 provider 的安装或退出应用；应用、任务和 ready 安装入口 MUST 保持可继续使用。

#### Scenario: 更新入口停止真实运行任务

- **GIVEN** 用户从提醒、About 或侧栏发起安装，且重新读取到至少一个运行任务
- **WHEN** 用户确认停止任务并安装
- **THEN** 所有受管运行项在安装前停止并被回收
- **AND** 更新安装只在运行任务数为零后开始

#### Scenario: 任务停止失败阻断安装

- **GIVEN** 用户确认停止任务并安装
- **WHEN** 退出协调链路仍观察到运行任务
- **THEN** 安装 provider 未被调用
- **AND** 应用保持打开，当前任务仍可继续处理

### Requirement: 更新安装失败结果可恢复且与阶段一致

Source: docs/product/flows/app-auto-update.md#任务未能停止或安装未能完成

- 桌面主进程 MUST 发布可序列化的安装失败结果，至少区分 `task-stop` 与 `install` 阶段，并包含当前运行任务数、是否曾有运行任务、任务是否已停止和安装是否已开始。
- 任务停止失败时 MUST 发布 `installStarted: false`，并保留实际非零运行任务数；不得伪装成安装已开始。
- 任务已停止但 provider 安装未完成，或零任务安装未完成时，主进程 MUST 重新打开 local console、恢复更新检查调度并保留 ready marker 与安装入口。
- 安装失败后的重试 MUST 重新读取 ready 状态和当前运行任务数，并重新进入安装确认链路；不得复用失败前的任务快照。
- 失败结果 MUST 不触发自动重试或再次弹出 ready 提醒。

#### Scenario: 安装开始后失败恢复

- **GIVEN** 运行任务已经停止且更新 provider 已开始安装
- **WHEN** 安装 watchdog 判定安装未完成
- **THEN** 应用恢复可用，ready marker 和安装入口保留
- **AND** renderer 收到 `installStarted: true` 的安装失败结果

#### Scenario: 重试重新取样

- **GIVEN** 一次安装失败后用户选择重试
- **WHEN** 重试链路开始
- **THEN** 它读取当前 ready 版本和当前运行任务数
- **AND** 新任务数决定新的安装确认内容

### Requirement: 安装前的任务停止必须等待权威终态

Source: docs/product/flows/app-auto-update.md#任务未能停止或安装未能完成

安装协调 MUST 使用独立于应用关闭的任务停止操作。取消请求返回、controller 已发出中止信号
或 local-console close Promise 完成，均不足以证明任务已停止；协调 MUST 等待活动运行项及其
受管进程进入终态并使权威运行任务计数为零。

#### Scenario: 运行项尚未终止时阻断安装

- **GIVEN** 用户确认停止任务并安装，且至少一个任务仍处于活动运行项或受管进程状态
- **WHEN** 停止等待达到上限或再次读取仍为非零
- **THEN** 更新 provider 未被调用
- **AND** local-console 与当前任务保持可继续使用
- **AND** 失败结果为 `task-stop`、`installStarted: false`，不得声称任务已经停止

#### Scenario: 任务终态后才开始安装

- **GIVEN** 停止请求已发出，但 provider 仍在异步收尾
- **WHEN** 活动运行项和受管进程计数最终归零
- **THEN** 安装协调才允许关闭 local-console 并调用更新 provider
- **AND** 后续安装失败反馈可以准确说明任务已停止

#### Scenario: 失败后重试使用零任务快照

- **GIVEN** 任务已经真实进入终态且安装随后失败
- **WHEN** 用户选择重试安装
- **THEN** 重试重新读取当前任务数并在零任务时显示普通安装确认
