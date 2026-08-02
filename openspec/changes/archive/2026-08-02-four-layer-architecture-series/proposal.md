# 提案：four-layer-architecture-series

## 需求基线

本系列最初由用户选择为全面内部架构重构；00/10/20 批保持产品行为不变。20 批归档后，用户明确
退出 GitHub issue runner，因此 30 批起同时承接一次产品运行形态收敛。该产品决策只改变 runner /
observer 边界；local 页面、API、持久化格式和 provider 协议继续作为回归 oracle。

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/prd.md` | `核心用户旅程`、`成功指标` | 作为全产品行为不变基线 | 无变更 |
| `docs/product/pages/main-conversation.md` | `操作与反馈`、`页面状态`、`指标与验收` | 作为本地会话与 renderer 重构 oracle | 无变更 |
| `docs/product/pages/main-left-sidebar.md` | `操作与反馈`、`页面状态`、`指标与验收` | 作为项目、会话、搜索入口重构 oracle | 无变更 |
| `docs/product/pages/main-right-sidebar.md` | `操作与反馈`、`页面状态`、`指标与验收` | 作为右栏路由与异步加载重构 oracle | 无变更 |
| `docs/product/pages/agent-teams.md` | `操作与反馈`、`页面状态`、`指标与验收` | 作为团队与 AI 建队重构 oracle | 无变更 |
| `docs/product/pages/onboarding.md` | `操作与反馈`、`页面状态`、`验收标准` | 作为 onboarding 重构 oracle | 无变更 |
| `docs/product/pages/settings.md` | `操作与反馈`、`页面状态`、`验收清单` | 作为设置与 IPC 重构 oracle | 无变更 |
| `docs/product/pages/search.md` | `操作与反馈`、`页面状态`、`指标与验收` | 作为搜索状态重构 oracle | 无变更 |
| `docs/product/flows/session-analysis.md` | `主流程`、`分支与异常`、`端到端验收` | 作为分析会话重构 oracle | 无变更 |
| `docs/product/prd.md` | `产品运行形态` | 30 批移除 GitHub runner 与 observer，只保留 local console | 已写入 |

系列总纲不直接持有 spec-delta。00/10/20 批不得改变行为 Requirement；30 批由自己的 spec-delta
退役 `github-issue-runner` 域并修改 local-console/desktop-shell，40/50 批继续保持剩余产品行为不变。

## 背景

现有 `docs/architecture/module-map.md` 提供业务视角六层叙事，但生产代码真正受机器约束的
技术分层只有包级 import 边界与两个 local-console planner 的传递纯闭包。

基线盘点（分支 `moebius/uvQT4Du6kiEg`，HEAD `54b93d4`）：

- `src/local-console/runtime.ts` 5,535 行；`processPending` 约 930 行、`runWorker` 约 690 行，
  同时承担应用编排、业务决策、store 协调、文件读取和 provider 生命周期。
- `desktop/src/console-page/app.tsx` 4,988 行；约 27% 是 IPC/HTTP，35% 是状态决策，18% 是
  视图渲染，应用编排与 React 容器没有形成稳定边界。
- 已识别 10,301 行无 IO 业务/状态模型，约占全部业务规则 34–41%；除两个 planner 外，
  大部分纯模块没有传递闭包门禁。
- `pnpm test` 基线 131.26 秒，1,900 项通过、4 项跳过；专用 acceptance 脚本不进入闸门，
  但可无争议归类的真实 SQLite/HTTP/子进程/Electron 测试至少占 68.5 秒（52.2%）。
- 数据端口已经存在：`LocalConsoleRuntimeOptions.store: LocalConsoleStore`。本系列保留这条缝，
  不重画存储抽象，也不借机修改 SQLite/JSONL schema。
- `packages/console-ui` 已是受门禁保护的视图包；本系列不重写组件库，renderer 重点是
  `app.tsx` 的状态与副作用编排。

用户选择全面四层重构，并明确功能开发冻结、由单人执行。冻结降低了冲突成本，但不取消
中途停止点：除用户明确批准退役行为的 30 批外，每个子 change 必须行为零变更；所有批次都必须
可独立合并和归档，完成后系统处于自洽状态。

## 提案

把全仓生产代码收敛为四层：

1. **视图层**：只把状态映射为可见界面并发出用户意图，不读取持久化事实、不调用 provider、
   fs、SQLite、HTTP 或 IPC adapter。
2. **应用编排层**：按一个用例纵切组织流程，读取事实、调用领域规则、调用端口并提交结果；
   允许异步和 IO，但不得复制领域判据，且入口保持薄。
3. **领域规则层**：只接收和返回普通值，运行时依赖闭包不得到达 fs、SQLite、provider、
   Electron、HTTP/IPC 或 browser global；全部由 `check:boundaries` 传递检查。
4. **适配器层**：实现 fs、SQLite/JSONL、provider CLI、HTTP、Electron IPC 和浏览器
   存储边界；不得拥有领域决策。

采用一个系列总纲加六个顶层执行 change：

1. `four-layer-00-boundary-foundation`
2. `four-layer-10-local-console`
3. `four-layer-20-desktop-renderer`
4. `four-layer-30-github-runner`
5. `four-layer-40-adapter-convergence`
6. `four-layer-50-final-convergence`

拆分依据是独立运行边界，而不是文件数量：门禁、local console、desktop renderer、退役 GitHub
runner、剩余 adapter/composition roots、最终清债分别能独立验证和回滚。每个子 change 只跑
自己的一次完整闸门；系列总纲不修改生产代码，不单独消耗完整闸门。

## 影响

覆盖生产运行代码：`src/**`、`desktop/src/**`、`packages/console-ui/src/**`。`sites/marketeam` 是
独立静态站点且不进入 TypeScript 运行时依赖图，不属于本次四层收敛范围；`scripts/**` 是开发/验收
工具，`prototypes/**` 是隔离沙盒，测试、Story、fixture、generated、agent Markdown、seed 和品牌
资产也不属于生产层归属范围。

明确不涉及：

- 30 批明确退役的 GitHub runner/observer 以外的产品行为、交互、文案、路由、API/IPC shape、错误 code 或排序语义；
- `LocalConsoleStore` 端口、SQLite/JSONL schema、数据根和恢复协议；
- provider CLI 参数、模型选择或执行超时；
- 顺手修复审计中发现的缺陷、依赖升级或无关命名清理；
- CQRS、事件总线、service locator、DI 框架或四层之外的新架构概念。
