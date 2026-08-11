# 提案：desktop-auto-update-reminder

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/flows/app-auto-update.md` | `主流程` / `检测新版本` | 从启动与手动检查扩展为启动、4 小时周期、唤醒补检，并保持自动下载与单飞闸门 | 已写入 |
| `docs/product/flows/app-auto-update.md` | `提醒弹窗` / `用户的三种决定` | 新增全局应用内提醒、稍后提醒、跳过版本和空闲排队语义 | 已写入 |
| `docs/product/flows/app-auto-update.md` | `安装确认` / `非目标` | 更新安装确认改用应用内 Radix Dialog，并明确普通退出弹窗本轮不改 | 已写入 |
| `docs/product/pages/settings.md` | `更新检查、下载与安装` | About 保留状态展示，并在 ready 状态中提供“重启并安装”；跳过版本时同时给出回忆性说明 | 已写入 |
| `docs/product/pages/main-left-sidebar.md` | `底部应用操作` | 保留独立“安装更新”入口；它与 About 安装动作共用任务保护确认 | 已写入（现有事实） |

## 背景

当前正式桌面应用只在启动和用户手动操作时检查更新；应用长期运行时不会自行发现新版本。自动下载已经存在，但下载完成只更新设置内状态，用户不打开设置就不知道包已就绪。安装确认和任务保护仍由 Electron 原生 `showMessageBox` 呈现，无法满足应用内蒙版、焦点限制、Escape 和点击空白关闭的统一交互要求。

本次产品决策还明确了两个必须保持分离的意图：更新提醒只请求用户决定，退出保护仍由安装流程在真正执行时独立重新取任务快照并确认；“稍后提醒”与“跳过此版本”是不同的记忆层级。

## 提案

1. 在桌面更新运行时增加运行期调度：启动完成后检查、每 4 小时检查、睡眠唤醒补检。所有触发共用现有单飞检查与状态 admission；`available`、`downloading`、`ready`、`installing` 时不发起会打断现状的检查。
2. 保留现有发现即后台下载与 ready marker 恢复能力，并新增按版本记录的 skip marker 和本次运行的 remind-later 记忆。ready 后若没有运行任务立即发布提醒；有 Agent、AI 建队或 CLI 安装任务时等到运行数归零再发布，不用替代性通知打扰用户。
3. 在 `@moebius/console-ui` 提供 `UpdatePromptDialog` 生产组件：更新就绪提醒和安装确认共享 Radix Dialog 基础，但使用独立的决定类型。提醒支持“重启并安装 / 稍后提醒 / 跳过此版本”；安装确认根据任务数量显示无任务或有任务文案。蒙版、Escape、点击空白关闭分别映射到“稍后提醒”或“取消 / 继续工作”。
4. 扩展 About 的 ready 展示，能说明用户已经跳过当前版本，并提供“重启并安装”；该动作与侧栏入口共用任务保护确认。
5. 本 change 先以生产 UI、组件测试和 Page Story 通过开发前用户任务闸门，再在明确授权后完成桌面运行时、IPC、renderer 和退出协调接线；普通 `Command + Q` 退出保护仍不替换。两阶段共享本 change 的设计、测试和真实应用验收清单。

## 影响

- `packages/console-ui`：新增更新弹层生产组件、双语文案、Dialog 叠层能力、About 跳过状态和 Page Story。
- `desktop`：接入更新调度、提醒策略、skip 持久化、renderer 状态/回调以及安装确认接线；普通退出保护保持现状。
- `openspec/specs/desktop-shell` 与 `openspec/specs/console-ui`：通过本 change 的 spec-delta 记录新增行为，归档时只回流已实现并验证的条目。
- 验收：Page Story 先承担可浏览的视觉与交互闸门；真实 Electron 验收仍必须覆盖定时发现、状态持久化、任务排队、安装失败恢复与独立退出保护。

## 返工补充：安装失败结果就地可见

产品事实源已补充安装失败的用户可见结果，见
`docs/product/flows/app-auto-update.md#任务未能停止或安装未能完成` 与
`docs/product/pages/settings.md#2026-08-10-产品决定`。本补充不改变更新提醒与退出保护分离的边界，只补齐安装确认后的结果链路：

- 退出协调必须停止并复核 local-console 的真实运行项；任务仍在运行时不得开始安装。
- 主进程通过稳定失败 DTO 通知 renderer，当前页面立即显示区分任务停止失败和安装阶段失败的应用内弹窗。
- About 使用独立的安装失败语义并保留安装入口；重试每次重新读取 ready 状态和任务数。

本轮对应的行为缓冲记录位于 `spec-delta/desktop-shell/spec.md` 与
`spec-delta/console-ui/spec.md`，归档前才回流当前 specs。

## 最终返工补充：任务停止必须与真实终态一致

真实产品用户任务评审暴露了一个实现层竞态：安装协调在取消请求返回后就把本地运行时关闭，
导致桌面层读到零任务，但 Agent 仍显示运行。基于同一产品承诺
`docs/product/flows/app-auto-update.md#任务未能停止或安装未能完成`，本补充收紧执行边界：

- 任务停止端口不得以关闭 local-console 或取消 Promise 返回作为停止完成信号；必须等待权威活动运行项和受管进程计数归零。
- 未归零时不得关闭应用、调用安装 provider 或声称任务已停止；当前界面显示任务停止失败，安装尚未开始。
- 只有真实任务终态完成后才能进入既有关闭、安装和失败恢复链路；重试继续重新读取任务数。
- 同步修正单任务英文文案，避免把一个任务显示成复数。
