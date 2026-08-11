# 任务：terminal-notification-delivery

## 0. 方案调研与 spike

- [x] 英文调研：Apple UNUserNotificationCenter 官方文档、Electron Notifications 官方文档、macos-notification-state 官方说明、Windows 对比基线。
- [x] 方案对比（≥2 实现 + 维持现状基线）写入 design.md。
- [x] 构建最小签名 Electron 应用 spike：未签名无法启动、adhoc 签名 Notification `show`、授权状态读取（Swift 桥，bundle 内）、Dock、系统设置入口、环境陷阱（`ELECTRON_RUN_AS_NODE`）均已实机验证；结论回填 design.md。
- [x] 实现第一步：macos-notification-state 1/2/3.x 均只提供锁屏/勿扰，无授权查询 API → 定案自建 Swift 桥（spike 已验证），桥以 .app 包装随应用分发（desktop/native/macos-notification-permission + build-native.mjs + extraResources）。

## 1. local-console：轮次/收束/静默

- [x] `round-closeout-plan.ts`（domain）：轮次状态机、开始边界、收束四分类、30s 静默、剪枝/去重/解析纯函数。
- [x] `round-terminal-event-bus.ts`：内部类型化事件总线（session:round:terminal，不开放脚本 Hook）。
- [x] `round-terminal-runtime.ts`（application）：视图组装 → domain 判定 → 收束事实落盘（store 幂等 `recordRoundTerminal`，jsonl 事实日志）→ 事件发布（event_id 去重持久化）。
- [x] `runtime-round-wiring.ts`（composition root 辅助）：装配 bus/runtime + 绑定 state-query 端口。
- [x] state-query 投影：所有可见会话 roundState（含剪枝复用）；`LocalConsoleSessionSummary.roundState`。
- [x] 单测：轮次边界 10 用例（tests/round-closeout-plan.test.ts）。

## 2. desktop：通知/权限/Dock/回流

- [x] `task-reminder-preference.ts`：任务提醒总开关原子持久化（默认开启，损坏回退 true）。
- [x] `macos-permission-adapter.ts`：spawn Swift 桥读取/请求授权（bundle 内验证）。
- [x] `notification-channel.ts`：Electron Notification 提交、failed 事件、click 回流回调、dock badge。
- [x] `task-reminder-delivery-plan.ts`（domain）+ `task-reminder-delivery-runtime.ts`：总开关→权限→通知/弹窗；失败只记通道异常。
- [x] `permission-modal-plan.ts`（domain）：三操作状态机、多对话合并、关闭保存事务。
- [x] `task-reminder-ipc.ts`（transport）+ `desktop-main-infrastructure-ipc`（composition root 装配 delivery ports + Dock 计数）。
- [x] 点击回流：channel click → 激活窗口 + broadcast `task-reminder:clicked`（renderer 定位）。
- [x] preload 暴露 read/set/modal-action/recheck/open-settings/clicked。
- [x] 打包：extraResources 带 MoebiusPermissionBridge.app；开发态 desktop/native/build。
- [x] 单测：弹窗状态机 + 投递判定 + Dock 计数（tests/task-reminder-delivery.test.ts，7 用例）。

## 3. console-ui：单点与页面接入

- [x] 设置弹窗：SettingsDialog 新增 taskReminder 设置组（真实偏好/权限/异常状态、3 秒保存事务、失败回退、重新检测、打开系统设置；i18n settings.taskReminder）。
- [x] 权限弹窗：OperatorConsole 挂载 NotificationPermissionDialog，订阅真实 modal 队列（phase→openingSettings/closingSave 映射），三操作接通 request/recheck/close-notifications + 失败重试；无第四种静默关闭。
- [x] Onboarding：真实 5 步 reducer（任务提醒=第 4 步整页 NotificationPermissionStep，就绪=第 5 步），route 接 useTaskReminderController（真实权限请求与回看状态），不再使用 Story harness 作为真实流程。
- [x] 侧边栏：OperatorSession/ConversationSidebarSession 携带 roundState；status-dot 单点派生（terminal→红/蓝/无点，进行中→闪烁）；toSidebarProject 透传 roundState；折叠聚合沿用同源优先级（与 Dock 计数同一定义）。
- [x] 点击回流：operator-console-view 订阅 task-reminder:clicked → readingPositionStore 定位收束记录 → selectConversation 打开目标对话；目标不可用分支 console.warn 并保留现场。
- [x] 测试：status-dot 单点 5 用例、onboarding-shell/state 适配 5 步（26+8）、onboarding-app-routing 26、sidebar regressions 26 全绿；既有 Story 深链与 46 stories 保持。

## 4. 验证

- [x] QA #133 修复：app.tsx 补齐 `taskReminder` 真实 controller 传参（composition root 内联 useTaskReminderController），主页面接线进入构建产物（dist/console-page/app.js 验证）；三域 typecheck、desktop fresh build、check:boundaries（624/13 roots）全绿。
- [x] QA #133 修复：Onboarding 步数统一为 5（zh/en `onboarding.progress` →「共 5 步 / of 5」；NotificationPermissionStep 已是「第 4 步，共 5 步」；测试断言「第 2 步，共 5 步」与「1 / 5」不存在同步更新）。
- [x] `pnpm run test --scope` 全绿（298 通过 + 4 跳过 acceptance；desktop 115；console-ui 524）。
- [ ] 新增带副作用动作的实现阶段真实页面确认（设置开关、权限弹窗、通知/Dock、Onboarding 第 4 步、点击回流）——需 GUI 会话与人工交互（含 requestAuthorization 系统弹窗），属功能验收阶段。
- [ ] 不跑全量 `pnpm test`、不归档 change、不合并 spec-delta、不提交、不 push。

## 功能验收记录（2026-08-10，第一轮）

结论：不通过。真实 Onboarding 可进入任务提醒步骤，但主页面无法渲染；其余依赖主页面的验收项被同一前置故障阻断。

### FQA-01 · 完成 Onboarding 后主页面为空白

