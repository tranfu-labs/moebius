# 任务：desktop-auto-update-reminder

## 开发前方案与 UI 闸门

- [x] 核对 `docs/product/flows/app-auto-update.md`、设置/侧栏 PRD、desktop-shell/console-ui spec、架构 module map、console-ui 包内契约与邻近 Dialog/Story。
- [x] 新增 `UpdatePromptDialog` 生产组件：ready reminder 与 install confirmation 两个 mode，共享 Radix Dialog、蒙版、焦点限制、Escape/backdrop decision mapping。
- [x] 扩展 `DialogContent` 的蒙版叠层能力，保持默认消费者行为不变；更新弹层不引入阴影、渐变或第二套弹窗原语。
- [x] 扩展 About ready 状态的 `skippedVersion` 视觉投影与“重启并安装”入口，并补齐 `zh-CN` / `en` 更新弹层文案。
- [x] 创建 `Page/Console/AppAutoUpdate` Page Story，覆盖更新就绪提醒、明确的零/有任务安装确认、跳过版本后的 About 状态、About 重新安装路径、双语与高密度/窄视口压力数据。
- [x] 为决定映射、显式按钮不被关闭语义覆盖、Escape、蒙版点击、任务分支、danger 动作、About 安装动作和跳过状态补组件测试；测试只断言用户可观察行为。
- [x] 在托管 Storybook 入口实际点击更新提醒、查看更新内容、无任务安装确认、跳过后 About 安装与有任务停止安装，确认显式决定不会被关闭语义覆盖。
- [x] 将 Page Story 交给 @product-delivery-lead 做开发前用户任务评审；评审不通过时只按证据修订 UI/方案。

## 桌面更新运行时

- [x] 在纯计划模块中定义启动、4 小时周期、唤醒补检与现有单飞 admission；加入“已有 available/downloading/ready/installing 时跳过”的边界测试。
- [x] 在 main 进程注册可清理的周期 timer 和 `powerMonitor` 唤醒监听；应用退出、窗口关闭和安装失败恢复时释放资源。
- [x] 保留现有自动下载/校验/ready marker 恢复；验证周期检测不会中断下载、重复下载或改变失败恢复语义。
- [x] 增加按版本 skip marker 的安全读写与纯策略：损坏/未知内容 fail closed，更高版本恢复提醒；增加本次运行 remind-later 记忆且不受周期检测抵消。
- [x] 扩展 desktop update/settings DTO，把 skip 投影传到 renderer；验证重启、迟到 state 和失败 state 不覆盖新 ready/installing 状态。

## Renderer 接线与安装意图

- [x] 在 `use-desktop-settings` / `OperatorConsole` 接入提醒 state、ready 排队条件和三个决定；有运行任务时只在任务数回到零后显示 reminder。
- [x] 将 reminder 的“重启并安装”和侧栏“安装更新”都接到 `shutdown.requestInstall()`；不得从 renderer 或 Dialog 直接调用 `quitAndInstall()`。
- [x] 将更新安装确认从 Electron 原生 `showMessageBox` 改接 `UpdatePromptDialog`，保留普通 `Command + Q` 有任务时的原生退出确认与独立意图。
- [x] 安装意图执行前重新获取任务快照并复用既有 cleanup promise、单次安装调用、watchdog 与失败恢复；取消/继续工作保持 ready 入口。
- [x] 覆盖父级重渲染、回调身份变化、慢/失败/迟到更新 state、任务从运行到空闲、关闭设置后重开和安装失败恢复。

## 验证与交付

- [x] 运行 console-ui 全量单测（62 files / 602 tests）、typecheck、Storybook catalog/static build；检查 Page Story 为 fullscreen、六个 fixture 确定且无真实集成。
- [x] 运行 desktop 定向单测、根 typecheck、边界检查和必要 desktop build；不把 Storybook 结果当作 runtime 证据。
- [x] 按 `docs/product/flows/app-auto-update.md` #1–#9 建立逐条证据：检测/下载、空闲提醒、任务排队、稍后、跳过、Esc/蒙版、不打断和双语弹层由真机记录覆盖；4 小时调度、唤醒与更高版本覆盖属于无用户动作的自动行为，由计划/调度测试覆盖。
- [x] 按 `docs/protocols/real-app-acceptance.md` 标注所有带副作用点击/退出/安装动作为真机；普通退出弹窗虽是 UI 非目标，但因共享 shutdown runtime 已补做 Command+Q 取消与确认两条真机回归。
- [x] 复核未扩大到 Intel/Windows、关闭自动更新开关、增量更新、普通退出弹窗或 prototypes；修正 PRD/实现/验收之间的事实漂移。
- [ ] 最终真实产品用户任务评审仍有状态一致性阻断，change 保持未归档；当前仅允许作为 Draft PR 提交，不得标记为可合并。

