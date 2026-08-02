# spec-delta: local-console / optimize-long-session-performance

> 这些条目记录已实现并验证的状态接口契约；实现早于本次文档补录，归档时再回流到 `openspec/specs/local-console/spec.md`。

### Requirement: 状态接口支持未改变快照的条件刷新

Source: `docs/product/pages/main-conversation.md#指标与验收`

local-console state API MUST 支持客户端以当前快照标识发起条件请求。快照未改变时 MUST 返回无状态体的未改变响应；快照发生任何可见状态变化时 MUST 返回完整状态，而不是让客户端沿用旧快照。

#### Scenario: 空闲会话的快照未改变

- **GIVEN** 当前选择的完整状态与上一次响应完全相同
- **WHEN** 桌面刷新通道发送当前快照标识
- **THEN** API 返回未改变响应且响应体为空
- **AND** 客户端保留当前状态，不提交新的时间线状态。

#### Scenario: 活动状态发生变化

- **GIVEN** 同一会话仍在打开且 `elapsedMs`、`liveMarkdown`、活动摘要、失败或终态中任一事实发生变化
- **WHEN** 桌面刷新通道发送旧快照标识
- **THEN** API 返回完整状态
- **AND** 客户端应用变化，不把该响应误判为 unchanged。