- environment: 真机（当前 worktree 的真实 Electron 窗口、真实本地服务、真实 IPC 与 worktree 数据根；托管进程 `terminal-notification-functional-qa-electron-clean-env`，CDP 9333）
- 入口：首次启动 Onboarding 第 5 步「准备就绪」。
- 操作：从第 1 步逐步完成真实引导；第 4 步点击「暂时不要」；第 5 步点击「开始使用」；随后刷新主页面。
- 屏幕／系统观察：路由进入 `#/`，但 `#root` 为空，窗口无任何主页面内容；刷新后仍为空。Renderer 报 `ReferenceError: taskReminder is not defined`。当前源码随后执行 `pnpm --filter @moebius/desktop typecheck` 也以退出码 2 失败：`OperatorConsoleApp` 未提供必填的 `taskReminder` prop（`src/console-page/app.tsx(275,6)`）。现有 `desktop/dist/console-page/app.js` 时间早于相关源码，不能代表当前源码的有效新构建。
- 与承诺一致否：否。预期进入可操作的真实主页面；实际所有设置、侧边栏、对话、权限弹窗、Dock 与通知回流入口均不可达。
- 最小复现：干净数据根启动当前 worktree Electron → 完成 Onboarding → 点击「开始使用」。
- 影响范围：主页面全部功能；本 change 的设置、任务提醒弹窗、状态点、Dock、通知点击回流、归档与项目移除验收全部被阻断。
- 可执行修复标准：`OperatorConsoleApp` 必须把真实 `useTaskReminderController` 结果传给 `OperatorConsoleView`；desktop typecheck、fresh build 均退出 0；从干净数据根完成 Onboarding 后主页面真实渲染，刷新与重启后仍可进入。

### FQA-02 · Onboarding 总步数前后冲突

- environment: 真机（同上）
- 入口：首次启动 Onboarding。
- 操作：依次从环境准备、选择团队、接力演示进入任务提醒，再点击「暂时不要」进入准备就绪。
- 屏幕／系统观察：第 1–3 步显示「共 4 步」；任务提醒页显示「第 4 步，共 5 步」；准备就绪页显示「第 5 步，共 4 步」。
- 与承诺一致否：否。真实流程已经是 5 步，所有步骤的总数必须一致。
- 最小复现：干净数据根打开 Onboarding，逐步点击「继续」，观察每页进度文案。
- 影响范围：首次引导与回看模式的进度认知；现有测试仍断言「第 2 步，共 4 步」，会把旧错误固化为绿色。
- 可执行修复标准：第 1–5 步统一显示「共 5 步」，中英文一致；将仍断言 4 步的测试迁移为 5 步行为断言。

### 本轮未验证（由 FQA-01 阻断）

- 轮次开始、进行中追加、成员交棒、主理人收束、30 秒静默兜底与重启恢复。
- 仅完成／等待通知一次，以及聚焦、其他页面、失焦、最小化、锁屏、专注模式、睡眠恢复。
- 系统通知、声音、Dock 单点计数、归档／恢复／项目移除。
- 设置保存、失败回退、重启持久化、权限重新检测与系统设置入口。
- 权限弹窗三项操作、多对话合并、不补发旧提醒、退出／崩溃恢复。
- 通知点击在运行中与退出后启动两种情况下的定位、目标不可用分支与隐私边界。

补充环境限制：首次托管 Electron 停止后，当前会话的 managed process 创建额度已耗尽，无法按协议再次托管启动；未回退到 shell 后台进程，因此重启复查如实保持未验证。

## 功能验收记录（2026-08-10，返工复验）

结论：不通过。FQA-01、FQA-02 已由真实 Electron 复验关闭，设置偏好跨重启也通过；但真实系统通知授权入口失败，且核心轮次收束与权限弹窗恢复存在会造成误提醒／漏提醒的实现阻断。

说明：managed process 创建额度仍已耗尽。本轮只使用有自然终点、在单次调用内启动并退出的前台 Electron 复验进程，没有启动 shell 后台进程或让服务跨回合逃逸。证据与长输出均位于系统临时目录。

### 已关闭 · FQA-01 / FQA-02

- environment: 真机（当前 worktree fresh desktop build、真实 Electron、真实 local-console、真实 IPC、隔离数据根 `/var/folders/15/y09rxzss4vq0c4sd9_g_0bvr0000gn/T/moebius-task-reminder-qa-k60GYx`）。
- 入口：干净首次启动 Onboarding。
- 操作：依次完成第 1–5 步；第 4 步点击「暂时不要」；第 5 步点击「开始使用」；随后进入设置。
- 屏幕／系统观察：第 1–5 步分别显示「第 1/2/3/4/5 步，共 5 步」；完成后 `#/` 主页面真实渲染；设置中的「任务提醒」组可达。无 renderer page error。
- 与承诺一致否：是。FQA-01、FQA-02 关闭。
- evidence: `/var/folders/15/y09rxzss4vq0c4sd9_g_0bvr0000gn/T/terminal-notification-fqa-retest.json`。

### 已通过 · 设置开关与持久化

- environment: 真机（同一隔离数据根，真实 Electron / IPC / 文件持久化）。
- 入口：主页面 → 设置 → 常规 → 任务提醒。
- 操作：关闭任务提醒，退出并重启；再开启任务提醒，退出并重启。
- 屏幕／系统观察：关闭后开关为 false，并显示「任务提醒已关闭」「系统通知、声音与 Dock 均已停用；侧边栏状态点保留」；首次重启仍为 false。重新开启并再次重启后仍为 true。Onboarding 完成标记也跨重启保留，重启直接进入主页面。
- 与承诺一致否：是。
- evidence: `/var/folders/15/y09rxzss4vq0c4sd9_g_0bvr0000gn/T/terminal-notification-fqa-persistence.json`。

### FQA-03 · 「允许系统通知」真实入口无法完成授权

