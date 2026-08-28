# desktop-shell delta：Electron 43 通知历史回流

本 delta 依赖 active change `terminal-notification-delivery` 已建立的任务提醒投递、权限弹窗、Dock 和运行中点击回流契约；只新增 Electron 43 的 macOS 历史通知恢复与授权桥边界。

## Requirement: macOS 历史通知可以冷启动回流

Source: `docs/product/flows/state-change-delivery.md#点击通知回到对应对话`、`#端到端验收`

- MUST 使用 Electron 43 macOS `Notification` 的稳定 `id` 标识每条任务提醒，并保留该 ID 到 `{ sessionId, roundId, terminalMessageId }` 的持久映射。
- MUST 在应用就绪时调用 `Notification.getHistory()`，为仍在 macOS 通知中心且能在持久映射中找到的历史通知对象重新挂接点击处理。
- MUST 让用户在 Moebius 已明确退出后点击仍保留的历史任务提醒时冷启动应用，并打开该通知对应的会话与终局记录。
- MUST 让历史通知点击继续经过现有的主进程持久化点击载荷、窗口激活、renderer 定位和消费对账链路，不因历史恢复创建第二套导航协议。
- MUST 在普通启动、历史查询失败、历史通知 ID 未知或目标记录不可用时不伪造通知点击、不自动跳转到猜测的会话，并保留既有用户现场/不可用提示。

#### Scenario: 退出后点击历史通知定位目标会话

- **GIVEN** 一轮终局已提交一条带稳定 ID 的任务提醒，且该提醒仍保留在 macOS 通知中心
- **WHEN** 用户明确退出 Moebius 后从通知中心点击该提醒
- **THEN** Moebius 冷启动并恢复窗口
- **AND** 应用打开该通知绑定的会话并定位对应终局记录
- **AND** 不重复提交这条通知。

#### Scenario: 普通启动不消费历史列表

- **GIVEN** 应用启动时 `Notification.getHistory()` 返回一条或多条仍保留的任务提醒
- **WHEN** 用户没有点击任何通知而普通启动 Moebius
- **THEN** 应用不自动跳转到任何历史通知目标
- **AND** 不生成或持久化虚假的通知点击。

#### Scenario: 未知历史通知安全忽略

- **GIVEN** `Notification.getHistory()` 返回的通知 ID 不在 Moebius 当前持久映射中
- **WHEN** 应用为历史通知恢复点击处理
- **THEN** 该通知不触发任务提醒点击载荷
- **AND** 已知会话事实、窗口现场和其他历史通知处理不受影响。

## Requirement: Electron 43 不替代 macOS 通知授权事实源

Source: `docs/product/flows/state-change-delivery.md#每次发送前检查权限，未通过时由弹窗承接本次终局`

- MUST 继续在每次真正提交通知前读取 macOS 当前通知授权状态，并按现有权限弹窗语义处理未授权、拒绝和读取失败。
- MUST 在 Electron 43 没有提供主进程 macOS 通知授权查询/请求 API 的前提下保留现有 `desktop/native/macos-notification-permission` Swift bridge，不把 `Notification.isSupported()`、`getHistory()` 或媒体授权 API 当作通知授权结果。
- MUST 让 Electron `Notification` 负责通知提交/历史恢复，Swift bridge 只负责现有授权状态读取与请求；不得新增与宿主竞争通知身份的第二套提交通道。

#### Scenario: 历史 API 存在但授权仍走 bridge

- **GIVEN** Electron 43 可以查询 macOS 历史通知
- **WHEN** 任务提醒执行发送前权限检查或权限弹窗的请求/重新检测
- **THEN** 应用仍读取/请求真实 macOS 通知授权
- **AND** 历史通知 API 的可用性不被展示为授权已允许，也不绕过现有权限降级。
