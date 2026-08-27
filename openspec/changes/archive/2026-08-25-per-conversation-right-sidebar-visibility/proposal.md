# 提案：per-conversation-right-sidebar-visibility

## 需求基线

产品事实源锚点：docs/product/pages/main-right-sidebar.md#入口与去向、#打开与关闭右侧栏、#指标与验收。

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| docs/product/pages/main-right-sidebar.md | 入口与去向、打开与关闭右侧栏、指标与验收 | 将右侧栏开关从跨对话的全局偏好改为每段根对话的独立工作现场状态 | 已写入 |

## 背景

现有产品规则和 renderer 都将右侧栏的开关保存为全局偏好；因此在对话 A 打开右侧栏后，切到此前从未打开过的对话 B 仍会显示右侧栏。标签已经按根对话隔离，开关归属却没有与同一工作现场对齐，和新的产品行为冲突。

## 提案

将右侧栏开关纳入每个根对话的外层工作现场：切换时恢复目标根对话自己的打开或关闭状态，未保存状态默认关闭，重启后仍分别恢复。右侧栏入口只打开目标工作现场；现有标签、草稿、阅读位置、动画、宽度偏好和分析对话路由保持原有语义。

## 影响

- docs/product/pages/main-right-sidebar.md：产品意图已更新。
- desktop/src/console-page：右侧栏工作现场持久化、当前 host 切换、导航回滚和归档清理。
- desktop/tests 与 scripts/acceptance/console-dashboard-ui.ts：单元、集成和真实 Electron 用户动作验证。
- openspec/specs/console-ui/spec.md：归档时合并本 change 的规格增量。