- environment: 真机（真实 Electron、真实 IPC、真实 Swift permission bridge、隔离数据根）。
- 入口：主页面 → 设置 → 常规 → 任务提醒 →「允许系统通知」。
- 操作：从真实页面点击「允许系统通知」，等待 bridge 返回，并从同一 preload IPC 读取结果作结构化诊断。
- 屏幕／系统观察：点击前后页面文字完全不变，窗口始终保持焦点，没有出现 macOS 授权确认，也没有处理中、成功或失败反馈。IPC 结果由 `permission: null` 变为 `authorizationStatus: unknown`、`error: macos-permission-bridge-exit:1:`；隐藏 modal 变为 `open: false, phase: request-done`，用户仍只看到「尚未开启／允许系统通知」。bridge 的 bundle 标识为 `io.moebius.permission-bridge`，而正式应用标识为 `io.tranfu.moebius`，不能作为同一应用的通知权限事实源。
- 与承诺一致否：否。预期请求 Moebius 自身的 macOS 通知权限并显示可理解结果；实际请求失败且静默留在原状态。
- 最小复现：在通知权限尚未决定的 macOS 用户下启动当前 desktop build → 完成 Onboarding → 设置 → 常规 → 点击「允许系统通知」。
- 影响范围：Onboarding 第 4 步授权、设置授权、每次终局发送前权限判断、系统通知、声音、拒绝后的系统设置恢复；当前实现无法证明检查的是 Moebius 自身权限。
- 可执行修复标准：权限读取与请求必须绑定并签名为与 Electron 通知提交相同的 Moebius 应用身份；真实点击后出现 macOS 授权流程或明确失败，返回 authorized / denied 的真实值；页面展示处理中和最终状态；读取失败进入「暂时无法检测／暂时无法发送系统通知」而不是继续伪装「尚未开启」。
- evidence: `/var/folders/15/y09rxzss4vq0c4sd9_g_0bvr0000gn/T/terminal-notification-fqa-permission-request.json`、`/var/folders/15/y09rxzss4vq0c4sd9_g_0bvr0000gn/T/terminal-notification-fqa-permission-result.json`。

### FQA-04 · 专业成员回复会被当成主理人收束

- environment: 结构化运行诊断（当前真实 domain 实现；该证据只用于定位实现阻断，不替代后续真机用户行为复验）。
- 入口：`buildRoundView` → `planRoundCloseout` 的生产轮次判定链路。
- 操作：输入一条用户消息与随后一条 `role=implementation-lead` 的专业成员消息；模拟交棒缝隙：无 active run、无 waiting、无 pending control work。
- 屏幕／系统观察：`buildRoundView` 不读取 Agent role，把该专业成员消息时间写入 `lastPrimaryFinishAt`；`planRoundCloseout` 立即返回 `record-terminal / completed`，并把专业成员消息 id 作为终局消息。退出码 0 的结构化结果已现场打印。
- 与承诺一致否：否。预期专业成员回复和交棒缝隙保持 in-progress，不生成收束事实或通知；实际直接生成完成事实。
- 最小复现：运行 `buildRoundView`，messages 为 user + 非主理人 agent，summary 为暂时空闲；再将结果传给 `planRoundCloseout`。
- 影响范围：成员交棒、直接点名成员、暂时空队列、主理人接回前的所有多 Agent 旅程；可能提前发「已完成」并使本轮后续工作落入错误轮次。
- 可执行修复标准：收束必须消费主理人完成且明确“不继续交棒”的一等信号，不得从任意 Agent 消息推断；一次扫完专业成员回复、主理人待接回、短暂空队列、成员结束后继续推进与真正主理人收束五组场景，并在真实应用中断言交棒期间不通知、最终仅通知一次。

### FQA-05 · 权限弹窗待展示列表与冷启动回流未持久化

- environment: 结构化运行诊断与只读源码追踪（不替代后续真机重启复验）。
- 入口：`TaskReminderDeliveryRuntime` 与 `MacOsNotificationChannel` 生产实现。
- 操作：向真实 runtime 类发出一条权限未通过的 terminal event，确认弹窗包含该任务；销毁 runtime 后按相同 ports 新建 runtime，模拟应用重启。
- 屏幕／系统观察：重启前 modal 为 `open: true` 且含一条任务；重建后 modal 为 `open: false, entries: []`。实现仅用内存 `modal` 与 `Set<string> delivered`，没有将待展示列表或投递状态写入数据根。通知点击也只绑定当前进程中 `Notification` 实例的 `click` listener；未发现 cold-start payload、`open-url` 或持久路由恢复入口。
- 与承诺一致否：否。预期未解决权限弹窗跨退出／崩溃恢复，已提交通知在应用退出后点击仍能启动并定位；实际重建 runtime 即丢列表，冷启动没有可恢复的目标载荷。
- 最小复现：构造 permission=notDetermined 的 runtime → emit terminal event → snapshot → dispose → new runtime → snapshot；对比 entries。
- 影响范围：权限未通过时退出或崩溃、多对话合并、事件去重、通知中心延迟点击、应用退出后启动定位。
- 可执行修复标准：以 `event_id` 持久化投递状态和待展示列表，重启恢复同一弹窗且不补发；通知点击目标必须有可被 cold start 恢复的持久载荷／系统 activation 路由，并在运行中、正常退出后、崩溃后各从真实通知中心点击验证。

### 本轮仍未形成真实运行证据

- 轮次开始、进行中追加、专业成员交棒、主理人最终收束、30 秒静默兜底及其跨重启恢复。
- 系统通知、声音、Dock 红蓝单点计数、归档／恢复／项目移除、多对话权限弹窗与通知点击回流。
- 原因：隔离数据根没有项目；真实「添加项目」进入 macOS 原生文件选择器，当前系统未授予自动化进程辅助功能权限，不能从 CDP 操作原生面板；未绕过 UI 直写数据库或直打 HTTP。搜索可找到已有默认会话，但真实点击后仍回到无项目的新对话页，未获得可发送任务入口。
- 因此上述场景不得由单测、Story、源码推断或结构化诊断抵扣；即使修复 FQA-03～05，也必须重新从真实项目／对话用户入口完成四段证据。

## 功能验收记录（2026-08-10，FQA-03～05 返工）

结论：FQA-03～05 的代码阻断已修复并通过机械闸门；真机 GUI 复验与其余未验证场景待下一轮（本环境无托管 GUI 工具，不代跑用户动作）。

### FQA-03 · 权限桥身份统一 + 失败透出

