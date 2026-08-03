### Requirement: 正式 macOS 更新自动检查并后台下载

Source: docs/product/pages/settings.md#更新检查、下载与安装

正式打包的 macOS Apple Silicon 应用 MUST 在启动后自动检查正式 GitHub Release，并在发现新版本后自动后台下载和校验；用户 MUST 还能手动立即检查。本 change 不引入运行期间的周期调度。更新器 MUST 将检查、下载进度、下载完成和失败投影为稳定状态；MUST NOT 在检查或下载阶段安装、重启、打开浏览器或弹出完成通知。开发态、非正式平台或更新元数据不可用时 MUST fail closed 并保留浏览器 Release 兜底。

#### Scenario: 启动后发现更新

- **GIVEN** 正式 macOS arm64 应用启动，GitHub 提供与当前版本不同的有效签名 Release 元数据
- **WHEN** 自动检查完成
- **THEN** 主进程开始后台下载
- **AND** renderer 收到版本与有界下载进度
- **AND** 未调用 `shell.openExternal`、安装或退出

#### Scenario: 包下载完成

- **GIVEN** 更新器报告目标包已完整下载并校验通过
- **WHEN** 更新状态广播到 renderer
- **THEN** 状态进入 `ready-to-install`
- **AND** 只有 UI 安装入口可触发下一步

#### Scenario: 检查或下载失败

- **GIVEN** 网络、元数据、签名或下载发生失败
- **WHEN** 更新器结束本次尝试
- **THEN** 状态进入可重试失败
- **AND** 当前版本仍可见、侧栏没有安装按钮、应用保持运行

#### Scenario: 安装器未使进程退出

- **GIVEN** 更新状态为 `ready-to-install`，用户已确认安装，但上游 `quitAndInstall()` 未使隔离应用进程在有界时间内结束
- **WHEN** 安装退出看门狗到期
- **THEN** 应用恢复可用并显示脱敏的安装失败/重试状态
- **AND** 已下载更新 marker 保留，重复安装调用被解除单飞锁
- **AND** 本地 console 与退出协调器恢复，用户不需要第二次启动应用才能继续工作

#### Scenario: 普通重启恢复已就绪更新

- **GIVEN** 更新包已完整下载并校验通过，更新器缓存和就绪元数据仍有效
- **WHEN** 用户执行普通应用重启
- **THEN** 主进程恢复 `ready-to-install` 状态而不重新下载完整包
- **AND** 设置“关于”显示“已准备好”，侧栏重新显示“安装更新”

### Requirement: Release 更新资产必须与最终 arm64 ZIP 一致

正式 GitHub Release MUST 使用明确白名单上传最终 macOS arm64 DMG、最终 ZIP、`latest-mac.yml` 和该 YML 明确引用的 ZIP blockmap sidecar；MUST NOT 上传 builder 中间文件。`latest-mac.yml` 的版本、ZIP 文件名、字节大小和 SHA-512 MUST 与最终 ZIP 一致；本地发布目录和远端 Release MUST 使用同一校验规则。最终 ZIP 内的 `.app` MUST 已签名、公证并 stapled，不能把 ZIP 本身描述为 stapled。

#### Scenario: 本地发布门禁拒绝中间文件

- **GIVEN** release 目录包含最终 arm64 产物、更新元数据和一个未列入白名单的 builder 文件
- **WHEN** 执行 `pnpm release:validate-update --dir <dir> --version <version>`
- **THEN** 校验失败并列出非白名单文件
- **AND** 发布流程不得上传该目录

#### Scenario: 远端发布门禁校验最终 ZIP

- **GIVEN** Draft Release 提供最终 arm64 资产、`latest-mac.yml` 和 YML 引用的 sidecar
- **WHEN** 执行 `pnpm release:validate-update --remote v<version> --version <version>`
- **THEN** 校验器下载远端 YML 与最终 ZIP 到系统临时目录
- **AND** 只有远端 YML 的版本、文件名、大小和 SHA-512 全部匹配时才返回成功

### Requirement: 更新安装必须经过用户确认与安全收尾

Source: docs/product/pages/settings.md#更新检查、下载与安装

`ready-to-install` 状态 MUST 只由侧边栏“安装更新”入口触发安装流程；设置“关于”只展示就绪状态，不提供安装按钮。侧栏入口 MUST 先显示安装确认；无运行任务时提供“取消/重启并安装”，有运行任务时提供独立的重启安装保护弹窗。确认停止任务后，主进程 MUST 等待任务和 local resources 有界回收，再只调用一次 `quitAndInstall()`；取消、任务回收失败或安装失败 MUST 保持应用打开。

#### Scenario: 用户取消安装

- **GIVEN** 更新包处于 ready 状态
- **WHEN** 用户从侧栏进入安装确认并选择取消或“继续工作”
- **THEN** 应用和当前工作区保持原位
- **AND** ready 安装按钮继续存在
- **AND** `quitAndInstall()` 未调用

#### Scenario: 有运行任务时确认重启安装

- **GIVEN** 至少一个 local Agent、AI 建队或 CLI 安装任务正在运行
- **WHEN** 用户选择“停止任务并重启安装”
- **THEN** 弹窗明确列出任务影响并进入准备安装状态
- **AND** 任务实际停止、local console/worker 收尾完成后才调用一次 `quitAndInstall()`

#### Scenario: 任务无法回收

- **GIVEN** 用户确认停止任务但某个受管任务未确认 close
- **WHEN** 安全收尾超时或失败
- **THEN** 应用保持打开并显示脱敏失败说明
- **AND** 更新包与安装入口可再次尝试

### Requirement: 普通退出与重启安装共享保护但使用独立弹窗

Source: docs/product/pages/settings.md#弹层与危险操作

Desktop MUST 使用一个共享的任务快照、停止和资源回收边界处理普通退出与重启安装；MUST 根据终止意图分别显示退出保护弹窗和重启安装保护弹窗。无运行任务时普通退出 MUST 不新增确认弹窗并直接安全收尾；有运行任务时才显示退出保护。安装流程 MUST NOT 复用普通退出弹窗，也 MUST NOT 让第二个弹窗叠在第一个弹窗上。

#### Scenario: 普通退出保护

- **GIVEN** 用户执行普通关闭或 `Command + Q` 且有运行任务
- **WHEN** 系统请求退出
- **THEN** 显示退出保护弹窗
- **AND** 用户取消时任务与应用保持运行，确认时停止任务并退出

#### Scenario: 无运行任务时普通退出

- **GIVEN** 用户执行普通关闭或 `Command + Q` 且没有运行任务
- **WHEN** 系统请求退出
- **THEN** 不显示退出确认弹窗并直接进入安全收尾
- **AND** 进程最终结束

### Requirement: 单次 Command + Q 完成退出

Source: docs/product/pages/main-left-sidebar.md#验收标准

Desktop MUST 在第一次退出事件登记唯一终止意图并复用同一个收尾 Promise。后续 `before-quit`、主窗口 `close` 和 `window-all-closed` 事件 MUST 只等待已登记的收尾，不得发起第二个确认或第二套清理。一次 `Command + Q` 在收尾成功后 MUST 使进程结束，Dock MUST 不再显示运行中指示；仅在应用未固定到 Dock 时要求图标消失。

#### Scenario: 一次 Command + Q

- **GIVEN** 隔离的正式桌面实例无运行任务
- **WHEN** 用户按一次 `Command + Q`
- **THEN** local console 与 worker 有界关闭
- **AND** 最终退出调用恰好一次
- **AND** 进程结束、Dock 不再显示运行中指示；若应用未固定在 Dock，图标消失，无需再次操作
