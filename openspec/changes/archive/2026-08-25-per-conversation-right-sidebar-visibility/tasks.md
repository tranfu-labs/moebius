# 任务：per-conversation-right-sidebar-visibility

- [x] 更新右侧栏页面 PRD，并建立 proposal、design、tasks 与 console-ui 规格增量。
- [x] 将右侧栏按 host 的持久化文档升级为同时保存标签和开关状态的兼容版本。
- [x] 让右侧栏 controller 按当前 host 读取、切换、写入和恢复开关状态，保留全局宽度偏好。
- [x] 对齐普通导航、搜索、分析入口、来源迁移、项目移除、归档和失败回滚的 host 状态。
- [x] 补齐存储、controller、导航和 App 集成测试，以及持久化拒绝时的运行期回退。
- [x] 扩展真实 Electron 右侧栏验收，记录 A/B 切换与重启的独立状态。
- [x] 运行受影响 scope 测试、typecheck、desktop build 和真实应用验收。

## 真机交付记录

- 环境：真机（真实 Electron 窗口、production renderer/local-console/持久化栈与临时 fake Codex）；入口：主窗口 > 会话 A > 显示右侧栏；操作：点击“显示右侧栏”；屏幕观察：A 被选中，右侧栏 `data-motion-state=open`；与承诺一致：是。
- 环境：真机；入口：左侧会话列表 > 会话 B，再返回会话 A；操作：依次点击 B、A；屏幕观察：首次访问的 B 没有右侧栏节点，返回 A 后右侧栏为 `open`；与承诺一致：是。
- 环境：真机；入口：关闭并重新启动 Electron 应用；操作：依次查看 B、A；屏幕观察：B 重启后仍无右侧栏节点，A 重启后为 `open`；与承诺一致：是。
- 环境：真机；入口：主会话 B > 完整输出；操作：点击“完整输出”，键盘调整宽度，重启并往返 A/B；屏幕观察：B 打开且过程标签可见，B 与 A 各自恢复 `open`，宽度由 586 调至 602 并跨重启保留；与承诺一致：是。

执行命令：`pnpm exec tsx scripts/acceptance/console-dashboard-ui.ts --case right-sidebar-conversation-visibility`；结果：退出码 0，输出 `ok: true`。证据 JSON 与截图仅写入系统临时目录，未纳入仓库。

## 步骤 4：边界矩阵

| 功能单元 | 空输入 | 非法或超限输入 | 并发或重入 | 无权限 | 失败恢复 |
| --- | --- | --- | --- | --- | --- |
| 状态文档、兼容迁移与持久化 | 未见过的 host 由 `emptyHostState` 返回关闭状态；存储单测「迁移 legacy open preference」覆盖首个 host 与后续 host。 | `parseStoredHostState` 丢弃损坏标签、把非 `open` 的可见性收敛为关闭；无数值型用户输入，覆盖见「drops unknown persisted types」与「defaults malformed v3 host state」。 | 同一版本化文档同步读写，`snapshot`／`restore`／`clearHosts` 一并携带可见性；覆盖见「keeps visibility with its host through tab writes, snapshots, restores, and cleanup」。 | `localStorage.setItem` 被拒绝时保留已净化的运行期文档；覆盖见「keeps host state in memory when persistence is denied」。 | 后续成功写入会把运行期文档落盘；同一存储单测覆盖重启后恢复。 |
| 右侧栏 controller 与开关 | `showHost` 读取目标 host，首次进入保持关闭；覆盖见「owns draft-backed tab changes, preferences, and host switching」。 | controller 只接受布尔开关；持久化的非法值复用上一行解析处理与测试。 | `activeHostSessionIdRef` 将切换与随后的开关写入同一目标 host，避免父组件重渲染回写旧 host；覆盖见「writes a visibility change to the host shown before its parent rerenders」。 | 复用状态文档的运行期回退，开关仍立即从同一 store 读回。 | 复用状态文档的后续写入恢复，当前窗口不因一次持久化失败回退为全局状态。 |
| 普通、搜索与分析入口导航 | 直接选择未访问的 B 只调用 `showTabsHost`，不强制打开；覆盖见 conversation/search navigation 单测与真实 Electron A/B 专项。 | 不可用搜索目标或失败引用进入既有错误分支，不构造标签或切换选择；覆盖见「settles a slow restore…」与「keeps the previous selection and leaves no draft…」。 | `inputRef`／迁移控制器的最新回调与 `migratingRef` 处理慢恢复、重渲染和重复迁移；覆盖见 searched-session 与 sidebar-source-migration 单测。 | 本地视图切换不新增授权请求；来源读取被拒绝或不可用时复用上一列的错误分支，而非打开错误 host。 | 目标加载失败恢复完整原右侧栏场景；覆盖见「restores the complete right-sidebar scene」的普通与分析两条集成测试。 |
| 归档、项目移除与来源迁移 | `clearHosts` 对空或不存在的 host 是 `delete` 无操作，其他 host 保持不变；复用存储 cleanup 测试。 | 归档 id 只来自 `planRemovedProjectSessionIds`；未知 id 的删除同样无操作，非当前分析标签移除保留兄弟标签的存储测试覆盖状态边界。 | `migratingRef` 在异步刷新期间阻止重复迁移；覆盖见「settles a slow migration through current callbacks」。 | 项目 transport 拒绝（含无权限）在清理前进入错误处理；覆盖见「does not clear right-sidebar state when project removal fails」。 | 项目移除失败保持已有 host 状态；成功后才执行 `removeSession`／`clearHosts`，覆盖同一项目移除失败测试与存储 cleanup 测试。 |

