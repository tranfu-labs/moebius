# 任务：four-layer-20-desktop-renderer

## A · 基线与 ledger

- [x] 冻结 settings/onboarding/team 与 conversation/search/sidebar 现有行为矩阵
- [x] 从系列 design 复制 20 批五条精确 test-name 映射，建立 ledger；补齐 duration、最终替代纯测试和删除/保留结论，标出必须保留的 fetch/IPC/React 接缝

## B · Shell/team 纵切

- [x] 提取 settings/onboarding/team/builder application controllers 与纯 state models
- [x] 把 preload/localStorage/subscription 收敛为 adapters
- [x] 覆盖 stale owner、generation、慢/失败返回和父级重渲染

## C · Conversation 纵切

- [x] 提取 selection/route/search/process/analysis/project/session/sidebar controllers
- [x] 把 HTTP/browser storage/timer 收敛为 adapters
- [x] `app.tsx` 收为 exact composition root + view prop mapping，删除对应 layer debt

## D · 验证与真机

- [x] 按 ledger 剪枝重复重型组合，保留唯一接缝
- [x] scope、定向测试、typecheck、desktop build 全绿
- [ ] 执行 RA-05、RA-05a～RA-10 并按真机协议记录；RA-05a 必须记录 A/B 草稿、pending 发送禁用、最终 selection/未读及重启事实
- [ ] 报告纯比例、闸门耗时和集成测试净变化
- [ ] QA/主理人复核后、合并前运行本 change 唯一一次 `pnpm test`

## 行为矩阵基线

| 旅程 | 保持不变的外部行为 | 失败/迟到边界 | 真机 oracle |
| --- | --- | --- | --- |
| settings | 语言、更新、复制反馈只归最新请求；重启保持语言 | 旧请求不得覆盖新状态 | RA-05 |
| sidebar/conversation | A/B 草稿各归 owner；pending 禁发；最终 selection/未读按最新 generation 提交 | 慢切换、快速往返、创建失败恢复旧 route/draft | RA-05a |
| team/builder | 切换、编辑、保存反馈只归目标团队/成员 | owner 改变或迟到保存不得串写 | RA-06 |
| onboarding | 回看后保持原 selection、草稿与右栏；readiness 只接受最新 sequence/revision | 初始检查、full snapshot 迟到不得回退 | RA-07 |
| search | 第二条件成为当前结果与 route host | 第一请求迟到不得抢回 | RA-08 |
| analysis | 消息/会话分析结果归正确 host 标签并可继续发送 | 离开入口后的迟到结果不得抢页面 | RA-09 |
| right sidebar | 改动/文件/过程/子任务/会话标签按 host 保持 | refresh 不得改写用户当前标签 | RA-10 |

## test-name ledger

三次样本使用 Node 24.18.0、desktop Vitest 单 worker 与精确 test-name filter，日期 2026-08-02。

| 原集成测试 | 三次 duration / 中位数 | 新纯测试 | 等价决策分支 | 保留接缝 | 当前结论 |
| --- | --- | --- | --- | --- | --- |
| `console-app-sidebar-conversation-regressions.test.tsx` · `keeps a target-owned draft editable across a slow switch and parent rerender while blocking send` | 88/72/74ms · **74ms** | `console-conversation-controller.test.ts` · `keeps target draft ownership through rerender and blocks send during slow selection` | draft owner、pending phase、父重渲染/callback identity | mounted React receiver + slow fetch | 纯测试已建；原接缝保留 |
| 同文件 · `serializes rapid round trips and clears both unread badges without stale selection writes` | 38/35/36ms · **36ms** | `use-conversation-transition.test.tsx` · `serializes rapid round trips and uses the callback owner captured for each generation` | generation、队列、stale write 丢弃 | mounted app + HTTP receiver | controller 测试已建；原接缝保留 |
| 同文件 · `keeps the previous route and draft when ordinary conversation creation fails` | 18/18/18ms · **18ms** | `use-new-conversation-submission.test.tsx` · `keeps route, draft, and selection intact when a slow creation fails after its owner rerenders` | create pending → failure 回滚；父重渲染/callback identity | mounted fetch failure → 可见反馈 | 轻量 controller 测试已建；原接缝保留 |
| `onboarding-app-routing.test.tsx` · `keeps the later shell PATH recheck when the initial check resolves last` | 24/24/24ms · **24ms** | `onboarding-readiness-controller.test.ts` · `rejects an older initial readiness result after a newer PATH recheck` | request sequence 丢弃初始迟到结果 | mounted onboarding + PATH status receiver | 纯测试已建；原接缝保留 |
| 同文件 · `does not let an older full readiness response overwrite newer per-CLI results` | 6/6/6ms · **6ms** | `onboarding-readiness-controller.test.ts` · `merges newer per-CLI results without accepting an older full snapshot` | revision 合并拒绝旧 full snapshot | preload readiness/install receiver | 纯测试已建；原接缝保留 |

