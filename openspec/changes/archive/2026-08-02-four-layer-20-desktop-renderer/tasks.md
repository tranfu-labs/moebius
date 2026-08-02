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
- [x] 执行 RA-05、RA-05a～RA-10 并按真机协议记录；RA-05a 必须记录 A/B 草稿、pending 发送禁用、最终 selection/未读及重启事实
- [x] 报告纯比例、闸门耗时和集成测试净变化
- [x] QA/主理人复核后、合并前运行本 change 唯一一次 `pnpm test`

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
  composition-root audit 已覆盖 16 个 root/facade；`app.tsx` 复算为 wiring 8 / timing 0 / business 0。
- `runtime.ts` 保持 **299/300 逻辑行**（308 物理行），20 批没有修改；没有占用它仅剩的 1 行余量。
- 按 00 批同一 logical-line 脚本，domain closure 从 113 文件 / 15,032 行增至 **161 文件 /
  19,734 行**，增加 4,702 行。沿用 00 批 74 文件 / 10,024 行对应 34–41% 的校准区间，本批累计
  纯逻辑/业务规则约 **67–81%**；这是职责抽样区间，不把 contracts 与规则混算成单点精度。
- ledger 五条原集成测试均保留：它们分别守 mounted React、慢 fetch/HTTP、preload/IPC 接缝；对应
  domain/controller 测试均已建立。集成测试净删除 **0**，测试文件净删除 **0**，因此可归因速度收益记 0。
- Node 24.18.0 验证：`pnpm check:boundaries` 通过（602 source / 516 production / 3 roots）；
  `pnpm run test --scope fb5081d` 为 65 files / 255 tests 全绿（17.27s）；`pnpm typecheck` 与
  `pnpm --filter @moebius/desktop build` 均退出码 0。
- 本 change 的完整 `pnpm test` 按约定留到 QA/主理人复核通过后的合并点；结果见文末合并点记录。

## RA-05、RA-05a～RA-10 真机记录（QA）

环境：dev Electron（`MOEBIUS_DATA_ROOT=/tmp/moebius-ra10-zT1Ozl` 临时数据根，零 mock），经 ADR-0002
dev-only CDP 9222 attach 真实窗口操作并断言；Node v24.18.0；真实 Codex CLI（0.146.0，ChatGPT 订阅）。
慢切换/迟到场景用 CDP `Network.emulateNetworkConditions`（latency 2.5–3s）构造。驱动脚本与启动日志
留于临时数据根 `driver/` 与 `electron-ra20*.log`。准备数据（项目、三个空会话）经真实 HTTP API 建立，
所有 RA 断言动作均为真实页面操作。

- **RA-05 通过**。入口＝侧栏 Settings；操作＝语言切到 English、About → Check for updates、Copy version
  info、关闭。观察＝界面实时转英文；更新区显示 “You're up to date” 且按钮变为 “Check again”（只属于
  最新请求）；复制后按钮变为 “Copied”，剪贴板实测为 `Moebius 0.2.0 · Apple Silicon Mac`；重启应用后
  界面保持英文（侧栏 New conversation/Search/Settings 等）。
- **RA-05a 通过**。入口＝主页面左侧栏；操作＝会话 A/B 各输入不同未发送草稿（DRAFT-A/DRAFT-B），
  A→B→A→B→A 快速往返；再以 3s 节流构造慢切换。观察＝快速往返中 composer 始终显示目标会话自己的
  草稿（`draft:<sessionId>` 按会话 ID 分键持久化，结构上不可能串会话）；慢切换 pending 期间发送按钮
  disabled（t+0 至 t+2.5s 全程 true），解除节流后切换完成、按钮恢复，草稿未写入旧会话；最终主区与
  selection 指向最后点击的会话 A。B 经菜单标记未读并离开后，页面 “Unread” 与服务端 `manualUnreadAt`
  一致。重启应用后：页面恢复到最后 selection（A），两份草稿各归原会话，B 未读保持。
- **RA-06 通过**。入口＝Agent teams 页；操作＝内容生产团队 → 成员内容生产总控 → Reasoning effort
  high→xhigh → Save runtime configuration。观察＝保存后该成员配置出现 “User override” 标记；切到同团队
  成员内容情报与证据为 “Following recommendation”，切到开发团队同样无 override——反馈只落目标团队/
  成员；离开团队页再进入、重开详情，xhigh 与 User override 均保持。
- **RA-07 通过**。入口＝侧栏 Replay onboarding；操作＝在会话 A（草稿 DRAFT-A、右栏打开）回看
  onboarding 并逐步完成到 Get started。观察＝回到会话 A，草稿原样保留，selection 不变
  （`moebius.console.selection` 仍为 A），右栏仍为打开且内容未重置。
- **RA-08 通过**。入口＝侧栏 Search；操作＝2.5s 节流下先搜「薄荷糖」300ms 后改搜「仙人掌」，解除节流
  后打开结果。观察＝结果稳定后只显示第二条件命中的会话 B（第一请求迟到未拉回）；打开后主内容＝
  会话 B、selection＝B、composer 恢复 B 自己的草稿，右栏 host 与 B 一致。
