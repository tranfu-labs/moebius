# 提案：desktop-auto-update-and-shutdown-guard

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/settings.md` | `#关于`、`#更新检查、下载与安装`、`#页面状态`、`#指标与验收`、`#非目标` | 从手动检查/浏览器下载改为启动后自动检查、手动立即检查、后台下载、侧栏确认后重启安装，并取消更新完成通知；关于只展示状态 | 已写入 |
| `docs/product/pages/main-left-sidebar.md` | `#页面结构`、`#底部应用操作`、`#验收标准` | 设置右侧增加仅在安装包就绪时出现的独立“安装更新”按钮；补充安装与退出保护、单次 `Command + Q` 语义 | 已写入 |

本 change 不提前合并 `openspec/specs/`；实现并验证完成后由 `spec-delta/` 回流事实规格。

## 背景

当前桌面更新只通过设置中的手动检查请求 GitHub 最新 Release；发现版本后仅打开浏览器下载页，仓库虽已安装 `electron-updater` 并配置 GitHub provider，但没有接入运行时事件、后台下载、下载完成状态或安装动作。现有设置状态只能表示 `idle/checking/latest/available/failed`。

当前退出协调只覆盖 CLI 安装任务。`before-quit`、主窗口 `close` 和 `window-all-closed` 都可以进入不同的收尾路径；在 macOS 上一次 `Command + Q` 可能留下 Dock 图标，用户需要再次退出。更新安装需要与普通退出共享任务清理和资源回收边界，但必须展示独立的重启安装确认弹窗，不能让一次安装操作复用普通退出弹窗。

## 提案

1. 使用现有 `electron-builder + electron-updater + GitHub Releases` 链路。正式 macOS Apple Silicon Release 生成并上传签名 ZIP、`latest-mac.yml` 与签名元数据；打包态启动后自动检查，发现更新后自动后台下载，下载并校验完成后只把“安装更新”暴露给用户。
2. 将桌面更新器抽象为可测试的事件/状态适配器：启动后自动检查、手动立即检查、无更新、有更新、下载进度、下载完成、失败和重试均转换为窄 DTO；不增加运行期间周期调度；`autoInstallOnAppQuit` 保持关闭，任何安装都只能经过侧栏用户确认。开发态、非 macOS 或未满足正式 Release 元数据时安全降级到当前手动/浏览器兜底，不改变正式发行范围。
3. 扩展设置和侧栏呈现：关于页展示检查、下载进度、已准备好和失败重试，但不提供安装按钮；更新下载完成或失败不创建右下角通知；侧栏底部把“设置”和条件式“安装更新”渲染为两个并列按钮。
4. 建立共享退出保护协调器，覆盖 local Agent/provider 运行、AI 建队运行和 CLI 安装任务。普通退出与重启安装都先经过同一任务快照、确认、停止与资源回收流程，但传入不同的意图和弹窗文案：普通退出显示“退出保护”，更新安装显示“重启安装保护”。任务停止失败时保持应用打开。
5. 修正 Electron 生命周期状态机：没有运行任务时，`Command + Q` 不新增确认弹窗并直接进入安全收尾；有运行任务时才显示普通退出保护。退出/安装意图在第一次拦截时同步登记，所有后续 `before-quit`、窗口 `close` 与 `window-all-closed` 事件都只等待同一个收尾 Promise；收尾完成后只调用一次最终退出或 `quitAndInstall()`。一次 `Command + Q` 必须在真实独立应用实例中完成退出。

## 本轮复核修正

1. 收紧安装入口：移除设置“关于”中的“重启并安装”，设置只展示检查、进度、已准备好和失败状态；安装按钮和确认流程只从侧栏触发。
2. 明确普通退出分支：无运行任务的 `Command + Q` 无确认直接安全退出；任务保护只在存在运行任务时显示，且与重启安装使用不同弹窗。
3. 将 Dock 验收改为可靠信号：观察进程结束和 Dock 不再显示运行中指示；仅在应用未固定时要求图标消失。
4. 增加普通重启恢复：已下载并校验的更新包不得重新下载完整包，重启后恢复 `ready`，侧栏安装按钮重新出现。
5. 收敛检查触发：只承诺启动后自动检查和手动立即检查，不设计或验收运行期间的周期调度。

## 影响

- `desktop/src/updater.ts`、新增的桌面更新协调/状态模块、settings IPC/preload 与 `desktop/src/main.ts`：接入 `electron-updater`、事件桥、安装动作和发布元数据边界。
- `desktop/src/desktop-shutdown-plan.ts`、`desktop/src/desktop-shutdown-runtime.ts`、`desktop/src/desktop-window-plan.ts`、`desktop/src/desktop-window-runtime.ts`、`desktop/src/desktop-lifecycle-register.ts`：统一退出/安装任务保护并修正生命周期竞态。
- `desktop/src/console-page/settings-state.ts`、`use-desktop-settings.ts`、`packages/console-ui/src/console/settings-dialog.tsx`、`operator-console.tsx` 与两套 i18n：增加下载进度、就绪包、安装确认和侧栏入口。
- `desktop/package.json`、`scripts/release/prepare-update-metadata.ts`、`validate-update-metadata.ts`、`upload-assets.ts` 与发布 skill：从最终 arm64 DMG/ZIP staging 生成可消费的更新元数据，上传使用明确白名单，并在本地/远端校验 YML 与最终 ZIP 的版本、文件名、大小、SHA-512；保留现有只发布 Apple Silicon 的红线。
- `openspec/specs/desktop-shell/`、`openspec/specs/console-ui/`：实现验证后合并对应 spec delta。

明确不在范围内：

- 不修改 `pnpm start` 的 local console 运行入口，不恢复 GitHub runner/observer。
- 不提供自动安装开关、预发布渠道、跨平台发布产物或用户可配置的检查频率。
- 不在本轮触碰当前承载会话的 `/Applications/Moebius.app` 或任何当前运行进程；真实验收必须使用隔离的临时应用实例和数据根。
- 不把更新完成做成右下角通知、Sidebar 红点或新的更新页面。
- 不在本轮发布 GitHub Release、推送分支或执行不可逆安装操作。
