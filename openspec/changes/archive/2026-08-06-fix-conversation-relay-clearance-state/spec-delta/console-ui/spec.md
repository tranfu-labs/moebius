# console-ui delta：fix-conversation-relay-clearance-state

## ADDED Requirements

### Requirement: 目录轨展开以覆盖层呈现且窄容器留白固定

Source: docs/product/pages/main-conversation.md#会话目录轨

系统 MUST 让目录轨展开面板以悬浮覆盖层呈现：展开面板 MUST 从收起态槽位向右延伸、z-index 高于时间线正文列，MUST NOT 推动正文、标题、输入框位置或主时间线滚动位置，MUST NOT 改变任何消息的排布。窄容器（自然居中 840px 内容列左缘不足 56px，即 `conversationPaneWidth < 952px`）下，时间线消息列与 composer MUST 以固定 56px 左内边距（12px 左内缩 + 44px 收起态目录轨视口）预留收起态目录轨占地，且该值 MUST NOT 随目录轨展开/收起变化。宽容器（自然居中列左缘 ≥ 56px）下，时间线消息列与 composer MUST 保持标准 32px gutter，且 MUST NOT 因目录轨展开改变。时间线消息列与 composer 的左侧内容边界 MUST 在两种容器宽度下保持一致。

#### Scenario: 窄容器目录轨展开不推动正文

- **GIVEN** 窄主会话（`conversationPaneWidth` < 952px）包含目录轨、消息与输入框
- **WHEN** 用户悬停目录轨使其展开
- **THEN** 消息列与 composer 的左内边距保持 56px 不变，正文与输入框左缘像素坐标不变
- **AND** 展开面板覆盖在正文左缘之上且事件行整行可点击

#### Scenario: 窄容器目录轨收起

- **GIVEN** 窄主会话包含目录轨、消息与输入框
- **WHEN** 目录轨处于收起态且用户未悬停
- **THEN** 消息列与 composer 的左内边距为 56px，与展开态相同
- **AND** 收起态目录轨（44px 视口 + 12px 内缩）不压到消息文字

#### Scenario: 宽容器目录轨展开不改变布局

- **GIVEN** 宽主会话（自然居中列左缘 ≥ 56px）包含目录轨
- **WHEN** 用户悬停目录轨使其展开
- **THEN** 消息列与 composer 保持 32px gutter 且内容边界不随展开变化

## MODIFIED Requirements

### Requirement: 主会话所有状态共用 dashboard 内容轴

Source: docs/product/pages/main-conversation.md#页面结构

系统 MUST 让主会话 sticky 标题、通知、空态、时间线消息、活动 run、结果、待发射区和 composer 共用最大 840px 的居中内容轴；可用宽度不足时各区域 MUST 共同收缩并保持 32px 左右 gutter；存在会话目录轨时，时间线消息列与 composer 的左侧 gutter 例外地按收起态目录轨宽度预留（56px）且不随目录轨展开变化，sticky 标题行位于目录轨上方、不受该例外影响。顶部窗口控制行与 sticky 会话标题 MUST 均为 46px。系统 MUST NOT 让任一区域继续使用独立的 760px / 720px 宽度，MUST NOT 因内容轴变宽而把目录轨迁入项目 / 会话侧栏或产生根级横向滚动。

#### Scenario: 宽窗打开长会话

- **GIVEN** 已有会话包含通知、用户与 Agent 消息、活动 run、待发射内容和 composer
- **WHEN** 主会话可用宽度大于 904px
- **THEN** 标题、消息、活动记录、待发射区和 composer 的内容边界对齐到居中的 840px 轴
- **AND** 顶部窗口控制行与 sticky 标题均为 46px，目录轨仍属于当前主会话

#### Scenario: 主会话容器收窄

- **GIVEN** 左侧栏打开且主会话正在显示
- **WHEN** 窗口缩窄到无法容纳 840px 内容轴
- **THEN** 标题、时间线和 composer 同步收缩；无目录轨时保留 32px 左右 gutter，有目录轨时消息列与 composer 左缘固定让出收起态目录轨宽度（56px）且不随目录轨展开变化
- **AND** 长正文、附件和 Markdown 在自身边界换行或滚动，不撑宽根页面

### Requirement: 主会话消息采用 dashboard 身份与正文层级

Source: docs/product/pages/main-conversation.md#时间线

系统 MUST 在主会话把用户与 Agent 身份头像渲染为 24px 圆形，并把 Agent / system 正文相对身份行缩进 32px。Agent 正文 MUST 占满 840px 内容列、不再附加行宽上限（68ch 限宽于 2026-08-06 按用户产品决定移除，不是发现原设计有错）。用户身份行和消息 MUST 右对齐，用户消息气泡 MUST 不超过主内容轴的 75%，使用 8px × 12px 内边距和 10px 圆角。系统 MUST 保持消息时间只在 hover / focus 时可见，并保持 Markdown、附件、完整输出、分析入口及活动 run 的既有行为。主会话视觉参数 MUST NOT 自动应用到右侧栏的 embedded 会话。

#### Scenario: 同一时间线含用户长消息与 Agent 长回复

- **GIVEN** 主会话包含用户消息、Agent 长回复与活动 run
- **WHEN** 用户悬停并键盘聚焦这些记录
- **THEN** 主会话头像为 24px，Agent 正文缩进 32px 且占满内容列宽度
- **AND** 用户气泡右对齐且不超过内容轴 75%，消息时间可见
- **AND** 原有消息操作仍可由鼠标和键盘使用
