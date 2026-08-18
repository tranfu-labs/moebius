# local-console delta：session-title-generation-entry-points

## ADDED Requirements

### Requirement: 新会话自动标题生成的触发面与语义

Source: docs/product/pages/main-conversation.md#页面标题

local-console MUST 在会话首条用户消息落库后异步触发标题生成，且 MUST 覆盖两条落库入口：携带 `initialMessage` 创建会话（create + initialMessage）与向已存在空会话追加首条消息（submit）。触发判定 MUST 只在首条消息含可提炼文本时生成；纯附件或无正文首条消息 MUST 保留既有默认标题派生路径（正文开头文字或第一个附件显示名）。标题生成 MUST 复用同一进程内守卫（同会话同一时刻至多一个在途生成）与同一开关（`enableSessionTitleGeneration`，默认开启）。生成失败、输出清洗无效或重命名乐观锁冲突（用户已改名 / 会话消失）时 MUST 静默保留既有标题，MUST NOT 重试，MUST NOT 阻塞对话。生成成功 MUST 走既有 `renameSession` 路径落库并递增标题 revision，MUST NOT 新增 schema 面。

#### Scenario: 携带 initialMessage 创建会话触发生成

- **GIVEN** 会话通过 create + initialMessage 创建且首条消息含文本
- **WHEN** 创建事务提交
- **THEN** 异步生成标题并重命名，与主流程 run 并行、互不阻塞
- **AND** 用户已手动改名时不覆盖

#### Scenario: 纯附件首条消息不生成

- **GIVEN** 会话通过 create + 附件创建且无正文
- **WHEN** 创建事务提交
- **THEN** 不触发标题生成，标题按第一个附件显示名派生

#### Scenario: 后续消息不重复生成

- **GIVEN** 会话已通过任意入口生成过一次标题
- **WHEN** 后续消息落库
- **THEN** 不再触发标题生成
