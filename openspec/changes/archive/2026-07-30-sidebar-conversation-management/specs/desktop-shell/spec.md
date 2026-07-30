# desktop-shell delta：sidebar-conversation-management

说明：这是 `spec-delta/desktop-shell/spec.md` 的 OpenSpec CLI 可验证镜像，两者语义保持一致。

## ADDED Requirements

### Requirement: renderer 原子编排会话侧栏 mutation

The desktop renderer MUST satisfy the following atomic-mutation contract.

Source: docs/product/pages/main-left-sidebar.md#项目与对话菜单

renderer MUST 在 local-console mutation 持久化成功并取得 canonical session 后才提交圆点、位置或标题。失败或 409 MUST 保留提交前组合，不得产生侧栏、主内容、右栏或搜索半更新。

#### Scenario: 置顶请求失败
- GIVEN 目标会话仍在项目列表且当前组合包含来源主内容和右侧会话
- WHEN 置顶 mutation 失败
- THEN 会话仍只在原项目出现
- AND 选中、主内容与右栏组合不变。

### Requirement: 标题变化使旧搜索响应失效

The desktop renderer MUST satisfy the following search-generation contract.

Source: docs/product/pages/search.md#操作与反馈

renderer MUST 让搜索请求绑定查询条件与标题 generation。成功重命名 MUST 取消旧 generation、清除陈旧结果并保留原查询以重试；晚到旧响应 MUST NOT 提交。

#### Scenario: 搜索过程中重命名
- GIVEN 查询 A 尚未完成
- WHEN 标题 A 成功改为不包含 A 的 B 且旧响应晚到
- THEN 页面不得重新显示 A
- AND 用户可按原查询条件重试。

### Requirement: 右栏会话标题由 canonical session 解析

The desktop renderer MUST satisfy the following canonical-tab contract.

Source: docs/product/pages/main-right-sidebar.md#会话重命名同步

renderer MUST 以 conversation tab sourceKey 解析 canonical session 标题和区分上下文，并持久保留不依赖标题解析成功的用户可读区分上下文。持久 tab title MUST NOT 成为会话标题事实源；无法解析时 MUST 输出可自动或手动重试的 pending 状态而不是旧标题，多个 pending 标签 MUST 仍可稳定区分。

#### Scenario: 保留标签组在重启后恢复
- GIVEN 隐藏标签组保留绑定会话的 sourceKey 且会话已重命名
- WHEN 应用重启并恢复该组
- THEN 标签直接使用 canonical 新标题
- AND 不短暂显示持久化旧标题。
