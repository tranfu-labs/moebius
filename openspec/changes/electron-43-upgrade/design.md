# 本项目适用方案：electron-43-upgrade

## 方案边界与上游基准

- 本项目约束：PRD 已冻结退出后历史通知回流、运行中前后台点击回流和本地 arm64 签名包验收，需求层语义不得改变 → 采纳结论：只扩展 Electron 运行时实现，不改变任务提醒终局分类、文案、Dock 计数或权限弹窗语义。
- 本项目约束：`terminal-notification-delivery` 已建立 `MacOsNotificationChannel`、`TaskReminderDeliveryRuntime`、持久化点击载荷、IPC 和 renderer 定位链路，且 predecessor 仍处于 active → 采纳结论：复用这些接口，不在本 change 内归档或改写其已定稿行为。
- 本项目约束：用户指定 Electron 43.x、正式桌面目标是 macOS Apple Silicon，且明确不要动 release skill → 采纳结论：锁定 `43.4.1`，不触碰 `moebius-release-moebius` skill，不增加发布或公证步骤。

## 模块划分与数据流

### M1 · Electron 43 运行时与 breaking-change 适配

变更单元：`desktop/package.json`、pnpm lockfile、desktop 开发/构建入口及实际命中的 Electron API 调用点。

本项目约束：用户要求逐版适配 Electron 39–43，且仓库把 typecheck/build 作为桌面变更的验证入口 → 采纳结论：先完成依赖安装和 39–43 逐版代码盘点，再按盘点结果适配，最后用 desktop typecheck/build 验证。

处理内容：

- 本项目约束：用户指定目标版本为 Electron 43.4.1，Electron 42 起 binary lazy download 可能改变安装/首次运行时序 → 采纳结论：将依赖和 lockfile 升级到 `43.4.1`，实际验证安装、开发启动和 electron-builder 打包。
- 本项目约束：用户明确要求开发启动清除 `ELECTRON_RUN_AS_NODE`，仓库已有 `desktop/scripts/dev-electron.mjs` 清除子进程环境的惯例 → 采纳结论：所有本地 Electron spike、开发启动和相关验证显式使用 `env -u ELECTRON_RUN_AS_NODE`，并保留现有脚本逻辑。
- 本项目约束：用户要求逐版适配 Electron 39–43，仓库测试/构建是事实验证入口 → 采纳结论：建立“命中调用点／无调用点／未验证”的逐版账本，静态无命中也继续执行构建和真实桌面验收。

### M2 · 稳定通知标识与历史通知恢复

变更单元：通知 ID 纯函数、`desktop/src/notification-channel.ts`、任务提醒投递状态和 wiring；与 M1 同一变更单元内完成测试。

数据流：

```text
LocalRoundTerminalEvent
  -> TaskReminderDeliveryRuntime（总开关、权限、event_id 去重）
  -> Notification({ id, groupId, title, body })
  -> macOS UNNotification / Notification Center

app ready
  -> Notification.getHistory()
  -> 读取持久化 notificationId -> 点击目标映射
  -> 为已知历史 Notification 对象挂 click listener
  -> 现有 recordClick -> focus/broadcast -> renderer 定位 -> consumeClick
```

结构决策：

