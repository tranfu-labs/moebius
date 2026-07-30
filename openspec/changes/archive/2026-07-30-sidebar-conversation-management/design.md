# 设计：sidebar-conversation-management

## 方案

### 持久化模型

`sessions` 增加：

- `attention_revision`：每次形成新的可确认红点事实时递增。
- `attention_acknowledged_revision`：用户最后确认的 revision。
- `manual_unread_at`：用户手动建立返回提醒的时间。
- `manual_unread_requires_leave`：在当前已展示会话上标记未读时为 1；显式选择其他会话后转为 0。
- `read_state_revision`：Agent 未读、手动未读及其离开/清除生命周期任一变化时递增，使颜色相同但事实已更新的旧菜单失效。
- `pinned_at`：置顶时间。
- `title_revision`：只跟踪标题写入并发，不复用通用 `updated_at`。

异常系统事件仍以 `session_messages.system_event_kind` 为事实源。不可继续状态继续由 continuation 投影并写入时间线记录；runtime 在检测到新的红点来源、或同一来源经过恢复后再次发生时推进 `attention_revision`。确认只更新 acknowledged revision，不删除或改写系统记录。新的 attention revision 必须大于已确认 revision 才显示红点。

Agent 新结果继续使用 `unread_since`；手动提醒独立使用 `manual_unread_at`。最终蓝点只关心二者是否至少一个存在，但清除规则分别执行。红点下的“标记为已读”只确认 attention；蓝点下的“标记为已读”清除 Agent 与手动未读。

### Mutation 与竞态

新增三个窄 mutation：

1. attention/read-state：携带当前可见状态、attention revision、read-state revision 与 title revision；服务端重新计算后任一不一致则返回 409。新 Agent 结果即使让蓝点仍保持蓝点，也会推进 read-state revision，旧菜单不得清除后来结果。
2. pin：携带预期 `pinnedAt`，事务更新后返回 session。
3. title：携带预期 `titleRevision`，trim 后非空，允许重名。

renderer 不先改圆点、区域或标题；mutation 成功并刷新 canonical state 后一次提交。失败保留原状态并显示重试。当前会话手动未读由 renderer 在成功选择另一段会话后解除 leave gate；自动恢复和同一行重复点击不算离开。

### 侧栏

`ConversationSidebar` 接收完整根会话列表并内部拆分：

- 置顶区按 `pinnedAt DESC`。
- 项目区只渲染未置顶会话，按 `createdAt DESC`。
- 项目聚合排除已置顶会话。
- 项目全部对话置顶时显示专用状态。

对话菜单按最终点生成：red/blue → 已读，blink → 无阅读项，none → 未读。菜单 action 在执行时用最新 session facts 再校验。

共享信息浮层在侧栏根部只渲染一次。行 hover/focus 只更新 `{sessionId, top}`；浮层以 `transform` 沿纵轴移动并替换内容。菜单、重命名、离开列表和目标迁移时清空目标。reduced-motion 下移除过渡。这个受限模式作为 `DESIGN.md` 动效红线的明确例外登记，其他位移动效仍禁止。

### 标题、搜索与右栏

session title 是唯一标题事实源。搜索请求除 query/scope generation 外再绑定 title generation；任何成功重命名都会取消旧请求并以原条件重跑，旧响应不能提交。

右栏 tab 的 `sourceKey` 保持稳定身份。持久化的 `tab.title` 只作为旧数据兼容；会话标签渲染时从 renderer 的 session title map 解析当前标题。无法解析时显示“标题更新中”，不回退旧标题；页面说明新名称已保存并随现有状态刷新自动重读，持续失败时保留手动“重试标题”入口。

同一标签组内标题重复时显示第二行：项目文件夹名称、实际工作空间分支和创建时间逐级组成；上下文随标签持久化，不依赖当前标题读取成功。若仍冲突或多个标题都不可解析，以 `createdAt + sourceKey` 稳定排序得到的“同刻第 N 个”兜底，界面不暴露内部 ID。标签宽度变化时，选中或聚焦标签滚入完整可见区域；后台标签更新保存并恢复原 `scrollLeft`。

### Story 与真实运行

- Component：状态点、共享浮层/右栏标签的确定状态。
- Block：ConversationSidebar 全菜单矩阵、置顶迁移、Git/非 Git 浮层。
- Page：`Page/Console/OperatorConsole` fullscreen 生产组合，覆盖侧栏与右栏。
- Story 不接 IPC、SQLite 或用户数据；Electron 验证真实 API、持久化与 renderer 编排。

## 权衡

- 选择独立 revision 而不是删除异常事实：保证时间线仍是真实记录，且同一事实跨重启不复现、新事实仍能提醒。
- 选择持久化成功后提交而不是 optimistic UI：操作反馈稍晚，但避免位置、标题和圆点回滚造成的错误对象感。
- 选择 sourceKey + canonical title resolver 而不是批量改写所有 tab 快照：隐藏标签组无需成为第二标题事实源，失败也不会展示旧标题。
- 共享浮层使用一个受限 transform 例外，不引入第三方 Preview Rail 代码、刻度轨或邻项形变。

## 风险

- attention revision 推进若不幂等会重复点红：用当前 red signature 与最后同步 signature 比较，迁移和刷新测试覆盖。
- 当前会话手动未读若错误消费自动恢复会立即消失：显式选择与自动恢复必须分开建模。
- 标题变化可能让旧搜索响应或隐藏标签回写旧名：请求 generation 和 canonical resolver 双重隔离。
- 横向定位依赖布局测量：用 layout effect 与实际浏览器验证，jsdom 单测只验证调用与状态。
- 回滚时新增 SQLite 列保持向前兼容；代码不再消费时不会影响旧行为。