## 本轮真实运行记录

- **环境：真机**。隔离签名 arm64 Electron 应用使用系统临时 data root 启动；`设置 → 关于` 观察到启动检查状态从“正在检查”进入“已是最新版”。证据标识：`desktop-auto-update-shutdown-rKpfAV`（系统临时目录，未提交仓库）。
- **环境：真机**。同一隔离实例切换 English 后，About、当前版本、更新状态与 Close 入口均可观察；发送一次真实 quit AppleEvent 后主进程退出，证据同上。
- **环境：真机（前置条件阻断，不计为更新功能通过）**。当前远端没有可用于 `0.4.3 → 新版本` 的有效 N−1→N Release，真实应用最终为“已是最新版”；因此本轮未执行下载完成、提醒、skip/remind、任务停止和重启安装动作，未注入 ready 状态、未替换网络或 IPC。对应 `UPD-02`–`UPD-12` 与 `UI-02` 已由验收脚本标为 `real-app-blocked`，交给功能验收在有真实发布前提时继续。
- **环境：替身＋Page Story，不算真机**。开发前任务评审已实际走过提醒四种决定、蒙版/Esc、3 任务与 0 任务安装确认、跳过后 About 安装入口；这些只作为 UI 交互辅助证据，不抵扣上条真实更新动作。

## 功能验收证据闭环（2026-08-10）

以下记录取代上方实现阶段的“缺少 N−1→N Release”阻断结论；旧记录保留作为当时环境的可审计事实。

### 范围裁决

- `UPD-08/09/10` 由真实运行任务下的安装保护、继续工作和停止任务安装证据覆盖；`UPD-11` 由真实安装失败后应用恢复、任务停止及安装入口保留证据覆盖。
- `REL-02` 由真实 GitHub Release 检测与下载覆盖。`UPD-04` 是本 change 未修改的既有失败重试动作；`REL-01/03/04` 属于独立 Release 制品流程，不阻断本 change。
- `QUIT-02/03` 因共享 shutdown runtime 被修改而纳入本轮回归，已补做原生 Command+Q 取消与确认两条真机路径。
- 4 小时定时、唤醒补检、更高版本覆盖和下载单飞没有用户动作，以 `desktop-update-scheduler`、`desktop-update-plan`、`desktop-update-runtime` 测试为回归证据；功能验收聚焦复跑 scheduler、plan、runtime 与 shutdown runtime 共 4 个文件、24 条测试，退出码 0。
- 正式签名包成功替换在当前隔离、临时签名应用中不可安全完成；保留为发布环境风险，不以测试或失败恢复证据冒充成功安装。

### 真机四段记录

1. **环境：真机（真实 macOS Electron、真实 GitHub Release、隔离 data root）**
   - **入口：** 应用启动与“设置 → 关于”。
   - **操作：** 以当前构建组装的隔离 `0.4.2` 应用启动，等待生产 updater 检查并下载真实 `0.4.3`，关闭并重开 About，普通退出后用同一 data root 重启。
   - **屏幕观察：** 状态依次出现“正在检查”“正在下载”“0.4.3 已准备好”；About 重开后保持 ready；重启后 About 仍显示 `0.4.3 is ready`，Sidebar 安装入口数为 1。
   - **与承诺一致否：** 是。真实检测、自动下载、ready marker 跨重启恢复、About/Sidebar 入口均符合承诺。
   - **证据标识：** `desktop-auto-update-shutdown-jhzUpi`（系统临时目录，未提交仓库）。

2. **环境：真机（真实 macOS Electron、真实外部浏览器）**
   - **入口：** 更新就绪提醒。
   - **操作：** 点击“查看更新内容”。
   - **屏幕观察：** Google Chrome 中 `https://github.com/tranfu-labs/moebius/releases` 匹配标签页数量从 5 增至 6；应用内 ready 提醒保持可见。
   - **与承诺一致否：** 是。外部页面真实打开，且该只读动作没有改写或关闭更新决定。
   - **证据标识：** `moebius-qa-update-evidence-closeout-e9NnIh`（系统临时目录，未提交仓库）。