1. 本项目约束：PRD 要求每条历史通知仍绑定自己的终局，现有终局事件已有稳定 `eventId`，而 `getHistory()` 需要可识别的通知 ID → 采纳结论：每个终局生成确定性的通知 ID（固定前缀加编码后的 `eventId`），同一事件跨重启不随机换 ID；所有任务提醒共用固定 `groupId`，但每条仍保留独立 ID。
2. 本项目约束：Electron 43 的历史对象不提供可依赖的 `userInfo`，现有点击定位需要 `{ sessionId, roundId, terminalMessageId }`，旧状态文件必须继续可读 → 采纳结论：在 `.state/task-reminder-delivery.json` 增加可向后兼容的 `notificationTargets` 映射；缺少该字段按空映射读取，不升级或破坏已有 `deliveredEventIds`、权限弹窗和 `lastClicked`。
3. 本项目约束：仓库现有状态通过原子写入保护，通知/权限失败不得回滚终局或伪造送达 → 采纳结论：映射在提交通知前随投递状态原子写入；失败时允许留下无害孤立映射，历史恢复只接受合法已知 ID；点击继续复用 `lastClicked` 和消费对账，不增加第二种导航协议。
4. 本项目约束：历史点击必须在应用重启后可恢复，官方 API 返回 live notification 对象；macOS 不使用仅标注 Windows 的 `handleActivation` → 采纳结论：历史查询只启动一次、同一对象只挂一次 listener、保留恢复对象引用直到应用退出，并仅在 macOS 使用 `getHistory()`。
5. 本项目约束：用户验收要求应用退出后点击历史通知冷启动，当前 wiring 又在 local-console 就绪后才创建 delivery runtime → 采纳结论：历史查询在桌面基础设施注册后尽早启动；runtime 未就绪时排队并持久化点击，普通启动没有点击事件时不自动导航。
6. 本项目约束：现有通知通道失败只表达异常并保留会话事实，不能猜测目标 → 采纳结论：`getHistory()` 不可用、返回空列表、查询失败或 ID 无映射时只记录可诊断异常、保留用户现场，并继续支持现有 `lastClicked` 恢复路径。

### M3 · macOS 通知授权桥决策

变更单元：`desktop/src/macos-permission-adapter.ts`、`desktop/native/macos-notification-permission/main.swift`、`desktop/scripts/build-native.mjs` 的 43.x 构建兼容性验证。除编译/路径/签名所需适配外，不删除 Swift bridge。

本项目约束：本项目必须在发送前读取 macOS 通知授权并支持权限请求，且 Electron 43 的 `Notification` API 不提供主进程 macOS 通知授权封装，`systemPreferences` 的授权方法只覆盖媒体 → 采纳结论：Electron 43 的 `Notification` API 负责提交通知和恢复历史，Swift bridge 继续读取 `UNUserNotificationCenter.getNotificationSettings`、请求授权并返回 alert/sound/badge 分项状态，以满足“每次发送前实时读取”和权限弹窗三态语义；`Notification.handleActivation` 只标注 Windows，不纳入 macOS 方案。

本项目约束：现有 `extraResources` 和同身份签名 bundle 契约把 Swift bridge 作为通知授权事实源，Electron 主进程负责通知提交；Electron 43 的 `getHistory()` 只解决历史通知恢复 → 采纳结论：保留 bridge 及其 bundle 身份，bridge 只负责授权状态/请求，Electron `Notification` 负责提交/历史恢复；正式签名包中的真实授权结果标记为**未验证**，不以未签名开发壳推断。

### M4 · 验证与交付证据

本项目约束：本 change 的需求只增加 Electron 升级、历史通知回流和授权 API 调研，且用户要求本地验收、不做发版 → 采纳结论：M4 只收集 M1–M3 各自的单测、desktop typecheck/build、受影响范围测试、边界矩阵和最终真实 Electron 验收，不引入新的用户可见功能。

## 关键选型与结构决策

