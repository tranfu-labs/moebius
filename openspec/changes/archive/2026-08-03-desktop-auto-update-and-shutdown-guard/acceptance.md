# 验收矩阵：desktop-auto-update-and-shutdown-guard

所有真实应用验收都必须使用隔离的临时数据根和独立构建/测试应用。禁止启动、退出、终止、重启或安装当前承载本会话的 `/Applications/Moebius.app`；禁止把当前 Moebius 进程当作被测实例。证据写系统临时目录，不写仓库 `artifacts/`。

在没有 macOS Accessibility 权限发送键盘事件的环境中，QUIT-01/02/03 的生命周期验收可使用指向已通过 realpath、临时目录和非生产 bundle ID 校验的隔离实例的 quit AppleEvent；该事件必须仍经应用真实 `before-quit` 链路，不得直接调用 IPC、生命周期函数或注入任务/状态。若验收目标明确要求键盘物理路径，AppleEvent 证据只能证明生命周期语义，不能替代键盘权限验收。

| ID | 入口与前置 | 用户动作 | 必须观察到的信号 |
| --- | --- | --- | --- |
| UPD-01 | 隔离的已打包 macOS arm64 实例；Release 有效 | 启动应用 | 自动检查开始；设置“关于”可读到 checking，未打开浏览器、未弹通知 |
| UPD-02 | 同上，Release 高于当前版本 | 等待检查结束 | about 显示目标版本与下载中/进度；进度在 0–100% 内单调；应用继续可用 |
| UPD-03 | 后台下载进行中 | 关闭并重新打开设置，切换常规/关于 | 下载继续；没有第二次下载；父级重渲染或回调变化不丢状态 |
| UPD-04 | 模拟检查超时、非法元数据和下载失败 | 等待失败，点击重试/重新下载 | 显示失败而不是“已是最新版”；当前版本保留；侧栏无安装按钮；重试可再次开始 |
| UPD-05 | 目标包完整下载且校验通过 | 打开设置关于 | 只显示“已准备好”和状态提示；不显示设置内安装按钮；侧栏设置右侧出现独立“安装更新” |
| UPD-06 | ready 状态 | 观察右下角与侧栏 | 没有更新完成通知、红点或新页面；安装按钮可单独聚焦 |
| UPD-07 | ready、无运行任务 | 点击侧栏安装更新，取消确认 | 先显示安装确认；取消后回到原工作区，ready 和按钮仍存在；未调用安装器 |
| UPD-08 | ready、有运行 Agent/CLI 任务 | 点击侧栏安装更新 | 显示重启安装专用弹窗，而不是普通退出弹窗；列出任务影响，按钮为“继续工作/停止任务并重启安装” |
| UPD-09 | 同上 | 点击“继续工作” | 弹窗关闭；任务继续；更新按钮仍存在；没有退出或安装 |
| UPD-10 | 同上 | 再次确认并点击“停止任务并重启安装” | 任务逐项停止并确认 close；local console/worker 收尾后只触发一次 `quitAndInstall()`；新版本实例重新打开 |
| UPD-11 | ready、有运行任务 | 任务停止故意无法确认 | 应用保持打开，显示脱敏失败；会话记录未丢失；ready 状态和重试入口保留 |
| UPD-12 | 已下载并校验通过的包；更新器缓存仍有效 | 普通重启应用后打开关于并观察侧栏 | 不重新下载完整包（下载事件计数不增加）；关于恢复“已准备好”；侧栏“安装更新”重新出现 |
| QUIT-01 | 隔离实例、无运行任务 | 按一次 `Command + Q` | 不出现确认弹窗；关闭资源、进程结束、Dock 不再显示运行中指示；未固定应用时图标消失；最终退出调用一次，不需要第二次按键 |
| QUIT-02 | 隔离实例、有运行任务 | 按一次 `Command + Q`，取消退出保护 | 普通退出专用弹窗出现；取消后应用和任务继续；不出现安装文案 |
| QUIT-03 | 同上 | 再次按 `Command + Q`，确认停止并退出 | 任务停止、资源回收后退出；不重复弹窗、不留孤儿进程 |
| QUIT-04 | 隔离测试 double lifecycle 事件 | 依次触发 `before-quit`、window close、window-all-closed、第二轮 before-quit | 共享同一协调 Promise；无第二次用户确认；最终退出/安装调用恰好一次 |
| UI-01 | 中文/英文各一轮 | 键盘打开设置、切换关于、查看状态、打开确认和关闭 | 所有新增按钮、状态、弹窗标题/说明/可访问名称均有当前语言版本；焦点可预测回到入口 |
| UI-02 | 900×640、560×640、900×480 三种视口 | 打开关于并覆盖 downloading/ready；再从侧栏触发 confirmation | 无水平滚动；标题/关闭/进度/状态和侧栏安装动作可达；短视口只滚动内容区 |
| REL-01 | 最终 builder 输出目录与干净 staging 目录 | `pnpm release:prepare-update --input <builder-output> --output <staging> --version <version>` 后再执行 `pnpm release:validate-update --dir <staging> --version <version>` | staging 只有最终 macOS arm64 DMG、最终 ZIP、`latest-mac.yml` 及其明确引用的 ZIP blockmap；DMG blockmap 等中间文件未复制；ZIP 内的 `.app` 已签名、公证并 stapled；YML 的版本、文件名、大小与 SHA-512 对应最终 ZIP |
| REL-02 | 无效/缺失元数据 Release | 启动隔离实例 | 自动更新安全降级；不显示假 ready，不调用安装；浏览器 Release 兜底仍可用 |
| REL-03 | 本地 release 目录含最终产物和一个 builder 中间文件 | `pnpm release:validate-update --dir <dir> --version <version>` | 命令非零退出并指出非白名单文件；禁止把中间文件上传 |
| REL-04 | 远端 Draft Release 含最终产物、YML 和 sidecar | `pnpm release:validate-update --remote v<version> --version <version>` | 读取远端资产白名单并下载远端 YML/ZIP 到系统临时目录；远端版本、文件名、大小、SHA-512 与最终 ZIP 一致才返回 0 |

实现完成后，QA 需在本表每一行补充：真实入口、观察结果、命令退出码或系统临时 evidence 路径。没有真实运行语句的 UI 条目不得标记为 `code-verified`。
