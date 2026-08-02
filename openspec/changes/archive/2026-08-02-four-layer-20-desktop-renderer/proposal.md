# 提案：four-layer-20-desktop-renderer

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-conversation.md` | `操作与反馈`、`页面状态`、`指标与验收` | 会话 renderer oracle | 无变更 |
| `docs/product/pages/main-left-sidebar.md` | `操作与反馈`、`页面状态`、`指标与验收` | selection/project/sidebar oracle | 无变更 |
| `docs/product/pages/main-right-sidebar.md` | `操作与反馈`、`页面状态`、`指标与验收` | tabs/process/analysis oracle | 无变更 |
| `docs/product/pages/agent-teams.md` | `操作与反馈`、`页面状态`、`指标与验收` | team/builder oracle | 无变更 |
| `docs/product/pages/onboarding.md`、`settings.md`、`search.md` | 各自操作、状态、验收 | shell flow oracle | 无变更 |
| `docs/product/flows/session-analysis.md` | 主流程、异常、端到端验收 | analysis flow oracle | 无变更 |
| `openspec/specs/desktop-shell/spec.md`、`console-ui/spec.md` | renderer / IPC / UI Requirements | 当前行为事实 | 无变更 |

`spec-delta/` 保持为空；本 change 不处理 console 状态审计中登记的独立产品缺陷。

## 背景

`app.tsx` 约 4,988 行并持有 80 个 OperatorConsoleApp hook/ref/reducer 状态点，混合 view props、
HTTP/IPC/localStorage、异步 owner/generation 和团队/会话业务状态。`console-ui` 已是干净视图包，
继续把逻辑搬进组件库会破坏现有硬边界。

## 提案

- 以 shell/team/settings/onboarding 与 conversation/search/sidebar 两组用户旅程提取 renderer
  application controllers 和纯 state models。
- 把 fetch、preload IPC、localStorage、timer/subscription 收敛到 renderer adapters。
- `app.tsx` 只保留语言/bootstrap/route composition 与 `OperatorConsole` 受控 prop 映射。
- 不引入 Redux/XState 等状态框架，不顺手修复 `console-state-composition-audit.md` 的开放候选。

## 影响

涉及 `desktop/src/console-page/app.tsx`、邻近 renderer modules/tests；console-ui public props 只允许
等价搬运，不做产品设计调整。