| 事项 | 选型理由（本项目约束 → 采纳结论） | 基准级别 |
| --- | --- | --- |
| Electron 目标版本 | 本项目约束：用户明确要求 43.x，并指定当前 43.4.1；正式包只支持 macOS arm64 → 采纳结论：锁定 `43.4.1` | 用户已提供 |
| macOS 通知提交 API | 本项目约束：用户要求修复 macOS 26 上 Electron 38 的旧通知路径；Electron 42+ 官方已迁移到 `UNNotification` → 采纳结论：继续使用主进程 `Notification`，不自建第二套投递通道 | 用户需求 + 官方 API |
| 退出后冷启动入口 | 本项目约束：用户验收明确要求点击通知中心历史通知；Electron 43 官方提供 macOS `Notification.getHistory()` → 采纳结论：启动时恢复历史对象并复用现有 click 回流 | 用户需求 + spike/API 验证 |
| 通知目标身份 | 本项目约束：`getHistory()` 恢复对象可识别的字段包含 `id`，当前任务事件已有稳定 `eventId`，而 `userInfo` 不在恢复字段中 → 采纳结论：固定 ID 加持久化目标映射 | 现有事件去重惯例 + 官方 API |
| 历史通知分组 | 本项目约束：产品要求多段对话各自保持可点击目标，不能合成聚合入口；Electron 43 的 `groupId` 只用于视觉分组 → 采纳结论：使用固定 `groupId`、每条保留独立 `id` | 需求 + 官方 API |
| 授权查询/请求 | 本项目约束：本项目需要主进程实时读取 `authorized/denied/notDetermined` 与发起系统请求；Electron 43 `systemPreferences` 没有 notification authorization 方法，类型探针也确认不存在 → 采纳结论：保留 Swift bridge | spike 验证，强基准 |
| macOS 冷启动实现 | 本项目约束：`handleActivation` 在 Electron 43 类型和文档中标注为 Windows；产品目标是 macOS → 采纳结论：不采用 `handleActivation`，采用 `getHistory()` | 官方 API + 平台约束 |
| 状态兼容 | 本项目约束：已有状态文件版本为 1，交付用户可能已有旧状态；新增映射可缺省读取，不改变既有事实 → 采纳结论：在版本 1 中做可选增量字段并覆盖旧状态解析 | 仓库既有持久化惯例 |
| 失败降级 | 本项目约束：现有任务提醒规定通知/权限失败不得回滚终局、不伪造送达 → 采纳结论：history 查询失败和未知 ID 只记录异常，保留侧边栏与持久化点击路径 | 现有 change 方案/PRD |
| Electron binary 安装 | 本项目约束：Electron 42 起不再通过 postinstall 下载，仓库的开发启动和 dist 都必须能获得可用 binary → 采纳结论：保留 pnpm 官方安装方式，在首次运行/构建命令中前台验证 lazy download | 用户验收 + Electron 官方 breaking change |
| 历史恢复时序 | 本项目约束：用户要求退出后点击历史通知，当前 runtime 又依赖 local-console 就绪 → 采纳结论：在桌面基础设施注册后提前查询并在 runtime 未就绪时排队点击 | 需求 + 仓库现有启动结构 |
| 外部依赖 | 本项目约束：仓库规定新增外部依赖属于方向选择类决策，本需求只要求升级 Electron 和复用现有 bridge → 采纳结论：不新增通知/权限第三方依赖 | 仓库既有规则 + 需求 |
| 签名验证 | 本项目约束：Electron 官方 macOS 通知要求代码签名，验收明确要求本地签名 arm64 包 → 采纳结论：沿用现有 electron-builder arm64 产物并把签名/通知中心观察列为真实验收 | 用户验收 + 官方 API |
| 测试闸门节奏 | 本项目约束：仓库规定迭代用 `--scope`，完整 `pnpm test` 每个 change 在复核通过后执行一次 → 采纳结论：M1–M3 使用定向测试，M4 统一执行一次全量回归 | 仓库既有测试惯例 |

## Electron 39–43 breaking changes 盘点