3. **环境：真机（真实 macOS Electron、真实 updater state）**
   - **入口：** 更新就绪提醒、About 与 Sidebar。
   - **操作：** 分别执行 Esc、蒙版关闭、稍后提醒、跳过此版本；重启后复查提醒与跳过状态；从 About 和 Sidebar 发起安装并取消。
   - **屏幕观察：** Esc、蒙版和“稍后提醒”关闭提醒但保留 ready 入口；下次启动重新提醒；跳过后重启不再弹并显示“你选择了跳过这个版本”；About 与 Sidebar 均保留安装入口，取消后应用继续运行。
   - **与承诺一致否：** 是。会话级稍后、版本级跳过、关闭语义与多入口安装均符合承诺。
   - **证据标识：** `moebius-qa-update-flow-rrjBNP`、`moebius-qa-update-cancel-reopen-rxVLmU`（系统临时目录，未提交仓库）。

4. **环境：真机（真实 macOS Electron、从 UI 启动的真实前台 Agent 任务）**
   - **入口：** 任务运行期间的 Sidebar“安装更新”。
   - **操作：** 在一个真实任务运行时点击安装更新，选择“继续工作”，确认任务仍运行；随后从 UI 停止任务并等待状态归零。
   - **屏幕观察：** 更新提醒在任务运行时排队不显示；确认框明确显示“安装需要先停止 1 个运行中任务”；选择继续后停止按钮仍可见；任务结束 2 秒后 ready 提醒没有重新出现。
   - **与承诺一致否：** 是。安装保护使用当前任务数；继续工作保留任务并记录本次运行的 remind-later，任务结束不会重复打扰。
   - **证据标识：** `moebius-qa-update-evidence-closeout-e9NnIh`（系统临时目录，未提交仓库）。

5. **环境：真机（真实 macOS Electron、从 UI 启动的真实前台 Agent 任务）**
   - **入口：** 有运行任务的安装确认。
   - **操作：** 先选择“继续工作”，再选择“停止任务并重启安装”；等待临时签名应用的真实安装失败恢复。
   - **屏幕观察：** 继续工作后任务仍运行；确认停止后任务停止；测试 updater 无法完成替换时应用保持打开，About 显示可理解的安装失败状态，ready/安装入口仍可使用。
   - **与承诺一致否：** 是。任务保护、停止、安装失败恢复符合承诺；不把失败恢复冒充正式签名包成功替换。
   - **证据标识：** `moebius-qa-update-running-task-riAy26`、`moebius-qa-update-install-m2pvR5`（系统临时目录，未提交仓库）。

6. **环境：真机（真实 macOS Electron、旧 marker 与 renderer 重建）**
   - **入口：** 应用启动及零任务安装确认。
   - **操作：** 取消安装后重建 renderer；另以旧版 `0.3.0` ready marker 启动 `0.4.2` 应用并等待真实检查。
   - **屏幕观察：** renderer 重建后本次运行不重复弹；页面从未把 `0.3.0` 显示成 ready，真实检查后显示 `0.4.3` 并将 marker 改写为 `0.4.3`。
   - **与承诺一致否：** 是。取消语义跨 renderer 重建保持，非法/旧/等版 marker 不会恢复为可安装更新。
   - **证据标识：** `moebius-qa-update-rework-sisters-tDPmlm`（系统临时目录，未提交仓库）。

7. **环境：真机（真实 macOS Electron、从 UI 启动的真实前台 Agent 任务、原生退出确认）**
   - **入口：** 有运行任务时的普通 Command+Q。
   - **操作：** 第一次按 Command+Q 并在原生确认选择“继续工作”；第二次按 Command+Q 并选择“停止任务并退出”；用同一 data root 重启。
   - **屏幕观察：** 首次取消后应用保持打开且停止按钮仍可见；确认退出后原进程以 code 0 结束；重启后停止按钮不可见，启动 reconciliation 完成后 `activeRuns = 0`。
   - **与承诺一致否：** 是。普通退出保护仍为独立原生对话框；取消保留应用和任务，确认后停止任务并退出。
   - **证据标识：** `moebius-qa-update-evidence-closeout-e9NnIh`（系统临时目录，未提交仓库）。

8. **环境：真机（真实 macOS Electron、中英文与窄视口）**
   - **入口：** 中文/英文设置与 About、真实 downloading/ready 状态。
   - **操作：** 切换 English，并在 900×640、560×640、900×480 三种视口观察 About、关闭入口与 Sidebar。
   - **屏幕观察：** 英文标题、版本、ready、Close 与 About 可访问名称完整；三种视口无水平溢出，更新入口可达。
   - **与承诺一致否：** 是。中英文及压力视口符合承诺。
   - **证据标识：** `desktop-auto-update-shutdown-jhzUpi`（系统临时目录，未提交仓库）。

