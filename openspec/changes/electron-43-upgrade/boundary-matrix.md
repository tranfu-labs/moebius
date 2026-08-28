# electron-43-upgrade 边界矩阵

步骤 4 产物。每个功能单元的每个异常情形均给出处理、测试或既有处理复用；真实签名包用户动作另按 `docs/protocols/real-app-acceptance.md` 在步骤 5 记录。

| 功能单元 | 空输入 | 非法或超限输入 | 并发或重入 | 无权限 | 失败恢复 |
| --- | --- | --- | --- | --- | --- |
| M1 · Electron 43 运行时与 39–43 适配 | 本功能没有新增用户输入；开发入口继续由 `desktop/scripts/dev-electron.mjs` 清除 `ELECTRON_RUN_AS_NODE`。复用 desktop startup 的空状态处理；由 typecheck/build 验证。 | 39–43 breaking-change 账本中的无命中 API 不新增适配；Electron binary/install 失败保留前台错误，不伪造可运行状态。复用 Electron 安装与 desktop build 验证。 | 单实例锁与既有生命周期注册继续复用，重复启动由 `requestSingleInstanceLock()` 分流；复用 lifecycle 测试和 M1 desktop 测试。 | 授权不由 Electron 运行时猜测，复用 M3 bridge/runtime 的权限分支。 | lazy binary 下载或构建失败保留失败现场并可重试；复用 install/build 的既有错误路径，步骤 4 以回归命令确认无新增失败。 |
| M2 · 稳定通知身份与历史恢复 | 空 `eventId` 生成的前缀 ID 解码为 `null`；空 history 不触发点击并记录诊断；由 identity/channel 测试覆盖。 | 编码/解码异常、未知 history ID、无目标映射均安全忽略；状态映射只保留合法目标。由 identity、state、wiring 测试覆盖。 | `delivered` 集合防止同一终局重复提交；`restoreHistory()` Promise、对象引用和 ID listener 均幂等。由 runtime/channel/wiring 测试覆盖。 | 权限未通过不提交通知，终局进入既有权限弹窗；复用 task-reminder runtime 测试。 | `show/failed/timeout` 映射为既有异常弹窗；history 查询失败只记录错误；点击通过原子状态和既有 pending/consume 链路恢复。由 channel/state/runtime/wiring 测试覆盖。 |
| M3 · macOS 授权 bridge 与打包兼容 | bridge CLI 只接受固定 `status/request` 动作；缺少或空输出按不可用快照处理。复用 Swift usage guard 与 adapter fallback。 | 非法 JSON、未知授权值、非零退出、spawn error 均降级为 `unknown + error`；由 permission-adapter 测试覆盖。 | 每次读取/请求使用独立前台 bridge 调用；runtime 每次真实提交前重新读取权限。复用已有 runtime 权限测试。 | `notDetermined/denied/provisional/authorized` 保持现有权限弹窗语义；不以 `Notification.isSupported()` 或 `getHistory()` 替代授权。由 adapter/runtime 测试和真实 status 读取覆盖。 | bridge 超时会 kill 子进程并返回错误；失败后沿用打开系统设置/重新检测路径。由 permission-adapter/runtime 测试覆盖。 |

## 对账说明

- M1–M3 的自动测试与复用关系以本次步骤 3 的实际命令输出为证据；真实通知中心注册、前后台横幅点击和退出后历史点击仍属于用户动作最终闸门。
- 本文件不把构建、类型检查或替身测试当作真实用户动作的通过凭据。

## 验收标准落位自查