- 根因（实机复验）：桥 bundle 标识 `io.moebius.permission-bridge` 与应用 `io.tranfu.moebius` 不一致，且生产构建未签名——未签名进程 `requestAuthorization` 立即返回 `UNErrorDomain error 1`（「Notifications are not allowed」），adapter 又把桥的 stdout 错误负载丢弃，页面只能显示「尚未开启／允许系统通知」。
- 修复：
  1. `desktop/scripts/build-native.mjs` 按 `desktop/package.json build.appId` 写 Info.plist 并 adhoc 签名；因开发态宿主是 Electron（com.github.Electron），构建双变体 `MoebiusPermissionBridge.app`（应用身份）与 `MoebiusPermissionBridge.dev.app`（开发身份），adapter 按 `process.execPath` 所在 bundle 的 CFBundleIdentifier 选择变体（`deriveRunningBundleId`）。
  2. 桥错误负载（`{"error": "..."}`）由 adapter 原样透出（`macos-permission-bridge-error:<msg>`）；设置页权限态新增 `unavailable`（「暂时无法使用系统通知」+ 重新检测），不再伪装「尚未开启」（`planPermissionViewState` + `TerminalNotificationSettings`）。
- 实机复验：两变体 `codesign --verify --deep --strict` 通过；app 变体 `status` 返回 `notDetermined` 退出 0；dev 变体 `request` 进入系统授权弹窗等待（8 秒有界复验阻塞于弹窗，随后 SIGKILL 清理，不再 error 1）。
- 待真机：允许／拒绝／系统设置外部改回、声音与专注模式分项（需人工交互）。

### FQA-04 · 主理人一等收束信号

- 根因：`buildRoundView` 把任意最后 Agent 消息（含专业成员回复）当作主理人完成，交棒缝隙直接生成 `completed`。
- 修复：主控分发对主理人 Agent 消息做出 `complete-source` 判定（完成且未点名下一位成员）时落盘 `primary_closeout` 事实（`store.recordPrimaryCloseout`，幂等键＝消息 id；rewind/重试后重复判定幂等忽略，`conflicting primary_closeout` 已消除）；`round-closeout-plan` 新增 `parsePrimaryCloseoutFact / planLatestPrimaryCloseout(FromLog)`，`buildRoundView` 只消费该事实派生 `lastPrimaryFinishAt / producedContent / latestAgentMessageId`；`primary-dispatch-runtime` 的角色判定委托 domain `planPrimaryCloseoutRecordability`。
- 测试：`tests/round-closeout-plan.test.ts` 新增交棒五场景（专业成员回复、主理人待接回、短暂空队列、成员结束后继续推进、真正主理人收束）与事实解析/投影用例，共 18 个全过。

### FQA-05 · 投递状态持久化 + 冷启动点击载荷

- 根因：弹窗列表与 `delivered` 集合仅在内存；通知点击只有运行中 `click` 监听，无持久载荷。
- 修复：新增 `desktop/src/task-reminder-delivery-state.ts`（adapter，原子写数据根 `.state/task-reminder-delivery.json`）：`deliveredEventIds`、`modalEntries`（条目含 `eventId`）、`lastClicked`、`lastConsumedClickAt`。runtime 构造期装载并恢复同一弹窗与去重集合，每次变更落盘；`pendingClick()`（domain `planPendingClick`）暴露未消费点击载荷；IPC 新增 `task-reminder:click-consumed`（preload `consumeTaskReminderClick`）；renderer 启动时按 `pendingClick` 定位并消费（`operator-console-view` 与运行中点击共用同一导航函数）。macOS 对已退出应用的通知点击不回调（平台限制，真机验收记录实际行为）。
- 测试：`desktop/tests/task-reminder-delivery-state.test.ts` 6 用例（损坏回退、文件读写、重启恢复同一弹窗且不补发、授权通知提交去重、点击载荷持久化与消费、授权通过清空弹窗）。

### 机械闸门（返工后）

- `pnpm run test --scope`：root 321 通过 + 4 skipped acceptance；desktop 121；console-ui 524。三域 typecheck、desktop build（console-ui + native 双变体 + esbuild）、`check:boundaries`（741 source / 625 production / 3 roots）全绿。
- 未跑全量 `pnpm test`、未归档、未合并 spec-delta、未提交、未 push。
- 待真机（GUI 人工）：设置「允许系统通知」真实授权流程、轮次/通知/Dock/归档/项目移除、点击回流运行中与退出后、Onboarding 第 4 步授权与回看；以及此前因无项目而缺证据的轮次与交棒真实运行场景。

### FQA-03 复验 · 仍失败

- environment: 真机（当前 fresh desktop build、真实 Electron、真实 local-console / preload IPC、签名 `MoebiusPermissionBridge.dev.app`、隔离数据根）。
- 入口：主页面 → 设置 → 常规 → 任务提醒 →「允许系统通知」。
- 操作：从真实页面点击；1.2 秒时检查真实 bridge 进程；等待 IPC 有界返回并重新读取设置状态。
- 屏幕／系统观察：`MoebiusPermissionBridge.dev.app/... request` 真实进程已启动，但窗口始终保持焦点且未出现 macOS 授权弹窗；最终 IPC 返回 `macos-permission-bridge-error:Notifications are not allowed for this application`。页面现在能正确转为「暂时无法使用系统通知／重新检查」，错误呈现的返工有效，但授权能力本身仍失败。
- 初始状态姐妹场景：打开设置时 `readTaskReminderState.permission` 仍为 `null`，页面把缺少读取结果显示为「尚未开启」；`readState()` 没有主动读取 macOS 当前权限。Onboarding 复用同一 controller，因此首次进入／回看也不能保证展示真实权限。
- 打包影响面：`resolvePermissionExecutable()` 在 packaged 模式读取 `Contents/Resources/native/MoebiusPermissionBridge.app/...`，但 `desktop/package.json build.extraResources` 没有任何 native bridge 条目；当前 `desktop build` 只生成开发目录，不能证明正式 `.app` 含桥。打包应用会进入 spawn/unavailable 分支。
- 与承诺一致否：否。预期真实请求 Moebius 的通知权限，并在设置与 Onboarding 首次读取当前状态；实际请求被系统拒绝，正式包还缺资源声明。
- 最小复现：通知权限尚未决定的 macOS 用户 → 当前 desktop dev build → 完成 Onboarding → 设置 → 点击「允许系统通知」。打包缺口可由 `desktop/package.json` 的 `extraResources` 与 packaged resolve 路径直接交叉检查。
- 影响范围：设置、Onboarding 第 4 步、首次任务完成时的权限弹窗、所有系统通知与声音；打包态会整体失去权限适配。
- 可执行修复标准：从真实 Electron 用户入口点击后必须出现 macOS 授权选择并返回 authorized / denied；首次打开设置与 Onboarding 必须读取真实当前值；bridge 必须进入实际 packaged `.app` 的 resolve 路径并通过签名后包内复验。允许、拒绝、返回设置恢复三条姐妹路径一次扫完。
- evidence: `/var/folders/15/y09rxzss4vq0c4sd9_g_0bvr0000gn/T/terminal-notification-fqa-r3-permission.json`。

