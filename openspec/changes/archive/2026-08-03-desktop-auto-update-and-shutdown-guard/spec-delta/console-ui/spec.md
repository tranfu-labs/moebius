### Requirement: 侧栏只在更新包就绪时提供安装入口

Source: docs/product/pages/main-left-sidebar.md#底部应用操作

`OperatorConsole` MUST 将“设置”和“安装更新”作为两个并列、各自可聚焦的底部操作。只有更新状态为 `ready-to-install` 时 MUST 渲染“安装更新”；检查中、下载中、失败、已是最新版和未知状态 MUST 不渲染该按钮，不显示更新红点或更新完成通知。

#### Scenario: 更新包未就绪

- **GIVEN** 更新状态为 checking、downloading、failed、latest 或 idle
- **WHEN** 侧边栏底部渲染
- **THEN** 只显示设置入口
- **AND** 用户不会看到安装更新按钮或下载完成通知

#### Scenario: 下载中的立即检查被阻止

- **GIVEN** 更新状态为 `available` 或 `downloading`
- **WHEN** 用户尝试点击关于页的立即检查
- **THEN** 检查按钮不可用且不会重新发起下载
- **AND** 当前版本与下载进度保持不变

#### Scenario: 更新包已就绪

- **GIVEN** 更新状态为 ready-to-install 且版本为 `0.2.1`
- **WHEN** 侧边栏底部渲染
- **THEN** 设置右侧显示独立的“安装更新”按钮
- **AND** 该按钮具有本地化可访问名称并可用键盘聚焦

### Requirement: 侧栏安装入口呈现安装确认

Source: docs/product/pages/settings.md#更新检查、下载与安装

设置“关于”只展示 `ready-to-install` 状态，不提供安装按钮。侧栏“安装更新” MUST 调用上层安装意图并先展示安装确认。无运行任务和有运行任务 MUST 使用不同的弹窗标题、说明与按钮；有运行任务时 MUST 提供“继续工作”和“停止任务并重启安装”，取消或继续工作 MUST 保留 ready 状态。

#### Scenario: 无运行任务确认安装

- **GIVEN** ready 状态且没有受管运行任务
- **WHEN** 用户点击侧栏“安装更新”
- **THEN** 显示说明应用将关闭、安装并重新打开的确认弹窗
- **AND** 取消不改变当前页面或 ready 状态

#### Scenario: 有运行任务的重启安装弹窗

- **GIVEN** ready 状态且有受管运行任务
- **WHEN** 用户点击侧栏“安装更新”
- **THEN** 显示独立的重启安装保护弹窗
- **AND** 弹窗说明停止任务会保留会话记录
- **AND** 选择“继续工作”只关闭弹窗，不显示普通退出弹窗

### Requirement: 更新异步状态对父级重渲染安全

Source: docs/product/pages/settings.md#打开与关闭

设置与侧栏的更新状态呈现 MUST 在父级重渲染、回调身份变化、慢返回、失败返回和迟到事件下保持同一状态机语义。重复检查/下载 MUST 被拦截，迟到的旧请求 MUST NOT 覆盖较新的 `ready`、failed 或 installing 状态，关闭并重新打开设置 MUST 恢复当前应用会话状态。
