# 设计：terminal-notification-delivery

## 方案

### 总链路

```text
主理人 run 终局 / 事实流
  → round-closeout-plan（纯 domain：轮次状态机、收束分类、30s 静默）
  → round-terminal-runtime（落盘收束事实，生成 event_id）
  → 内部类型化事件总线 session:round:terminal
      ├─ 侧边栏单点投影（roundState → 红/蓝/闪烁/无点）
      ├─ Dock 适配器（未归档对话当前可见红点+蓝点计数）
      ├─ macOS 通知适配器（发送前权限检查 → Notification+声音 / 权限弹窗）
      └─ 点击回流（激活窗口 → 打开对话并定位收束记录）
```

### 分层与文件职责（按 module-map 四层）

**domain（纯逻辑，可单测，无 IO）**
- `src/local-console/round-closeout-plan.ts`（新）：轮次状态机 `not-started / in-progress / terminal-completed / terminal-awaiting / terminal-no-new-content / silent-closeout`；轮次开始边界（首次发送、收束或终止后的重试/重新运行）、进行中追加归当前轮、收束三分类、30 秒静默计时与重置事件集、跨重启恢复（`silentSince` 持久化）。
- `packages/console-ui/src/console/status-dot.ts`（改）：单点派生 `roundState + 未确认待处理事实 + unread/manualUnread + archived → 红/蓝/闪烁/无点`；Dock 计数投影＝未归档对话中当前可见红点或蓝点的去重数。
- `desktop/src/notification-preference.ts`（新）：任务提醒总开关原子持久化（仿 language-preference，默认开启）。
- `desktop/src/permission-modal-plan.ts`（新）：发送时权限弹窗状态机（三操作、多对话合并、暂时无法检测、关闭通知 3 秒保存事务）。

**application**
- `src/local-console/round-terminal-runtime.ts`（新）：订阅事实流 → 落盘收束事实（绑定 terminal messageId）→ 发布终局事件；`event_id` 去重持久化。
- `src/local-console/round-silent-runtime.ts`（新）：30 秒静默调度与结论落盘。
- `desktop/src/notification-delivery-runtime.ts`（新）：总开关检查 → 每次发送前权限读取 → 提交系统通知+声音，或进入权限弹窗队列；Dock 计数维护；通知失败只记录通道异常、不回滚事实。
- desktop renderer：设置开关保存状态机、Onboarding 第 4 步 controller、权限弹窗 controller。

**adapter**
- `desktop/src/macos-permission-adapter.ts`（新）：授权状态读取、首次授权请求、打开系统通知设置（实现见 spike 结论）。
- `desktop/src/notification-channel.ts`（新）：Electron `Notification` 提交、`failed` 事件、声音、`app.dock.setBadge`。
- `desktop/src/notification-click-return.ts`（新）：点击 → 激活/启动 → IPC → 打开会话并定位收束记录（应用退出后启动路径）。
- IPC 扩展：settings（偏好读写、权限、通道、弹窗操作）、onboarding（第 4 步）、preload/contract。
- `src/local-console/state-query-*`：会话快照增加 roundState 投影。

**view（packages/console-ui）**
- 现有生产 Story 组件接入真实 props：任务提醒设置组、权限弹窗、Onboarding 第 4/5 步、侧边栏单点。
- i18n zh/en 已统一「任务提醒」用户文案。

### 事件 schema（内部类型化）

```json
{
  "event_id": "session:round:terminal:<sessionId>:<roundId>",
  "session_id": "...",
  "round_id": "...",
  "outcome": "completed | awaiting-user",
  "terminal_message_id": 123,
  "conversation_title": "...",
  "occurred_at": "..."
}
```

- 收束事实成功落盘后才发布事件；同一 `event_id` 最多投递一次（持久化去重）。
- 通知/弹窗失败不回滚、不改写对话终局。
- 点击回流使用 `session_id + terminal_message_id`，脚本/消费者不猜路由。
- 不开放用户脚本 Hook（用户已裁决：内部类型化事件总线 + 原生消费者）。

### 单点状态机与 Dock（用户已确认）

- 每段对话始终只显示一个点；新一轮开始后旧蓝点结束、只显示闪烁点；本轮结束后按结果显示红/蓝/无点。
- 折叠项目只聚合一个最高优先级代表点。
- Dock＝未归档对话当前可见红点+蓝点的去重数；闪烁与无点不计；归档退出 Dock，恢复后重新计数；项目移除退出 Dock 且保留事实（当前无恢复入口）。

## 权衡