## 安装失败反馈返工（2026-08-10）

- [x] 将 local-console 活动运行项纳入安装确认后的真实停止边界；停止后重新读取任务数，未归零时阻断安装并发布 `task-stop` 失败结果。
- [x] 将 provider/watchdog 安装失败、任务停止失败和零任务安装失败归一为可序列化的失败 DTO，通过 preload/IPC/renderer 传递。
- [x] 增加失败弹窗三种用户结果：任务未停止、任务已停止后安装未完成、零任务安装未完成；Esc、蒙版和左侧退路只关闭，不自动重试。
- [x] 让 About 区分检查、下载和安装失败，并在 ready/失败状态保留“重启并安装”入口；重试从新的 ready 与任务状态取样。
- [x] 补齐中英文生产 Page Story、组件行为测试、shutdown/runtime 状态测试；删除/调整因停止后复核契约而失去意义的旧测试假设。
- [x] 定向验证：desktop 4 个文件 31 tests、console-ui 3 个文件 26 tests、typecheck、Storybook、import boundaries、desktop build 和 `git diff --check` 均通过。
- [x] 在隔离真实 Electron 中从有任务安装确认入口观察任务确实停止、失败弹窗立即显示实际阶段和任务状态，并验证关闭与重试行为。

### 返工真机四段记录

1. **环境：真机（当前 worktree 重建的隔离 macOS arm64 Electron 0.4.2；临时 data root；ready marker 来自此前真实 GitHub Release 下载；未注入 IPC/网络）**
   - **入口：** Sidebar「Install update」→ 零任务安装确认。
   - **操作：** 点击「Restart and install」，等待真实 updater 安装 watchdog 失败；在失败弹窗点击「Retry installation」，再取消新的安装确认；打开 Settings → About。
   - **屏幕观察：** 当前界面出现 `Update installation failed`，说明应用已恢复且可继续工作；重试重新显示 `Restart and install 0.4.3` 确认；About 显示 `Update installation failed`，并同时保留 `Restart and install`。
   - **与承诺一致否：** 是。失败结果就地可见，重试没有复用旧确认，About 没有使用检查失败/网络失败语义，安装入口仍可达。
   - **证据标识：** `moebius-update-failure-ui-retry-run`（系统临时日志，未提交仓库）。

2. **环境：真机（同一隔离 Electron、真实 UI 启动的 Agent 运行项、临时 data root）**
   - **入口：** 运行任务期间的 Sidebar「Install update」。
   - **操作：** 在真实 composer 输入并发送一个至少 120 秒的任务；确认页面出现 `activeRuns=1` 与 `Stop lead Agent`；点击「Install update」→「Stop tasks and restart to install」。
   - **屏幕观察：** 安装确认显示 `Installation needs to stop 1 running tasks`；确认后失败弹窗显示安装已开始但未完成、运行任务已停止；失败弹窗出现时 `activeRuns=0`。
   - **与承诺一致否：** 是。确认任务数与实际运行项一致，停止动作没有绕过任务保护，失败说明与任务实际状态一致。
   - **证据标识：** `moebius-update-failure-running-task-run`（系统临时日志，未提交仓库）。

3. **环境：真机（同一隔离 Electron；任务停止后安装失败恢复）**
   - **入口：** 有任务安装确认后的失败弹窗。
   - **操作：** 观察停止任务后的失败结果，点击「稍后重试」，继续留在工作区并检查安装入口。
   - **屏幕观察：** 失败弹窗关闭后应用保持可用，任务已停止且不会自动恢复；Sidebar/About 的安装入口仍保留。
   - **与承诺一致否：** 是。左侧退路只关闭失败反馈，不自动重试或再次弹出 ready 提醒。
   - **证据标识：** `moebius-update-failure-running-task-run`、`moebius-update-failure-ui-retry-run`（系统临时日志，未提交仓库）。

> 注：上方“返工真机四段记录”保留 2026-08-10 失败反馈返工的历史观察；其中单任务文案仍记录当时的复数输出。最终返工后的单数文案与任务终态观察以如下 2026-08-11 记录为准。

## 最终返工：任务停止终态一致性（2026-08-11）