## 步骤 4：回归记录

步骤 1 的两条基线命令均因 `pnpm: command not found` 未能执行，故当时没有通过数、失败数或耗时可量化对比。本步重跑当前仓库的构建／测试入口，结果如下：

| 验证项 | 步骤 1 基线 | 步骤 4 实际输出 |
| --- | --- | --- |
| 类型检查与桌面构建 | 未执行 | `pnpm typecheck` 退出码 0；`pnpm --filter @moebius/desktop build` 退出码 0。 |
| 受影响范围回归 | 未执行 | `pnpm run test --scope HEAD`：13 文件、80 测试通过，耗时 11.96s；相对步骤 3 的 78 项增加 2 项。 |
| 完整闸门 | 未执行 | `pnpm test` 退出码 0：根套件 130 文件通过、1 文件跳过，931 测试通过、4 测试跳过（110.68s）；桌面验收子套件 1 文件／66 测试通过（18.86s）；desktop 158 文件／795 测试通过（40.68s）；console-ui 63 文件／651 测试通过（10.81s）。 |
| 最终真实 Electron 专项 | 未执行 | `pnpm exec tsx scripts/acceptance/console-dashboard-ui.ts --case right-sidebar-conversation-visibility` 退出码 0，输出 `ok: true`；A/B 首次切换、返回、重启、显式入口和宽度保留均有临时证据。 |

`git diff --check` 退出码 0、无输出。完整闸门日志中有用于失败路径断言的运行日志，但四个子套件的测试汇总没有失败项。

## 有意偏离清单

- `scripts/acceptance/console-dashboard-ui.ts`：相对初版方案直接扩展 `right-sidebar-responsive` case，新增独立的 `right-sidebar-conversation-visibility` case，并保留前者原有路径；【实现层】该既有 case 在到达本功能路径前受不相关仪表盘断言阻断（默认左侧栏宽度期望 252、实际 228），独立 case 才能以真实 Electron 观察 A/B 状态，同时不删减既有响应式覆盖。

## 遗留事项

- 未采纳的评审提醒及理由：无；本 change 的评审提醒均已采纳或确认无需调整。
- “无本项目依据，仅为惯例”的方案条目及风险判定结果：无；步骤 2 已判定无方向性风险。
- **待核实**：步骤 1 的原始命令文本没有落入版本化产物；已知结果是两条命令均因 `pnpm: command not found` 未执行。因此本步只能将当时的“无测试／构建计数”与当前实际结果对比，不能按单条历史命令做计数差。
- **未验证**：完整闸门中的 `tests/claude-real.acceptance.test.ts` 仍跳过 4 项（1 个测试文件）；本次没有运行真实 Claude 验收。右侧栏本功能的真实 Electron 专项已单独执行并通过。
- 既有 `right-sidebar-responsive` case 的非功能前置仍待核实：当前 fake Codex 失败路径渲染“结果不完整”，而该 case 仅等待“没有启动/多次未能启动”；临时放宽该断言后又在默认左侧栏宽度（期望 252、实际 228）处失败。该项不作为本 change 的真机证据，未修改其既有行为。
