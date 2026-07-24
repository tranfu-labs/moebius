# 设计：replay-onboarding-from-sidebar

## 方案

### 展示状态与组件边界

`OperatorConsoleRoute` 持有只在当前 renderer 生命周期存在的 replay 状态。`OperatorConsoleApp` 始终保持挂载；replay 激活时使用 `hidden`/全屏兄弟层让操作台退出可访问树，并在其上渲染 `OnboardingRoute`。这样无需把项目、对话、草稿、Agent 团队页面等内部状态搬进 URL 或新增持久化快照，退出时即可原样恢复。

`OperatorConsole` 新增受控 `onReplayOnboarding` 回调，仅负责渲染侧栏入口，不感知路由、marker 或 Electron IPC。入口使用现有 `SidebarAction` 与设计令牌。

`OnboardingRoute` 和 `OnboardingShell` 接收 `mode: "first-run" | "replay"`。shell 根据 mode 切换标题栏标签、退出操作和末步 CTA；route 根据 mode 把完成动作交给不同上层：

- `first-run`：沿用 `completeOnboarding()`，写 marker 并把 `pendingAgentTeamKey` 交给新建对话。
- `replay`：只关闭临时展示态，忽略本轮临时团队选择，不调用完成 IPC。

### 恢复与焦点

侧栏入口在打开回看前记录自身按钮。退出或完成后取消全屏层，并把焦点恢复到“重新查看引导”，保证键盘用户回到明确位置。操作台保持挂载，因此当前会话、应用页、草稿、滚动与运行订阅不重新初始化。

### 状态副作用

回看路径不新增 reset/delete marker IPC，也不复用 `completeOnboarding`。应用关闭会销毁 replay 内存态；下次启动仍由既有有效 marker 直接进入主页面。

第 2 步选择只影响本次接力演示。“完成回看”不写 last-used team、不产生 pending team。AI 建队的“创建并选中”仍是用户独立、显式确认的创建动作，不因 replay 自动发生，也不由 replay 完成回滚。

## 权衡

- 不删除 marker：保留“已完成引导”的历史事实，避免中途关闭后把用户强制送回首启。
- 不把 replay 写进 URL 或本地存储：回看是临时界面状态，刷新/重启自然退出，避免形成第二套恢复协议。
- 保持操作台挂载而非退出时重建：多保留一个隐藏 React 子树，但能精确保留尚未持久化的草稿、页面选择和滚动状态。
- 复用完整 onboarding shell 而非复制只读版本：避免两套引导内容漂移；仅通过 mode 收窄完成与退出语义。

## 风险

- 隐藏操作台仍可能收到后台状态刷新；这是预期行为，退出回看后应看到最新运行事实。必须确保隐藏层不在可访问树中、不能接受焦点。
- 回看期间 AI 建队可能产生明确的用户团队创建副作用；界面必须继续要求原有“创建并选中”确认，完成回看本身不得隐式创建。
- 新增退出操作可能与 macOS 拖拽标题栏冲突；按钮必须标记为 `window-no-drag` 并保持键盘可达。
- 回滚时可移除 replay mode、受控回调和侧栏入口；marker、IPC 与首启路径未改变，无数据迁移成本。
