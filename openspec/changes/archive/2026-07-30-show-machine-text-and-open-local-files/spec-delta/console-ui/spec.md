# console-ui delta：show-machine-text-and-open-local-files

## Requirement: #13 会话文本不再替换机器信息
Source: docs/product/pages/main-conversation.md#指标与验收

系统 MUST 在 Agent 正文、运行步骤标题与摘要、实时 Markdown、允许展示的终态说明和系统记录中保留输入原文的路径、`cwd`、`runDir`、数据库路径及内部 id。系统 MUST NOT 用机器信息、路径、内部标识或工作空间类型占位符替换这些文本，也 MUST NOT 因非空活动摘要包含机器信息而整条丢弃；活动摘要只有缺失或纯空白时才 MUST 使用 `console.runBlock.progress`。

终态说明 MUST 保留既有安全错误码资格门：只有被 runtime 分类为安全错误码的非空 `message.body` 才按原文进入 description；正文空白或错误未分类时 MUST 使用 RunOutcome 对应状态的既有默认说明。renderer 放开显示 MUST NOT 要求 runtime 把原始 stderr、路径或内部异常加入 `message.body`。

### Scenario: Agent 正文同时包含路径与自然语言机器词
- GIVEN Agent 正文包含 `/tmp/report.txt:2`、`runId=run-secret` 与 `Send a direct message before handoff.`
- WHEN 主时间线渲染该消息
- THEN 路径、run id、`direct` 与 `handoff` 均按原文可见
- AND 页面不存在任何“已隐藏”占位文案

### Scenario: 运行步骤包含路径
- GIVEN 活动 run 的步骤标题或摘要包含绝对路径、`cwd` 与内部 id
- WHEN RunBlock 渲染该步骤
- THEN 非空文本保持原值
- AND 缺失或纯空白摘要仍显示既有进度兜底

### Scenario: 活动摘要命中旧机器模式
- GIVEN 成员运行期间的活动摘要为 `正在写入 /tmp/report.txt，runId=run-secret`
- WHEN 主时间线渲染活动行
- THEN 活动行逐字显示该摘要
- AND 不显示 `console.runBlock.progress` 对应文案

### Scenario: 活动摘要为空白
- GIVEN 成员运行期间的活动摘要缺失或只有空白
- WHEN 主时间线渲染活动行
- THEN 活动行显示 `console.runBlock.progress` 对应文案

### Scenario: 安全终态说明与 runtime 边界
- GIVEN runtime 为受信任安全错误码提供非空用户可读 `message.body`
- WHEN RunOutcome 渲染该终态
- THEN description 按原文显示该 body
- WHEN body 为空白或错误码未分类
- THEN description 使用该状态既有默认说明
- AND renderer 不读取或拼接原始 stderr、路径或内部异常

## Requirement: 绝对路径成为应用内文件引用
Source: docs/product/pages/main-conversation.md#时间线

共享 Markdown renderer MUST 把语法有效的显式 Markdown 绝对 POSIX 文件目标、普通文本中的裸绝对 POSIX 路径及其可选 `:line[:column]` 解析为应用内文件引用，并在存在宿主回调时呈现为可点击控件。点击 MUST 只把规范化的 path、line、column 交给文件引用回调，MUST NOT 触发浏览器导航、外链确认或 `window.open`。内部动作身份 MUST 来自当前 renderer 实例在 Markdown AST 变换时登记的私有意图，MUST NOT 只凭正文可构造的 URL 或 hash 判定。

普通文本中的尾随句子标点 MUST 留在文件引用外；整个 inline code 恰好是文件目标时 MUST 保留代码视觉并可点击。已有 Markdown link、图片与 fenced code MUST NOT 被递归拆成嵌套文件引用，其中的路径文本仍 MUST 保持原文。任何正文 HTTPS URL 都仍是普通外链并走既有确认回调；图片、`file:`、`javascript:`、data 与自定义协议仍按既有边界阻断。

### Scenario: Agent 给出裸 `/tmp` 产物
- GIVEN Agent 正文包含 `产物位于 /tmp/moebius-report.txt:12:3，请查看。`
- WHEN 主时间线渲染并点击该裸路径
- THEN 页面保留完整路径文本与路径外的逗号
- AND 文件回调收到 path `/tmp/moebius-report.txt`、line `12`、column `3`
- AND 不触发外链确认

### Scenario: Inline code 与代码块保持各自语义
- GIVEN 正文包含 inline code `` `/tmp/report.txt:2` `` 和 fenced code 中的 `/tmp/example.txt`
- WHEN Markdown 渲染
- THEN inline code 保持代码视觉并可触发 path `/tmp/report.txt`、line `2` 的文件回调
- AND fenced code 原文可见但不生成文件回调

### Scenario: 显式文件链接与成员 mention 回归
- GIVEN 正文同时包含显式绝对文件链接、裸绝对路径、已知成员 mention 与 HTTPS 外链
- WHEN 用户依次点击四种目标
- THEN 两种文件目标进入文件回调、mention 进入成员回调、HTTPS 进入外链确认
- AND 四种 intent 不互相冒充或覆盖

### Scenario: 危险协议不提升为文件引用
- GIVEN 正文包含 `file:///tmp/a`、`javascript:`、data image 与自定义协议
- WHEN Markdown 渲染并发生点击
- THEN 这些目标不能导航或进入文件回调

## Requirement: #22 一轮结束留下结果卡片
Source: docs/product/pages/main-conversation.md#区域与信息

系统 MUST 在没有任何成员在工作且没有待处理交棒时，于时间线末尾展示结果卡片，说明这段对话期间有几个文件发生改动并提供一步打开改动内容的入口；右侧栏正式形态已就绪，该入口 MUST 打开或聚焦右侧栏对应的“改动”标签；没有文件改动时 MUST 如实说明；项目文件夹不是 Git 仓库时 MUST NOT 出现结果卡片。系统 MUST NOT 在卡片上铺开文件清单，MUST NOT 声称这些改动由团队成员造成，MUST NOT 按单个步骤结束反复产出卡片。

### Scenario: 一轮结束且有改动
- GIVEN 一轮工作结束且没有成员继续接力，这段对话期间有 2 个文件发生改动
- WHEN 用户查看时间线末尾
- THEN 出现结果卡片说明有 2 个文件发生改动，只给数量与查看入口，措辞不归因于成员

### Scenario: 一轮结束但什么都没改
- GIVEN 一轮工作结束且这段对话期间没有文件发生改动
- WHEN 用户查看时间线末尾
- THEN 结果卡片如实说明没有文件发生改动，不省略卡片

### Scenario: 非 Git 项目不出卡片
- GIVEN 当前会话的项目文件夹不是 Git 仓库
- WHEN 一轮工作结束
- THEN 时间线末尾不出现结果卡片

### Scenario: 查看改动使用右侧栏正式形态
- GIVEN 一张结果卡片只展示改动文件数量与「查看改动」入口
- WHEN 用户点击「查看改动」
- THEN 右侧栏打开或聚焦对应的“改动”标签
