# local-console delta：separate-file-reading-modes

## Requirement: 项目当前源码与会话累计 diff 分开读取
Source: docs/product/pages/main-right-sidebar.md#项目文件标签

local console MUST 为项目当前文件和会话累计 diff 提供不同的只读查询契约。项目文件查询成功时 MUST 返回完整当前 UTF-8 文本与单一当前行模型，MUST NOT 因文件相对基线有改动而返回 diff。累计 diff 查询 MUST 继续返回相对会话基线的新增、删除、上下文和旧 / 新行号。

### Scenario: 已改动文件读取当前源码
- GIVEN 会话工作空间中的 `src/a.ts` 相对基线有一行删除和两行新增
- WHEN 请求项目当前文件
- THEN 响应包含当前文件的完整文本
- AND 不包含已删除行或 diff line kind
- WHEN 请求该文件的累计 diff
- THEN 响应包含一行删除、两行新增及其旧 / 新行号

## Requirement: 文件引用按会话工作空间和 canonical 目标分流
Source: docs/product/pages/main-conversation.md#时间线

session-scoped 文件引用查询 MUST 使用该会话锁定的实际工作空间，并在每次读取时解析工作空间和目标的 canonical 真实路径。真实目标位于真实工作空间内时 MUST 返回 `workspace-file`；真实目标位于外部时 MUST 返回 `external-preview`。判定 MUST 使用路径段安全的包含关系，MUST NOT 使用字符串前缀或 renderer 提供的作用域结论。

### Scenario: 工作区内符号链接逃到外部
- GIVEN 工作区内路径是符号链接且真实目标位于工作区外
- WHEN 请求该文件引用
- THEN 结果类型为 `external-preview`
- AND 不返回整个外部文件

### Scenario: 外部别名指回工作区
- GIVEN 输入路径位于工作区路径外但真实目标位于工作区内
- WHEN 请求该文件引用
- THEN 结果类型为 `workspace-file`
- AND 响应携带工作区相对路径和完整文本

### Scenario: 相似字符串前缀不是工作区
- GIVEN 工作区为 `/work/app` 且目标为 `/work/application/a.ts`
- WHEN 请求该目标
- THEN 目标按工作区外处理

## Requirement: 工作区文件完整读取且外部文件保持有界
Source: docs/product/pages/main-right-sidebar.md#工作区文件与工作区外预览

`workspace-file` 成功响应 MUST 包含整个普通 UTF-8 文本、真实行号、canonical path 和工作区相对路径。完整文件超过项目文件整文件预算时 MUST 返回 `file-too-large`，MUST NOT 返回部分内容或降级为 `external-preview`。

`external-preview` 成功响应 MUST 只包含目标行附近固定窗口、真实行号、目标行列和前后截断事实，并继续受既有扫描字节、单行字节和响应总字节硬上限约束。它 MUST NOT 返回完整性为 true。目录、缺失、不可读、不可显示文本、目标行过长、扫描不足和响应过大 MUST 沿用已有错误归类，MUST NOT 回退读取相似路径。

### Scenario: 工作区单行 JSON 完整读取
- GIVEN 工作区内 JSON 文件只有一行且整行在完整文件上限内
- WHEN 请求无显式行号的文件引用
- THEN `workspace-file` 响应包含该行的全部文本
- AND `isComplete` 为 true

### Scenario: 工作区文件超过完整读取上限
- GIVEN 工作区内普通文本超过整文件上限
- WHEN 请求该文件引用
- THEN 响应为 `file-too-large`
- AND 不返回第 1 行附近窗口

### Scenario: 外部大型日志读取目标窗口
- GIVEN 工作区外日志超过整文件上限且目标行在外部扫描预算内
- WHEN 请求第 292 行
- THEN `external-preview` 响应只包含第 292 行附近窗口
- AND `isComplete` 为 false

### Scenario: 不可显示文本沿用既有失败
- GIVEN 两个目标分别含 NUL 与无效 UTF-8
- WHEN 请求两个目标
- THEN 两个响应都返回 `binary-file`
- AND 不携带部分文本

## Requirement: 文件读取保持只读
Source: docs/product/pages/main-right-sidebar.md#选择文件

文件读取 MUST 不修改目标、索引、会话或 git 状态。每次文件引用请求 MUST 根据当前 session workspace 和 canonical 目标分类；系统 MUST NOT 信任 renderer 传回的旧作用域。

### Scenario: 连续读取不产生副作用
- GIVEN 同一文件连续执行项目源码、文件引用和 diff 查询
- WHEN 查询全部完成
- THEN 文件内容、mtime、git 状态与会话事实没有因读取而变化
