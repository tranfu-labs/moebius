# 设计：desktop-auto-update-reminder

## 方案

### 生产 UI surface

- `packages/console-ui/src/console/update-prompt-dialog.tsx` 提供一个受控 `UpdatePromptDialog`，用 `mode` 区分 `ready` 与 `install-confirmation`。组件只接受版本、运行任务数和决定回调，不读取 IPC、定时器、持久化或窗口状态。
- `packages/console-ui/src/ui/dialog.tsx` 保持 Radix Dialog 的共享出口，并允许调用方为蒙版指定叠层 class；默认仍是现有设置/历史信息弹层的叠层。更新弹层使用成对的 overlay/content z-index 覆盖当前工作区或设置，确保内容始终位于蒙版之上，不复制 Dialog 基础实现。
- ready 模式将当前/新版本、更新内容外链和三个动作按轻重分组：跳过在左，稍后在中间，重启安装为右侧主操作。`Dialog.Root` 的 Escape / backdrop close 直接归为 `remind-later`。
- 安装确认模式根据 `runningTaskCount > 0` 选择两套内容：无任务提供“取消 / 重启并安装”；有任务提供“继续工作 / 停止任务并重启安装”，危险停止动作使用既有 danger Button 变体。Escape / backdrop close 在有任务时归为“继续工作”，无任务时归为“取消”。
- `SettingsAboutState.skippedVersion` 只改变 ready 文案，不创造新的更新状态；ready 状态同时接受 `onInstallUpdate`，让 About 与侧栏共用安装意图入口，跳过版本也不隐藏该动作。所有产品静态文案进入 `zh-CN` / `en` 资源，版本号、数量和项目名称保持 fixture 或运行时输入原样。
- `packages/console-ui/src/console/app-auto-update-page.stories.tsx` 是唯一浏览入口，组合真实 `UpdatePromptDialog` 与 `SettingsDialog`。固定 host 只模拟当前工作区、侧栏和运行任务，绝不接真实桌面 API；故事覆盖就绪提醒、运行任务安装确认、跳过后 About 状态和高密度压力数据/窄视口。

### 运行时数据链路

1. `desktop-update-runtime.ts` 保持更新 provider、下载状态和 ready marker 的所有权；新增调度器只负责触发 `check()`，不复制 provider 状态机。
2. 新增纯计划模块（建议拆为 `desktop-update-schedule-plan.ts` 与 `desktop-update-reminder-plan.ts`）计算启动/周期/唤醒 admission、运行中等待、提醒决定和更高版本覆盖。纯模块不能依赖 Electron、文件系统或 provider。
3. main 进程使用 Electron `powerMonitor` 的唤醒事件和可清理的 4 小时 timer；窗口销毁、应用退出和安装失败恢复时必须释放监听器与 timer。周期检查只调用现有单飞入口。
4. `desktop-update-contract.ts` / settings DTO 增加可序列化的 `skippedVersion` 投影（或等价的明确字段），并通过现有 `readUpdateState` / `onUpdateState` 到 renderer。skip marker 使用数据根 `.state` 下独立文件，写入采用临时文件 + rename，损坏或版本非法时 fail closed 为未跳过。
5. `use-desktop-settings` / `OperatorConsole` 增加提醒状态和决定回调。ready 提醒的 `install` 只调用 `shutdown.requestInstall()`；它不得直接调用 `quitAndInstall()`。退出协调器在该调用中重新获取当前任务快照、再次确认 ready、执行既有收尾与安装看门狗。
6. 普通 `Command + Q` 仍走现有原生退出保护，不接入更新提醒 Dialog；更新安装确认才替换现有更新路径的原生 message box。

### 验证与证据

- 组件层使用 Vitest + Testing Library 验证决定映射、任务数量分支、Escape、点击蒙版、焦点可达和双语 key 对齐。
- Storybook 静态构建验证 `Page/Console/AppAutoUpdate` 的六个固定 state；Page Story 不得把通过测试当作真实 Electron 验收替代。
- 后续 runtime 实现必须增加纯计划单测、desktop IPC/状态恢复测试，并用隔离打包 Electron 验收定时发现、唤醒、下载不打断、skip/remind 记忆、安装失败恢复与任务收尾。

## 权衡

- 选择在 `console-ui` 增加真实 presentational component，而不是在 Story 文件复制一套按钮/弹窗。这样 Story 能成为后续 desktop 接线的稳定 UI 契约；代价是本轮会先出现未被 desktop 使用的生产组件，接线任务必须在同一 change 完成前收口。
- 选择一个组件的两个 mode，而不是两套相似 Dialog。二者共享蒙版、焦点与动作布局基础，同时用 discriminated union 防止把“跳过版本”误传给安装确认；代价是 mode 组件内部有少量条件分支。
- 不把 ready reminder 与退出保护合并成一个 runtime 状态机。提醒表达用户意图，退出协调器表达最终安全收尾；这样任务数在用户点击后可以重新取样，避免 stale snapshot 直接安装，代价是需要清楚的 intent 回调和重复防护。
- 不给“稍后提醒”做 4 小时重弹，也不把跳过版本当成关闭自动更新。调度和提醒策略分层后，定时检查不会抵消用户决定；代价是需要分别维护本次运行的 remind 状态和跨重启的 skip marker。

