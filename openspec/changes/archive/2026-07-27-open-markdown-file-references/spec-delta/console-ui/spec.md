# console-ui delta：open-markdown-file-references

## Requirement: 显式 Markdown 文件目标成为应用内引用
Source: docs/product/pages/main-conversation.md#时间线

共享 Markdown renderer MUST 把语法有效的绝对 POSIX 文件目标及其可选 `:line[:column]` 解析为应用内文件引用，并在存在宿主回调时呈现为可点击控件。点击 MUST 只把规范化的 path、line、column 交给文件引用回调，MUST NOT 触发浏览器导航、外链确认或 `window.open`。内部动作身份 MUST 来自当前 renderer 实例在 Markdown AST 变换时登记的私有意图，MUST NOT 只凭正文可构造的 URL 字符串判定。任何正文 HTTPS URL 都仍是普通外链并走既有确认回调；图片、`file:`、`javascript:`、data 与自定义协议仍按既有边界阻断。

机器文本过滤 MUST 保留 renderer 支持的 inline、带标题与 reference-style 显式 Markdown 文件目标及其链接语法，同时继续隐藏普通正文中的裸绝对路径、机器字段和内部 id。

### Scenario: Agent 引用 Codex 会话记录
- GIVEN Agent 正文包含 `[会话记录 (line 292)](/Users/user/.codex/sessions/day/rollout.jsonl:292)`
- WHEN 主时间线渲染并点击该引用
- THEN 标签保持可点击且文件回调收到 path `/Users/user/.codex/sessions/day/rollout.jsonl`、line `292`
- AND 正文中的另一个裸绝对路径仍显示为隐藏替代文案

### Scenario: 危险协议不提升为文件引用
- GIVEN 正文包含 `file:///tmp/a`、`javascript:`、data image 与 HTTPS 外链
- WHEN Markdown 渲染并发生点击
- THEN 三种危险目标不能导航或进入文件回调
- AND HTTPS 外链只进入既有确认与宿主回调

### Scenario: 外观类似内部地址的 HTTPS 仍是外链
- GIVEN 正文包含指向 Moebius 保留域外观的普通 HTTPS Markdown 链接
- WHEN 用户点击该链接
- THEN 它只进入外链确认流程
- AND 文件引用与成员 mention 回调都不触发

## Requirement: 已知团队 mention 显示可读名称并连接既有团队详情
Source: docs/product/pages/main-conversation.md#时间线

共享 Markdown renderer MUST 只在普通文本节点中按会话冻结成员名单识别 `@slug`，并复用运行时 handoff 的 ASCII slug 边界语义，把已知 slug 显示为 `@<displayName>` 并在存在宿主回调时呈现为可点击控件。点击 MUST 只交回该成员 slug；operator console MUST 用当前会话冻结团队键打开现有 Agent 团队详情，MUST NOT 从 mention 直接派工、执行、编辑成员或改变消息原文。

未知 mention MUST 保持原文与普通文本形态。fenced code、inline code 和已有 Markdown link 内的 `@` MUST NOT 被替换、嵌套成链接或触发团队入口。

### Scenario: 已知与未知 mention 同时出现
- GIVEN 会话成员名单包含 `{ slug: "implementer", displayName: "实现者" }`
- AND 正文包含普通文本 `@implementer`、未知 `@other`、行内代码 `` `@implementer` ``
- WHEN Markdown 渲染
- THEN 普通文本显示可点击的 `@实现者`
- AND 未知 mention 与行内代码仍分别显示 `@other` 和 `@implementer`
- WHEN 用户点击 `@实现者`
- THEN 宿主只收到成员 slug `implementer`

## Requirement: 文件引用在右侧栏按目标位置打开
Source: docs/product/pages/main-right-sidebar.md#文件引用标签

系统 MUST 按 `sessionId + canonical file path + line + column` 打开或聚焦唯一 `file-reference` 标签，并把该类型纳入可恢复标签枚举但排除在加号类型选择之外。首次加载可用内容时 MUST 把目标行滚入视野、用非纯颜色方式突出，并显示可选择复制的路径与真实行号；列号存在时 MUST 显示目标列信息。

不可用响应 MUST 显示原因且不得崩溃、导航或回退读取其他文件。大型文件响应只含目标附近窗口时，界面 MUST 保留其真实行号，MUST NOT 假装窗口首行为文件第一行。
多个不同文件引用异步解析时，系统 MUST 基于每次完成时的最新标签状态原子合并结果，MUST NOT 让后完成的引用覆盖先完成的标签。

### Scenario: 重复点击同一引用
- GIVEN 某会话的文件、行、列引用标签已经打开
- WHEN 用户再次点击相同引用
- THEN 右侧栏聚焦既有标签且标签总数不变

### Scenario: 符号链接与真实路径引用同一文件
- GIVEN 同一会话先后点击某文件的符号链接路径和真实路径，且二者解析到同一 canonical path
- WHEN 两次引用的行列相同
- THEN 右侧栏只保留一个文件引用标签并聚焦它

### Scenario: 两个文件引用并发解析
- GIVEN 用户在第一个文件引用解析完成前点击另一个不同文件引用
- WHEN 两个读取请求以任意顺序完成
- THEN 两个文件引用标签都保留
- AND 后完成的结果不覆盖先完成的标签

### Scenario: 大文件目标窗口
- GIVEN 文件引用响应从第 250 行开始并以第 292 行为目标
- WHEN 文件引用标签呈现
- THEN 行号从 250 起显示且第 292 行滚入视野并突出
- AND 加号类型选择仍只有改动与项目文件
