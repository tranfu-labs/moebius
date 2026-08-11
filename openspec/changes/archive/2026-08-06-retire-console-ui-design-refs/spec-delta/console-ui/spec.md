# console-ui delta：retire-console-ui-design-refs

## MODIFIED Requirements

### Requirement: 验收 #17 加号只创建两类可选内容

Source: docs/product/pages/main-right-sidebar.md#空白标签与类型选择

系统 MUST 让加号创建一个不参与去重的空白标签，并在 Git 项目中提供“新会话”“改动”和“项目文件”三种选择。系统 MUST NOT 在类型选择中出现过程、子任务、终端、预览或浏览器。没有“新会话”类型时，生产类型与既有普通会话行为仍 MUST 保留。

（原句「参考 HTML 未包含“新会话”时」以静态设计稿为条件；设计稿已退役，改写为直接行为陈述。）

### Requirement: 左侧栏与主会话非品牌图标按宿主盒统一对齐

Source: docs/product/pages/main-left-sidebar.md#响应式与窗口行为；docs/product/pages/main-conversation.md#页面结构

系统 MUST 让左侧栏与主会话内除品牌 Logo 外的 Lucide 图标在既有按钮或文本行宿主中自然居中。具有相同视觉角色与密度的图标 MUST 保持一致的视觉重量；系统 MUST NOT 通过单枚图标的 `top`、额外上内边距或位移补偿对齐，也 MUST NOT 为校正图形而缩小既有按钮宿主。图标出现、消失、hover、focus、展开、折叠或状态切换 MUST NOT 改变同层文字的基线或横向起点。该规则 MUST NOT 自动应用到品牌 Logo 或右侧栏内部。

#### Scenario: 生产侧栏与主会话图标按宿主盒对齐

- **GIVEN** 生产侧栏与主会话显示 shell、导航、项目/会话操作、消息/活动工具、子会话、状态、上下文和 Composer 代表状态
- **WHEN** 检查这些图标与其宿主
- **THEN** 具有相同视觉角色与密度的图标使用相符的图形尺寸、描边和自然居中方式
- **AND** 单行图标中心与宿主行或按钮中心的垂直差不超过 0.5px
- **AND** 图标与文字基线自然，同一行相邻按钮视觉重量一致
- **AND** 其他已经自然对齐且视觉重量一致的生产图标保持既有尺寸和布局

（原 Scenario「参考页与生产页的对应图标几何一致」以 `dashboard.html` 参考页为对照物；参考页已退役，改写为生产内部一致性断言，THEN 的几何判据不变。）
