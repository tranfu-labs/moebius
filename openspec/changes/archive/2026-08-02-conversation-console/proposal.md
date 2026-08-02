# 提案：conversation-console

## 背景
当前架构里 GitHub issue 同时承担三重角色：操作台（人在评论区发指令、@角色）、消息总线（agent 交棒靠评论传递、runner 轮询扫描）、留痕层（过程与验收锚在评论上）。本地观察页只是这套架构的补丁——只有可见性、没有操作权，人看到问题仍要切去 GitHub 处理，观察与操作割裂，页面沦为鸡肋。

以 GitHub issue 为操作台的具体痛点：

1. 反馈延迟：消息要等心跳轮询拾取，`eyes` reaction 是唯一即时反馈，交互节奏是分钟级异步。
2. 运行黑盒：codex 运行期间在 GitHub 上完全不可见，中断只能靠发新评论旁敲侧击。
3. 协议手写格式：一条消息一个 mention、验收走查 `N. 通过 — 依据`、提案确认 key——这些硬格式存在的唯一原因是界面是纯文本评论区，人写错了 runner 还要发提醒。
4. 两套心智：看全局去观察页，操作去 GitHub。

## 提案
把人机交互的主战场从 GitHub issue 评论区迁到本地：观察页从「只读旁路」升格为「本地对话操作台」，采用 codex CLI 那种对话形态——项目 → 会话两层侧栏、单时间线多角色混排、运行过程直播可中断、协议格式由控件生成。

本次 change **仅交付页面独立设计**：信息架构、交互规则与字符图线框。不含任何代码实现，也不设计与 runner / 状态文件的代码层对接（数据来源、写入通道、进程边界由后续对接设计补充）。

## 影响
- 本次零代码、零运行时行为变化；change 落盘后停留在 `openspec/changes/`，归档推迟到实现完成。
- 未来实施并归档后：`src/observer/` 只读页被对话操作台取代；`openspec/specs/github-issue-runner/spec.md` 中观察页呈现类规格移交新业务域 `local-console`；`docs/wireframes/pages/observer.md` 被 `pages/console.md` 取代；`docs/wireframes/flow.md` 的 Observer 节同步更新。
- 观察页的进程隔离、依赖方向、只读红线等架构条目本次不动，由对接设计 change 裁决。
