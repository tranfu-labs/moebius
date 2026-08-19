# 设计：align-team-discovery-entry

## 方案

- 复用 `AgentTeamsPageHeading` 的 actions 区，把「找现成团队」作为可见 outline 按钮，把「新建团队」保留为唯一 primary 操作与两项菜单。
- 保持现有 `onDiscoverTeams` 回调边界；组件只表达导航意图，不接入 GitHub 或桌面 IPC。
- 保持团队内部 `upstreamRepository` 与分组判定不变，只替换用户可见名称。
- 发现页与持续更新详情继续复用既有生产组件，只更新与 PRD 对齐的标题、提示和动作文案。

## 权衡

不新增首页搜索框：PRD 要求的是常驻任务入口，搜索输入仍由独立发现页承载。搜索入口使用次级按钮，保留「新建团队」作为页面唯一 primary 操作，同时保证两项任务都无需展开菜单即可识别。

## 风险

长文案可能挤压窄窗页头。沿用页头既有换行布局，并在 Storybook 窄窗状态中验证；若出现横向滚动，可只调整 actions 的折行方式，不改变入口层级。