| 方案 | 取舍 | 结论 |
| --- | --- | --- |
| 从队列瞬时状态推断结束（现状基线） | 交棒缝隙抖动、无一等收束事实、跨重启不可恢复 | 不采用；被用户与 PRD 明确否决 |
| 用户可配置脚本 Hook（Claude Code 式） | 触发源被 Provider Stop 污染、权限归 Script Editor、静默失败、安全面大 | 不采用；内部事件总线+原生消费者 |
| 权限读取：`macos-notification-state`（Electron 官方推荐） | 原生模块需 node-gyp 编译与签名 app 内加载；社区维护、API 稳定 | 首选，spike 验证后定案 |
| 权限读取：自建 Swift 原生桥 | 完全自控、无第三方依赖；需 Xcode CLT、维护成本 | 备选，spike 对比 |
| 权限读取：Renderer Web Notifications + failed 事件兜底 | 官方文档确认可用但权限状态仍需原生模块；renderer 通知无法承载「应用已退出后的通知点击回流」 | 不采用为主路径；main 进程 Notification 承担提交与点击 |
| 提交失败判定：直接 `show()` 后等 failed | 无法在发送前区分「未授权/拒绝/通道故障」，无法给出三操作恢复弹窗 | 不采用；发送前权限读取为准 |
| Dock 计数：底层提醒 vs 可见点 | 用户已裁决只统计当前可见红点与蓝点；被遮挡提醒不再计入 | 按裁决实施 |

## 风险

- **签名应用 spike 决定权限读取实现**：未签名 Electron 的 Notification 一定发 `failed`；adhoc 签名是否足够、`macos-notification-state` 能否在 arm64 + Electron 38 编译加载，必须在实现第一步验证（见 spike 结论）。
- **requestAuthorization 系统弹窗需要人工交互**：自动化环境无法代点授权弹窗；该分支的完整真机验收在功能验收阶段执行。
- **事件总线与既有 runtime 的耦合**：收束判定必须在主理人终局路径上接线，避免遗漏「不继续交棒即收束」的既有语义；用纯 domain 状态机 + 单测隔离。
- **睡眠/唤醒时序**：不承诺睡眠期间任务推进；唤醒后按真实保存边界发一次通知，靠 `event_id` 去重防重复。
- **回滚思路**：通知/权限/Dock 全部为「终局事实的消费者」，关掉总开关或卸载适配器即可回到纯侧边栏行为，不影响会话事实。

## Spike：签名最小应用验证结论（2026 实机执行）

**环境**：本机 arm64 macOS；Electron 38.8.6；adhoc 签名（`codesign -s -`）；`UNUserNotificationCenter` 经 Swift 原生桥读取。**重要环境陷阱**：本机环境设置了 `ELECTRON_RUN_AS_NODE=1`，任何 Electron 运行（spike、desktop dev/build）都必须 `env -u ELECTRON_RUN_AS_NODE` 显式清除，否则 Electron 以纯 Node 运行且不加载应用代码；实现阶段的启动脚本与 CI 必须显式处理。

| 验证项 | 结果 |
| --- | --- |
| 授权状态读取（尚未决定） | ✅ `.app` bundle 内 Swift 桥读取 `authorizationStatus=notDetermined`，alert/sound/badge 分项均为 notDetermined |
| 命令行无 bundle 上下文 | ❌ `UNUserNotificationCenter.current()` 崩溃（`bundleProxyForCurrentProcess is nil`）→ 权限读取必须运行在 .app bundle 内（主进程原生模块或 bundle 内可执行） |
| 系统通知提交（adhoc 签名 + bundle id io.moebius.spike） | ✅ `Notification.show()` 触发 `show` 事件 |
| 签名移除/无效 | ❌ 应用无法启动（与 Electron 官方「unsigned 发 failed」同方向，且更早失败）→ 正式发行必须有效签名 |
| Dock 角标 | ✅ `app.dock.setBadge("5")` 设置与清除成功 |
| 系统设置入口 | ✅ `shell.openExternal("x-apple.systempreferences:com.apple.preference.notifications")` 打开系统通知设置（macOS 12+ 的 `UNUserNotificationCenter.openSystemSettings` 在当前 SDK 不可用） |
| 首次授权请求 | ⏳ `requestAuthorization` 弹系统授权框需人工确认，属真机功能验收项 |
| 系统设置外部改回允许 / 声音单独关闭 | ⏳ 需人工在系统设置操作，属真机功能验收项 |