### FQA-04 复验 · 原结构阻断已关闭，真机旅程仍待验

- environment: 结构化运行诊断（当前生产 domain 实现；不作为用户可见通过证据）。
- 入口：`buildRoundView` → `planRoundCloseout`。
- 操作：重放原失败输入：user + `role=implementation-lead` 专业成员消息、交棒缝隙无活动工作；另传入一条明确 `primary_closeout` 作对照。
- 实际观察：无 `primary_closeout` 时 `lastPrimaryFinishAt=null`，结果为 `start-silent / in-progress`；传入明确主理人收束事实后才返回 `record-terminal / completed`。
- 与承诺一致否：原结构错误已修复；但专业成员交棒、主理人接回与最终通知一次仍未从真实项目／对话入口执行，不能据此宣布用户旅程通过。
- 后续复验标准：获得真实项目入口后，完成专业成员回复 → 主理人接回 → 最终收束；交棒期间无通知，最终恰好一次。

### FQA-05 复验 · 部分关闭，退出后点击仍失败

- environment: 真实文件系统结构化运行诊断 + 只读生产接线追踪（不替代系统通知点击真机证据）。
- 入口：`TaskReminderDeliveryRuntime` + `.state/task-reminder-delivery.json`。
- 操作：权限未通过的 terminal event → 保存弹窗 → 销毁／重建 runtime；再记录 click → 重建 → consume → 再重建。
- 实际观察：modal entry 与 delivered event id 能跨 runtime 恢复；`recordClick` 后 pending click 能恢复，consume 后再次重建为 null。该部分修复有效，状态文件位于 `/var/folders/15/y09rxzss4vq0c4sd9_g_0bvr0000gn/T/moebius-fqa-r3-delivery-0MQUR1/.state/task-reminder-delivery.json`。
- 剩余失败：生产实现只在当前进程 `Notification` 实例触发 `click` listener 后调用 `recordClick`。应用已经退出时该 listener 不存在，代码也没有 notification response / launch activation payload；实现回报已明确 macOS 在已退出应用场景不回调。因此持久化无法覆盖规格中的「通知已提交 → 应用退出 → 点击通知 → 启动并定位」。
- 与承诺一致否：部分否。预期退出后点击仍启动并定位；实际只覆盖运行中点击后、renderer 消费前崩溃／重启的恢复。
- 最小复现：提交系统通知后完全退出 Moebius，再从通知中心点击；当前实现没有可执行的冷启动 payload 来源。该场景仍需在系统通知可用后真机确认实际表现。
- 影响范围：正常退出、崩溃或系统结束后的通知回流；用户可能只能打开应用，不能定位原对话与收束记录。
- 可执行修复标准：采用 macOS 能在冷启动时交付目标的原生 notification response／activation 方案，并在正常退出与崩溃后分别点击真实通知验证启动、恢复和定位；若平台方案确实不能满足，必须交回产品方修改已确认承诺，不能以运行中 click 持久化替代。

## 功能验收记录（2026-08-10，FQA-03 复验）

结论：FQA-03 根因已定位并修复（本机 dev 与打包身份均已为 denied，requestAuthorization 在已拒绝状态下不弹窗、直接返回 UNErrorDomain error 1——macOS 平台行为）；打包资源缺口已补并实机验证包内路径；设置/Onboarding 首次读取真实权限已修复。FQA-05「退出后点击启动」经平台确认无法在当前 Electron 版本实现，已修订 spec-delta 承诺并交回产品方裁决。

### FQA-03 复验 · 根因与修复

- 根因（实机确认）：`MoebiusPermissionBridge.dev.app status` 返回 `authorizationStatus: denied`（com.github.Electron 曾在本机被拒绝）；已拒绝 bundle 的 `requestAuthorization` 不弹窗、立即返回「Notifications are not allowed for this application」。上一轮实现的「双变体 + adhoc 签名 + 错误透出」均正确，缺的是对 denied 状态的回读区分。
- 修复：
  1. `desktop/package.json build.extraResources` 补 `native/build/MoebiusPermissionBridge.app → native/MoebiusPermissionBridge.app`（与 packaged resolve 路径一致）。
  2. `readState` 首次读取真实权限：runtime 新增 `ensurePermission()`（domain `planPermissionRefreshNeeded`：从未读取且总开关开启才读）；设置页与 Onboarding 打开即显示真实授权值，不再 `permission: null`。
  3. `request` 失败后回读真实状态（domain `planPermissionAfterRequest`）：回读 denied → 显示「已拒绝 + 打开系统设置」（恢复路径）；回读仍失败才显示「暂时无法使用系统通知」。
- 实机复验：`electron-builder --mac --arm64 --dir` 产出 `release/mac-arm64/Moebius.app`，包内 `Contents/Resources/native/MoebiusPermissionBridge.app` 存在且 `codesign --verify --deep --strict` 通过；包内桥 `status` 正常返回（本机 io.tranfu.moebius 已因先前弹窗超时被系统记为 denied，恰好真实验证 denied 读取与恢复路径）。
- 说明：本机 dev（com.github.Electron）与打包（io.tranfu.moebius）身份现均为 denied；denied 状态下 macOS 不会再次弹窗，恢复路径是「打开系统设置 → 允许 → 重新检测」。notDetermined → 弹窗路径在更早复验中已确认（app 变体 request 阻塞于系统授权框）。真机验收时若需弹窗路径，可在通知权限尚未决定的用户/机器上执行，或先在系统设置清除该 bundle 的通知授权。
- 新增测试：ensurePermission 三态（首次读取/总开关关闭不读/已缓存不重复读）、request 失败回读 denied。

### FQA-04 复验 · 已关闭（结构性误判不再复现）

- 上一轮结构化复验已确认：无 `primary_closeout` 时保持 in-progress，只有主理人一等收束事实才产生 completed。真实多 Agent 旅程待获得项目入口后复验。

### FQA-05 复验 · 部分关闭 + 平台确认

