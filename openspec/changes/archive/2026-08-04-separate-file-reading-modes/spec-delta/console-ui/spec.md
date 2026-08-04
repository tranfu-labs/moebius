# console-ui delta：separate-file-reading-modes

## Requirement: 文件引用保留显式定位意图
Source: docs/product/pages/main-conversation.md#时间线

共享 Markdown renderer MUST 在绝对本地文件引用的 path、line、column 之外保留行号是否由正文显式给出；无行号路径与显式 `:1` MUST NOT 合并为同一初始显示意图。解析层 MUST NOT 根据扩展名、路径位置或文件存在性自行决定读取范围。

### Scenario: 裸 Markdown 路径没有定位意图
- GIVEN 消息正文包含 `/workspace/README.md`
- WHEN renderer 产生文件打开意图
- THEN path 为 `/workspace/README.md`
- AND `hasExplicitLine` 为 false

### Scenario: 第一行是显式目标
- GIVEN 消息正文包含 `/workspace/README.md:1`
- WHEN renderer 产生文件打开意图
- THEN line 为 1
- AND `hasExplicitLine` 为 true

## Requirement: 工作区文件与外部预览使用不同呈现
Source: docs/product/pages/main-right-sidebar.md#工作区文件与工作区外预览

右侧栏 MUST 根据服务端返回的目标作用域呈现文件。完整工作区文件 MUST 使用普通源码阅读或 Markdown Preview；工作区外结果 MUST 同时在标签与内容区明确标识“预览”和内容有界，MUST NOT 显示为完整文件或提供 Markdown Preview。不可用结果 MUST 清除上一目标内容并显示对应原因，MUST NOT 回退读取其他文件。

### Scenario: 工作区文件完整打开
- GIVEN 文件引用响应为完整 `workspace-file` 且包含 120 行
- WHEN 右侧栏呈现该标签
- THEN 用户可访问第 1 至 120 行
- AND 页面没有“仅显示目标位置附近内容”标识

### Scenario: 外部 Markdown 仍是有界文本
- GIVEN 文件引用响应为 `.md` 的 `external-preview`
- WHEN 右侧栏呈现该标签
- THEN 标签与内容区显示预览标识
- AND 只显示响应提供的真实行号窗口
- AND 不出现 Markdown Preview 切换

## Requirement: 项目文件使用源码视图且改动使用 Review 视图
Source: docs/product/pages/main-right-sidebar.md#项目文件标签

项目文件内容 MUST 显示完整当前文本和单一当前行号，MUST NOT 显示旧 / 新双行号、增删 line kind、`+` / `−` 或增删背景。改动标签 MUST 继续使用会话基线 diff，并以可访问且不只依赖颜色的信号区分新增、删除与上下文。

### Scenario: 已改动文件从两个入口打开
- GIVEN 同一文件相对会话基线有新增与删除
- WHEN 用户从项目文件选择它
- THEN 内容区显示完整当前源码和一列当前行号
- AND 不显示删除行或 Review 增删语义
- WHEN 用户从改动标签选择它
- THEN 内容区显示累计 diff、旧 / 新行号和增删语义

## Requirement: 完整 Markdown 文件提供 Preview 与源码
Source: docs/product/pages/main-right-sidebar.md#工作区文件与工作区外预览

完整工作区 `.md` 与 `.markdown` 文件 MUST 提供 Preview 和源码模式。无显式行号的首次打开 MUST 默认 Preview；带显式行号的首次打开 MUST 默认源码并定位目标。用户切换模式后，选择 MUST 只作用于当前标签；切回源码 MUST 恢复目标位置。Preview 与源码 MUST 从同一次成功读取的完整文本快照派生。

Preview MUST 复用既有 Markdown HTML 清洗、危险协议阻止、远程外链确认和严格 Mermaid 策略。Preview 中的绝对本地文件链接 MUST 继续进入应用内文件打开回调；文件正文 MUST NOT 激活团队 mention 或对话引用控制。相对本地链接、本地图片和 `.mdx` MUST NOT 因本次获得新的本地解析能力。

### Scenario: 裸 README 默认 Preview
- GIVEN `/workspace/README.md` 被完整读取且没有显式行号
- WHEN 文件标签首次呈现
- THEN Preview 为选中模式并显示渲染后的标题
- WHEN 用户切换源码
- THEN 显示同一快照的完整 Markdown 原文

### Scenario: 带行号 Markdown 默认源码
- GIVEN `/workspace/README.md:42` 被完整读取
- WHEN 文件标签首次呈现
- THEN 源码为选中模式且第 42 行进入视野并突出
- WHEN 用户切到 Preview 再切回源码
- THEN 第 42 行再次进入视野并突出

### Scenario: Preview 中链接遵守既有安全边界
- GIVEN Markdown 同时包含绝对本地文件链接、HTTPS、`javascript:` 与本地相对图片
- WHEN 用户依次激活这些目标
- THEN 绝对本地路径只进入应用内文件回调
- AND HTTPS 只进入既有确认流程
- AND 危险协议与本地相对图片不执行、不读取

## Requirement: 文件异步加载只提交当前目标结果
Source: docs/product/pages/main-right-sidebar.md#选择文件

文件加载的成功与失败 MUST 同时匹配当前标签身份、session、目标和请求代次后才能提交。父级重渲染、回调身份变化、模式切换或较慢旧请求完成 MUST NOT 覆盖较新的目标、模式、内容、错误或阅读位置。磁盘文件 MUST NOT 自动替换当前已呈现文本；重新选择、重新打开或使用既有刷新入口后的源码与 Preview MUST 从同一次新响应派生。

### Scenario: 慢旧请求晚于新请求返回
- GIVEN 文件 A 的请求尚未完成时用户选择文件 B
- WHEN B 先成功且 A 随后成功或失败
- THEN 当前目标与内容仍为 B
- AND A 的内容或错误不出现

### Scenario: 父级更新回调身份
- GIVEN 当前文件请求中父级重渲染并传入新回调实例
- WHEN 原请求成功
- THEN 匹配当前目标的结果仍可提交一次
- AND 不重复请求、不回退到旧目标

### Scenario: 重新读取后两种模式使用同一文本
- GIVEN 当前 Markdown 的源码与 Preview 都来自文本 V1
- AND 文件在磁盘变为 V2
- WHEN 用户尚未重新读取
- THEN 两种模式继续显示 V1
- WHEN 用户重新选择、重新打开或使用既有刷新入口且请求成功
- THEN 两种模式都从同一次 V2 响应派生
