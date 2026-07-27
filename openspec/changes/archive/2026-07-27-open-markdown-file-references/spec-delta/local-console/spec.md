# local-console delta：open-markdown-file-references

## Requirement: 文件引用读取受会话可信根与窗口预算约束
Source: docs/product/pages/main-right-sidebar.md#文件引用标签

session-scoped 文件引用端点 MUST 只接受绝对 POSIX 文件路径、正整数 line 与可选正整数 column。runtime MUST 读取当前会话工作空间与配置解析出的 Codex sessions root，分别取得真实根与目标真实路径，并只在目标普通文件真实位于至少一个可信根内时读取。路径穿越、符号链接逃逸、其他本机位置、目录、不存在、不可读、二进制或无效 UTF-8 MUST 返回结构化不可用结果，MUST NOT 读取或回退到相似路径。
目标在可信根内完成 `realpath` 后，可用响应以及后续 `line-too-large`、`response-too-large`、`line-not-found`、`scan-limit`、`binary-file`、`not-file` 或读取失败响应都 MUST 携带 canonical path；只有无法取得真实路径或目标位于可信根外时才保留输入路径。

可用响应 MUST 只返回目标行前后固定有界窗口、真实行号、目标行列与前后截断事实。读取 MUST 流式扫描，并分别受最大扫描字节、单行 UTF-8 字节与响应总 UTF-8 字节硬上限约束；超过单行或响应上限 MUST 返回结构化不可用结果，MUST NOT 返回部分行或整份大型文件。读取 MUST NOT 仅因整文件超过项目文件的 2 MiB 上限而拒绝仍可在上述预算内定位和返回的目标。

### Scenario: workspace 内普通文本
- GIVEN 会话 workspace 内存在普通文本文件且目标为第 12 行
- WHEN renderer 请求该会话的文件引用
- THEN 响应只包含第 12 行附近的有界文本窗口与真实行号
- AND 目标行标识为 12

### Scenario: Codex rollout 大于项目文件上限
- GIVEN Codex sessions 根内 rollout 文件超过 2 MiB 且第 292 行在扫描预算内
- WHEN renderer 请求该绝对路径第 292 行
- THEN 响应可用且包含第 292 行
- AND 不返回整份 rollout 内容

### Scenario: 目标行本身超过显示上限
- GIVEN 受信任文本文件的目标行单行超过文件引用字节上限
- WHEN renderer 请求该目标行
- THEN 响应为 line-too-large
- AND 不返回目标行的完整或部分内容
- AND 响应路径是该文件的 canonical path

### Scenario: NUL 二进制文件通过别名引用
- GIVEN 可信根内的 NUL 二进制文件同时有真实路径和根内符号链接
- WHEN renderer 分别请求两个路径
- THEN 两次响应均为 binary-file
- AND 两次响应路径都是同一个 canonical path

### Scenario: 符号链接逃出可信根
- GIVEN workspace 内文件链接的真实目标位于 workspace 与 Codex sessions 根之外
- WHEN renderer 请求该链接路径
- THEN 响应为 outside-trusted-roots
- AND 外部目标内容没有返回
