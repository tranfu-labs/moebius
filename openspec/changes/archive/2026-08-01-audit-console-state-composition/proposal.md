# 提案：audit-console-state-composition

## 需求基线

本次不改变产品意图或已实现行为，而是为 `desktop/src/console-page/app.tsx` 及其邻近状态模块建立一次性的候选不变量审计清单。实现状态盘点不属于页面 PRD 应承载的产品事实，因此不存在需要新增的 PRD 规则；下列页面文档只作为判断用户可见后果的 oracle，不作修改。

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/product/pages/main-conversation.md` | `#新对话草稿的生命周期`、`#输入框`、`#页面状态` | 核对会话选择、输入、发送、恢复等状态组合的用户后果 | 无需修改 |
| `docs/product/pages/main-left-sidebar.md` | `#选择对话`、`#标记为已读与未读`、`#页面状态` | 核对选择、阅读状态、搜索和组合路由的用户后果 | 无需修改 |
| `docs/product/pages/main-right-sidebar.md` | `#分析对话标签与跨树路由`、`#页面状态` | 核对标签宿主、焦点、草稿与主内容归属的用户后果 | 无需修改 |
| `docs/product/pages/new-conversation.md` | `#操作与反馈`、`#页面状态` | 核对新对话草稿、项目、团队与提交门禁的用户后果 | 无需修改 |
| `docs/product/pages/agent-teams.md` | `#操作与反馈`、`#页面状态` | 核对团队浏览、编辑草稿、保存和外部变化的用户后果 | 无需修改 |
| `docs/product/pages/settings.md`、`docs/product/pages/onboarding.md`、`docs/product/pages/search.md` | 各自的 `#操作与反馈`、`#页面状态` | 核对设置请求、引导恢复与搜索请求的迟到结果 | 无需修改 |

行为事实以 `openspec/specs/console-ui/spec.md`、`openspec/specs/desktop-shell/spec.md` 为补充 oracle；本轮只登记候选，不把未裁决、未实现的候选写入 specs 或 `docs/architecture/invariants.md`。

## 背景

`app.tsx` 当前有 86 条 `useState` / `useReducer` / `useRef` 声明：49 条 `useState`、3 条 `useReducer`、34 条 `useRef`；另有 22 个 `useEffect` 可能作为跨状态写入或异步窗口。单独的 hook 数量不构成问题，风险来自两个或更多状态存在合法组合约束，而 owner、generation、phase、selection 或提交顺序没有被某个状态模型或守卫显式表达。

已修复的草稿串会话缺陷 `02c1604` 是校准样本：修复前 composer 正文的正确归属依赖 selection，但正文写入与 selection 提交跨过异步阅读状态切换；中间窗口没有显式 owner。审计方法若不能在修复前快照中仅凭读写点和异步边界识别该组合，就不能用于本轮清单。

## 提案

- 在 `docs/architecture/console-state-composition-audit.md` 交付一份按可复算风险分数排序的候选清单，不修改生产代码、测试、PRD、当前行为 specs 或系统级不变量事实源。
- 逐条覆盖 86 个 hook 声明，并另建 effect ledger 与邻近状态模块公开状态面清单；每项必须映射到风险条目或附机器可复核依据的“登记即可”，不得静默省略。
- 每个风险条目写出可判真假的不变量、声明/写入/读取坐标、打开窗口的具体异步边界、可复现的破坏时序、用户可见后果、评分维度、总分、等级和三选一建议动作类型。
- 每条候选只承载一个可独立开 change 的不变量簇；不提出按文件或技术层拆分 `app.tsx`，也不写后续实现方案。
- 用 `02c1604^` 历史快照执行同一套方法做回溯自校验；校准失败时先修订方法，再形成当前清单。
- 单列“未来可提升到 `docs/architecture/invariants.md` 的候选”，只标识候选及理由，不修改该事实源。

## 影响

- 新增架构审计文档 `docs/architecture/console-state-composition-audit.md`。
- change 仅承载审计方法、任务与核验记录；无 spec-delta、wireframe 或 architecture SVG。
- 不改变 Electron renderer、localStorage、IPC、local-console API、SQLite / JSONL、console-ui 或用户可见行为。
- 本轮不新增、修改或删除测试；文档验收依赖坐标回查、行表计数与已知答案校准，不运行测试闸门。
