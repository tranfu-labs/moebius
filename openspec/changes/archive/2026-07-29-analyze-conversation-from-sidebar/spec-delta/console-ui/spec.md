# console-ui delta：analyze-conversation-from-sidebar

## MODIFIED Requirements

### Requirement: 消息与对话分析入口使用同一生产会话组合
Source: docs/product/flows/session-analysis.md#1-从来源消息或对话开始分析

系统 MUST 在符合条件的 Agent 消息菜单提供「在右侧栏分析这条消息」，并在左侧栏对话菜单提供「在右侧栏分析这段对话」。每个对象的鼠标右键、可聚焦菜单按钮与键盘上下文操作 MUST 打开同一菜单并绑定同一消息或对话，菜单关闭后 MUST 把焦点返回对应对象或其菜单按钮。

两种入口 MUST 打开同一个右侧栏普通新对话组合，使用相同布局、候选问题、草稿归并、发送和后续对话行为，MUST NOT 创建分析专用页面或第二套草稿。入口对象只允许改变追加的静态文本片段。

#### Scenario: 两种菜单进入同一页面

- GIVEN 一条可分析的 Agent 消息和一段记录可用的对话
- WHEN 用户分别从消息菜单和对话菜单触发分析
- THEN 两次结果使用同一个右侧栏新对话生产组合与相同候选问题
- AND 消息级与对话级结果只在文本片段内容上不同

#### Scenario: 三种菜单打开方式绑定同一对象

- GIVEN 用户聚焦一条可分析消息或对话行
- WHEN 用户分别使用右键、菜单按钮和键盘上下文操作
- THEN 三种方式打开同一组菜单项并绑定同一来源对象
- AND 菜单关闭后焦点回到该对象或其菜单按钮

### Requirement: 对话分析项按记录可用性禁用
Source: docs/product/pages/main-left-sidebar.md#在右侧栏分析这段对话

对话正在运行、存在未读结果、当前未选中或所属项目目录不可用时，系统 MUST 在记录路径仍可取得的前提下保持「在右侧栏分析这段对话」可用。记录路径不可用时，系统 MUST 禁用该项，通过鼠标悬停与辅助技术提供「对话记录不可用，暂时无法分析」的可读原因，并 MUST NOT 打开没有来源片段的草稿。

#### Scenario: 项目目录不可用不阻止分析

- GIVEN 对话所属项目目录不可用但对话记录路径可取得
- WHEN 用户打开该对话菜单
- THEN 分析项保持可用

#### Scenario: 记录不可用时禁用

- GIVEN 对话记录路径不可取得
- WHEN 用户打开该对话菜单并悬停分析项
- THEN 分析项不可选择，鼠标用户看到禁用原因且辅助技术可读取同一原因
- AND 不创建或打开分析草稿

### Requirement: SessionAnalysis Page Story 展示真实入口
Source: docs/product/pages/main-right-sidebar.md#新会话与已有会话标签

`Page/Console/SessionAnalysis` MUST 使用确定性 fixture、fullscreen 布局与真实生产导出展示消息级和对话级菜单、启用与禁用状态、非当前对话切换结果以及两种入口的片段差异。分析草稿标签 MUST 显示「新对话」并与真实应用一致；Story MUST NOT 复制平行菜单或连接真实 IPC、文件系统和用户数据。

#### Scenario: Page Story 可机械比较两类片段

- WHEN 打开 SessionAnalysis 的入口对比 Story
- THEN 消息级片段包含精确外部执行信息或「未建立」
- AND 对话级片段只包含 Moebius 会话记录路径
- AND 两者使用标题为「新对话」的相同右侧栏布局与候选问题
