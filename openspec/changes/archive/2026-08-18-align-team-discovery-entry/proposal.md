# 提案：align-team-discovery-entry

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/agent-teams.md` | 页面标题与任务入口 | 将寻找现成团队提升为与新建团队并列的常驻入口 | 已写入 |
| `docs/product/pages/agent-teams.md` | 持续接收更新与独立维护 | 更新首页分组及停止更新关系的用户文案 | 已写入 |
| `docs/product/pages/github-team-discovery.md` | 页面结构 | 统一发现页标题、搜索提示和结果状态文案 | 已写入 |

## 背景

当前 Storybook 把寻找现成团队放在「新建团队」菜单中，并使用“跟随上游”“只在本地”等实现语义。它弱化了已有团队搜索入口，也没有直接说明两类团队后续是否继续收到作者更新。

## 提案

让 Agent 团队首页常驻显示「找现成团队」和「新建团队」；新建菜单只保留 AI 建队与空白创建。同步更新首页分组、发现页和解除更新关系动作的用户文案，不改变 GitHub 搜索范围、安装流程、团队数据模型或同步机制。

## 影响

受影响范围为 `@moebius/console-ui` 的 Agent 团队首页、GitHub 团队发现页、持续接收更新团队详情、相应 Page Story、测试和 `console-ui` 行为规格。
