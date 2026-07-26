# console-ui spec delta

### Requirement: 会话目录轨以左侧锚点呈现连续轨迹动效

Source: docs/product/pages/main-conversation.md#会话目录轨

系统 MUST 让收起态短横线保持共同左端基线，并在展开时从同一左侧锚点向右打开面板。短横线 MUST 从左端收束，事件节点 MUST 横向进入对应成员泳道，相邻 Git graph 曲线 MUST 随展开逐段绘入。系统 MUST NOT 采用居中膨胀、左右同时生长或邻近事件金字塔作为目录轨动效。

#### Scenario: 从收起目录展开多泳道

- GIVEN 当前主会话目录轨处于收起态
- WHEN 用户悬停或键盘聚焦任一真实事件行
- THEN 所有收起横线的左端位置保持不变
- AND 面板、节点与相邻曲线从左向右连续呈现
- AND 正文、标题与输入框的布局位置不变

### Requirement: 目录预览连续跟随检查事件且尊重 reduced motion

Source: docs/product/pages/main-conversation.md#会话目录轨

系统 MUST 让预览卡相对展开面板保持固定 side offset，并在检查事件变化时沿事件行纵向连续跟随，内容 MUST 使用短促淡换。`prefers-reduced-motion: reduce` 命中时，系统 MUST 取消面板、横线、节点、曲线、锚点和内容的位移、绘制及淡换时序，以即时静态切换提供等价信息。

#### Scenario: 从最左泳道切换到最右泳道

- GIVEN 多泳道目录已展开且预览最左泳道事件
- WHEN 指针移动到最右泳道事件所在的整行
- THEN 预览只沿纵向跟随新事件
- AND 卡片与展开面板的横向间距保持不变

#### Scenario: 用户要求减少动态效果

- GIVEN 系统匹配 `prefers-reduced-motion: reduce`
- WHEN 目录轨展开并切换检查事件
- THEN 节点、曲线和预览立即进入目标状态
- AND 轨迹顺序、当前节点、预览内容和定位能力与标准模式等价