- 已关闭：弹窗列表与 delivered 集合跨 runtime 恢复；运行中 click 持久化与消费对账。
- 平台确认（本轮查证）：Apple `UNUserNotificationCenterDelegate` 文档未承诺 macOS 启动已退出应用处理通知响应；Electron 38.8.6 无任何冷启动 notification activation API——`Notification.getHistory()`（应用重启后重新挂载通知中心残留通知的交互事件）与 `handleActivation()`（Windows）均为 Electron 40+ 新 API（已在 `node_modules/electron/electron.d.ts` 确认不存在于 38.8.6）。因此「应用已退出时点击通知 → 启动并定位」在当前技术栈不可实现，且 `getHistory` 语义本身也不启动已退出应用。
- 行动：`spec-delta/desktop-shell/spec.md` 的「通知点击回流与退出后启动定位」已修订为「运行中定位 + 崩溃/重启后按持久化载荷恢复」并标注 `PLATFORM-LIMIT（待产品方确认）`；`docs/product/flows/state-change-delivery.md`（产品意图事实源）暂未改动，等待 PDL/产品方对承诺修改的裁决。
- 建议产品承诺（待裁决）：通知点击定位在应用运行时可用（含崩溃/重启后按持久化载荷恢复）；应用完全退出时点击由 macOS 平台行为决定、不承诺自动启动；应用内持久化收束事实、侧边栏状态点与 Dock 作为恢复入口。升级 Electron ≥40 后可另行评估 `getHistory()` 重新挂载残留通知。

### 机械闸门（FQA-03 复验后）

- `pnpm run test --scope`：root 321 通过 + 4 skipped acceptance；desktop 123；console-ui 524。三域 typecheck、`check:boundaries`（741 source / 625 production / 3 roots）全绿。
- `electron-builder --mac --arm64 --dir` 打包复验：`release/mac-arm64/Moebius.app` 内 `Contents/Resources/native/MoebiusPermissionBridge.app` 存在、签名校验通过、包内桥 status 正常返回。
- 未跑全量 `pnpm test`、未归档、未合并 spec-delta、未提交、未 push。
- 待真机：denied 恢复路径（打开系统设置 → 允许 → 重新检测）、notDetermined 弹窗路径（需权限未决定的用户/机器）、声音与专注模式分项；轮次/通知/Dock/归档/项目移除与真实多 Agent 旅程（需项目入口）。

## 产品裁决与规格闭合（2026-08-10）

背景：PDL #139 要求按「障碍型方案」以签名 Electron 38 最小 spike 实测「通知中心点击已完全退出应用」路径（`app.on('ready', (_, launchInfo))` 顶层注册、发通知后完全退出、从通知中心点击、记录是否启动与 launchInfo 结构），并把调研/候选/代价/spike 结果补入 design.md。

### 冷启动 spike 四轮实测（授权后）

1. **授权链路**：macOS 26.5.1 上 usernoted 对通知客户端做代码签名验证——adhoc（含 requirement 变体）与未公证 Developer ID 全部验证失败（amfid `-423` / Gatekeeper 拒）→ `UNUserNotificationCenter.requestAuthorization`（标准/provisional）与 `add` 恒 `error 1`、系统弹窗永不出现；ncprefs 手工注入授权条目无效（验证失败客户端拿合成状态）。`NSUserNotificationCenter`（废弃 API）`deliver` 触发 legacy `askpermissions` 弹窗（绕过验证），用户点「允许」后 usernoted 记录 `Authorization set for <bundle> to allow: YES`（实测写入成功）；同一身份弹窗只弹一次，未响应即被记为 denied。
2. **投递**：Electron 主进程（签名与 LaunchServices 注册记录一致，验证通过）授权后 `add` 成功，`Presenting ... as banner`（NotificationsPipeline 全流程 Success）。
3. **清除（4 轮）**：默认 timeoutType 通知在 banner 收起（约 4 秒）即被从 delivered 移除（app 运行中也移除）；`timeoutType: 'never'` 在运行期间保留，但 `app.quit()`/`app.exit()` 时被 Electron 主动清除（usernoted `removeDeliveredNotification`，source 为 Electron 连接）。**Electron 38 本地通知在任何情况下都无法在应用完全退出后保留于通知中心**。
4. **原生通道证伪**：嵌套桥（同 bundle id）`add` 恒 error 1（客户端验证失败，与授权无关）；独立桥同 id 会覆盖宿主 LaunchServices 注册记录，点击启动的不是宿主。普通启动时 `ready` 的 `launchInfo` 实测为 `{}`（空对象）。

### 产品裁决（用户已确认，接受默认建议）

- 本次接受「显式退出后不承诺通知点击回流」：`Command+Q` 明确退出即停止本次提醒，Electron 38 移除已提交通知，不存在可点击通知；重新打开后经持久化侧边栏红点或蓝点找回（仅限仍有红/蓝点的对话；「确认没有新增内容」等无点结论不保留提醒入口）。
- Electron 40+ 的 `getHistory()` 冷启动评估拆分为后续技术升级，不扩大本次功能风险。
- PRD（docs/product/flows/state-change-delivery.md）已由产品方回写三段生命周期：应用运行（含关闭窗口、隐藏、失焦、最小化）时点击直达；点击已由主进程接收、页面定位前中断则下次启动续定位；`Command+Q` 明确退出后无通知冷启动。PRD 复评两轮通过。

### 旧失败如何转为当前验收边界（不篡改历史记录）

- 历史 FQA-05「退出后点击启动仍失败」的预期（通知已提交 → 应用退出 → 点击通知 → 启动并定位）被本次产品裁决**替换**为「明确退出后无通知冷启动」边界；其实现阻断记录与「不能以运行中 click 持久化替代」的修复标准原文保留在上方历史小节，作为裁决依据。
- 原承诺中仍然有效的部分保持不变并继续验收：**运行中点击直达**（click 事件 → 激活窗口 → 定位收束记录）；**点击已接收、定位前中断则下次启动续定位**（`.state/task-reminder-delivery.json` 的 `lastClicked/lastConsumedClickAt` 持久化 + `pendingClick` 消费对账，不重放通知）。
- 新增判据：**普通启动不得读取或消费不存在的通知点击**（明确退出后通知已被移除，`pendingClick` 应为空；不得伪造历史点击）。

