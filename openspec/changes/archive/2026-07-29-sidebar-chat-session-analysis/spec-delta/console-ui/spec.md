# console-ui delta：sidebar chat 与会话分析入口

## ADDED Requirements

## Requirement: 右侧栏承载普通会话且不复制会话布局
Source: docs/product/pages/main-right-sidebar.md#新会话与已有会话标签

右侧栏 MUST 支持未发送普通新会话和已创建普通会话标签。主内容与右侧会话 MUST 复用同一生产会话组合的标题、时间线、运行记录、composer、普通附件、团队切换与恢复行为。系统 MUST NOT 增加分析专用布局、嵌套第二层右侧栏或让右侧会话内部自己持有 evidence 标签工作区。

### Scenario: 首次发送原地成为已有会话
- GIVEN 右侧栏当前标签承载一个有效未发送会话草稿
- WHEN 首条消息创建成功
- THEN 同一标签原地显示普通已有会话
- AND 左侧栏出现该普通用户会话
- AND 完整输出、文件与子任务在当前外层标签条打开兄弟标签。

### Scenario: 手动 sidebar chat 没有分析闸门
- GIVEN 用户从右侧栏内容选择手动创建普通新会话
- WHEN 用户保留「通用助手」并发送
- THEN 页面按普通会话运行
- AND 不因团队身份显示或执行方案确认闸门。

## Requirement: 分析入口只增加静态文本片段与候选问题
Source: docs/product/pages/main-conversation.md#分析当前对话入口

活动 run、成功 Agent 历史回复和结构化异常终态 MUST 提供一致、键盘可达的「分析当前对话」菜单项。入口选定的草稿 MUST 使用普通新会话页面，只在普通附件区域增加可删除文本胶囊，并在空态增加候选问题。文本胶囊 MUST 显示短标签，通过 hover 与键盘焦点提供完整静态文本；候选问题 MUST 只把对应提示词写入正文。

### Scenario: 同一草稿追加片段
- GIVEN 流程控制器返回一份可归并未发送草稿
- WHEN 用户从另一个时间线位置再次触发入口
- THEN 页面聚焦同一右侧标签
- AND 在现有片段后追加一个可独立删除的文本胶囊
- AND 不修改正文、上下文或普通附件。

### Scenario: 首次发送后零专用布局
- GIVEN 分析入口创建的草稿首次发送成功
- WHEN 页面显示已创建会话
- THEN 候选问题消失
- AND 会话使用普通已有会话的全部布局
- AND 已发送片段在首条用户消息中保持短标签与完整详情。

## Requirement: 零标签关闭右侧栏并恢复内容选择
Source: docs/product/pages/main-right-sidebar.md#标签全部关闭

关闭最后一个标签 MUST 同时关闭右侧栏并留下零标签状态，MUST NOT 自动创建、高亮或保留「新标签」。用户之后显示右侧栏时 MUST 先看到无标签内容选择；只有选择类型后才创建标签。

### Scenario: 关闭最后一个标签
- GIVEN 右侧栏只有一个可关闭标签
- WHEN 用户完成关闭或草稿丢弃裁决
- THEN 标签数为零
- AND 右侧栏关闭
- AND 焦点回到主内容显示按钮。

## Requirement: sidebar chat 组合路由区分选中与承载会话
Source: docs/product/pages/main-left-sidebar.md#选择对话

左侧栏 MUST 把已创建 sidebar chat 作为最终项目下的普通用户会话呈现。来源可用时，页面 MUST 只高亮 sidebar chat 行，同时在主内容显示来源并在右侧栏显示 sidebar chat；来源不可用时 MUST 在主内容显示 sidebar chat。两段会话的状态点、阅读位置和草稿 MUST 独立。

### Scenario: 来源可用时找回
- GIVEN sidebar chat B 的来源 A 仍可承载主内容
- WHEN 用户激活 B 的左侧栏行
- THEN 只有 B 行处于选中态
- AND 主内容显示 A
- AND 右侧栏显示并聚焦 B。

### Scenario: 已打开后来源失效
- GIVEN 页面正在显示来源 A 与右侧 B
- WHEN A 变为不可承载且 B 仍可用
- THEN B 成功迁移到主内容后才删除旧来源标签
- AND B 的阅读位置、草稿、运行状态与选中态保持。

## Requirement: 搜索结果与当前查询条件一致
Source: docs/product/pages/search.md#操作与反馈

搜索 MUST 至少按完整标题执行 trim、Unicode NFKC、lowercase 后的非空包含匹配。空查询 MUST 保持中性初始状态。页面显示的加载、结果和错误 MUST 只属于当前输入与归档范围对应的最近搜索；已失效搜索不得覆盖状态或阻塞新搜索。输入法组合期间 Enter MUST NOT提交搜索。

### Scenario: 晚到旧结果被隔离
- GIVEN 查询 A 仍在执行
- WHEN 用户改成查询 B 并提交，随后 A 晚到
- THEN 页面输入、范围、加载、结果与错误只反映 B
- AND A 不禁用 B 的提交入口。

### Scenario: 归档结果恢复并打开
- GIVEN 搜索结果是一段仍属于活动项目的归档 sidebar chat
- WHEN 用户激活唯一「恢复并打开」动作
- THEN 会话只恢复一次
- AND 来源可用时走组合路由
- AND 来源不可用时在主内容打开并显示降级说明。

## Requirement: 所有合法团队重名状态可辨认
Source: docs/product/pages/main-conversation.md#选择工作空间与团队

新对话、sidebar chat 和已有会话的团队选择控件 MUST 让所有合法重名团队通过稳定、用户可读且不含内部 key、路径或临时序号的信息辨认。可见文本与辅助名称 MUST 使用同一辨认信息。

### Scenario: 同名用户团队
- GIVEN 两支用户团队显示名称相同
- WHEN 用户展开或收起团队选择控件
- THEN 选项与当前值使用稳定本地创建时间区分
- AND 辅助名称提供相同上下文。
