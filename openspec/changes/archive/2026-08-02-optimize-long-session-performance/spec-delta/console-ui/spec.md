# spec-delta: console-ui / optimize-long-session-performance

> 这些条目记录已实现并验证的 UI 行为契约；实现早于本次文档补录，归档时再回流到 `openspec/specs/console-ui/spec.md`。

### Requirement: 长会话窗口化不减少可访问历史

Source: `docs/product/pages/main-conversation.md#指标与验收`
Source: `docs/product/pages/main-conversation.md#会话目录轨`

操作台 MUST 保留完整的公开消息逻辑集合，即使只挂载视口附近的消息 DOM。窗口化 MUST 支持真实消息高度变化、首尾滚动、未挂载消息的精确 Relay 定位、跨会话非末尾阅读位置恢复和末尾新消息跟随；内部运行占位 MUST NOT 进入公开时间线 DOM。

#### Scenario: 未挂载消息被目录轨定位

- **GIVEN** 目标公开消息不在当前 DOM 窗口内
- **WHEN** 用户从目录轨激活该消息
- **THEN** 页面先使目标进入可定位窗口，再把它精确滚入阅读区并短暂突出
- **AND** 不跳到近似消息或丢失其他公开历史。

#### Scenario: 切换返回中段阅读位置

- **GIVEN** 用户在会话 A 的中段阅读且没有停在末尾
- **WHEN** 用户切到会话 B 后返回会话 A
- **THEN** 会话 A 恢复原阅读消息
- **AND** 期间到达的新消息不强制把阅读位置移到末尾。

### Requirement: 导航失败恢复完整组合现场

Source: `docs/product/pages/main-left-sidebar.md#选择对话`

普通、搜索和 hosted 分析导航的必要请求失败或过期时，操作台 MUST 恢复进入导航前的 selection、主内容 route、右栏 visibility、host session、tabs 文档、active tab、草稿和阅读位置；成功导航 MUST 只提交一次目标现场。

#### Scenario: 普通目标加载失败

- **GIVEN** 原会话右栏打开且存在 active tab
- **WHEN** 用户打开普通目标且目标加载失败
- **THEN** 原 selection、主内容、右栏开合、host、tabs 文档、active tab、草稿和阅读位置保持不变
- **AND** 页面显示可理解的失败反馈。

#### Scenario: Hosted 分析目标加载失败

- **GIVEN** 用户从搜索或分析入口进入 hosted 目标
- **WHEN** 目标请求失败或过期
- **THEN** 原组合现场完整恢复
- **AND** 目标导航过程中写入的 tabs 不残留。
