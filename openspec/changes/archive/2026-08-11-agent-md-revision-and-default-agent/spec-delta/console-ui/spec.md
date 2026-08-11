# console-ui delta：agent-md-revision-and-default-agent

## ADDED Requirements

### Requirement: Agent Markdown 编辑器呈现段落级变化标记与来历

Source: docs/product/pages/agent-teams.md#变化时间线
Source: docs/product/flows/agent-evolution.md#二看见变化与来历

`AGENT.md` 编辑器 MUST 接受一份变化标记输入（段落区间、作者种类、作者标签、时间、该段之前的文本），并在正文左侧对变动过的段落渲染标记。标记 MUST NOT 常驻显示作者与时间；MUST 在指针悬停或键盘聚焦该段落时才显形。点击标记 MUST 就地展开显示该段落之前的文本，MUST NOT 导航离开当前编辑器、MUST NOT 打开第二个界面。

组件 MUST NOT 渲染逐行增删对比、内容指纹或版本控制术语；变化的呈现单位是标记数据里给定的段落区间，组件本身 MUST NOT 自行对全文做二次分块或差异计算——分块和归属判断由调用方传入，编辑器只负责渲染。

编辑器容器 MUST 提供"最近变化"摘要行与展开入口；展开态渲染完整的成员级修订时间线（复用 `Requirement: Member revision timeline is a presentational list`），收起态只显示一行摘要。

标记样式 MUST 使用既有语义令牌（`border-line` / `bg-accent` 等），MUST NOT 引入裸 hex 或新增未登记的颜色语义。

#### Scenario: 标记默认不抢注意力，悬停才显形

- **GIVEN** 编辑器渲染了两个段落的变化标记
- **WHEN** 用户没有悬停或聚焦任何标记段落
- **THEN** 作者与时间文本不可见，只有色条可见
- **WHEN** 用户悬停其中一个标记段落
- **THEN** 该段落的作者与时间显形，其余标记不受影响。

#### Scenario: 点击标记就地展开，不导航

- **GIVEN** 一个标记段落带有"之前的文本"
- **WHEN** 用户点击该标记
- **THEN** 之前的文本在原位展开显示
- **AND** 编辑器焦点、滚动位置和当前草稿内容不因此改变
- **AND** 没有发生路由跳转或弹出独立对话框。

### Requirement: Member revision timeline is a presentational list

Source: docs/product/pages/agent-teams.md#变化时间线

时间线组件 MUST 按时间倒序渲染修订列表，每条只包含一句摘要、作者标签和相对时间；组件 MUST NOT 渲染内容指纹、保存时刻的技术细节或逐行对比。每条修订（除最早一条外）MUST 提供"回到这一版"操作，点击后组件 MUST 只调用传入的回调并把目标修订 id 交给调用方，MUST NOT 自行判断回退是否成功或修改本地状态。

组件 MUST 处理摘要未就绪（`pending`）与摘要不可用（`unavailable`）两种状态，分别渲染为等待中占位与中性说明文案，MUST NOT 把两者混淆展示，MUST NOT 编造摘要文本。

#### Scenario: 摘要未就绪时显示占位而非空白

- **GIVEN** 一条修订的摘要状态为 `pending`
- **WHEN** 时间线渲染这条修订
- **THEN** 显示中性的"生成中"占位文案
- **AND** 不显示空字符串或加载失败提示。

#### Scenario: 回到这一版只触发回调

- **GIVEN** 时间线渲染了三条修订
- **WHEN** 用户点击中间一条的"回到这一版"
- **THEN** 组件调用 `onRestore` 并传入该条修订的 id
- **AND** 组件本身不改变已渲染的列表顺序或内容，直到调用方传入新的 props。

### Requirement: 默认 Agent 设置复用共享运行配置选择器

Source: docs/product/pages/settings.md#默认-agent

设置弹窗的默认 Agent 设置组 MUST 使用与团队成员运行配置相同的共享选择器组件（CLI / Provider / 模型 / 思考程度），选项范围、静态校验与旧值保留规则 MUST 与团队页保持完全一致，MUST NOT 实现第二套平行的选择控件。当前生效值缺失已保存选择时，MUST 显示调用方提供的内置推荐值，MUST NOT 显示为空白或"未设置"。

#### Scenario: 默认 Agent 与团队成员共用同一套选项

- **GIVEN** 团队成员运行配置选择器提供的 CLI 列表和某个 CLI 下的 model/effort 联动规则
- **WHEN** 设置页渲染默认 Agent 选择器
- **THEN** 可选项范围、切换 CLI 后的兼容默认组合与旧版自定义值展示规则与团队页完全一致
- **AND** 两处不存在任何字段级别的呈现差异。
