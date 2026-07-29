# local-console delta：analyze-conversation-from-sidebar

## MODIFIED Requirements

### Requirement: reference-text 显式区分消息级与对话级片段
Source: docs/product/flows/session-analysis.md#2-收集静态文本片段

local-console reference-text API MUST 要求调用方显式声明 `message` 或 `conversation` 范围，并 MUST 只从可信 session fact log 与 provider link 生成静态文本。

`conversation` 范围 MUST 只返回 `Moebius 会话记录：<路径>`，MUST NOT 推断最近一次 run 或追加外部执行信息。

`message` 范围 MUST 始终返回记录路径；能够按明确 run 匹配 provider link 时 MUST 追加对应 Codex 或 Kimi external session id，不能匹配或尚未建立时 MUST 追加 `外部执行：未建立`。

#### Scenario: 对话级片段不猜测最近 run

- GIVEN 对话记录中存在多个 provider execution link
- WHEN 客户端请求 conversation 范围的 reference-text
- THEN 返回文本只包含 Moebius 会话记录路径
- AND 不包含任何 Codex、Kimi 或 external session id

#### Scenario: 消息级片段精确匹配 run

- GIVEN 消息对应 run B 且记录中同时存在 run A 与 run B 的 provider link
- WHEN 客户端请求 message 范围并指定 run B
- THEN 返回文本包含 run B 对应的 CLI 与 external session id
- AND 不包含 run A 的 external session id

#### Scenario: 消息尚未建立外部会话

- GIVEN 消息没有可匹配的 provider link
- WHEN 客户端请求 message 范围的 reference-text
- THEN 返回文本包含记录路径与 `外部执行：未建立`