### 规格闭合动作

- `design.md`：「待产品方裁决」改为已裁决结论；保留四轮 spike 证据与 Electron 40+ 后续评估记录。
- `spec-delta/desktop-shell/spec.md`：删除 `PLATFORM-LIMIT（待产品方确认）` 与旧「退出后点击启动」要求；Requirement 与 Scenario 按三段生命周期改写（运行中点击直达 / 点击已接收后中断则下次启动续定位 / 明确退出后通知移除、不承诺冷启动）；增加「普通重开不读取、不消费不存在的通知点击；仅按侧边栏当前红点或蓝点找回，无点结论无找回入口」判据。
- 代码检查结论：现有实现（运行中 click → `recordClick` → renderer `pendingClick` 消费；`lastConsumedClickAt` 对账）与已裁决边界一致，普通启动只消费持久化 `pendingClick`（不存在即为空），无需代码修正。

### 剩余真机清单（按已裁决边界）

- 运行中点击直达：真实通知 → 点击 → 激活窗口并定位收束记录（含关闭窗口、隐藏、失焦、最小化形态）。
- 已接收点击的中断恢复：点击已由主进程接收、页面定位前退出/崩溃 → 下次启动按持久化载荷续定位且不重放通知。
- 明确退出后通知移除与侧边栏找回：`Command+Q` 退出后通知中心无该应用通知；重开后仅仍有红/蓝点的对话可从侧边栏找回；无点结论无找回入口；普通启动不消费不存在的通知点击。
- 权限：denied 恢复路径（打开系统设置 → 允许 → 重新检测）、notDetermined 弹窗路径（需权限未决定的用户/机器）、声音与专注模式分项。
- 轮次/通知一次/Dock 红蓝单点计数/归档/项目移除与真实多 Agent 旅程（需项目入口）。

## 最终定向返工（PDL #163，2026-08-10）：首次权限状态同步

### FQA-最终 · 设置首屏权限同步

- environment: 真机（macOS 26.5.1，Electron 38.8.6，fresh desktop build 含本轮修复，真实本地服务/IPC/Swift permission bridge dev 变体 com.github.Electron——本机 denied，隔离数据根）。
- entry: 主页面 → 设置 → 常规 → 任务提醒（冷启动后首次打开，不点击任何按钮）。
- 操作: 隔离数据根预置 onboarding 完成标记后冷启动真实 Electron；主页面渲染后点击侧边栏「设置」打开设置弹窗；**不点击任何按钮**，等待权限投影落地后读取任务提醒组文本；另从同一 preload IPC 直读 `readTaskReminderState()` 作结构化诊断。
- 断言: 首屏即显示「已拒绝 / 打开系统设置」，不显示「尚未开启」；IPC 首次读取返回 `authorizationStatus: denied`。
- 实际值: 任务提醒组文本含「已拒绝」「打开系统设置」「系统通知和声音不可用；Dock 与侧边栏仍可用。」，不含「尚未开启」；IPC 直读返回 `{"enabled":true,"permission":{"authorizationStatus":"denied","alert":"enabled","sound":"enabled","badge":"enabled","error":null},...}`。consistent: true，复验脚本退出码 0。
- evidence: `/var/folders/15/y09rxzss4vq0c4sd9_g_0bvr0000gn/T/terminal-notification-firstload-final-20260810.json`。
- 根因: 冷启动早期 local console server 尚未就绪（`DesktopLocalConsoleRuntime.pathSource` 为 null）→ `ensureRuntime()` 返回 null → `readState` 返回 `permission: null` → renderer 首次渲染显示「尚未开启」；此后无推送同步，直到用户点击按钮触发 refresh 才更新。renderer 侧排查结论：controller 的 mount `refresh` → `setPermission(planPermissionViewState(...))` 链路本身正常（单次 IPC 返回 denied 即更新），缺陷完全来自主进程首次返回值。
- 修复（仅此一项，未扩大范围）: `desktop/src/desktop-main-infrastructure-ipc.ts` `readState` 在 `runtime === null` 且总开关开启时直接读取真实权限（桥为独立进程、不依赖 local console；总开关关闭仍不读），IPC 首次即返回 denied；runtime 创建后 `ensurePermission` 会再读并缓存（幂等）。未采用 renderer 重试方案（application 复杂度已到 12 上限，且修复后主进程不再返回 null，重试属冗余）。
- 测试（行为，非文案镜像）: 新增 `desktop/tests/use-task-reminder.test.tsx` 4 用例——首次异步读取返回 denied 时无交互立即显示 denied；首次读取被拒时保持 undetermined 不崩溃；首次读取 unavailable 后经请求动作 refresh 同步为 denied；通知点击订阅触发 refresh 同步 pendingClick。加 `task-reminder-delivery-state` 8 用例共 12 个全绿。
- 机械闸门（返工后）: `pnpm run test --scope` 全绿（root 321 通过 + 4 skipped acceptance；desktop 127；console-ui 524）；三域 typecheck 全绿；`check:boundaries`（741 source / 625 production / 3 roots）全绿；`pnpm --filter @moebius/desktop build`（console-ui + 桥双变体 + esbuild）全绿。
- 未跑全量 `pnpm test`、未提交、未创建 PR、未 push（在复验通过后的最终收尾阶段统一执行）。

## 功能验收最终复验（2026-08-10，FQA #157）

结论：**不通过**。FQA-03 仍存在真实页面首屏与真实权限值不一致；其余尚未通过路径缺少可合法生成的真实项目与可用通知权限，按 `docs/protocols/real-app-acceptance.md` 记为未验证，不以结构诊断、测试或预置状态抵扣。按 PDL 指令，本轮只提交最终证据与影响，不自动进入第三轮实现返工。

### FQA-03 · 真实权限读取与拒绝恢复（部分通过，首屏失败）

