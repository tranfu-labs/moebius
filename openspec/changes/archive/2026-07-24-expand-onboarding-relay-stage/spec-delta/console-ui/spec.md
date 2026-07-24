# spec-delta: console-ui / expand-onboarding-relay-stage

## MODIFIED Requirements

### Requirement: 验收 #18 — 接力节点只以相邻线段连接并与消息逐行对齐

Source: docs/product/pages/onboarding.md#第-3-步--团队协作示例

系统 MUST 仅把团队成员顺序映射为稳定等宽的横向轨道。graph 总宽 MUST 等于 `memberCount × laneWidth`，成员节点横坐标 MUST 等于 `(memberIndex + 0.5) × laneWidth`；同一组几何结果 MUST 同时驱动角色表头、节点与 SVG viewBox，系统 MUST NOT 把任意成员数继续压入一个固定比例宽度。

每一拍 MUST 在该拍 `speakerSlug` 的位置产生一个节点。每个已完成节点 MUST 向本拍边界绘制一段短 tail，下一拍 MUST 使用一条三次贝塞尔曲线从上一成员轨道转入当前成员轨道；tail 和 connector MUST 只属于第 `i - 1` 拍与第 `i` 拍之间的交接，任何连接的 `y1..y2` 索引差 MUST 不超过一个 beat 索引单位。系统 MUST NOT 渲染代表某成员贯穿多拍的竖线、首拍直连末拍的路径或其他跨拍 DAG 边。

每拍节点行与该拍消息行 MUST 位于同一共享 CSS grid，且两者的 `grid-row` MUST 使用相同 beat 索引。已出现的拍次 MUST 留在同一舞台中，当前拍变化不得从数据或 DOM 中移除既有问题、修正或复核记录。

#### Scenario: 六拍开发团队接力

- **GIVEN** 内置开发团队有 3 名成员和 6 拍编排
- **WHEN** 第 3 步渲染完整接力
- **THEN** 页面渲染 6 个节点和 5 组相邻连接
- **AND** 每组连接的终止 beat 索引减起始 beat 索引等于 1
- **AND** 每个节点行与对应消息行拥有相同 `grid-row`
- **AND** 成员表头、节点与路径使用同一组轨道横坐标。

#### Scenario: 六名成员的宽版轨道

- **GIVEN** 所选团队有 6 名成员
- **WHEN** 第 3 步在宽窗口渲染
- **THEN** graph 总宽等于 6 个稳定轨道宽度
- **AND** 第 1 名和第 6 名成员的节点中心分别位于 0.5 和 5.5 个轨道宽度
- **AND** 角色标签不因平均挤入固定比例 graph 列而退化为省略号。

## ADDED Requirements

### Requirement: 验收 #25 — 第 3 步使用宽版且高度可降级的接力舞台

Source: docs/product/pages/onboarding.md#主体区每屏

系统 MUST 在宽窗口下把第 3 步内容列上限设为约 `780px`，同时 MUST 保持第 1、2、4 步普通内容列约 `512px` 的既有行为。系统 MUST 在宽窗口完整显示所选团队名称与 2–6 名成员角色标签，并 MUST 让默认 `1180 × 760` 桌面窗口中的标准六棒完成态无需手动滚动即可全部可见。

当可用高度不足或编排超过标准六棒时，系统 MUST 只让接力时间线内部滚动；接力卡标题、角色表头、重新播放、完成说明和 onboarding 底部操作 MUST 保持可见。系统 MUST NOT 以强制改变 Electron BrowserWindow 尺寸、裁切消息正文或隐藏引导操作来获得空间。

#### Scenario: 默认桌面窗口显示六棒

- **GIVEN** Electron 主窗口为默认 `1180 × 760`
- **AND** 所选开发团队包含标准 6 拍
- **WHEN** 用户进入第 3 步
- **THEN** 第 3 步内容列使用约 780px 宽版
- **AND** 团队名、成员标签与 6 条消息均可读取
- **AND** 完成态无需手动滚动时间线即可看见全部 6 条消息
- **AND** 「重新播放」「上一步」「继续」保持可见。

#### Scenario: 最小高度窗口

- **GIVEN** 窗口高度缩小到允许的最小高度
- **WHEN** 第 3 步时间线无法完整容纳所有拍次
- **THEN** 只有时间线容器产生纵向滚动
- **AND** 接力卡标题、角色表头、完成说明和 onboarding 底部操作仍可见。

### Requirement: 接力输入阶段与角色持有者反馈

Source: docs/product/pages/onboarding.md#第-3-步--团队协作示例

系统 MUST 在下一拍消息出现前显示该成员的有界输入反馈，并在消息 reveal 时用节点、相邻连接、消息行和角色持有者反馈表达同一次交接。标准动态效果 MUST 把角色表头下划线移动到 typing 或 active 成员轨道并绘制当前相邻路径；`prefers-reduced-motion: reduce` 命中时 MUST 使用无 transform、无 translate、无持续脉冲的静态位置与 opacity 反馈，且成员、顺序、消息和完成状态 MUST 信息等价。

#### Scenario: 下一位成员正在输入

- **GIVEN** 第 2 拍尚未 reveal
- **WHEN** 第 2 拍进入预备输入阶段
- **THEN** 时间线显示第 2 拍成员的输入反馈
- **AND** 角色持有者反馈指向第 2 拍成员
- **WHEN** 第 2 拍 reveal
- **THEN** 输入反馈退出并由第 2 拍节点、连接和消息替代。