## 实施检查点 1

- 20 批 exact debt：15 → **9**。已清 onboarding route shape、onboarding IPC dependency/adapter、
  settings adapter、team adapter、draft adapter；剩余集中在 `app.tsx`、`state-sync.ts`、
  `use-managed-attachments.ts`、right-sidebar tabs 与 CLI installer manager。
- `onboarding-route.tsx`：603 → **248** 物理行；readiness state/generation、installation state sync 与
  mutation commands 已进入受 shape 门禁的 application controllers，纯 model 直接覆盖迟到/单调合并。
- 新增 `onboarding/register.ts` composition root；条件审计为 wiring 4 / timing 0 / business 0，AST
  合计 4。root 只装配 readiness、installer、team builder 与 channel map。
- settings/team/draft 不再被误登记为 adapter：纯 reducer/owner 判据归 domain，异步 single-flight 与
  save-all 时序归 application，`localStorage` 仍只在 draft adapter。
- `app.tsx` 仍为 4,988 行，本检查点尚未开始 façade 收薄，不把外围 debt 下降计作主 root 完成。
- `pnpm run test --scope fb5081d`：13 files / 89 tests 全绿，6.12s；同轮
  `pnpm check:boundaries` 通过（470 source / 384 production / 3 roots）。desktop typecheck 在各纵切后全绿。

## 实施收口记录（复核前）

- `app.tsx` 从 4,988 物理行 / 4,801 逻辑行收为 **275 物理行 / 262 逻辑行**；达到主理人修订后的
  `<=262` 目标并通过 `<=300` 硬门禁。root 装配 12 个具名 bundle；`OperatorConsole` prop mapping 与
  sidebar slot 位于 view 层，20 批最后一条 `application-use-case-shape` debt 已摘除。
- 20 批 exact debt：15 → **0**；全系列剩余 debt 仅绑定 30 批 20 条、40 批 56 条。
  composition-root audit 已覆盖 15 个 root/facade；`app.tsx` 复算为 wiring 8 / timing 0 / business 0。
- `runtime.ts` 保持 **299/300 逻辑行**（308 物理行），20 批没有修改；没有占用它仅剩的 1 行余量。
- 按 00 批同一 logical-line 脚本，domain closure 从 113 文件 / 15,032 行增至 **161 文件 /
  19,734 行**，增加 4,702 行。沿用 00 批 74 文件 / 10,024 行对应 34–41% 的校准区间，本批累计
  纯逻辑/业务规则约 **67–81%**；这是职责抽样区间，不把 contracts 与规则混算成单点精度。
- ledger 五条原集成测试均保留：它们分别守 mounted React、慢 fetch/HTTP、preload/IPC 接缝；对应
  domain/controller 测试均已建立。集成测试净删除 **0**，测试文件净删除 **0**，因此可归因速度收益记 0。
- Node 24.18.0 验证：`pnpm check:boundaries` 通过（602 source / 516 production / 3 roots）；
  `pnpm run test --scope fb5081d` 为 65 files / 255 tests 全绿（17.27s）；`pnpm typecheck` 与
  `pnpm --filter @moebius/desktop build` 均退出码 0。
- 本 change 的完整 `pnpm test` 尚未运行；按约定留到 QA/主理人复核通过后的合并点。故完整闸门
  实际耗时暂记“待合并点采样”，不以 scope/build 时间冒充。