- [x] 将安装取消端口从 `localConsole.close()` 改为不关闭服务的 `stopRunningTasks()`；等待 active run 与受管进程权威计数归零，未归零时不进入安装。
- [x] 保留 `DesktopShutdownRuntime` 的取消后复核与 `task-stop` 失败路径；安装阶段失败只在任务终态已确认后报告“任务已停止”。
- [x] 增加真实 local-console 行为测试，覆盖 provider 尚未启动时的预中止 signal、停止请求等待 provider 终态、计数归零后服务仍可查询；补充单任务英文文案测试。
- [x] 定向 desktop shutdown、console-ui Dialog 与 local-console 停止行为测试通过；typecheck 已通过。
- [x] 在真实隔离 Electron 中重现长任务安装：记录停止前后 activeRuns、运行卡片/停止按钮、失败弹窗任务说明，以及点击重试后的确认任务数。
- [x] 功能与聚焦视觉复验完成；最终真实产品用户复评仍发现运行状态源不一致，change 不归档。

### 最终返工真机四段记录（2026-08-11）

1. **环境：真机（当前 worktree 重建的隔离 macOS arm64 Electron 0.4.2；非生产 bundle id；临时 data root；ready marker 来自此前真实 GitHub Release 下载；未替换 IPC 或网络）**
   - **入口：** 工作区 Sidebar「Install update」。
   - **操作：** 通过真实 composer 启动至少 120 秒的前台 Agent 任务；观察运行态后打开安装入口，确认「Stop tasks and restart to install」；等待临时 updater 安装失败；点击「Retry installation」并取消重新出现的安装确认。
   - **屏幕观察：** 停止前有 `Elapsed`、`Running` 和 `Stop lead Agent`；确认弹窗为 `Installation needs to stop 1 running task`；失败弹窗显示“Installation started but did not complete. Running tasks were stopped and session records are preserved; tasks will not restart automatically”，同时不再显示 `Elapsed` 或停止按钮；重试确认变为零任务普通 `Restart and install 0.4.3`，没有再次要求停止同一任务。
   - **与承诺一致否：** 是。安装只在权威任务数归零后继续，失败说明与实际终态一致，重试重新读取当前任务状态。
   - **证据标识：** `moebius-product-review-failure-continuation-1786415172178`（系统临时目录，未提交仓库）。

2. **环境：真机（同一隔离 Electron；安装失败恢复路径）**
   - **入口：** 失败弹窗、设置 → About。
   - **操作：** 从失败弹窗选择稍后处理；打开 About；从 About 再次发起安装并取消。
   - **屏幕观察：** 失败反馈在当前路径可见；About 显示独立的 `Update installation failed. You can try installing again.`，并保留 `Restart and install` / `Retry`；取消只关闭确认，不自动重试。
   - **与承诺一致否：** 是。失败语义不再误报为检查或网络失败，安装入口仍可达。
   - **证据：** 同上 `evidence.json`。

3. **环境：行为测试（内存/本地 runtime，不替代真机）**
   - **入口：** local-console shutdown port 与更新安装确认组件。
   - **操作：** 覆盖 provider 尚未启动时的预中止 signal、停止请求等待 provider 终态、计数归零后服务仍可查询，以及单任务英文文案。
   - **屏幕/状态观察：** 停止 promise 未完成前计数保持为 1；provider 进入终态后计数归零；单数文案为 `1 running task`。
   - **与承诺一致否：** 是。测试固定了终态等待与文案边界，不读取页面源文件做镜像断言。
   - **证据标识：** `moebius-update-stop-scope-tests-2`（46 files / 538 tests）、`moebius-update-stop-test-single-final-3`、`moebius-update-stop-console-tests-final`（系统临时日志，未提交仓库）。

4. **交付边界：** 正式签名包成功替换并重启到 0.4.3 仍是环境风险；本次真机使用临时 updater 失败恢复路径验证任务终态，不将其冒充为正式安装成功。

## 最终真实产品用户复评阻断（2026-08-11）

- **环境：真机。** 隔离 Electron `0.4.2`、真实 Release `0.4.3`、English、560×640、真实前台长任务；未注入 ready、网络或 IPC。
- **入口与操作：** 从 Sidebar 发起安装，先选择 `Keep working`，再次安装后选择 `Stop tasks and restart to install`。
- **屏幕观察：** 任务卡已显示 `Completed` 且停止按钮消失，但失败弹窗同时声称 `1 task is still running`、安装尚未开始。
- **与承诺一致否：** 否。任务卡与安装保护使用的运行状态源不同步，用户无法唯一判断任务是否结束、是否需要重新启动；Retry、About 与跨入口一致性因此未完成最终覆盖。
- **证据标识：** `moebius-product-review-final-1786416895804`（系统临时目录，未提交仓库）。
- **处理状态：** 已达到两轮自动返工上限；按用户指示仅创建 Draft PR，保留本 change 与未完成项，不归档、不回流行为 specs、不声明可合并。
