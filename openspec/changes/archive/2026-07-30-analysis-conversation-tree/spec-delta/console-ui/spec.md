# console-ui delta：analysis-conversation-tree

## Requirement: 分析面板只展示直接分析子项入口
Source: docs/product/pages/main-conversation.md#分析对话入口面板规则

分析面板 MUST 支持关闭、空、加载、失败和直接子项列表状态；列表项 MUST 只触发打开或聚焦会话，不得承载摘要、运行状态、详情、输入或管理动作。

### Scenario: 多层分析关系

- Given 当前对话 A 的直接子项为 B，B 的直接子项为 C
- When 渲染 A 的分析面板
- Then 面板显示 B
- And 不显示 C、不缩进、不画树

### Scenario: 长列表

- Given 直接子项超过面板可用高度
- When 用户滚动面板
- Then 仅面板列表滚动
- And 所在对话时间线阅读位置不变

## Requirement: 根对话与分析对话复用同一面板组件
Source: docs/product/pages/main-conversation.md#分析对话入口面板规则

根对话的面板 MUST 锚定主内容右上角；右侧栏分析对话的面板 MUST 锚定该标签内容右上角。窄内容区 MUST 使用不改变正文宽度的覆盖布局。

### Scenario: 右侧栏分析对话打开自己的面板

- Given 分析对话显示在外层右侧栏标签
- When 用户激活其标题区分析面板开关
- Then 面板出现在该标签的内容区域
- And 外层右侧栏不新增嵌套层

## Requirement: 分析面板交互可访问
Source: docs/product/pages/main-conversation.md#分析对话入口面板规则

面板开关 MUST 暴露可访问名称与展开状态；入口 MUST 可键盘聚焦激活并使用完整标题；关闭面板与成功导航 MUST 遵守规定焦点去向。

### Scenario: 键盘关闭面板

- Given 键盘焦点在打开的面板内
- When 用户关闭面板
- Then 焦点返回控制该面板的开关

### Scenario: 入口打开失败

- Given 目标会话不可用
- When 用户激活入口
- Then 焦点保持原入口
- And 显示可被辅助技术读取的失败原因

## Requirement: `moebius-ref:` 作为受控应用内链接渲染
Source: docs/product/pages/main-conversation.md#右侧栏中的分析新会话

合法 `moebius-ref:` Markdown link MUST 渲染为应用内导航；未知自定义协议、非法目标以及代码、HTML、图片地址或裸文本中的协议样式 MUST NOT 获得导航能力。

### Scenario: 合法消息引用

- Given 用户消息包含合法且可访问的消息引用链接
- When 渲染消息并激活链接
- Then 发出消息导航 intent
- And 不调用系统外链能力

### Scenario: 不可用引用

- Given 链接语法非法或目标不可访问
- When 渲染消息
- Then 保留可读标签并说明来源不可用
- And 不允许激活为应用内或外部链接