**实现定案**：
1. **权限读取走「运行在 .app bundle 内的原生桥」**：首选 `macos-notification-state`（Electron 官方推荐），实现第一步先验证其在 arm64 + Electron 38 下编译加载（node-gyp 需 Xcode CLT，本机已具备）；若编译或加载失败，回退到自建 Swift 桥（spike 已验证 bundle 内读取授权可行，需随 app 分发编译产物并处理代码签名）。**最终采用自建 Swift 桥**（macos-notification-state 1/2/3.x 均无授权查询 API）。
2. **桥身份契约（QA #135 FQA-03 修正）**：`UNUserNotificationCenter` 按 bundle 标识读写授权，桥必须与通知提交使用同一身份且必须签名。生产脚本按 `desktop/package.json build.appId`（io.tranfu.moebius）写入 Info.plist 并 adhoc 签名；开发态宿主是 Electron（com.github.Electron），因此构建双变体（`MoebiusPermissionBridge.app` / `MoebiusPermissionBridge.dev.app`），adapter 按 `process.execPath` 所在 bundle 的 CFBundleIdentifier 选择变体。实机复验：未签名或签名后改写 Info.plist 都会使 `requestAuthorization` 立即返回 `UNErrorDomain error 1`（「Notifications are not allowed」）；双变体预签名后 `request` 进入系统授权弹窗等待（8 秒有界复验确认阻塞于弹窗）。桥错误负载（`{"error": "..."}`）由 adapter 原样透出，设置页显示「暂时无法使用系统通知」而非伪装「尚未开启」。**已拒绝状态（QA #137）**：已拒绝 bundle 的 `requestAuthorization` 不弹窗、直接返回 error 1（实机确认 dev 与打包身份均曾为 denied）；`request` 失败后回读真实状态（domain `planPermissionAfterRequest`），denied → 显示「已拒绝 + 打开系统设置」，回读仍失败才显示「暂时无法使用系统通知」；`readState` 首次打开即读取真实权限（`ensurePermission`，总开关关闭时不读），设置与 Onboarding 不再显示空值。**打包**：`build.extraResources` 含 `native/build/MoebiusPermissionBridge.app → native/MoebiusPermissionBridge.app`，已用 `electron-builder --mac --arm64 --dir` 实机验证包内路径存在、签名校验通过、包内桥 status 正常。
3. **系统设置入口**：使用 `shell.openExternal("x-apple.systempreferences:com.apple.preference.notifications")`（已验证）。
4. **通知提交**：Electron 主进程 `Notification` + `failed` 事件（正式签名下已验证 `show`）；`failed` 事件映射为「暂时无法发送系统通知」通道状态。
5. **Dock**：`app.dock.setBadge`（已验证）。
6. **环境**：所有 Electron 启动路径显式清除 `ELECTRON_RUN_AS_NODE`。
7. **主理人一等收束信号（QA #135 FQA-04 修正）**：轮次收束不得从任意 Agent 消息推断。主控分发对主理人 Agent 消息做出 `complete-source` 判定（完成且未点名下一位成员，即明确不继续交棒）时，落盘 `primary_closeout` 事实（幂等键＝消息 id，rewind/重试后重复判定幂等忽略）；`buildRoundView` 只消费该事实派生 `lastPrimaryFinishAt / producedContent / latestAgentMessageId`。专业成员回复、主理人待接回、短暂空队列、成员结束后继续推进均保持 in-progress，只有真正主理人收束才生成 `completed`。
8. **投递状态持久化与冷启动点击载荷（QA #135 FQA-05 修正）**：已投递 `event_id` 集合、待展示权限弹窗列表、最近一次通知点击载荷（`lastClicked`）与消费时刻（`lastConsumedClickAt`）原子落盘于数据根 `.state/task-reminder-delivery.json`；runtime 重建（退出/崩溃后重启）恢复同一弹窗且不补发；renderer 启动时读取 `pendingClick` 并按持久化载荷定位，消费后经 `task-reminder:click-consumed` 对账。**冷启动点击裁决（2026-08-10 产品方已确认，取代 QA #137 旧表述）**：见下节「冷启动 spike 实测」——Electron 38 本地通知在应用退出后无法保留于通知中心（退出即被清除），通知中心点击冷启动在此技术栈实测不可行；产品方已接受「显式退出后不承诺通知点击回流」，PRD（docs/product/flows/state-change-delivery.md）已回写三段生命周期边界。

### 冷启动 spike 实测（PDL #139/#146 障碍型方案，2026-08-10 实机）

**调研（官方能力说明与类型定义）**
- Electron 38.8.6 `electron.d.ts` 与官方 app 文档：`app.on('ready', (event, launchInfo))` 存在；darwin 从通知中心启动时 `launchInfo` 承载 `NotificationResponse`（`{actionIdentifier, date, identifier, userInfo, userText?}`）。
- Apple 文档（Handling Notifications and Notification-Related Actions）：用户选择通知动作时系统会启动应用并投递 `UNNotificationResponse` 给通知中心 delegate。
- Electron 38 `NotificationConstructorOptions` 无 `id`/`userInfo` 字段（identifier 由系统生成 UUID）——生产绑定目标需原生通道或持久化映射。

