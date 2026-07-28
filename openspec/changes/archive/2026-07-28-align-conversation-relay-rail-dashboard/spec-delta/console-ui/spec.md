# console-ui delta：align-conversation-relay-rail-dashboard

## MODIFIED Requirements

### Requirement: 当前主会话拥有固定目录轨

Source: docs/product/pages/main-conversation.md#会话目录轨

系统 MUST 仅在当前打开的根会话内、相对主会话左缘内缩 12px 显示固定目录轨；项目 / 会话侧栏 MUST NOT 为各会话行绘制消息目录。收起态 MUST 使用 44px 命中槽与 20px 事件行，以共同左端对齐的短横线投影每条用户消息和 Agent 可见最终回复：普通事件 MUST 为 `13 × 2px` 且七成不透明，当前阅读事件 MUST 为 `24 × 3px` 且完全不透明。用户事件 MUST 使用前景色，Agent 事件 MUST 使用对应身份色。系统事实、运行占位、子会话卡片与工具过程 MUST NOT 形成目录事件。

#### Scenario: 打开包含多成员回复的根会话

- **GIVEN** 当前根会话存在用户消息、多个 Agent 回复、系统事实与子会话卡片
- **WHEN** 主会话页面完成渲染
- **THEN** 主会话左缘内缩 12px 的 44px 槽内只为用户消息和 Agent 回复显示短横线
- **AND** 当前阅读事件比普通事件更长、更实
- **AND** 会话侧栏各行保持原有导航密度且没有目录轨

### Requirement: 展开轨迹使用整行命中与成员分支图

Source: docs/product/pages/main-conversation.md#会话目录轨

系统 MUST 在目录悬停或键盘聚焦后，以覆盖层展开同一批事件；每条真实事件的整行 MUST 成为同一节点的悬停、聚焦和激活区域。用户事件 MUST 位于 `x=14px` 的用户主干，Agent MUST 按首次出现顺序进入成员泳道；所有事件 MUST 显示为圆点，当前阅读事件 MUST 显示为作者色描边环。用户主干 MUST 贯穿每个连续可见区间，每名 Agent 的成员色分支 MUST 从其首个可见回复之前的事件节点平滑分叉、穿过该成员的可见回复，并在其末个可见回复之后平滑并回下一事件节点。系统 MUST NOT 使用直角折线、跨省略区连线、全宽等距散点或仅节点大小的命中区。

#### Scenario: 多成员往返会话展开

- **GIVEN** 可见事件顺序为用户、主 Agent、开发、主 Agent、测试、开发
- **WHEN** 用户展开目录轨
- **THEN** 用户事件位于固定主干，主 Agent、开发和测试按首次出现顺序占据各自泳道
- **AND** 每个成员分支从前一事件进入并在后一事件并回
- **AND** 最左与最右事件行的任意横向位置都命中各自唯一节点

#### Scenario: 可见事件之间存在折叠区

- **GIVEN** 两个可见事件之间有一个省略行
- **WHEN** 轨迹展开
- **THEN** 主干与成员分支在省略边界各自收束
- **AND** 省略区两侧不绘制一条跨区直接连接

### Requirement: 会话目录轨以左侧锚点呈现连续轨迹动效

Source: docs/product/pages/main-conversation.md#会话目录轨

系统 MUST 让收起态短横线保持共同左端基线，并在展开时从同一左侧锚点向右打开面板。正常可用高度下，事件行 MUST 从 20px 展开到 32px；短横线 MUST 从左端收束，节点 MUST 横向进入对应泳道，用户主干与成员分支 MUST 随展开绘入。面板 MUST 使用抬升中性底、1px 描边、8px 圆角、零阴影和位于轨迹下方的事件 hover 带。面板宽度 MUST 由实际成员泳道数决定：主干和右侧留白各 14px、成员泳道默认相隔 18px，成员过多时压缩间距，最终宽度 MUST NOT 超过 224px。系统 MUST NOT 按主会话宽度在 148–224px 之间无条件插值，也 MUST NOT 采用居中膨胀、左右同时生长或邻近事件金字塔。

#### Scenario: 从收起目录展开少量成员轨迹

- **GIVEN** 当前目录只有用户和一名 Agent
- **WHEN** 用户悬停或键盘聚焦任一真实事件行
- **THEN** 面板宽度只覆盖主干、该成员泳道与两侧留白
- **AND** 行高在正常窗口中展开到 32px，短横线收束、圆点进入泳道、分支图出现
- **AND** 正文、标题、输入框和主时间线滚动位置不变

#### Scenario: 多成员遇到窄主会话

- **GIVEN** 成员泳道按 18px 间距会超过主会话可用宽度
- **WHEN** 目录展开
- **THEN** 系统压缩泳道间距且面板不超过 224px
- **AND** 目录不迁入项目 / 会话侧栏，也不推动正文重排

### Requirement: 节点预览模板与面板锚点保持稳定

Source: docs/product/pages/main-conversation.md#会话目录轨

系统 MUST 让预览卡默认宽 240px、正文最多三行，并相对整个展开轨迹面板保持 12px side offset；窗口碰撞时 MAY 整卡翻转或约束宽度，但 MUST NOT 按节点泳道位置改变偏移。Agent 事件预览 MUST 只显示成员可读名称、时间和原回复开头；用户事件预览 MUST 显示“你”、时间和用户原文开头。系统 MUST NOT 在 Agent 预览顶部重复显示关联用户消息、内部 slug 或生成摘要。指针从面板跨入预览卡时 MUST 保持展开；只有离开面板与预览卡后才 MAY 延迟收起。

#### Scenario: 从最左泳道检查到最右泳道

- **GIVEN** 展开轨迹同时存在最左用户节点和最右 Agent 节点
- **WHEN** 用户分别检查两条事件行并把指针跨入预览卡
- **THEN** 两次预览都与面板保持 12px 横向间距
- **AND** 卡片只沿事件行纵向跟随且在指针进入时保持可见

### Requirement: 长会话目录围绕阅读焦点折叠并可精确定位

Source: docs/product/pages/main-conversation.md#会话目录轨

系统 MUST 按主时间线可用视口与最大 32px 展开事件行计算可见容量；超出容量时 MUST 围绕当前阅读消息保留连续窗口并尽量保留首尾边界，远端区间以省略行表示。可用高度不足时，展开事件行 MAY 在 32–20px 之间有界压缩，但目录面板 MUST NOT 越过主会话可用视口或 composer。目录滚轮与方向键浏览 MUST NOT 移动主时间线，只有点击、Enter 或 Space 激活真实事件后才 MUST 将原消息定位到阅读区并短暂突出。定位失败 MUST 保持原阅读位置。

#### Scenario: 矮窗口阅读长会话中段

- **GIVEN** 会话事件数超过按 32px 展开行高计算的容量且阅读焦点位于中段
- **WHEN** 目录展开并用方向键移动浏览游标
- **THEN** 面板留在可用视口内，焦点两侧远端区间分别折叠且主时间线位置不变
- **WHEN** 用户按 Enter 激活浏览事件
- **THEN** 对应原消息进入阅读区并短暂突出

## RENAMED Requirements

- FROM: `### Requirement: 展开轨迹使用整行命中与相邻 Git graph 曲线`
  TO: `### Requirement: 展开轨迹使用整行命中与成员分支图`
