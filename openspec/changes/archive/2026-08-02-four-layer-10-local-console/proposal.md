# 提案：four-layer-10-local-console

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-conversation.md` | `操作与反馈`、`页面状态`、`验收标准` | 本地会话真实页面回归 oracle | 无变更 |
| `docs/product/pages/main-left-sidebar.md` | `操作与反馈`、`页面状态`、`验收标准` | 项目/会话 mutation 回归 oracle | 无变更 |
| `openspec/specs/local-console/spec.md` | 全部 local runtime Requirement | API、恢复、路由、运行、失败事实保持不变 | 无变更 |
| `openspec/changes/four-layer-architecture-series/design.md` | `10 · Local console` | 本 change 的系列契约 | 待主理人核验 |

`spec-delta/` 保持为空；任何行为差异都视为回归，不内联修改 spec 迎合实现。

## 背景

`runtime.ts` 的 public session/project/query methods、`processPending`、`runWorker` 和 lifecycle helpers
同时承担领域决策、应用时序与 adapter 调用。两个既有纯 planner 已证明切点可行，但 runtime 仍是
5,535 行，许多规则仍只能借真实 SQLite/HTTP/provider fixture 测试。

## 提案

- 保留 `LocalConsoleStore`、execution、workspace、attachment 和 fact-log 端口及 schema。
- 按项目/会话命令查询、primary run、worker run、terminal/recovery 四组用例提取 application flows。
- 把剩余可值传递的 policy/transition/selection 规则放进 domain pure closure。
- `LocalConsoleRuntime` 保留薄 façade、composition root、active-run 内存协调和关闭生命周期。
- 逐 test-name 把纯决策组合降级为纯单测，保留 HTTP+SQLite、restart、provider fact、并发和失败接缝。

## 影响

主要涉及 `src/local-console/runtime.ts`、邻近 local-console domain/application modules 和对应 tests；
不改 server API、store port、SQLite/JSONL、provider 参数或 renderer props。
