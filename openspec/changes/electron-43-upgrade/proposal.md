# 提案：electron-43-upgrade

## 需求基线

本 change 依赖现有 `terminal-notification-delivery` change 已建立的任务提醒、权限弹窗、Dock 与运行中点击回流实现；本 change 只补齐 Electron 43 运行时迁移和退出后的历史通知回流。产品意图已先写入 PRD，以下只保留指针。

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| 当前用户任务描述 | 背景、范围三件事、验收 | Electron 38.8.6 升级至 43.x；使用 `Notification.getHistory()` 做冷启动回流；调研授权 API 并按结果保留或退役 Swift 桥；本地签名包验收 | 已提供 |
| `docs/product/flows/state-change-delivery.md` | 范围、开始条件、点击通知回到对应对话、完成条件、指标与端到端验收 | 明确 Electron 43.x 下，退出后仍留在通知中心的任务提醒点击时冷启动并定位对应会话；移除通知不构成回流入口 | 已写入 |
| `openspec/changes/terminal-notification-delivery/design.md` | 冷启动 spike 实测 | 作为现有 Electron 38 负向基线与 `getHistory()` 待升级验证的技术输入 | 已有 |
| `openspec/changes/terminal-notification-delivery/spec-delta/desktop-shell/spec.md` | 通知点击回流与生命周期边界 | 现有运行中点击、持久化点击载荷和权限/投递行为继续复用；本 change 补充其 Electron 43 历史通知部分 | 已有，待本 change 补充 |

## 背景

桌面包当前锁定 Electron 38.8.6。macOS 通知仍走已废弃的 `NSUserNotification`，在 macOS 26 上无法完成可靠的通知中心注册和投递。Electron 42 已迁移到 `UNNotification`，该改动不向旧版回移；本 change 目标固定为 43.x，当前选定补丁版本为 43.4.1。

现有任务提醒实现已经把终局事实、通知提交、权限桥、点击载荷和 renderer 定位拆开，但 Electron 38 的实测结论是应用退出时通知被清除，无法完成通知中心历史冷启动。Electron 43 的 `Notification.getHistory()`、通知自定义 `id` 与 `groupId` 提供了重新接入的运行时能力；需要把历史通知对象接回现有点击载荷和会话定位链路，同时完成 39–43 逐版 breaking changes 盘点。

## 提案

1. 将 `desktop` 的 Electron 依赖及锁文件解析版本升级到 43.4.1，逐版审查 Electron 39、40、41、42、43 的 breaking changes，并对实际命中点做适配和回归。
2. 保留主进程 `Notification` 作为唯一系统通知提交通道；每条任务提醒使用稳定的通知标识，持久保存标识到点击目标的映射。应用就绪时调用 macOS `Notification.getHistory()`，对仍在通知中心的已知历史通知重新挂接 `click`，复用现有 `recordClick → focus/broadcast → renderer 定位 → consumeClick` 链路。
3. 调研 Electron 43 的授权能力。若只能提供通知提交/历史恢复而不能在主进程取得 macOS 通知授权状态并发起授权请求，则保留 `desktop/native/macos-notification-permission` Swift 桥及其签名 bundle；不因新增历史 API 擅自删除授权事实源。
4. 用单测覆盖通知标识、历史恢复、未知历史通知忽略、重复恢复防护和既有持久化点击回流；用 `env -u ELECTRON_RUN_AS_NODE` 的 desktop build、定向测试、全量回归和本地 arm64 签名包完成验证。不会修改 `moebius-release-moebius` skill，也不执行 push、merge 或发布。

## 影响

- `desktop/package.json`、锁文件及 Electron 构建/开发启动链路：版本、lazy binary 下载和 43.x 运行时。
- `desktop/src/notification-channel.ts`、任务提醒 delivery runtime/wiring/state/plan、桌面生命周期注册：稳定通知标识、历史对象恢复和冷启动时序。
- `desktop/native/macos-notification-permission`、`desktop/scripts/build-native.mjs`：在 Electron 无通知授权查询/请求 API 时继续作为同身份签名桥，不删除现有嵌套 bundle 契约。
- `desktop/tests/*` 及任务提醒相关根测试：新增或调整行为测试；与现有 Electron 38 基线的失败项分开记录，不把基线红灯误报为本 change 回归。
- 对外行为：macOS 26 上正式签名桌面包使用新通知框架；运行中通知点击保持原回流；应用退出后，仍在通知中心的历史通知点击时冷启动并定位到对应会话。
