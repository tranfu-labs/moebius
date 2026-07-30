# local-console delta：sidebar-conversation-management

说明：本文件保留为项目级 `spec-delta/`；OpenSpec CLI 可验证镜像位于 `specs/local-console/spec.md`，两者语义保持一致。

## ADDED Requirements

### Requirement: 会话侧栏元数据独立持久化
Source: docs/product/pages/main-left-sidebar.md#标记为已读与未读

local-console MUST 独立持久化 attention 确认、Agent 未读、手动未读、read-state revision、置顶时间和标题 revision。确认 attention MUST NOT 删除或改写时间线事实；同一事实经刷新或重启 MUST NOT 再次提醒，后来形成的新事实 MUST 再次提醒。

#### Scenario: 同类异常恢复后再次发生
- GIVEN 用户已经确认一次卡住事实且该会话随后恢复
- WHEN 后来产生一条新的卡住事实
- THEN 新事实拥有更高 attention revision
- AND 会话再次显示未确认 attention。

### Requirement: 阅读状态 mutation 校验最新事实
Source: docs/product/pages/main-left-sidebar.md#标记为已读与未读

阅读状态 mutation MUST 以服务端最新可见状态、attention revision、read-state revision 与 title revision 为准。Agent 未读或手动未读的建立、推进、离开 gate 或清除 MUST 推进 read-state revision。红点已读 MUST 只确认当前 attention；蓝点已读 MUST 清除 Agent 与手动未读；运行点 MUST 拒绝手动改变阅读状态。陈旧操作 MUST 不写入并返回可判定冲突。

#### Scenario: 菜单打开后会话开始运行
- GIVEN 用户在无点状态打开菜单
- WHEN 会话开始运行后才提交标记未读
- THEN mutation 返回陈旧状态冲突
- AND 会话不产生手动未读。

#### Scenario: 蓝点菜单打开后到达新结果
- GIVEN 用户在蓝点对应 read-state revision R 打开“标记为已读”
- WHEN 新 Agent 结果到达并把 read-state revision 推进到 R+1 后才提交旧菜单
- THEN mutation 返回陈旧状态冲突
- AND 新结果的未读时间保持不变。

### Requirement: 当前会话手动未读需要一次离开
Source: docs/product/pages/main-left-sidebar.md#标记为已读与未读

当前已展示会话被标记未读后 MUST 先成功选择另一段会话，之后再次显式成功展示时才清除。自动恢复、刷新和重复激活当前行 MUST NOT 清除；非当前会话的手动未读在下一次显式成功展示时清除。

#### Scenario: 重启不消费当前会话提醒
- GIVEN 当前会话被标记未读且用户尚未离开
- WHEN 应用重启并自动恢复该会话
- THEN 手动未读仍存在。

### Requirement: 置顶与标题是原子会话 mutation
Source: docs/product/pages/main-left-sidebar.md#置顶与取消置顶

置顶和重命名 MUST 在 SQLite 事务提交后返回新 session 摘要。置顶 MUST 保留创建时间与项目归属；重命名 MUST 只改变 trim 后的非空标题和 title revision。归档 MUST 清除置顶状态。失败 MUST 保留提交前元数据。

#### Scenario: 重命名后搜索只使用新标题
- GIVEN 会话标题 A 成功改为不包含 A 的 B
- WHEN 分别搜索 A 和 B
- THEN A 不命中该会话
- AND B 命中同一 session。
