# 提案：add-conversation-relay-rail

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-conversation.md` | `# 会话目录轨` | 当前主会话正文左侧新增可折叠目录轨；补充整行命中、Git graph 曲线、面板固定预览偏移与 Agent 两行预览模板 | 已写入 |
| `docs/product/pages/main-left-sidebar.md` | 页面职责 | 明确项目 / 会话侧栏不承载消息目录轨 | 已写入 |

## 背景

长会话目前只能靠正文滚动回看，用户无法从主会话左侧快速纵览用户与多成员的真实往返，也不能从紧凑目录直接预览和定位某条消息。已确认原型曾错误落在会话侧栏，现已纠正到当前主会话正文左侧。

## 提案

- 从当前主时间线已有的可见用户消息与 Agent 最终回复投影目录事件，不新增并行消息事实源。
- 收起态显示身份色短横线；展开态显示用户菱形、Agent 圆点和只连接相邻可见行的 Git graph 式曲线。
- 展开态每条事件行整体可悬停、聚焦和点击；预览卡相对整个展开面板保持固定横向间距。
- Agent 预览只显示可读成员名、时间与回复开头；用户预览显示“你”、时间与原文开头。
- 长会话按时间线可用高度形成围绕阅读焦点的折叠窗口；目录浏览与正文定位分离。
- 当前会话保存最后阅读消息；切换返回时尽力恢复，新消息不打断历史阅读。

## 影响

- `packages/console-ui`：新增目录轨纯模型与组件，接入 `OperatorConsole`，补充 Storybook、测试与设计语言。
- `desktop/src/console-page`：持久化每个根会话的最后阅读消息。
- `docs/product/pages/main-conversation.prototype.html` 与对应原型源码：同步四项最新视觉反馈，继续作为视觉验证制品。
- 不改 `conversation-sidebar.tsx`，不新增 local-console API，不改变 JSONL / SQLite 边界。
