# local-console 规格增量

说明：本文件保留为项目级 `spec-delta/`；OpenSpec CLI 可验证镜像位于 `specs/local-console/spec.md`，两者语义保持一致。

## MODIFIED Requirements

### Requirement: 来源胶囊序列化为用户消息来源块

Source: docs/product/flows/session-analysis.md#2-收集来源引用

分析草稿在发送前 MUST 支持有序、可删除的来源胶囊。每个胶囊通过悬浮、键盘聚焦与辅助技术公开的完整文本 MUST 是该胶囊唯一的 Agent 输入载荷。提交时 local-console MUST 把仍存在的胶囊文本按顺序各序列化一次，形成用户消息顶部唯一的 Markdown 来源块，并与正文和普通附件在同一个 session fact 中原子提交；已发送消息 MUST NOT 继续保存或重复呈现独立胶囊。

来源块或任意正文中的 `moebius-ref:` MUST 只承担用户导航语义。runtime MUST NOT 根据该链接追加目标消息、目标对话、结构化运行记录、stdout、stderr 或完整输出，也 MUST NOT 因链接目标不可用而阻止消息提交、pending 发射或 run 创建。

#### Scenario: 对话片段只传递可见文本

- **GIVEN** 对话级胶囊公开文本为 T，目标对话含多条消息与大体量完整输出
- **WHEN** 用户发送分析问题并启动 Agent
- **THEN** Agent 输入中的来源片段逐字等于 T 且只出现一次
- **AND** 输入不含仅存在于目标时间线或运行输出中的内容。

#### Scenario: 多个片段保持顺序且各出现一次

- **GIVEN** 草稿按顺序包含文本 T1 与 T2 两个胶囊
- **WHEN** 用户提交首条消息
- **THEN** 来源块按 T1、T2 的顺序生成
- **AND** T1 与 T2 各自只序列化一次。

#### Scenario: 删除片段后发送

- **GIVEN** 草稿原有两个来源胶囊且用户删除第一个
- **WHEN** 首条消息提交成功
- **THEN** JSONL、SQLite 投影与消息 UI 的 Markdown 来源块只包含第二个引用
- **AND** 被删胶囊不形成附件、引用或隐藏 prompt。

#### Scenario: 重建保留来源块顺序

- **GIVEN** JSONL 用户消息包含具有三个链接的来源块
- **WHEN** SQLite 索引被删除并从 JSONL 重建
- **THEN** 三个链接的标签、目标与顺序保持
- **AND** 不重建独立来源胶囊。

#### Scenario: 链接目标不可用不阻塞 pending

- **GIVEN** 队首用户消息含指向缺失或不可访问目标的合法 `moebius-ref:`
- **WHEN** 主 Agent 车道可发射该消息
- **THEN** 消息与 run 按普通顺序创建
- **AND** 链接目标状态只在用户激活导航时处理。

### Requirement: reference-text 生成公开应用内来源链接

Source: docs/product/flows/session-analysis.md#2-收集来源引用

local-console reference-text API MUST 要求调用方显式声明 `message` 或 `conversation` 范围，并生成可读标签与公开 `moebius-ref:` 目标。消息级链接 MUST 使用稳定 session/message 标识并提供安全纯文本摘录；对话级链接 MUST 使用稳定 session 标识与可读标题。长文本、Markdown 特殊字符、Emoji、控制字符与空正文 MUST 经过确定性投影、转义和截断。该 API 只生成导航链接与胶囊的完整可见文本；链接 MUST NOT 触发 run 输入侧的来源读取或权限扩张。

#### Scenario: 对话级来源链接

- **GIVEN** 对话具有稳定 session 标识与可读标题
- **WHEN** 客户端请求 conversation 范围的 reference-text
- **THEN** 返回合法 `moebius-ref:conversation/<session-id>` Markdown link
- **AND** 可见标签使用对话标题且不展示文件路径或 provider 标识。

#### Scenario: 消息级来源链接

- **GIVEN** 消息属于稳定 session 且具有稳定 message 标识
- **WHEN** 客户端请求 message 范围的 reference-text
- **THEN** 返回合法 `moebius-ref:message/<session-id>/<message-id>` Markdown link
- **AND** 可见标签使用安全纯文本摘录且不展示内部路径或 provider 标识。

#### Scenario: 特殊字符安全投影

- **GIVEN** 消息正文含 Markdown 链接、代码、Emoji、控制字符或超长文本
- **WHEN** 客户端请求 message 范围的 reference-text
- **THEN** 可见标签是确定性转义与截断后的单行纯文本
- **AND** 生成链接仍可被 Markdown parser 解析为唯一来源目标。

## ADDED Requirements

### Requirement: 已持久化可见消息是重试与恢复的唯一来源文本

Source: docs/product/flows/session-analysis.md#用户移除文本片段

重试、重新运行、同一 run 恢复与恢复失败后的重新执行 MUST 只使用对应用户消息中已持久化的可见文本。runtime MUST NOT 刷新 `moebius-ref:` 目标，也 MUST NOT 把历史 execution context 中遗留的隐藏 `referenceContext` 拼入 provider prompt。新建或从历史 context 派生的 execution context MUST NOT 再持久化 `referenceContext`。

#### Scenario: 旧隐藏上下文不进入重试 prompt

- **GIVEN** 历史 run execution context 含遗留 `referenceContext`，而用户消息只含短来源片段 T
- **WHEN** runtime 重试或恢复该工作
- **THEN** provider prompt 包含用户消息中的 T
- **AND** prompt 不含遗留 `referenceContext` 内容
- **AND** 新 run 的 execution context 不含 `referenceContext`。

## REMOVED Requirements

### Requirement: 来源引用在新 run 前读取最新可访问内容

**Reason**: `moebius-ref:` 收窄为导航协议；Agent 只接收消息中可见的片段文本。

**Migration**: runtime 停止解析与刷新链接目标，已有消息按持久化文本运行。

### Requirement: 来源读取失败不创建新消息或 run

**Reason**: 链接目标状态不再是消息或 run 的前置条件。

**Migration**: 目标不可用只在用户激活导航时报告，pending 按普通顺序发射。
