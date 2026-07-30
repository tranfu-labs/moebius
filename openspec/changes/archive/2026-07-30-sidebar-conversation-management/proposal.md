# 提案：sidebar-conversation-management

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-left-sidebar.md` | `#置顶区`、`#项目与对话菜单`、`#标记为已读与未读`、`#重命名对话` | 新增置顶迁移、阅读状态菜单、共享信息浮层与重命名 | 已写入并通过产品复评 |
| `docs/product/pages/main-conversation.md` | `#页面标题`、`#侧边栏状态点的触发` | 明确标题持久化、红点确认与控制工作优先级 | 已写入并通过产品复评 |
| `docs/product/pages/search.md` | `#操作与反馈` | 明确重命名后的唯一标题、竞态与失败恢复 | 已写入并通过产品复评 |
| `docs/product/pages/main-right-sidebar.md` | `#新会话与已有会话标签`、`#会话重命名同步`、`#标签溢出` | 明确同名区分、跨标签组同步与横向定位 | 已写入并通过产品复评 |

视觉探索入口：`docs/product/pages/main-left-sidebar.prototype.html`。原型只回答共享浮层与右栏标签的视觉问题，不是生产依赖或行为事实源。

## 背景

当前侧栏只消费 Agent 结果未读、运行和异常事实，缺少用户可控的阅读提醒、红点确认、置顶和会话重命名。现有右栏标签把标题快照持久化在 renderer 本地存储中，搜索请求也只按查询条件隔离，无法保证重命名后的跨入口一致性。现有每行 Tooltip 形态也不能形成一份共享信息面连续跟随的交互。

## 提案

- 在 local-console 会话元数据中持久化红点确认 revision、Agent 未读、手动未读、置顶时间与标题 revision，并提供带陈旧状态校验的窄 mutation。
- 在 console-ui 中增加置顶区、状态菜单矩阵、重命名弹层和全侧栏唯一共享信息浮层。
- renderer 在 mutation 持久化成功后刷新并提交视图，不做乐观迁移；同时使搜索请求和右栏标签标题服从 canonical session 标题。
- 右栏同名标签使用稳定、可读且不含完整路径或内部 id 的第二行上下文；标题读取失败时原位降级并可重试。
- 同步生产 Block / Page Story 与确定性 fixture，并在真实 Electron 页面验证关键链路。

## 影响

- 行为域：`local-console`、`console-ui`、`desktop-shell`。
- 数据：SQLite session 元数据新增兼容列；已有会话默认不置顶、无手动未读、无已确认 attention。
- API：新增会话 attention、pin、title mutation；现有 read endpoint 保持兼容。
- UI：侧栏中部滚动结构、对话菜单、浮层、右栏标签和搜索结果更新。
- 架构：不新增跨层反向依赖；生产代码不得 import、复制或运行时读取 `prototypes/`。
