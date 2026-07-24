# 提案：replay-onboarding-from-sidebar

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-left-sidebar.md` | 入口与去向、底部应用操作、验收标准 | 在设置上方增加固定的“重新查看引导”入口，并规定返回时恢复原主页面状态 | 已写入 |
| `docs/product/pages/onboarding.md` | 入口与去向、重新查看引导、验收标准 | 新增不改变完成 marker、可退出且不交接团队选择的回看模式 | 已写入 |

## 背景

引导完成状态目前由数据根下有效的 `.onboarding-completed` ISO 时间 marker 判定。生产操作台在 marker 命中后会拒绝再次进入 `/onboarding/*`，侧栏也没有重新查看入口；但高保真原型已经展示过侧栏底部“重新查看引导”的产品方向。

设置页面尚未落地，用户无法在应用内再次理解四步引导中的环境、团队选择和接力演示。直接删除 marker 会把一次可逆的回看误建模为重新初始化：中途退出后还会改变下一次启动路径，因此不采用。

## 提案

- 在主页面侧栏底部增加“重新查看引导”，位置固定在“设置”上方，复用现有 `SidebarAction` 导航行。
- 为 onboarding shell 增加显式的 `first-run | replay` 展示模式。回看时标题栏显示“回看引导”和“退出”，第 4 步主操作显示“完成回看”。
- 回看作为 renderer 内的临时展示态覆盖主页面，同时保持原操作台组件挂载；退出或完成后恢复进入前的页面和本地交互状态。
- 回看完成不调用 `completeOnboarding`，不修改 `.onboarding-completed`，不产生 pending team，也不写 last-used team。
- 保留首启路径的既有行为与硬门禁；AI 建队仍只在用户显式确认创建时产生独立持久化副作用。

## 影响

- `packages/console-ui`：侧栏受控入口、onboarding 回看模式文案与退出操作。
- `desktop` renderer：回看展示态、操作台保活、退出/完成恢复，不新增主进程 IPC。
- 产品与规格：主侧栏底部操作、onboarding 回看行为。
- 测试：侧栏顺序和可访问性、两种 onboarding 模式、marker 与团队偏好不变、操作台保活恢复。