| 验收标准 | 实现落位 | 测试/验证落位 | 对账结果 |
| --- | --- | --- | --- |
| Electron 升级到 43.x，逐版复核 39–43 breaking changes，并跑通现有测试 | `desktop/package.json`、lockfile、M1 运行时复核；未命中的生产 API 不增加适配分支 | Electron 43.4.1 安装、typecheck、desktop build、arm64 dist；最终受影响范围测试 14 个文件通过；修复 wrapper 测试竞态后完整 `pnpm test` 退出码 0 | 实现与全量自动闸门均已落位；desktop 相对基线新增 3 个测试文件、11 个测试 |
| 冷启动通知点击使用 `Notification.getHistory()` 回流对应会话 | 稳定 notification ID、持久化 target 映射、app ready 后历史恢复、早期点击排队，复用现有 click/consume 链路 | identity/channel/state/runtime/wiring 行为测试；覆盖未知 ID、空/失败 history、重复恢复、普通启动不导航 | 自动覆盖已落位；退出后通知中心真实点击待步骤 5，记为**未验证** |
| Electron 43 授权 API 能覆盖则退役 Swift 桥，否则保留并记录原因 | R2 spike 确认 Electron 43 无满足本项目契约的 macOS 通知授权查询/请求 API；保留 `desktop/native/macos-notification-permission`，Electron 只负责提交/历史 | Swift bridge 构建、开发/生产 bundle ID、签名、打包资源、真实 status 读取及 adapter 行为测试 | 按已验证方向落位；正式签名包授权请求/状态边界仍待步骤 5，记为**未验证** |
| 本地签名包通知中心注册、前台/后台横幅点击、退出后历史冷启动定位 | M1 已产出 `release/mac-arm64/Moebius.app`；M2 已接入对应代码路径 | 自动测试不能替代真实用户动作 | 尚无步骤 5 观察证据，记入遗留事项；不是实现层回退 |
| task-reminder 相关单测全绿 | 任务提醒 runtime/state/wiring 与 channel/identity/permission 测试随实现完成 | 最终 `--scope`：根 11/11，desktop 99/99；其中 task-reminder 根测试 10/10，desktop 相关用例均在 99/99 内通过 | 已验证；整体完整闸门的独立 wrapper 失败不改变该组定向结果 |

## 全量回归对账

按步骤 1 基线命令执行最终有效的一次：

```text
env -u ELECTRON_RUN_AS_NODE pnpm test
```

步骤 1 基线（根非 slow 套件）为 151 个文件通过、1 个跳过；1073 个测试通过、5 个跳过，耗时 189.57s。另有根 slow 套件 1/1 文件、68/68 测试通过、43.41s；desktop 当时为 176 个文件通过、1 个失败，917/918 个测试，失败为 `tests/shell-path.test.ts` 的既有超时；console-ui 未因 wrapper 之前的停止继续执行。

本次步骤 4 最终全量输出（命令退出码 0）为：root 151 个文件通过、1 个跳过；1073 个测试通过、5 个跳过，耗时 189.85s；root slow 1 个文件、68 个测试通过，耗时 37.87s；desktop 180 个文件、929 个测试通过，耗时 77.67s；console-ui 72 个文件、722 个测试通过，耗时 25.78s。四个 workspace 均完成，未有失败或跳过以外的异常结果。

与步骤 1 基线对比：root 非 slow 文件/测试计数均为 151/1073 通过、1/5 跳过，耗时由 189.57s 变为 189.85s；root slow 为 1/68，耗时由 43.41s 变为 37.87s；desktop 从 176 个通过文件、1 个失败文件及 917/918 个测试变为 180/180 文件、929/929 测试，新增 3 个测试文件、11 个测试，基线的 `tests/shell-path.test.ts` 超时本次未复现；console-ui 本次完成 72/72 文件、722/722 测试，步骤 1 因前序失败未执行。此前修复前的 wrapper 超时尝试已由评审打回并以修复后的本次全量结果替代，不作为最终闸门结果。

## 有意偏离清单（步骤 4 汇总）

- `desktop/tests/desktop-local-console-runtime.test.ts`：移除重复的 `skillRegistry` 字段；偏离仓库原测试快照的保留现状，理由是步骤 1 基线 `pnpm typecheck` 已实际报 TS1117，必须消除重复对象键才能满足现有 TypeScript 门禁。【实现层】
- `desktop/src/notification-channel.ts`：为通道构造函数增加可选 `platform` 注入；偏离原方案未要求可注入平台的内部形状，理由是 history 恢复必须在非 macOS 测试中安全短路且无需伪造 Electron 平台，全量受影响测试因此可确定验证。【实现层】
- `tests/managed-process-wrapper.test.ts`：将 wrapper `close` Promise 在 marker 等待前注册；偏离原测试监听时序，理由是 Electron 43 change 后实际 214ms 内已发生 `close`，原顺序造成 20s 超时，修复的是测试竞态而非生产行为。【实现层】

## 遗留事项（本步更新）

- **未验证**：本地签名 `Moebius.app` 在 macOS 通知中心注册、系统设置列表显示、前台/后台横幅点击、退出后历史通知冷启动定位，以及正式签名身份下 bridge 的授权请求/状态边界；这些是步骤 5 的真实用户动作。
- **已处理记录**：修复前一次全量曾因 wrapper 测试的 close 监听竞态超时；已通过定向测试和修复后的最终全量回归关闭，不作为遗留失败。
- **基线差异记录**：步骤 1 的 `tests/shell-path.test.ts` 超时在最终全量中未复现，当前没有基线通过、最终失败的自动测试项。
- **待处理依赖**：`terminal-notification-delivery` predecessor 仍有真实 GUI 验收和归档工作；本 change 只复用其已实现回流接口。
