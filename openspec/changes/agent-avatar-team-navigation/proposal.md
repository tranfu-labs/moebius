# 提案：agent-avatar-team-navigation

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| docs/product/pages/main-conversation.md | `#Agent-头像与当时信息`、`#指标与验收` | 已知执行配置时头像默认显示 Provider 标识；信息卡按钮改为打开历史所属团队详情并预选对应 Agent，不再打开历史 `AGENT.md` Dialog | 已写入 |
| docs/product/pages/agent-teams.md | `#区域与信息` | 复用既有团队详情页的成员选择，不新增独立 Agent 页面 | 已有基线，无需改写 |

## 背景

当前运行身份数据已经有 Provider 与团队快照，但 `LocalConsoleMemberIdentity` 没有把执行配置投影到 UI，因此时间线头像只有在信息 Popover 读取到 run 事实后才可能显示 Provider 标识。正在运行的记录使用不可交互的 `RoleTag`，没有进入同一 run 信息 Popover 的入口。

现有 Popover 的第二动作仍是读取历史 `AGENT.md`。产品要求该动作改为打开对应历史团队中的对应 Agent；桌面已经有 `ownership:id` 团队键、团队详情页和选中成员状态，但当前跨层回调没有携带历史成员目标。

## 提案

沿用现有 Agent 头像、ProviderMark、run 信息 Popover 与 Agent 团队详情页，补齐两条事实链：

1. 将会话团队快照成员的 `executionProfile` 投影为时间线身份的 Provider 标识；活动 run 同时保留本次 profile 供首屏标识使用。
2. 将历史 run 的团队稳定键与成员 slug作为 Popover 的导航目标，通过一个语义化的宿主回调交给桌面导航层，原子地打开 `agent-teams` 详情并选中成员。正在运行、成功和结构化终局记录共用同一个 Popover；移除 UI 中的历史 `AGENT.md` Dialog 入口。

不新增独立 Agent 页面、不在 `console-ui` 内部维护路由或导航状态，也不使用当前团队配置回填历史团队目标。旧 run 没有团队稳定身份时不制造错误跳转。

## 影响

- `src/local-console`：补充历史 run 团队键、成员 Provider 投影和活动 run 的 profile 传输。
- `packages/console-ui`：统一活动/历史头像入口，替换 Popover 动作，扩展语义化团队成员导航回调；同步中英文文案、测试和设计事实描述。
- `desktop`：把导航意图接到现有 `useAgentTeamNavigation`，以团队键和成员 slug打开既有团队详情并选中成员。
- `openspec/specs/console-ui`：实现完成并验证后，通过 `spec-delta` 回流，删除历史 Markdown Dialog 行为并补充 Provider 标识与团队成员跳转判据。
- 本 change 不删除后端历史 Markdown 读取接口；它不再被生产 UI 暴露，接口清理另行处理，避免扩大本次用户可见范围。