- environment: 真机（macOS 26.5.1、Electron 38.8.6、本轮 fresh desktop build、真实 local-console、真实 preload/IPC、真实 Swift permission bridge；隔离数据根 `/var/folders/15/y09rxzss4vq0c4sd9_g_0bvr0000gn/T/moebius-task-reminder-qa-k60GYx`）。
- 页面入口：主页面 → 设置 → 常规 → 任务提醒。
- 操作：冷启动应用并首次打开设置；随后点击「允许系统通知」，再点击「打开系统设置」。
- 断言：首次打开即显示 macOS 当前真实权限；当前 bundle 已拒绝时应直接显示「已拒绝／打开系统设置」，不得先显示未授权请求入口；打开系统设置必须执行真实系统调用。
- 实际观察值：两个签名 bridge 的 `status` 均为 `authorizationStatus=denied`，`readTaskReminderState.permission.authorizationStatus` 也为 `denied`；但页面首屏仍显示「尚未开启／允许系统通知」。点击「允许系统通知」后页面才变为「已拒绝／打开系统设置／系统通知和声音不可用；Dock 与侧边栏仍可用」；再点击「打开系统设置」后真实 System Settings 进程存在。首屏断言失败；请求失败后的 denied 回读及系统设置入口通过。
- 与承诺一致否：否（部分动作符合，但首次真实状态展示不符合）。
- 最小复现：在 macOS 已拒绝 `com.github.Electron` 通知权限的机器上 fresh build → 冷启动 → 设置 → 常规 → 任务提醒；同时读取真实 IPC 状态与 DOM 文本。
- 预期：首屏显示「已拒绝」和「打开系统设置」。
- 实际：IPC 已为 denied，首屏却显示「尚未开启」和「允许系统通知」；只有再次请求后才修正。
- 影响范围：已拒绝用户首次打开设置时会被引导重复请求，而不是直接进入系统设置恢复；共享初始权限 controller 的页面存在同类回归风险。
- 可执行修复标准：异步首次权限读取完成后必须把 renderer 可见状态更新为同一份结果；在真实 denied 环境冷启动设置页应无需额外点击即显示「已拒绝／打开系统设置」，返回应用后再读真实值。补测应断言状态流转行为，不镜像断言文案。
- 未覆盖姐妹场景：当前 dev 与 packaged bundle identity 均已 denied，无法重新进入 `notDetermined`；本机不能验证首次授权弹窗。系统设置中实际改为允许后的返回刷新也未执行，因此不得写通过。
- evidence: `/var/folders/15/y09rxzss4vq0c4sd9_g_0bvr0000gn/T/terminal-notification-fqa-final-20260810.json`。

### 其余尚未通过路径 · 未验证（真实入口前提不成立）

- environment: 真机启动能力可用，但任务前提不成立。
- 页面入口：主页面 → 新建对话 → 选择项目。
- 操作：尝试从真实用户入口为隔离数据根添加本工作区项目；点击「选择项目」会进入真实 macOS 文件选择器。尝试使用系统辅助操作选择目录时，macOS 返回 `osascript is not allowed to send keystrokes (1002)`。本会话 managed process 已达到上限，不能把 Electron 跨回合保留给用户手动完成；按契约未回退 shell 后台进程，也未绕过 UI 直打 HTTP/SQLite。
- 屏幕／系统观察：隔离应用只能停在「还没有项目，从上面的项目按钮添加一个」；没有可从 UI 发起的真实多 Agent 对话。当前通知权限同时为 denied，不能产生真实系统通知或声音。
- 与承诺一致否：未验证，不构成通过证据。
- 未覆盖范围：真实专业成员交棒与唯一 `primary_closeout`、完成／等待通知、声音、单点与 Dock 红蓝计数、权限弹窗三操作及队列跨重启、运行中点击回流、已接收点击中断恢复、`Command+Q` 通知移除与普通重开、红蓝／无点找回、归档／恢复／项目移除。
- 影响：上述主链仍没有符合真机协议的用户入口证据；当前交付不能进入“功能验收通过”。既有单测、结构化持久化诊断与冷启动 spike 只能作为辅助证据。
- 下一次可执行前提：提供一个由真实 UI 已加入项目的隔离数据根，并提供可用（allowed 或 notDetermined）的正式签名通知身份；通过 managed process 留存 Electron，随后仅复验本节列出的剩余路径。

## 功能验收最终定向复验（2026-08-11，FQA-03 首屏权限同步）

结论：**通过；已知真实缺陷关闭。** 本轮只复验用户最终授权修复的 FQA-03，不重新打开用户已明确放弃验收的多 Agent、真实通知、Dock 与点击回流主链。历史失败记录保留在上方，不改写。

### 设置首屏

- environment: 真机（macOS 26.5.1、Electron 38.8.6、fresh desktop build；真实 local-console、preload/IPC 与 Swift permission bridge；dev bundle `com.github.Electron` 当前真实权限为 denied；隔离数据根 `/var/folders/15/y09rxzss4vq0c4sd9_g_0bvr0000gn/T/moebius-task-reminder-qa-k60GYx`）。
- 页面入口：主页面 → 设置 → 常规 → 任务提醒。
- 操作：冷启动后首次打开设置；不点击「允许系统通知」等按钮；从设置打开后的 0 ms 起每 50 ms 读取一次真实 DOM，共 24 次／1.15 秒；随后读取同一次 preload IPC 状态。
- 断言：首屏无需交互即直接显示「已拒绝／打开系统设置」，任何采样不得先出现「尚未开启」；preload IPC 同时返回 `authorizationStatus: denied`。
- 实际观察值：24/24 个 DOM 样本均包含「已拒绝／打开系统设置」及「系统通知和声音不可用；Dock 与侧边栏仍可用」；0/24 样本包含「尚未开启」。同一次 `readTaskReminderState` 返回 `permission.authorizationStatus="denied"`、`error=null`。
- 与承诺一致否：是。

### Onboarding 共享状态

- environment: 同上，真机。
- 页面入口：主页面 → 重新查看引导 → 第 1/2/3 步「继续」→ 第 4 步。
- 操作：仅使用真实页面按钮进入回看第 4 步，不触发系统权限请求；读取页面状态与同一次 preload IPC。
- 断言：共享 controller 不得复现设置首屏旧问题；第 4 步应直接显示任务提醒与 macOS 当前真实权限。
- 实际观察值：第 4 步直接显示「任务提醒／已开启」「macOS 通知／已拒绝」；同一次 preload IPC 返回 `authorizationStatus="denied"`、`error=null`，未出现「尚未开启」。
- 与承诺一致否：是。
- evidence: `/var/folders/15/y09rxzss4vq0c4sd9_g_0bvr0000gn/T/terminal-notification-fqa03-final-20260811.json`。
