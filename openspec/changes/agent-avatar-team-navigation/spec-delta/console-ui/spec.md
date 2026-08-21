# console-ui 规格增量：agent-avatar-team-navigation

## MODIFIED Requirements

### Requirement: Agent avatar opens a run-scoped information popover

Source: docs/product/pages/main-conversation.md#Agent-头像与当时信息

每条运行中、成功或结构化终局 Agent 记录 MUST 提供可由鼠标和键盘操作的头像按钮，并打开以该 run 为范围的信息 Popover。已知执行配置时，头像首屏 MUST 显示对应 Provider 标识；Popover 载入的 run profile MUST 覆盖首屏预览。缺失字段 MUST 显示“此项未记录”，MUST NOT 使用当前团队状态补写。

Popover MUST 保持既有 collision handling、窄视口边界、Escape/外部点击关闭和焦点返回原头像行为。历史团队稳定身份不可解析时 MUST NOT 提供指向当前团队的错误跳转。

#### Scenario: 活动 Agent 头像可打开信息卡

- **GIVEN** 当前会话存在正在运行的 Agent run，且 run 有 sessionId、runId 和可用信息 loader
- **WHEN** 用户点击或键盘激活活动 Agent 头像
- **THEN** 头像打开该 run 的信息 Popover
- **AND** 已知执行配置时头像已经显示 Provider 标识

#### Scenario: 没有审计入口时保留静态降级

- **GIVEN** Agent 记录没有可用的 runId 或信息 loader
- **WHEN** 时间线渲染该记录
- **THEN** 系统显示现有静态角色头像
- **AND** 不创建没有来源的 Popover 或导航目标

## REMOVED Requirements

### Requirement: Historical Agent Markdown opens in a read-only dialog

**Reason**: 产品事实源已将 Popover 动作改为打开历史所属团队的对应 Agent 详情；生产 UI 不再暴露历史 `AGENT.md` Dialog。

**Migration**: 后端历史 Markdown 读取接口暂保留兼容，但 console-ui 不再调用或展示该接口。

## ADDED Requirements

### Requirement: Historical Agent information opens the owning team member detail

Source: docs/product/pages/main-conversation.md#Agent-头像与当时信息

当历史 run 信息包含可解析的稳定团队键和成员 slug 时，Popover MUST 提供“打开 Agent 详情”动作。激活动作 MUST 只发出历史 `teamKey` 与成员 slug 的语义导航意图；宿主 MUST 打开既有 Agent 团队详情并预选该成员。console-ui MUST NOT 创建独立 Agent 路由、拼接页面路径或读取当前团队替代历史目标。

当历史团队稳定身份缺失或不可解析时，Popover MUST 隐藏该动作，不得跳转到当前团队。导航动作的失败、catalog 延迟和成员已删除情形 MUST 由桌面宿主现有导航与详情页状态处理。

#### Scenario: 打开历史所属 Agent 详情

- **GIVEN** Popover 的历史信息包含 `teamKey = system:general-assistant` 和成员 slug `assistant`
- **WHEN** 用户激活“打开 Agent 详情”
- **THEN** 宿主打开既有团队详情页
- **AND** 团队详情页预选 `assistant`
- **AND** 不打开 `AGENT.md` Dialog

#### Scenario: 历史团队身份缺失不误跳转

- **GIVEN** 历史信息没有可解析的稳定团队键
- **WHEN** 用户打开 Popover
- **THEN** Popover 不显示 Agent 详情跳转动作
- **AND** 当前团队不会被当作历史团队打开