**候选与代价**

| 候选 | 代价 | 实测结论 |
| --- | --- | --- |
| Electron 38 `ready` launchInfo（通知点击冷启动） | 通知需在应用完全退出后仍保留于通知中心；需解决 identifier 绑定（Notification 无 id/userInfo） | **证伪**：通知退出即被清除（4 轮实测），通知中心无残留可点击，launchInfo 通道无法触发；普通启动时 `launchInfo` 为 `{}`（空对象，非 null） |
| 原生 UNUserNotificationCenter 通道（Swift 桥投递 + 自定义 identifier/userInfo） | 桥须与宿主同 bundle id（授权共享）；桥为嵌套 app 时客户端签名验证失败 | **证伪**：嵌套桥（同 bundle id）add 恒 `error 1`（验证失败，与授权状态无关）；独立桥同 id 注册会覆盖宿主 LaunchServices 记录，点击启动的不是宿主 |
| 升级 Electron ≥40 + `Notification.getHistory()` | 大版本升级影响面未评估；getHistory 语义依赖「通知中心残留通知」 | **当前版本不可验证**：38 通知不残留（见上）；40+ 是否改变清除行为未知，留待升级后评估 |

**签名验证硬门槛（macOS 26.5.1 实机，推翻「adhoc 即可」旧假设）**
- usernoted 对通知客户端做代码签名验证：**adhoc 签名（含带 cdhash/identifier requirement 变体）一律验证失败**（amfid `-423`，无证书链）→ `requestAuthorization`（标准/provisional）与 `add` 全部立即 `UNErrorDomain error 1`，**系统授权弹窗永远不会出现**；`getNotificationSettings` 仍返回（对验证失败客户端返回合成值，不可作权威）。
- **Developer ID 未公证**同样失败：usernoted 执行证书链验证（`SecTrustEvaluateIfNecessary`）但被 Gatekeeper 拒（`spctl: rejected, Unnotarized Developer ID`）。
- ncprefs 手工注入授权条目（含 src/req 完整格式）**无效**：usernoted 对验证失败客户端返回合成状态，不读注入值。
- **授权弹窗的真实触发路径**：`NSUserNotificationCenter`（废弃 API）`deliver` 触发 legacy `askpermissions` 弹窗（绕过签名验证）；用户点「允许」后 usernoted 记录 `Authorization set for <bundle> to allow: YES`（实测写入成功）。**同一身份弹窗只弹一次**：未响应即被记为 denied，之后不再弹窗；换全新 bundle id 可再次触发。
- **投递身份验证的差异**：Electron 主进程（LaunchServices 注册记录与进程签名一致）验证**通过**，授权后 `add` 成功（NotificationsPipeline 全流程 Success、`Presenting ... as banner`）；嵌套桥（路径/签名与注册记录不一致）验证恒失败。

**投递与清除实测（授权后，4 轮）**
- Electron 主进程 `Notification`（默认 timeoutType）：投递成功、banner 呈现，**约 4 秒后 banner 收起即被从 delivered 移除**（app 运行中也移除）。
- `timeoutType: 'never'`：app 运行期间保留（>10 秒），**`app.quit()`/`app.exit()` 时仍被 Electron 主动清除**（usernoted 日志 `removeDeliveredNotification`，source 为 Electron 连接）。
- 结论：**Electron 38 本地通知在任何情况下都无法在应用完全退出后保留于通知中心** → 「退出后从通知中心点击启动」在此技术栈不可行；`ready` 的 `NotificationResponse` launchInfo 通道无法被触发。

**生产影响（本轮实证）**
- 「打开系统设置恢复」路径的前提（身份曾被真实用户拒绝）在本机不成立——denied 多为验证失败合成；但该路径对真实拒绝场景仍有效，保留。
- 正式发行若需 `requestAuthorization` 系统弹窗（非 legacy 路径），**必须 Developer ID + 公证签名**（当前 electron-builder 配置无 identity，默认 adhoc）；发布管线需增加公证步骤（本机无 notarytool 凭据，未实测公证后弹窗，按 Gatekeeper 语义推断）。
- 点击回流按产品方已裁决的三段生命周期交付：**运行中点击直达**（click 事件定位）；**点击已接收、定位前中断则下次启动续定位**（持久化 `pendingClick` 载荷，不重放通知）；**`Command+Q` 明确退出后无通知冷启动**（Electron 38 移除已提交通知，普通重开经持久化侧边栏红/蓝点找回，不得伪造历史通知点击）。Electron 40+ 评估拆分为后续技术升级，不扩大本次功能风险。
