# console-ui 规格增量

## ADDED Requirements

### Requirement: Agent 表单卡片是受控呈现层

Source: docs/product/pages/agent-form.md#入口与去向

`console-ui` MUST 提供 Agent 表单卡片组件，它只接收表单定义与作答草稿并通过回调交还变更；组件 MUST NOT 自行持久化答案、判断表单何时出现、或替换上一份表单。草稿的 `formId` 与表单定义的 id 不一致时，组件 MUST 按新表单从第一题开始渲染，MUST NOT 显示上一份表单的答案。

#### Scenario: 宿主换了表单但没换草稿

- **GIVEN** 卡片正显示一份答到第三题的表单
- **WHEN** 宿主传入另一份表单定义、草稿仍是上一份的
- **THEN** 卡片停在第一题且没有任何预填答案

### Requirement: 表单规模超限时不可渲染

Source: docs/product/pages/agent-form.md#表单规模

`console-ui` MUST 提供纯函数判定一份表单定义是否可渲染：题数 MUST 在 1 到 4 之间，每道选择题的预设选项 MUST 在 1 到 4 之间，题目标题与选项标题 MUST 非空。判定 MUST 只返回可否渲染，MUST NOT 抛错，也 MUST NOT 产生任何面向用户的解释文案。

#### Scenario: 五题的表单

- **GIVEN** 一份 5 题的表单定义
- **WHEN** 宿主调用可渲染判定
- **THEN** 判定为不可渲染，且没有异常抛出

#### Scenario: 某题写了四个预设选项

- **GIVEN** 一份 2 题的表单，其中一题带 4 个预设选项
- **WHEN** 宿主调用可渲染判定
- **THEN** 判定为可渲染

#### Scenario: 某题写了五个预设选项

- **GIVEN** 一份 2 题的表单，其中一题带 5 个预设选项
- **WHEN** 宿主调用可渲染判定
- **THEN** 判定为不可渲染

### Requirement: 选择题末尾固定补一个「自己写」项

Source: docs/product/pages/agent-form.md#三种作答区

单选题与多选题 MUST 在 Agent 写的预设选项之后渲染一个「自己写」输入项，该项 MUST NOT 来自表单定义。它的选中态 MUST 由输入内容派生：写进字即选中，清空即未选中，MUST NOT 提供独立的勾选控件。单选题里「自己写」有内容时，预设选中项 MUST 被让出；多选题里「自己写」与预设项 MUST 可同时选中。

#### Scenario: Agent 只写了一个预设选项

- **GIVEN** 一道只有 1 个预设选项的单选题
- **WHEN** 卡片渲染该题
- **THEN** 作答区共两项：那个预设选项与「自己写」输入项

#### Scenario: 单选题里改写自己的答案

- **GIVEN** 一道单选题已选中某个预设选项
- **WHEN** 用户在「自己写」里输入内容
- **THEN** 预设选项不再选中，该题在进度上仍为已答
- **AND** 用户清空输入后该题回到未答

### Requirement: 进度只在多题时出现且每格可跳转

Source: docs/product/pages/agent-form.md#页面状态

题数大于 1 时，卡片 MUST 显示 `{current}/{total}` 与逐题进度格，每格 MUST 可点击直接跳到该题，且 MUST 以可访问名称区分已答与未答。题数等于 1 时 MUST NOT 渲染进度。跳回已答的题 MUST 原样带回答案，继续前进 MUST NOT 清空后面已答的题。

#### Scenario: 从第三题跳回第一题

- **GIVEN** 一份 3 题的表单，前两题已答，用户停在第三题
- **WHEN** 用户点击进度的第一格并改掉第一题的答案，再回到第三题
- **THEN** 第一题显示改后的答案，第二题的答案没有被清空

#### Scenario: 只有一题的表单

- **GIVEN** 一份只有 1 题的表单
- **WHEN** 卡片渲染
- **THEN** 没有进度，导航行右侧只有发送

### Requirement: 导航行前进不设门槛，发送只挡全空

Source: docs/product/pages/agent-form.md#操作与反馈

「下一步」MUST 始终可点，MUST NOT 因当前题未答而禁用。第一题 MUST NOT 渲染「上一步」。「上一步」与「下一步」MUST 并排在导航行右侧。最后一题 MUST 以发送取代「下一步」。整份表单一题都没答时发送 MUST 禁用，并且 MUST NOT 渲染任何解释禁用原因的文字、可访问描述或悬停提示。

#### Scenario: 当前题未答时前进

