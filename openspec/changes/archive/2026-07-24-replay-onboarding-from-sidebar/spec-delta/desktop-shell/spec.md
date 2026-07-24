# desktop-shell 规格增量

## ADDED Requirements

### Requirement: 已完成用户可非破坏性回看引导

Source: docs/product/pages/onboarding.md#重新查看引导

桌面 renderer MUST 允许 marker 已完成的用户从主页面进入完整 onboarding 回看。回看 MUST 作为非持久化展示态保持进入前的操作台挂载；退出或完成后 MUST 恢复进入前的项目、对话、草稿和应用页面状态。

进入、退出和完成回看 MUST NOT 删除、覆盖或重写 `.onboarding-completed`，MUST NOT 调用首启完成 IPC，MUST NOT 生成 `pendingAgentTeamKey`，并 MUST NOT 更新上一次成功创建会话所用团队。应用在回看中关闭后，下次启动 MUST 继续按有效 marker 进入主页面。

#### Scenario: 退出回看

- **GIVEN** 有效 completion marker 已命中且用户从一个带未提交草稿的主页面进入回看
- **WHEN** 用户点击“退出”
- **THEN** 原操作台重新可见且草稿、当前项目、当前对话和应用页面保持不变
- **AND** completion marker 内容未改变。

#### Scenario: 完成回看

- **GIVEN** 用户在回看第 2 步临时选择了不同团队
- **WHEN** 用户在第 4 步点击“完成回看”
- **THEN** renderer 返回进入前的操作台
- **AND** 不调用 `onboarding:complete`
- **AND** 不把临时团队选择交给新建对话或 last-used team。

#### Scenario: 回看中关闭应用

- **GIVEN** 有效 completion marker 已命中且用户正在回看第 2 步
- **WHEN** 应用关闭并重新启动
- **THEN** renderer 按原有效 marker 进入主页面
- **AND** 不恢复或强制继续回看。
