# local-console delta：show-machine-text-and-open-local-files

## Requirement: 文件引用读取不受位置根限制并保持窗口预算
Source: docs/product/pages/main-right-sidebar.md#文件引用标签

session-scoped 文件引用端点 MUST 只接受绝对 POSIX 文件路径、正整数 line 与可选正整数 column。runtime MUST 解析目标真实路径，并允许读取本机任意位置及任意符号链接真实目标的普通文件，MUST NOT 以当前会话工作空间、Codex sessions root 或其他目录白名单拒绝目标。

路径无法解析、目录、不存在、不可读、二进制或无效 UTF-8 MUST 返回结构化不可用结果，MUST NOT 回退读取相似路径。完成 `realpath` 后，可用响应以及后续 `line-too-large`、`response-too-large`、`line-not-found`、`scan-limit`、`binary-file`、`not-file` 或读取失败响应都 MUST 携带 canonical path；只有无法取得真实路径时保留输入路径。

可用响应 MUST 只返回目标行前后固定有界窗口、真实行号、目标行列与前后截断事实。读取 MUST 流式扫描，并分别受最大扫描字节、单行 UTF-8 字节与响应总 UTF-8 字节硬上限约束；超过单行或响应上限 MUST 返回结构化不可用结果，MUST NOT 返回部分行或整份大型文件。读取 MUST NOT 仅因整文件超过项目文件的 2 MiB 上限而拒绝仍可在上述预算内定位和返回的目标。

### Scenario: `/tmp` 普通文本
- GIVEN `/tmp` 存在普通 UTF-8 文本文件且目标为第 12 行，该文件不在会话 workspace 或 Codex sessions root 内
- WHEN renderer 请求该文件引用
- THEN 响应可用，只包含第 12 行附近的有界窗口与真实行号
- AND 响应路径是该文件的 canonical path

### Scenario: 符号链接指向工作空间外
- GIVEN workspace 内路径是一个符号链接，真实目标位于任意其他本机目录
- WHEN renderer 请求该链接
- THEN 响应按真实目标内容可用
- AND 响应路径是链接目标的 canonical path

### Scenario: 大文件目标窗口
- GIVEN 任意位置的文本文件超过 2 MiB 且目标行在扫描预算内
- WHEN renderer 请求该目标行
- THEN 响应可用且包含目标行
- AND 不返回整份文件

### Scenario: 目标行本身超过显示上限
- GIVEN 任意位置文本文件的目标行单行超过文件引用字节上限
- WHEN renderer 请求该目标行
- THEN 响应为 line-too-large
- AND 不返回目标行的完整或部分内容
- AND 响应路径是该文件的 canonical path

### Scenario: 二进制文件通过别名引用
- GIVEN 含 NUL 的文件同时有真实路径和符号链接路径
- WHEN renderer 分别请求两个路径
- THEN 两次响应均为 binary-file
- AND 两次响应路径都是同一个 canonical path

### Scenario: 读取预算继续拒绝无界内容
- GIVEN 目标文件需要超过扫描上限才能到达目标行，或目标窗口超过响应总字节上限
- WHEN renderer 请求该目标
- THEN 响应分别为 scan-limit 或 response-too-large
- AND 不返回部分窗口