- **GIVEN** 用户停在一道没有任何选中项的题上
- **WHEN** 用户点击「下一步」
- **THEN** 卡片进入下一题，该题在进度上保持未答

#### Scenario: 一题都没答

- **GIVEN** 一份表单的每一题都为空且用户停在最后一题
- **WHEN** 卡片渲染导航行
- **THEN** 发送为禁用态，且卡片内没有任何解释这条规则的文字或可访问描述

### Requirement: 发送消息按题序逐行组装且不含 description

Source: docs/product/pages/agent-form.md#发送

发送 MUST 产出一段按题目顺序逐行组装的纯文本，每行 MUST 是问题标题加该题答案。单选取选中项的 title，多选按表单原顺序取各选中项的 title，自由输入与「自己写」取用户原文；多选里「自己写」MUST 排在选中的预设项之后。跳过的题 MUST NOT 出现在消息里，任何选项的 description MUST NOT 进入消息。

#### Scenario: 混合题型并跳过一题

- **GIVEN** 一份 4 题的表单，用户答了单选、多选与自由输入并跳过其中一题
- **WHEN** 用户发送
- **THEN** 消息按题序有 3 行，多选那行按表单原顺序排列
- **AND** 消息里不含任何 description，也不含被跳过那题的标题

### Requirement: 表单卡片全键盘可完成

Source: docs/product/pages/agent-form.md#前进与回退

卡片 MUST 支持只用键盘完成一次作答并发送。Enter MUST 在非文本输入处前进或发送；自由输入题与「自己写」输入项上 Enter MUST 是换行，Cmd 或 Ctrl + Enter 才前进。

#### Scenario: 在「自己写」里换行

- **GIVEN** 焦点在「自己写」输入项上
- **WHEN** 用户按 Enter
- **THEN** 输入内容换行，卡片停在当前题

### Requirement: 表单卡片纵向溢出时内部滚动

Source: docs/product/pages/agent-form.md#响应式与窗口行为

卡片高度超出宿主给的可用高度时，MUST 只让题目区滚动，头部与导航行 MUST 保持可见。卡片 MUST NOT 自行设定宽度或以视口单位设定高度；宽度与可用高度 MUST 由宿主决定。选项的 title 与 description MUST NOT 被截断。

#### Scenario: 矮容器里的四题表单

- **GIVEN** 宿主把卡片放进一个高度不足以完整显示当前题的容器
- **WHEN** 卡片渲染
- **THEN** 进度与导航行仍然可见，题目区自身出现滚动

### Requirement: 操作台把表单排在用户自己的草稿之上

Source: docs/product/pages/agent-form.md#页面结构

操作台 MUST 在会话底部把 Agent 表单卡片渲染在待发射区、附件草稿与输入框之前，并与主时间线正文列同宽。表单定义判定为不可渲染时，操作台 MUST NOT 渲染卡片，也 MUST NOT 显示任何解释写法不合规的文案。

#### Scenario: 表单与已有附件草稿同时存在

- **GIVEN** 会话已有一个就绪的附件草稿，且本轮 Agent 发来一份合规表单
- **WHEN** 操作台渲染会话底部
- **THEN** 表单卡片在附件草稿与输入框之前，附件草稿没有被顶掉

#### Scenario: 超限表单到达操作台

- **GIVEN** 本轮表单有 5 题
- **WHEN** 操作台渲染会话底部
- **THEN** 输入框上方没有卡片，界面上也没有任何解释格式问题的文字

### Requirement: 题与题之间改变高度而不跳变

Source: docs/product/pages/agent-form.md#前进与回退

当前题变化导致卡片高度变化时，卡片 MUST 在一档标准时长内从变化前的高度过渡到变化后的高度，MUST 以变化发生那一刻的实际高度为起点（连续切题时不得从上一次的终态重来），并且 MUST 在 `prefers-reduced-motion: reduce` 下直接呈现终态。卡片 MUST NOT 对内容做位移、缩放或淡入。

#### Scenario: 从长题走到短题

- **GIVEN** 当前题的作答区明显高于下一题
- **WHEN** 用户点击「下一步」
- **THEN** 卡片高度连续收缩到新高度，导航行随之平移而不是瞬间跳位

#### Scenario: 收缩途中改跳到另一题

- **GIVEN** 卡片正在两个高度之间过渡
- **WHEN** 用户在过渡结束前点击进度里的另一格
- **THEN** 新的过渡从当前屏上高度继续，不出现回到起点或直接跳到终点的跳变
