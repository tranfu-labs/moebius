# 交付包：per-conversation-right-sidebar-visibility

本文件只做交付闭环核对；实现、测试和产品事实分别留在代码、`tasks.md` 与页面 PRD 中。

## 1. 变更摘要

右侧栏的开关状态现在按根对话的外层工作现场保存：A 已打开、首次访问 B 时 B 保持关闭、返回 A 恢复打开。分析对话继续复用所属根对话的工作现场；通过 B 的右侧栏入口会只打开 B，不改写 A。右栏宽度仍是跨对话、跨重启的全局偏好。

| 范围 | 文件 |
| --- | --- |
| 产品与规格 | `docs/product/pages/main-right-sidebar.md`；`openspec/changes/per-conversation-right-sidebar-visibility/{proposal.md,design.md,tasks.md,spec-delta/console-ui/spec.md}` |
| 工作现场存储与 controller | `desktop/src/console-page/right-sidebar-tabs-store.ts`；`desktop/src/console-page/use-right-sidebar-tabs.ts` |
| 导航、入口与清理 | `desktop/src/console-page/{app.tsx,conversation-navigation-model.ts,use-conversation-navigation.ts,use-searched-session-navigation.ts,use-analysis-panel-navigation.ts,use-conversation-analysis.ts,use-conversation-console.ts,use-sidebar-source-migration.ts,use-project-mutations.ts}` |
| 自动化与真机验收 | `desktop/tests/{right-sidebar-tabs-store.test.ts,use-right-sidebar-tabs.test.tsx,use-conversation-navigation.test.tsx,use-searched-session-navigation.test.tsx,use-analysis-panel-navigation.test.tsx,use-conversation-analysis.test.tsx,use-sidebar-source-migration.test.tsx,use-project-mutations.test.tsx,console-app-sidebar-conversation-regressions.test.tsx}`；`scripts/acceptance/console-dashboard-ui.ts`；`AGENTS.md` |

没有新增独立的 production 模块或外部依赖；现有 `RightSidebarTabsStore` 版本化扩展为同时保存标签和可见性，现有 controller、导航与清理入口继续复用。

运行方式：

```sh
pnpm run test --scope HEAD
pnpm typecheck
pnpm --filter @moebius/desktop build
pnpm exec tsx scripts/acceptance/console-dashboard-ui.ts --case right-sidebar-conversation-visibility
pnpm test
```

## 2. 测试报告

| 命令 | 实际结果 |
| --- | --- |
| `pnpm run test --scope HEAD` | 退出码 0；13 文件、80 测试通过，11.96s。 |
| `pnpm typecheck` | 退出码 0。 |
| `pnpm --filter @moebius/desktop build` | 退出码 0。 |
| `pnpm exec tsx scripts/acceptance/console-dashboard-ui.ts --case right-sidebar-conversation-visibility` | 退出码 0；输出 `ok: true`，在真实 Electron 中覆盖 A/B 切换、返回、重启、显式入口与宽度保留。 |
| `pnpm test` | 退出码 0；根套件 130 文件通过、1 文件跳过，931 测试通过、4 测试跳过（110.68s）；桌面验收子套件 1 文件／66 测试通过（18.86s）；desktop 158 文件／795 测试通过（40.68s）；console-ui 63 文件／651 测试通过（10.81s）。 |
| `git diff --check` | 退出码 0、无输出。 |

步骤 1 的两条基线命令都因 `pnpm: command not found` 未能执行，因此没有历史通过数、失败数或耗时。相对步骤 3 的受影响范围回归（78 项），本步增加 2 项测试至 80 项。

## 3. 与需求差异清单（终稿）

无。需求层的状态归属、首次访问默认关闭、入口行为、重启恢复和全局宽度语义均按 PRD 与用户描述实现，未增删或改写用户可见行为。

## 4. 建议回退需求的问题

无。

## 5. 有意偏离清单（汇总）

- `scripts/acceptance/console-dashboard-ui.ts`：相对初版方案直接扩展 `right-sidebar-responsive` case，新增独立的 `right-sidebar-conversation-visibility` case，并保留前者原有路径；【实现层】既有响应式 case 在进入本功能路径前受无关断言阻断，独立 case 才能对 A/B 状态保留真实 Electron 证据，同时不删减响应式覆盖。

## 6. 遗留事项终稿与对账清单

### 遗留事项

- 未采纳的评审提醒及理由：无；本 change 的评审提醒均已采纳或确认无需调整。
- “无本项目依据，仅为惯例”的方案条目及风险判定结果：无；步骤 2 已判定无方向性风险。
- **待核实**：步骤 1 的原始命令文本没有进入版本化产物；已知结果为两条命令都因 `pnpm: command not found` 未执行，因此不能按单条历史命令计算差值。
- **未验证**：完整闸门跳过 `tests/claude-real.acceptance.test.ts` 的 4 项测试（1 个文件）；本次没有运行真实 Claude 验收。右侧栏的真实 Electron 专项已单独执行。
- **待核实**：既有 `right-sidebar-responsive` case 的 fake Codex 失败路径与默认左侧栏宽度前置问题仍存在；该 case 不作为本 change 的真机证据，亦未在本 change 中修改。

### 对账

| 验收标准 | 落位与证据 | 结论 |
| --- | --- | --- |
| A 打开，首次访问 B 关闭，返回 A 仍打开 | host v3 存储、controller 与普通导航；存储/controller/集成测试及 Electron 专项。 | 已实现并验证。 |
| 按根对话隔离，分析对话复用所属根的工作现场 | host 解析、普通/搜索/分析入口和回滚；导航与集成测试。 | 已实现并验证。 |
| B 的右侧栏入口只打开 B，A 不被改写 | 入口调用 `showHost` 后只写目标 host；Electron 专项覆盖过程标签入口。 | 已实现并验证。 |
| 重启后分别恢复；宽度继续全局保留 | 版本化存储与现有宽度偏好；Electron 专项两次重启验证。 | 已实现并验证。 |
| 空输入、非法值、重入、无权限、失败恢复 | `tasks.md` 的 4 × 5 边界矩阵无空格；持久化拒绝回退与项目移除失败测试已补齐。 | 已实现并验证。 |

用户验收前，变更仍只保留在工作区与本地分支；尚未归档 change、合并规格增量、提交或执行外发动作。
