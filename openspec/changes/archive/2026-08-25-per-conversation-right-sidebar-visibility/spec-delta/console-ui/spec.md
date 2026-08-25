# console-ui 规格增量

## MODIFIED Requirements

### Requirement: 验收 #1 右侧栏开关按对话隔离，宽度偏好保留全局

Source: docs/product/pages/main-right-sidebar.md#入口与去向
Source: docs/product/pages/main-right-sidebar.md#打开与关闭右侧栏

系统 MUST 在一个根对话尚未保存右侧栏开关状态时默认关闭右侧栏，并按根对话分别保存和恢复开关状态。切换根对话、通过右侧栏入口到达目标对话或应用重启时，系统 MUST 只恢复目标根对话自己的状态；一个根对话的开关 MUST NOT 改变另一个根对话。用户主动调整的右栏宽度仍 MUST 作为跨对话、跨重启的原始全局偏好保存。窗口或左导航变化导致宽度暂时越界时 MUST 只夹取呈现值，不得覆盖原始偏好。开合 MUST NOT 清空当前会话草稿、改变运行状态或重置会话区滚动位。

#### Scenario: 对话 A 打开而首次访问的 B 保持关闭

- **GIVEN** 根对话 A 已保存右侧栏为打开
- **AND** 根对话 B 没有已保存的右侧栏开关状态
- **WHEN** 用户从 A 切换到 B
- **THEN** B 的右侧栏保持关闭
- **AND** A 保存的打开状态不被改写
- **WHEN** 用户返回 A
- **THEN** A 的右侧栏恢复打开。

#### Scenario: 重启后分别恢复对话开关

- **GIVEN** 根对话 A 保存为打开，根对话 B 保存为关闭
- **WHEN** 用户重启应用后依次打开 B 和 A
- **THEN** B 保持关闭
- **AND** A 恢复打开。

#### Scenario: 右侧栏入口只打开目标工作现场

- **GIVEN** 根对话 A 的右侧栏已打开
- **AND** 根对话 B 的右侧栏已关闭
- **WHEN** 用户触发属于 B 的右侧栏入口
- **THEN** B 的右侧栏打开并显示目标内容
- **AND** A 的保存状态仍为打开。
