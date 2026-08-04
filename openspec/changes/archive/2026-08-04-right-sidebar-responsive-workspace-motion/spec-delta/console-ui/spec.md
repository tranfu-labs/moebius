# console-ui 规格增量

## MODIFIED Requirements

### Requirement: 验收 #1 右侧栏开关与原始宽度偏好全局持久化

Source: docs/product/pages/main-right-sidebar.md#入口与去向
Source: docs/product/pages/main-right-sidebar.md#响应式与窗口行为

系统 MUST 在没有已保存开关偏好时默认关闭右侧栏，在没有已保存宽度偏好时按当前可用内容
宽度的 50% 呈现。用户改变开关或主动调整宽度后，系统 MUST 跨对话与应用重启恢复对应原始
偏好。窗口或左导航变化导致宽度暂时越界时 MUST 只夹取呈现值，不得覆盖原始偏好。开合 MUST
NOT 清空当前会话草稿、改变运行状态或重置会话区滚动位。

#### Scenario: 缩窗只临时夹取已保存宽度

- **GIVEN** 用户已保存 700px 右栏宽度
- **WHEN** 可用内容宽度缩窄到只能呈现 520px，随后恢复到 1200px 并重启应用
- **THEN** 缩窄期间右栏呈现 520px
- **AND** 恢复和重启后右栏重新呈现 700px。

### Requirement: 验收 #16 最后标签关闭时右侧栏保留退场快照

Source: docs/product/pages/main-right-sidebar.md#标签全部关闭
Source: docs/product/pages/main-right-sidebar.md#关闭标签

系统 MUST 为每个标签提供关闭操作。最后一个标签关闭后 MUST 立即保存零标签状态并开始关闭
右侧栏；出场期间 MUST 保留最后内容的不可交互视觉快照，完成后才从页面结构移除。系统 MUST
NOT 创建虚假的空白标签、先显示空白工作面、关闭对话、停止推进或取消子任务。之后仅通过显示
按钮重开时 MUST 显示内容选择面，且选择前标签数仍为零。

#### Scenario: 关闭最后标签后重开

- **GIVEN** 右侧栏只剩一个改动标签
- **WHEN** 用户关闭该标签
- **THEN** 标签状态立即为空且旧改动内容只作为 inert 快照保留至退场完成
- **WHEN** 用户重新显示右侧栏
- **THEN** 页面显示“这个标签要看什么”且没有已创建标签。

### Requirement: 验收 #23 右侧栏按可用内容宽度切换并排与覆盖

Source: docs/product/pages/main-right-sidebar.md#窄窗口
Source: docs/product/pages/main-right-sidebar.md#响应式与窗口行为

系统 MUST 以应用窗口扣除当前可见左导航后的可用内容宽度作为布局输入。宽度达到或超过
960px 时 MUST 并排显示主会话与右栏；低于 960px 时 MUST 让右栏占满内容面并覆盖会话区，
提供独立关闭入口。仅因窗口或左导航变化跨越断点时 MUST NOT 播放开关动画、丢失焦点、标签
或阅读位置。关闭后 MUST 恢复打开前的会话区滚动位。

#### Scenario: 960px 边界

- **GIVEN** 右侧栏已经打开
- **WHEN** 可用内容宽度依次为 960px 和 959px
- **THEN** 960px 使用并排布局且右栏为 480px
- **AND** 959px 使用占满内容面的覆盖布局且没有宽度分隔线。

## ADDED Requirements

### Requirement: 右侧工作区按比例和双面可读边界呈现

Source: docs/product/pages/main-right-sidebar.md#响应式与窗口行为

并排布局没有宽度偏好时，系统 MUST 让右栏取可用内容宽度的 50%，取整误差不超过 1px。
右栏 MUST 至少 480px；当前最大值 MUST 取可用内容宽度 75% 与给主会话保留 480px 后剩余
宽度的较小者。

#### Scenario: 无偏好的 1200px 内容面

- **GIVEN** 没有保存右栏宽度偏好
- **WHEN** 可用内容宽度为 1200px
- **THEN** 右栏宽度为 600px且主会话宽度不小于 480px。

### Requirement: 分隔线同时支持指针与键盘宽度调整

Source: docs/product/pages/main-right-sidebar.md#宽度调整分隔线

并排布局 MUST 提供贯穿内容高度、命中区大于可见细线的可聚焦垂直 separator，公开当前、
最小和动态最大宽度。左拖 MUST 扩大右栏、右拖 MUST 缩小；`ArrowLeft/ArrowRight` MUST
分别扩大/缩小 16px，Shift 步长为 64px，Home/End MUST 到当前边界。hover、拖动、键盘
焦点和抵达边界 MUST 有强调反馈；继续越界操作 MUST 保持边界且不得抖动、位移或弹 toast。

#### Scenario: 键盘到达动态最大值

- **GIVEN** 1200px 内容面中的分隔线获得键盘焦点
- **WHEN** 用户按 End 后继续按 ArrowLeft
- **THEN** 右栏保持 720px
- **AND** separator 的当前值与边界反馈一致。

### Requirement: 右侧工作区开合可反向且安全退场

Source: docs/product/pages/main-right-sidebar.md#打开与关闭右侧栏

右侧栏 MUST 使用 150ms 无弹性标准缓动从右缘展开并沿原路径收回。并排时主会话 MUST 同步
让出或收回空间；覆盖时右栏 MUST 从右缘覆入或退出；内容 MUST 只被裁切或平移，不得缩放、
弹跳或先显示空白面。动画中再次开关 MUST 从当前进度响应最后意图，不排队或跳回端点。

关闭开始时右栏 MUST 立即停止指针和键盘交互，并把内部焦点移到主内容显示/隐藏按钮；视觉
内容 MUST 保留到退出完成后才卸载和恢复主会话滚动位置。打开 MUST 保留开关焦点。用户启用
减少动态效果时 MUST 立即完成目标状态。

#### Scenario: 关闭途中重新打开

- **GIVEN** 已打开右栏正在执行关闭动画且尚未到端点
- **WHEN** 用户再次激活显示按钮
- **THEN** 右栏从当前进度立即反向打开且没有排队或端点跳变
- **AND** 最终保持打开。

#### Scenario: reduced-motion 关闭

- **GIVEN** 用户启用减少动态效果且焦点位于右栏内容
- **WHEN** 用户关闭右栏
- **THEN** 右栏立即移除且焦点位于主内容显示按钮
- **AND** 主会话滚动位置恢复。