- **RA-09 通过**。入口＝消息 More actions → “Analyze this message in the right sidebar”（消息级）与会话
  菜单 → “Analyze this conversation in the right sidebar”（整段级），均在会话 C（已先用真实运行造出一条
  agent 消息）。观察＝消息级触发后立即离开到会话 A，30s 后页面仍停在 A（迟到结果未抢页面）；回到 C，
  分析草稿带 “Text fragment 1” 留在 C 的右栏。两条分析发送后均完成真实运行：来源分别显示
  「消息 · ceo · “RA09-LIGHTHOUSE”」与「对话 · “会话C-灯塔维修日志”」，回复 RA09-ANALYSIS / RA09-CONV；
  服务端各出现一条 `analysisParentSessionId=C` 的真实会话，右栏内有 composer 可继续发送。
- **RA-10 通过**。入口＝右侧栏；操作＝A 开 Changes 标签；C 开两个分析子会话标签、New blank tab →
  Project files、主会话消息 Full output → CEO 过程标签；3s 节流下 C→A 切换宿主；关闭并重开右栏。
  观察＝节流 pending 期间右栏显示目标 host（A）自己的活动标签并呈 “Loading project changes…”，
  无迟到内容抢占；每个 host 的标签现场各自保持：C＝两个子会话 + Project files + CEO（活动＝CEO
  过程标签，含 Attempt 1 · completed），A＝Changes；关闭/重开后两 host 现场均恢复。

七条全部通过。备注：RA-05a 的「未读与实际已查看一致」以手动未读样本验证（空会话无自然未读）；
RA-10 的 Project files 内容为空文件夹如实提示，与临时项目目录一致。

## 合并点完整闸门

- 首次 `pnpm test` 红于 `production-copy-guard.test.ts` 的两条 ENOENT：测试硬编码了已拆除的
  `desktop/src/console-page/state-sync.ts`，且因此无法确认递归命令中后续 suite 是否执行。
- 修正把 `desktop/src/console-page` 的生产 `.ts` / `.tsx` 改为递归自动发现；6 个文件的 16 条存量
  中文文案登记为 exact copy debt（每个文件冻结命中数、原因与
  `four-layer-50-final-convergence` removal change），`language-state.ts` 的 reducer locale 比较使用
  行级 `i18n-exempt: locale-state-reducer` 标记，不把业务状态比较误报成文案分支。
- 反证 fixture：临时加入未登记的 `production-copy-guard-probe.ts` 后，guard 仅该测试变红并打印
  文件路径、第 1 行及字面量；移除探针后定向 guard 3/3 全绿。
- 修正后完整 `pnpm test`（Node 24.18.0）退出码 **0**，总墙钟 **133s**：root 121 files / 1,034 tests
  全绿，另 1 file / 4 tests skipped（81.24s）；slow 1 / 63（15.96s）；desktop 111 / 514
  （25.78s）；console-ui 45 / 460（7.15s）。
- 相对 Node 24 基线 119.24s 的单样本观察为 +13.76s，且高于本批 102–118s 目标带。20 批没有删除
  ledger 集成接缝，desktop suite 相比 10 批增加 83 项；测试组合和机器时序同时变化，故不把差值归因于
  重构，仍按可归因速度收益 **0** 记账，不以单次样本宣称提速。

### 主理人独立复核（dev-manager）

- 独立重跑完整 `pnpm test`（Node 24.18.0，同一工作区）：四个 scope 全绿且计数与 dev 报告逐项一致
  ——root 121 files / 1,034 tests（另 1 file / 4 tests skipped）、slow 1 / 63、desktop 111 / 514、
  console-ui 45 / 460；无 `FAIL` / `ELIFECYCLE` / `ERR_PNPM` 标记；总墙钟 128s。
- 墙钟差值归因：相较 10 批，root（121/1,034）、slow（1/63）、console-ui（45/459→460）三个 scope
  规模基本未变，增量全部来自 desktop 的 66 files / 431 tests → 111 files / 514 tests，即 +45 个测试
  文件、+83 个用例。+13.76s 摊到 45 个新文件约 0.3s/文件，与 vitest 每文件 transform + environment
  固定开销同量级。故该差值指向覆盖增加而非执行变慢；与 dev 一致按可归因收益 0 记账，此处仅补归因，
  不改记账口径。
- 独立反证探针（非复用 dev 的 fixture，测毕已还原、工作区干净）：
  - 探针 A：在 `desktop/src/console-page/` 新增未登记 `.ts` 并写入中文字面量 → guard 第 1 条测试变红，
    精确打印 `desktop/src/console-page/__probe_dm.ts:1` 及字面量内容；另两条保持绿。
  - 探针 B：向既有 debt 文件 `edit-resend.ts` 追加一条中文字面量 → guard 第 2 条测试变红，报
    `expected 1 debt literals, found 2`。
  - 结论：exact copy debt 是可回归的棘轮而非白名单——新增违规与既有文件的违规增量都会被拦住，
    且债务条目失效（文件改名/删除）会报 stale。
- 收口条件逐条核对：`app.tsx` 4,801 → 262 逻辑行（≤262 目标）；bundle 16 → 12；JSX 带函数体内联
  回调 17 → 0；`four-layer-20-desktop-renderer` fileDebt 15 → 0；`runtime.ts` 停留在 10 批的
  `04cf8c5`、308 物理 / 299 逻辑行、本批零改动；composition-root 审计 16 条；QA 七条真机记录已落盘。
