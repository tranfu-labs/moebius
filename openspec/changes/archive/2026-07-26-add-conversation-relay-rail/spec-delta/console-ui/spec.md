# console-ui delta：add-conversation-relay-rail

## Requirement: 当前主会话拥有固定目录轨
Source: docs/product/pages/main-conversation.md#会话目录轨

系统 MUST 仅在当前打开的根会话正文列左侧显示一条固定目录轨；项目 / 会话侧栏 MUST NOT 为各会话行绘制消息目录。收起态 MUST 以身份色短横线投影每条用户消息和 Agent 可见最终回复，系统事实、运行占位、子会话卡片与工具过程 MUST NOT 形成目录事件。

### Scenario: 打开包含多成员回复的根会话
- GIVEN 当前根会话存在用户消息、Agent 回复、系统事实与子会话卡片
- WHEN 主会话页面完成渲染
- THEN 正文左侧只为用户消息和 Agent 回复显示目录行
- AND 会话侧栏各行保持原有导航密度且没有目录轨

## Requirement: 展开轨迹使用整行命中与相邻 Git graph 曲线
Source: docs/product/pages/main-conversation.md#会话目录轨

系统 MUST 在目录悬停或键盘聚焦后，以覆盖层展开同一批事件；每条真实事件的整行 MUST 成为同一节点的悬停、聚焦和激活区域。用户消息 MUST 显示为菱形，Agent 回复 MUST 显示为圆点，相邻两个可见真实事件之间 MUST 使用与首次引导接力图同类的三次贝塞尔曲线。系统 MUST NOT 使用直角折线、跨省略区连线、贯穿多行的成员竖线或仅节点大小的命中区。

### Scenario: 最左与最右泳道分别被悬停
- GIVEN 展开轨迹同时存在最左用户节点和最右 Agent 节点
- WHEN 用户分别把指针放到两条事件行的任意横向位置
- THEN 两行都命中各自唯一节点并显示对应预览
- AND 预览卡与展开面板的横向间距相同

### Scenario: 可见事件之间存在折叠区
- GIVEN 两个可见事件之间有一个省略行
- WHEN 轨迹展开
- THEN 省略区两侧不绘制一条跨区直接连接

## Requirement: 节点预览模板与面板锚点保持稳定
Source: docs/product/pages/main-conversation.md#会话目录轨

系统 MUST 让预览卡相对整个展开轨迹面板保持固定 side offset；窗口碰撞时 MAY 整卡翻转，但 MUST NOT 按节点泳道位置改变偏移。Agent 事件预览 MUST 只显示成员可读名称、时间和原回复开头；用户事件预览 MUST 显示“你”、时间和用户原文开头。系统 MUST NOT 在 Agent 预览顶部重复显示关联用户消息、内部 slug 或生成摘要。

### Scenario: 预览一个专业成员回复
- GIVEN 某 Agent 回复位于最右泳道且拥有自定义可读名称
- WHEN 用户悬停该事件行
- THEN 卡片显示自定义名称、时间和回复原文开头
- AND 卡片不显示关联用户消息标题或 `@slug`

## Requirement: 长会话目录围绕阅读焦点折叠并可精确定位
Source: docs/product/pages/main-conversation.md#会话目录轨

系统 MUST 按主时间线可用视口与 20px 固定事件行计算容量；超出容量时 MUST 围绕当前阅读消息保留连续窗口并尽量保留首尾边界，远端区间以省略行表示。目录滚轮与方向键浏览 MUST NOT 移动主时间线，只有点击、Enter 或 Space 激活真实事件后才 MUST 将原消息定位到阅读区并短暂突出。定位失败 MUST 保持原阅读位置。

### Scenario: 阅读长会话中段
- GIVEN 会话事件数超过当前视口容量且阅读焦点位于中段
- WHEN 目录渲染并用方向键移动浏览游标
- THEN 焦点两侧远端区间分别折叠且主时间线位置不变
- WHEN 用户按 Enter 激活浏览事件
- THEN 对应原消息进入阅读区并短暂突出

## Requirement: 根会话恢复各自最后阅读消息
Source: docs/product/pages/main-conversation.md#会话目录轨

系统 MUST 为每个根会话尽力保存最后阅读 message id，并在切换返回后只恢复一次。用户正在阅读历史时，新消息与 state 刷新 MUST NOT 强制跳底；用户位于底部时 MUST 继续跟随最新消息。从未打开、存储损坏或锚点失效的会话 MUST 安全聚焦最新稳定事件。

### Scenario: 两个会话停在不同阅读位置
- GIVEN 用户分别在两个根会话停留于不同消息
- WHEN 用户在两者之间切换并返回
- THEN 各会话恢复自己的消息锚点
- AND 期间新增回复不把正在阅读历史的会话强制移到底部
