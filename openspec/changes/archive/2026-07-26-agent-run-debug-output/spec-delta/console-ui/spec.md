# console-ui delta：agent-run-debug-output

## MODIFIED Requirements

### Requirement: 过程标签以分层调试调用链呈现一次 Agent 执行
Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 为每个 attempt 先显示完整运行状态、独立计时、开始 / 完成时间、model / effort / provider / CLI 和原始 run / thread 标识，再提供 `SYSTEM_PROMPT`、`DEVELOPER_PROMPT`、`USER_INPUT` 三个分层 disclosure，最后按时间顺序显示调用与输出事件。系统 MUST 常驻提示该本地调试视图可能包含提示词、路径与内部标识。系统 MUST NOT 把三层 prompt 拼成一个无来源文本块。

#### Scenario: 用户展开一次 completed run
- GIVEN 过程响应包含完整 attempt 元数据和三层 prompt
- WHEN 用户打开该成员的完整输出并展开三层
- THEN 页面显示模型、精确开始 / 完成时间和 completed
- AND 三层分别显示自己的原文
- AND 页面常驻显示本地原始调试信息提示

### Requirement: 调试事件显示原始字段且安全只读
Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 为调用与输出事件显示精确 ISO 时间戳、原始协议类型、call id、name 和 status，并让原始参数、结果、Agent 输出与 raw payload 可展开查看。绝对路径和内部标识 MUST 保持原值；终端控制字符 MUST 转为可见转义；所有原始内容 MUST 作为只读文本渲染，MUST NOT 作为 Markdown、HTML、脚本或终端控制序列执行。

#### Scenario: 原始工具输出含 HTML、控制字符和内部路径
- GIVEN 工具输出包含 `<script>bad()</script>`、ESC 控制字符与完整绝对路径
- WHEN 用户展开原始输出
- THEN script 以文本可见且没有执行
- AND ESC 以可见转义显示
- AND 绝对路径未被省略或替换

### Requirement: token 统计进入调试链但 reasoning 不显示
Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 将 token usage 作为独立调试事件显示原始协议类型与实际存在的 input / cached input / output / reasoning output / total 统计，MUST NOT 显示 reasoning 文本或 encrypted reasoning payload。

#### Scenario: token 与 reasoning 同时存在
- GIVEN 一次执行的 rollout 同时记录 token usage 与 reasoning
- WHEN 用户查看该次执行的调用链
- THEN 页面显示 token 统计
- AND 页面中找不到 reasoning 文本或 encrypted payload

### Requirement: 长调试内容默认折叠且不截断
Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 让长 prompt、参数、结果、raw payload 与 Agent 原始输出默认折叠；展开后 MUST 能从首行读到末行并允许选择复制。系统 MUST 继续以虚拟列表保持大型事件流的有界 DOM，MUST NOT 因 disclosure 把全部历史事件同时挂载。

#### Scenario: 一千条事件包含超长输出
- GIVEN 一个 attempt 有 1,000 条事件且其中一条输出超过 20 行
- WHEN 过程标签首次渲染
- THEN 长输出正文默认不可见
- AND 事件 DOM 数量保持有界
- WHEN 用户展开长输出
- THEN 首行、中间行和末行均可见

### Requirement: prompt 惰性加载抵抗重渲染、慢返回与失败
Source: docs/product/pages/main-right-sidebar.md#内容更新

系统 MUST 按 `sessionId + runId` 隔离 prompt stack 的 idle / loading / ready / unavailable / error 状态。父级重渲染或 load callback 身份变化 MUST NOT 清空已经加载的 prompt；切换 attempt、tab 或 session 后迟到的旧响应 MUST NOT 覆盖当前目标；加载失败 MUST 提供局部重试且过程事件仍可阅读。

#### Scenario: 慢请求期间切换到另一会话
- GIVEN attempt A 的 prompt 请求尚未返回
- WHEN 用户切换到会话 B 并展开 attempt B
- AND attempt A 的响应随后到达
- THEN 页面仍显示 attempt B 的状态与内容
- AND attempt A 的内容没有写入 B

#### Scenario: 父级回调身份变化后请求成功
- GIVEN prompt 正在加载且父级重渲染产生新的 load callback 身份
- WHEN 原请求成功返回
- THEN 目标 attempt 进入 ready 且内容只保存一次
- AND 不因 callback 变化重新进入 loading 或重复请求

#### Scenario: prompt 加载失败后重试
- GIVEN prompt 请求失败但过程事件已成功加载
- WHEN 页面显示局部错误
- THEN 调用与输出事件仍可阅读
- WHEN 用户点击重试且下一次请求成功
- THEN 三层 prompt 正常显示且事件阅读位置不变

### Requirement: 同一步多 attempt 各自保留调试事实
Source: docs/product/pages/main-right-sidebar.md#过程标签

系统 MUST 在同一过程标签内按开始顺序显示全部 attempts，并让每个 attempt 使用自己的 prompt stack、模型元数据、状态、时间和事件。单次 rollout 或 prompt stack 不可用 MUST 只降级该 attempt，MUST NOT 清空同一步其他 attempts。

#### Scenario: 三次执行中第二次记录不可用
- GIVEN 同一步有 failed、unavailable、completed 三次执行
- WHEN 用户打开该过程标签
- THEN 第一次与第三次分别显示自己的 prompt、模型、状态和事件
- AND 第二次原位显示记录不可用
- AND 标签整体不降级为空