来源为 [Electron breaking changes](https://www.electronjs.org/docs/latest/breaking-changes) 与各版本官方 release notes：[39.0.0](https://releases.electronjs.org/release/v39.0.0)、[40.0.0](https://releases.electronjs.org/release/v40.0.0)、[41.0.0](https://releases.electronjs.org/release/v41.0.0)、[42.0.0](https://releases.electronjs.org/release/v42.0.0)、[43.0.0](https://releases.electronjs.org/release/v43.0.0)。实现阶段按此表逐项复核，并把需要运行时确认的项明确标记为**未验证**后留在测试报告。

| 版本 | 官方变更 | 本仓库盘点与处理 |
| --- | --- | --- |
| 39 | offscreen `paint` 共享纹理结构变化；`window.open` 弹窗尺寸行为修正；其余 Chromium 继承项按官方页复核 | 本项目约束：产品没有 offscreen/popup 运行入口，静态扫描只有 console-ui 安全链接测试的 `window.open` 反断言 → 采纳结论：不改无命中的生产代码，仍用 build/typecheck 和真实桌面验收复核 |
| 40 | 继续带入 39 的变更；Electron 运行时相关 API 及 renderer clipboard 兼容性需复核 | 本项目约束：Electron `clipboard` 只在 desktop main composition root 使用，renderer 使用浏览器 `navigator.clipboard`/剪贴板事件 → 采纳结论：不迁移无命中的 renderer Electron API，保留现有边界并执行类型/构建测试 |
| 41 | cookie changed 事件修正、WebContents/OSR 等继承项；没有本功能直接命中的通知 breaking change | 本项目约束：源码没有 cookies 事件监听和 OSR 纹理消费，桌面仍使用普通窗口/会话路径 → 采纳结论：不新增适配分支，以 desktop typecheck、构建和定向测试确认 |
| 42 | macOS `NSUserNotification` → `UNNotification`；electron 包改为首次运行时 lazy 下载；OSR 默认 scale factor、`clearStorageData.quotas` 和 `ELECTRON_SKIP_BINARY_DOWNLOAD` 变化 | 本项目约束：macOS 26 通知失败是本 change 的直接背景，且源码无 `quotas`、OSR、`ELECTRON_SKIP_BINARY_DOWNLOAD` 或旧通知 API 直接调用 → 采纳结论：适配主进程 `Notification` 与签名包，实际验证安装/首次 Electron 启动/打包，不以静态扫描代替运行验证 |
| 43 | 下载默认目录、nativeImage 色彩空间、Linux 圆角和 Linux dialog `showHiddenFiles` 等行为变化；新增 macOS Notification `getHistory`、`id`、`groupId` | 本项目约束：正式目标为 macOS arm64，源码无 `showHiddenFiles`、nativeImage 色彩转换或自定义下载器调用；用户又要求历史通知冷启动 → 采纳结论：只在 M2 接入 `getHistory`/`id`/`groupId`，并用真实签名包验收通知历史和前后台点击 |

本次实际静态扫描命令及摘要：

```text
git grep -n -E "host-rules|host-resolver-rules|OffscreenSharedTexture|desktopCapturer|NSAudioCaptureUsageDescription|clearStorageData|showHiddenFiles|will-download|setSavePath|ELECTRON_SKIP_BINARY_DOWNLOAD|on\(['\"]paint|window\.open" -- desktop/src src packages/console-ui/src tests scripts
```

输出只有 `packages/console-ui/src/console/markdown-message.test.tsx` 对 `window.open` 的安全反断言；没有上述 Electron 主进程 breaking-change 调用点。该结果只关闭静态命中风险，不替代 M4 的构建和真机验收。

## 测试策略

本项目约束：仓库要求每个模块与测试一起交接，真实用户动作必须在运行中的应用里验证，完整 `pnpm test` 只在复核通过后执行一次 → 采纳结论：为 M1–M4 分别设置可独立执行的验证入口，并把真实签名包验收和最终全量回归作为 M4 的闭环证据。

每个变更单元均有独立验证入口：

| 变更单元 | 测试/验证层级 | 完成判据 |
| --- | --- | --- |
| M1 · Electron 43 运行时与 breaking-change 适配 | 本项目约束：升级影响依赖、类型、构建和实际启动 → 采纳结论：覆盖安装、类型检查、desktop build、受影响范围测试和真实启动 | 命令有实际退出码 0；失败项按 39–43 账本归因，不以静态扫描代替运行结果 |
| M2 · 稳定通知标识与历史通知恢复 | 本项目约束：历史回流涉及纯逻辑、通知 API、持久化和真实通知中心 → 采纳结论：覆盖 domain 单测、channel mock 行为测试、state/runtime/wiring 集成式单测和真实签名包 | ID/映射/恢复/排队/幂等分支均有行为断言；真实通知中心覆盖运行中和退出后点击 |
| M3 · macOS 通知授权桥决策 | 本项目约束：bridge 同时有 Swift 构建/路径选择、权限适配和签名包行为边界 → 采纳结论：覆盖 Swift 构建/路径测试、permission adapter 单测和真实签名包权限操作 | 开发/生产 bridge 变体选择正确；权限状态、请求和失败降级如实返回 |
| M4 · 验证与交付证据 | 本项目约束：步骤 4 要求边界矩阵和基线回归，验收要求真实用户动作 → 采纳结论：覆盖边界矩阵、完整 `pnpm test` 和本地真实验收 | 矩阵无空白；全量输出与步骤 1 基线可比较；用户动作有真实观察记录 |

### M1

- 运行 `pnpm install --frozen-lockfile`，确认 lockfile 与 Electron 43.4.1 一致；首次 Electron binary 下载必须在可控的前台命令中完成，不使用 shell 后台进程。
- 运行 `env -u ELECTRON_RUN_AS_NODE pnpm typecheck` 和 `env -u ELECTRON_RUN_AS_NODE pnpm --filter @moebius/desktop build`。
- 重跑受影响 desktop 测试及由 import graph 计算的 `pnpm run test --scope`；版本迁移的每个失败按 39–43 账本归因。

### M2

- 新增纯函数测试：ID 的确定性、编码/解码、非法 ID 和旧状态缺省映射。
- 新增 `notification-channel` 行为测试：`show()` 传递 id/groupId；show/failed/timeout 互斥结算；历史对象只挂一次 listener；未知历史 ID 不触发点击；点击载荷保持现有结构。
- 扩展 delivery runtime/state/wiring 测试：提交前保存映射、重启恢复、历史点击持久化、local-console 尚未就绪时排队、普通启动不自动导航、已有 pending click 继续消费。
- 使用 `src/testing/wait.ts` 的 `waitForCondition`/`waitForValue`，不在新测试中手写 deadline 轮询；真实 Electron 的通知权限弹窗、banner click 和 Notification Center 保留行为不以 mock 测试代替。

### M3

- 保留并扩展 Swift bridge 构建/路径测试，确认 Electron 43 开发宿主与打包宿主仍选择正确签名变体。
- 在权限状态读取与请求的已有测试中继续覆盖 `authorized`、`provisional`、`denied`、`notDetermined`、bridge error；不要把 Electron `Notification.isSupported()` 当作授权状态。

### M4

- 步骤 4 先执行边界矩阵覆盖空输入、非法/超限 ID、并发或重入恢复、无权限、history 查询失败/恢复；每格写实际处理和测试或复用来源。
- 最终按步骤 1 的基线重跑完整 `pnpm test`，只在复核通过、合并前执行一次；报告通过/失败/跳过、耗时及相对基线新增测试数。
- 真实验收必须使用 `env -u ELECTRON_RUN_AS_NODE` 与本地签名 arm64 `Moebius.app`：系统通知列表出现 Moebius；前台、后台各点击一次；显式退出后点击保留的通知中心历史通知并确认冷启动定位；task-reminder 单测全绿。证据写系统临时目录，不提交 `artifacts/`。

## 方向性风险判定

**无方向性风险。**逐项对账后，没有仍挂不上需求、仓库既有惯例、用户输入或可观察 spike 结果的方向选择，也没有方案条目需要标注“无本项目依据，仅为惯例”。R1–R3 是对用户已经指定的方向和兼容性边界做的自验证核查，不触发用户选型确认；所有尚未执行的真实运行项都在下方遗留事项中标为**未验证**。

### R1 · Electron 43 历史通知恢复与稳定标识核查

- 最小 spike：在临时依赖目录安装 Electron 43.4.1（忽略 binary postinstall），用 TypeScript 探针编译 `Notification.getHistory()`、`new Notification({ id, groupId })`，并用 `@ts-expect-error` 断言不存在的旧猜测 API。
- 实际命令输出摘要：`pnpm install --ignore-scripts` 解析并安装 `electron 43.4.1`，退出码 0；`tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --skipLibCheck api-probe.ts`，退出码 0、无诊断。探针确认 `getHistory`、`id`、`groupId` 类型成立，`systemPreferences.getNotificationSettings()` 不存在。
- 本项目约束：用户要求退出后通知历史点击回流，而 API 需要稳定标识和可恢复目标 → 采纳结论：API 方向为**经 spike 验证**，实现采用 M2 的 `getHistory + 稳定 id + 持久化目标映射`；签名包的通知中心实际保留和点击事件仍属于后续运行验收，不在本 spike 中虚报通过。

### R2 · Electron 43 macOS 通知授权覆盖核查

- 最小 spike：检查 Electron 43 `systemPreferences` 类型与官方 API 页面，编译 `getMediaAccessStatus`/`askForMediaAccess`，并对 `getNotificationSettings` 进行负向类型断言。
- 本项目约束：用户要求调研 Electron 43 的通知授权查询/请求 API，现有通知权限语义又依赖主进程真实授权状态 → 采纳结论：授权边界为**经 spike 验证**。Electron 43 没有满足本项目主进程通知授权契约的查询/请求 API，保留 Swift bridge；不执行“退役嵌套 bundle”。官方通知文档说明的是通知提交/历史恢复和签名要求，官方 `systemPreferences` 文档的授权方法是媒体授权，不是通知授权。

### R3 · Electron 39–43 breaking changes 结构影响核查

- 最小 spike：按官方版本 release notes 建立表格，并对仓库生产代码执行 M1 静态调用点扫描。
- 本项目约束：用户要求逐版过 39–43 breaking changes，且仓库当前生产代码的命中点可由静态扫描定位 → 采纳结论：当前可由静态结果和现有架构关闭“已知 API 调用点选错”的核查项；无命中的继承 Chromium 行为仍以 build、typecheck 和真实桌面验收关闭。没有因惯例新增外部依赖或改变数据源。

### 未关闭但不触发用户选型的运行风险

- Electron 43.4.1 binary 在本轮网络下载阶段无进度，已中止一次 `pnpm dlx electron@43.4.1 --version`（退出码 130）；因此真实 Electron 43 启动、签名通知保留、前台 banner click（Electron #51885）和退出后 Notification Center click **未验证**。这不改变已由用户指定且经 API spike 验证的方向，按 M4 继续验证；若实际 API/runtime 与官方契约不符，再登记偏差，不擅自改需求层语义。

## 方案回滚与失败边界

- 本项目约束：需求明确目标必须是 Electron 43.x，macOS 26 通知和退出后历史回流是本 change 的目的 → 采纳结论：Electron 版本回滚只作为发现 43 与仓库硬约束不兼容时的本地恢复手段，并保留 lockfile 变更与失败证据，不作为交付方案。
- 本项目约束：通知/权限失败不得回滚终局或伪造送达，历史通知可能包含未知旧 ID → 采纳结论：历史恢复只消费已知 ID 映射；查询失败不清除通知、不删除会话事实、不自动跳转。
- 本项目约束：现有 bridge 负责真实授权状态/请求，Electron `getHistory()` 只负责历史通知对象 → 采纳结论：保留 bundle 内签名与开发/生产双变体；若正式签名包仍不能读取真实授权，沿用权限弹窗/系统设置降级，不把 history API 当授权替代。

## 遗留事项

1. **未验证**：Electron 43.4.1 binary 本机实际启动和本地 arm64 dist 包运行；本轮下载阶段停滞，需在实现/验收阶段重试并报告真实输出。
2. **未验证**：macOS 26 上正式签名包的通知注册、系统设置列表显示、前台和后台 banner click、退出后 `Notification.getHistory()` 历史点击冷启动定位，以及正式签名身份下 Swift bridge 的真实授权读取/请求。
3. **已验证基线红灯**：步骤 1 的完整 `pnpm test` 中 `tests/shell-path.test.ts` 既有 1 项超时断言失败；不是本 change 引入，步骤 4 必须重新对比并处理任何新增回归。
4. **已验证基线红灯**：步骤 1 的 `pnpm typecheck` 受 `tests/desktop-local-console-runtime.test.ts` 重复 `skillRegistry` 属性阻断；不是本 change 引入，提交前必须处理或明确归因。
5. **待处理依赖**：`terminal-notification-delivery` change 仍有真实 GUI 验收和归档工作；本 change 复用其已实现接口，不把 predecessor 未完成的验收伪装成本 change 的已验证结果。
6. 本轮没有“待核实”项；也没有不采纳的评审提醒。后续若出现不采纳提醒或待核实事实，逐条追加理由和证据。

## 有意偏离清单

步骤 2 暂无有意偏离。所有方向选择均追溯到用户需求、仓库现有任务提醒实现/持久化惯例或 Electron 官方 API；步骤 3 起若实现细节偏离本方案，将按“位置 → 被偏离基准 → 具体约束理由”逐条登记。

本方案经评审交接后自主定稿，按纪律第 3 条分级作为基准。
