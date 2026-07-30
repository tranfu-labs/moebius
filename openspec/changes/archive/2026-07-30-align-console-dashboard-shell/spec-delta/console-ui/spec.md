# console-ui Spec Delta

## ADDED Requirements

### Requirement: 左侧栏采用 dashboard 视觉节奏且保留生产能力

Source: docs/product/pages/main-left-sidebar.md#页面结构

系统 MUST 让主页面左侧栏默认宽度为 252px，同时保留既有可拖动最小 / 最大宽度、窄窗自动收起和显式开合能力。系统 MUST 使用 46px 窗口控制行、34px 品牌行、34px 应用级导航行以及 32px 项目 / 会话行；会话行 MUST 以 28px 左缩进容纳标题，并以 `»` 加中性选中底表示当前会话。系统 MUST 保留“新建对话”“搜索”“Agent 团队”“重新查看引导”“设置”及全部项目 / 会话操作，MUST NOT 因参考稿未展示某项生产能力而删除或隐藏它。

#### Scenario: 展开含状态会话的侧栏

- **GIVEN** 主页面侧栏包含展开项目、折叠项目、选中会话和三种状态点
- **WHEN** 用户在默认宽度打开侧栏
- **THEN** 侧栏宽 252px，窗口控制、品牌、应用入口、项目和会话使用规定高度
- **AND** 选中会话显示 `»` 与中性选中底，展开项目不重复聚合状态点
- **AND** 折叠项目只显示最高优先状态点，底部引导与设置保持可达

#### Scenario: 用户拖动并恢复侧栏

- **GIVEN** 侧栏处于默认 252px 宽度
- **WHEN** 用户拖动右边界后关闭并重新打开侧栏
- **THEN** 拖动仍受既有最小 / 最大宽度约束，主内容随实际宽度重排
- **AND** 开合不重置会话、项目展开状态、列表滚动位置或主时间线

### Requirement: 左侧栏与主会话使用一致的表面层级和独立滚动边界

Source: docs/product/pages/main-left-sidebar.md#响应式与窗口行为

系统 MUST 让左侧栏与主会话使用同一不透明 canvas 背景，以语义选中、悬停和 card token 表达层级，并以 1px 语义分隔线表达侧栏右边界、顶部控制行底边、侧栏底部操作顶边和 composer 边界。品牌和页面标题 MUST 使用既有 display 字体，导航、列表与正文 MUST 使用既有 body 字体及对应层级。系统 MUST NOT 为本次对齐新增裸色、阴影或渐变。侧栏中只有项目 / 会话列表 MUST 独立滚动；主会话中只有时间线 MUST 独立滚动，顶部控制行、标题、底部操作和 composer MUST 保持可达，最后一条消息 MUST NOT 被 composer 遮挡。

#### Scenario: 短高度窗口分别滚动侧栏和主会话

- **GIVEN** 侧栏包含超出可用高度的项目列表，主会话包含超出可用高度的消息
- **WHEN** 用户把桌面窗口高度缩短并分别滚动两区
- **THEN** 只有项目列表和主时间线发生滚动
- **AND** 品牌、应用导航、侧栏底部操作、主标题和 composer 保持可达
- **AND** 两区背景、语义分隔线和字体层级保持一致，最后一条消息不被 composer 遮挡

### Requirement: 主会话所有状态共用 dashboard 内容轴

Source: docs/product/pages/main-conversation.md#页面结构

系统 MUST 让主会话 sticky 标题、通知、空态、时间线消息、活动 run、结果、待发射区和 composer 共用最大 840px 的居中内容轴；可用宽度不足时各区域 MUST 共同收缩并保持 32px 左右 gutter。顶部窗口控制行与 sticky 会话标题 MUST 均为 46px。系统 MUST NOT 让任一区域继续使用独立的 760px / 720px 宽度，MUST NOT 因内容轴变宽而把目录轨迁入项目 / 会话侧栏或产生根级横向滚动。

#### Scenario: 宽窗打开长会话

- **GIVEN** 已有会话包含通知、用户与 Agent 消息、活动 run、待发射内容和 composer
- **WHEN** 主会话可用宽度大于 904px
- **THEN** 标题、消息、活动记录、待发射区和 composer 的内容边界对齐到居中的 840px 轴
- **AND** 顶部窗口控制行与 sticky 标题均为 46px，目录轨仍属于当前主会话

#### Scenario: 主会话容器收窄

- **GIVEN** 左侧栏打开且主会话正在显示
- **WHEN** 窗口缩窄到无法容纳 840px 内容轴
- **THEN** 标题、时间线和 composer 同步收缩并保留 32px 左右 gutter
- **AND** 长正文、附件和 Markdown 在自身边界换行或滚动，不撑宽根页面

### Requirement: 主会话消息采用 dashboard 身份与正文层级

Source: docs/product/pages/main-conversation.md#时间线

系统 MUST 在主会话把用户与 Agent 身份头像渲染为 24px 圆形，把 Agent / system 正文相对身份行缩进 32px，并把 Agent 长正文限制为最大 68ch。用户身份行和消息 MUST 右对齐，用户消息气泡 MUST 不超过主内容轴的 75%，使用 8px × 12px 内边距和 10px 圆角。系统 MUST 保持消息时间只在 hover / focus 时可见，并保持 Markdown、附件、完整输出、分析入口及活动 run 的既有行为。主会话视觉参数 MUST NOT 自动应用到右侧栏的 embedded 会话。

#### Scenario: 同一时间线含用户长消息与 Agent 长回复

- **GIVEN** 主会话包含用户消息、Agent 长回复与活动 run
- **WHEN** 用户悬停并键盘聚焦这些记录
- **THEN** 主会话头像为 24px，Agent 正文缩进 32px 且不超过 68ch
- **AND** 用户气泡右对齐且不超过内容轴 75%，消息时间可见
- **AND** 原有消息操作仍可由鼠标和键盘使用

### Requirement: 主会话 composer 对齐内容轴并与 embedded 布局隔离

Source: docs/product/pages/main-conversation.md#输入框

系统 MUST 让已有会话与新对话的主 composer 使用同一 840px 内容轴、1px 描边、14px 圆角和 10px / 12px 内间距。上下文项 MUST 为 28px 高；空 textarea MUST 从单行高度起步并随内容增长，最大高度 MUST 为 120px；附件、发送和主理人停止按钮 MUST 为 32px 方形且使用 10px 圆角。系统 MUST 保留正文、输入法、mention、附件、发送、停止、待发射和禁用原因的既有状态规则，MUST NOT 把主 composer 宽度或单行起步规则应用到右侧 embedded composer。

#### Scenario: 新对话与已有会话输入多行内容

- **GIVEN** 用户分别打开新对话和已有会话
- **WHEN** 用户输入多行正文、添加附件并打开 mention 补全
- **THEN** 两个主 composer 与各自页面的 840px 内容轴一致
- **AND** textarea 从单行增长且不超过 120px，所有上下文与操作保持可达

#### Scenario: 主理人运行时右侧子任务同时打开

- **GIVEN** 主会话主理人正在运行且右侧栏打开一个可推进的子任务
- **WHEN** 主会话显示发送、停止和待发射状态
- **THEN** 主 composer 使用 dashboard 主布局并保持既有控制语义
- **AND** 右侧子任务 composer 继续使用 embedded 可用宽度和原有密度
