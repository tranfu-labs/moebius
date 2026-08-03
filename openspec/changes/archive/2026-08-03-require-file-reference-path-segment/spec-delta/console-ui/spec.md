# console-ui delta：require-file-reference-path-segment

## Requirement: 绝对路径成为应用内文件引用
Source: docs/product/pages/main-conversation.md#时间线

共享 Markdown renderer MUST 只把规范化后在根 `/` 之外至少包含一个实际路径段的目标解析为应用内文件引用。该边界 MUST 同时适用于语法有效的显式 Markdown 绝对 POSIX 文件目标、普通文本中的裸绝对 POSIX 路径及整个 inline code；单独 `/`、规范化后仍为 `/` 的目标以及 `A / B` 中作为分隔符的 `/` MUST 保持原有文本语义，MUST NOT 登记文件 intent 或触发文件引用回调。

有效文件引用的可选 `:line[:column]`、URI 解码、路径规范化与私有 intent 身份 MUST 保持现有行为。renderer MUST NOT 根据扩展名、磁盘存在性、目标是否为目录或可读性预判引用；`/tmp`、无扩展名路径和不存在目标仍 MUST 进入文件引用回调，点击后的目录、不存在或不可读结果 MUST 由文件面板反馈。

普通文本中的尾随句子标点 MUST 留在文件引用外；有效 inline code 文件目标 MUST 保留代码视觉并可点击。已有 Markdown link、图片与 fenced code MUST NOT 被递归拆成嵌套文件引用，其中的路径文本仍 MUST 保持原文。任何正文 HTTPS URL 都仍是普通外链并走既有确认回调；图片、`file:`、`javascript:`、data 与自定义协议仍按既有边界阻断。点击有效文件引用 MUST 只把规范化的 path、line、column 交给文件引用回调，MUST NOT 触发浏览器导航、外链确认或 `window.open`。

### Scenario: 单独斜杠保持普通文本
- GIVEN 正文包含单独 `/`、`A / B` 与后续有效路径 `/tmp/report`
- WHEN Markdown renderer 渲染并发生点击
- THEN 两个作为文本的 `/` 均不登记文件 intent、不可触发文件回调
- AND `/tmp/report` 仍可触发 path `/tmp/report`、line `1`、column `null` 的文件回调

### Scenario: Inline code 与显式 Markdown 根目标不提升
- GIVEN 正文包含 inline code `` `/` ``、显式链接 `[根目标](/)` 与有效 inline code `` `/tmp/report.txt:2` ``
- WHEN Markdown renderer 渲染并发生点击
- THEN inline code `` `/` `` 保持代码视觉且不触发文件回调
- AND 显式 Markdown 根目标不触发文件回调
- AND 有效 inline code 保持代码视觉并触发 path `/tmp/report.txt`、line `2`、column `null` 的文件回调

### Scenario: 判据使用规范化结果
- GIVEN 显式 Markdown 目标或完整 inline code 分别为 `/:2`、`/./`、`/tmp/..` 与 `/tmp/../var/log`
- WHEN Markdown renderer 渲染并发生点击
- THEN 前三个规范化后仍为 `/` 的目标均不登记文件 intent、不触发文件回调
- AND `/tmp/../var/log` 触发 path `/var/log`、line `1`、column `null` 的文件回调
- AND 系统不是按原始字符串是否包含行号、`.` 或 `..` 决定引用资格

### Scenario: 目录与不存在目标仍由文件面板判断
- GIVEN 正文包含 `/tmp`、无扩展名路径 `/tmp/moebius-output` 与不存在目标 `/tmp/not-created-yet`
- WHEN 主时间线渲染这些路径
- THEN 三者均呈现为文件引用而不读取磁盘预判
- WHEN 用户点击 `/tmp`
- THEN 文件面板报告目标不是普通文件
- AND renderer 不把该结果改写成普通文本或外链

### Scenario: 真实文本路径保留行列定位
- GIVEN 正文包含指向真实临时文本的绝对路径并带 `:2:3`
- WHEN 用户点击该文件引用
- THEN 文件回调收到规范化 path、line `2`、column `3`
- AND 右侧栏显示 canonical path、目标位置与突出显示的第 2 行

### Scenario: 协议、代码块与成员 mention 回归
- GIVEN 正文同时包含 HTTPS 外链、`file:` URL、fenced code 中的 `/tmp/example.txt`、已知成员 mention 与有效裸路径
- WHEN 用户依次操作可用目标
- THEN HTTPS 只进入外链确认，`file:` 与 fenced code 不进入文件回调
- AND 已知 mention 只进入成员回调，有效裸路径只进入文件回调
- AND 各 intent 不互相冒充或覆盖