## 风险

- 4 小时 timer、唤醒事件与已有 startup check 可能同时到达；必须复用现有 pending promise admission，并在测试中验证不会重复发起或重置下载。
- ready marker、skip marker 与当前版本关系不一致时可能出现错误提醒；所有 marker 读取需版本校验，未知/损坏内容按未跳过处理并保留可用安装入口。
- ready 提醒可能在任务状态变化的同时打开；提醒策略只在稳定的 running count 为零时排队放行，已打开的提醒不得因新任务自动撤回。
- 安装确认组件替换后，更新安装与普通退出仍会有视觉规格差异；这是 PRD 明确接受的范围边界，不能顺手改普通退出路径。
- Page Story 是确定性模拟，无法证明真实 IPC、下载和 quitAndInstall；交付前必须按真实运行验收清单补齐 Electron evidence。

## 当前阶段边界

生产 UI、自动更新调度、skip/remind 记忆、renderer/IPC 接线和更新安装退出协调均已实现并通过受影响范围验证。真实 Electron 验收仍单独按下方清单执行；Page Story、Storybook、单测、类型检查和构建不能替代真实下载、任务停止、重启安装及失败恢复证据。

## 返工设计补充：安装结果与运行任务事实分离

产品来源：`docs/product/flows/app-auto-update.md#任务未能停止或安装未能完成`。

### 任务停止链路

安装确认批准后，`DesktopShutdownRuntime` 保存的只是一项安装意图上下文
`{ hadRunningTasks }`，不是可直接执行的任务快照。它调用宿主的取消端口，随后重新读取
`getRunningTaskCount()`；只有计数归零才关闭运行时并调用 `DesktopUpdateRuntime.install(context)`。
`main.ts` 的取消端口把 local-console 的活动运行项纳入同一收尾边界，普通 `Command + Q`
仍复用这条停止边界和自己的原生确认弹窗。

如果取消抛错或复核仍有运行项，shutdown runtime 不关闭应用、不调用安装 provider，发布
`kind: "task-stop"` 的失败结果。这样失败弹窗中的运行任务数来自失败时的实际读取，而不是首次
确认时的旧值。

### 安装失败事件链路

更新 runtime 在 provider 抛错或 watchdog 恢复时保留 ready marker，清除一次性安装闸门，
重新开放本地 console 与调度，并发布 `kind: "install"` 失败结果。失败 DTO 同时携带
`hadRunningTasks`、`tasksStopped`、`installStarted` 和失败时的运行任务数，renderer 不需要
从文案或当前 UI 推断阶段。

`use-desktop-settings` 将事件保存为 renderer 状态；`OperatorConsole` 挂载第三种
`UpdatePromptDialog` mode。关闭失败弹窗只清除事件，重试回到安装入口，由 shutdown runtime
重新读取 ready 和任务数。About 只消费 update failure reason，用独立的安装失败文案，并继续
提供同一个安装意图入口。

### 交互边界

- 任务停止失败：`继续工作` 关闭弹窗，`重试` 重新进入任务保护。
- 安装阶段失败：`稍后重试` 关闭弹窗，`重试安装` 重新进入任务保护。
- Escape、蒙版和左侧退路只关闭失败弹窗，不能自动重试。
- 失败弹窗沿用 `UpdatePromptDialog` 的 Radix overlay、焦点限制和 z-index，不新增第二套
  modal 原语。

## 最终返工设计补充：停止运行项而不关闭服务

`LocalConsoleRuntime.close()` 是应用关闭语义，不能作为安装前的任务取消原语：它会进入
runtime closing、关闭 store/server，并可能在 provider 尚未完成收尾时让桌面层失去权威计数。
因此新增独立的 `stopRunningTasks()` 链路：

1. `LocalRuntimeShutdownRuntime.stopRunningTasks()` 对当前 active run controller 发出
   `desktop-install-stop` 中止信号，不准备 graceful resume，也不设置全局 closing 状态。
2. 该方法等待 `activeRunRegistry` 与 managed-process running count 的权威合计变为零，
   使用既有 runtime timeout 作为上限；超时返回时保留非零计数，不伪造成功。
3. `StartedLocalConsoleServer` 和 `DesktopLocalConsoleRuntime` 暴露该独立端口；main 的安装/退出取消端口先取消其他受管工作，再调用它，服务继续可用。
4. `DesktopShutdownRuntime` 既有的取消后重新取样负责最终安全闸门：计数非零时发布
   `task-stop` 失败并停留应用；计数为零时才关闭 local-console、调用安装 provider。
5. 失败弹窗的任务停止说明按 `runningTaskCount === 1` 选择单数文案；安装阶段失败只有在
   该终态已被确认后才能说明任务已停止。

行为测试同时覆盖“停止请求发生在 provider 尚未启动”和“provider 仍未终止”两种边界，
确保取消 Promise 的返回时序不会被误当成任务终态。
