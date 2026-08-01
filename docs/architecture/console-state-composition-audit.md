# Console 状态组合审计

## 结论

审计基准为 `cf85d0b`，对象是 `desktop/src/console-page/app.tsx` 及同目录 22 个邻近文件。本轮只做静态状态组合审计，不修改实现、不运行应用，也不把“未证伪的可能性”表述成已复现缺陷。

共登记 15 个可独立开 change 的候选。当前有 4 条标记为已确认缺陷（其中 R-02 为部分消解的父条目，剩余重启子集由 R-14 独立跟踪）、11 个未证伪的可能性；可独立执行的已确认缺陷是 R-08、R-14、R-15。最高优先级不是“hook 多”，而是 owner / generation / phase 没有进入状态模型，导致迟到提交或错误清理可能越过用户已经切换的现场。现有保护共 6 类，经 86 条 hook 完整性表登记为“已有保护待登记”。

## 机械基线

以下命令与输出原样记录；模式同时覆盖 `useRef(...)` 与 `useRef<T>(...)`。

```text
$ printf 'useState '; rg -n '\buseState\s*[(<]' desktop/src/console-page/app.tsx | wc -l | tr -d ' '; printf 'useReducer '; rg -n '\buseReducer\s*[(<]' desktop/src/console-page/app.tsx | wc -l | tr -d ' '; printf 'useRef '; rg -n '\buseRef\s*[(<]' desktop/src/console-page/app.tsx | wc -l | tr -d ' '; printf 'useEffect '; rg -n '\buseEffect\s*\(' desktop/src/console-page/app.tsx | wc -l | tr -d ' '
useState 49
useReducer 3
useRef 34
useEffect 22

$ { rg -n '\buseState\s*[(<]' desktop/src/console-page/app.tsx; rg -n '\buseReducer\s*[(<]' desktop/src/console-page/app.tsx; rg -n '\buseRef\s*[(<]' desktop/src/console-page/app.tsx; } | cut -d: -f1 | sort -n | awk 'BEGIN { app=language=routes=route=console=0 } $1 >= 394 && $1 < 410 { app++ } $1 >= 410 && $1 < 477 { language++ } $1 >= 477 && $1 < 554 { routes++ } $1 >= 554 && $1 < 617 { route++ } $1 >= 617 { console++ } END { printf "App %d\nDesktopLanguageRoot %d\nDesktopRoutes %d\nOperatorConsoleRoute %d\nOperatorConsoleApp %d\nTotal %d\n", app, language, routes, route, console, app+language+routes+route+console }'
App 0
DesktopLanguageRoot 2
DesktopRoutes 1
OperatorConsoleRoute 3
OperatorConsoleApp 80
Total 86
```

## 风险排序规则

每条分数为 `R = W + 2U + P + S + B`：`W` 可触发性 0–3，`U` 用户后果 0–4，`P` 持续性 0–3，`S` 静默性 0–2，`B` 影响面 0–2。13–18 为高风险，8–12 为中风险，1–7 为低风险。排序按总分、`U`、`P`、`W` 依次降序，最后按 ID 升序。

“判定性质”不参与评分：

- `已确认缺陷`：给定条目中的操作序列，源码坐标足以推出非法组合必然出现。
- `未证伪的可能性`：状态形状成立，但操作入口是否能在该时序窗口并发仍需真实运行或组件测试验证。
- `已有保护待登记`：关系已由 owner、reducer、generation、queue 或 guard 表达，不是开放风险。

## 按风险排序的候选

| ID | 主题 | 判定性质 | W/U/P/S/B | R | 等级 | 动作类型 |
| --- | --- | --- | --- | ---: | --- | --- |
| R-01 | 项目 mutation 的裸 boolean 不能表达并发 owner | 未证伪的可能性 | 1/4/3/1/2 | 15 | 高 | 显式化 |
| R-02 | 关闭非当前分析草稿只检查当前附件 | 已确认缺陷（部分消解） | 3/3/3/2/1 | 15 | 高；剩余风险见 R-14 | 显式化（部分完成） |
| R-14 | 重启后未激活草稿的附件事实不可见 | 已确认缺陷 | 2/3/3/2/1 | 14 | 高 | 显式化（跨重启附件 owner） |
| R-03 | AI 建队提交没有 request owner / generation | 未证伪的可能性 | 2/3/3/1/1 | 13 | 高 | 显式化 |
| R-04 | 来源迁移的迟到结果可覆盖新 route | 未证伪的可能性 | 2/3/2/1/2 | 13 | 高 | 显式化 |
| R-05 | 分析草稿创建完成后无条件切换 route | 未证伪的可能性 | 2/3/2/1/2 | 13 | 高 | 显式化 |
| R-06 | 归档完成后用旧 render 的 route 决定回退 | 未证伪的可能性 | 1/3/2/1/2 | 12 | 中 | 显式化 |
| R-07 | 搜索结果导航先写 route、selection gate 可拒绝 | 未证伪的可能性 | 1/3/2/1/2 | 12 | 中 | 显式化 |
| R-08 | 分析通知没有 route / session owner | 已确认缺陷 | 3/2/1/1/2 | 11 | 中 | 显式化 |
| R-15 | `clearDraft` 不清理服务端草稿附件 | 已确认缺陷 | 3/0/3/2/2 | 10 | 中 | 显式化（资源生命周期） |
| R-09 | 主 Agent 切换状态只容纳一个 team owner | 未证伪的可能性 | 2/2/1/1/1 | 9 | 中 | 显式化 |
| R-10 | Save-all failures 没有 team owner | 未证伪的可能性 | 1/2/1/1/1 | 8 | 中 | 显式化 |
| R-11 | 重命名完成后可用旧搜索条件覆盖新条件 | 未证伪的可能性 | 2/2/0/1/1 | 8 | 中 | 显式化 |
| R-12 | 语言 external 事件不带 revision | 未证伪的可能性 | 1/1/2/1/2 | 8 | 中 | 显式化 |
| R-13 | 右栏焦点确认只比较 tabId、不比较 host | 未证伪的可能性 | 1/1/0/1/0 | 4 | 低 | 显式化 |

### R-01 · 项目 mutation 的裸 boolean 不能表达并发 owner

- **判定与评分**：`未证伪的可能性`；`W/U/P/S/B = 1/4/3/1/2`，`R=15`（高）；动作类型为`显式化`。
- **涉及状态**：`isProjectMutationPending`（H-063）。
- **不变量**：若任一项目重命名、移除或修复请求仍在途，则 `isProjectMutationPending` 必须为 `true`，且只有最后一个在途请求结束后才能变为 `false`。
- **坐标**：声明 `app.tsx:742`；三个入口分别在 `3010–3033`、`3035–3110`、`3119–3142`，都在请求前写 `true`、各自 `finally` 无条件写 `false`；读取投影在 `app.tsx:4640`。
- **窗口**：第一个请求写 `true` 后，若第二个入口在 React 禁用投影生效前或通过另一入口开始，先结束的请求会在另一个仍等待 `await fetch/refresh` 时写 `false`。
- **用户后果**：项目操作会过早重新可用，后续重命名、修复或移除可与仍在途的服务端写重叠；oracle：`docs/product/pages/main-left-sidebar.md#修改项目显示名称`、`docs/product/pages/main-left-sidebar.md#移除项目`。
- **独立 change 边界**：只处理项目 mutation phase / owner，不触碰 selection coordinator 或项目 API。

### R-02 · 关闭非当前分析草稿只检查当前附件

- **判定与评分**：`已确认缺陷（部分消解）`；`W/U/P/S/B = 3/3/3/2/1`，`R=15`（高）；动作类型为`显式化（部分完成）`，剩余风险由 R-14 独立执行。
- **涉及状态**：右栏 tabs（H-029）、sidebar conversation drafts（H-027）、外部附件 drafts（X-22）及当前 draft locator。
- **不变量**：若被关闭的分析草稿含任一正文、文本胶囊（代码字段 `textFragments`）或附件，则必须在删除该草稿和附件前得到用户确认。
- **历史反例**：草稿 A 只添加附件 → 切到 tab B → 点击 A 的关闭按钮 → A 不是 active，旧实现令 `hasAttachments=false` 且正文未改 → 无确认执行 remove + clear。
- **用户后果**：旧实现会让用户未确认即失去 A 的未发送附件；oracle：`docs/product/pages/main-right-sidebar.md#关闭标签`、`docs/product/pages/main-right-sidebar.md#指标与验收`（验收 34）、`openspec/specs/console-ui/spec.md`「composer 支持纯附件与附件草稿恢复」。
- **部分保护坐标**：`sidebar-conversation-drafts.ts:135–140` 以纯函数统一正文、文本胶囊、上下文与附件判定；`use-managed-attachments.ts:369–375` 从 renderer keyed ref 暴露目标 draft 查询；`app.tsx:4670–4688` 按被关闭 draft 的 `attachmentDraftKey` 查询，并在确认取消时先于 remove / clear 返回。纯逻辑测试见 `desktop/tests/sidebar-conversation-drafts.test.ts:52–85`，慢成功、失败、重渲染、取消与确认接缝见 `desktop/tests/console-app-sidebar-conversation-regressions.test.tsx:610–727`。
- **已消解子集**：`fix-inactive-analysis-draft-close-confirmation` 消解“附件事实已经进入 renderer keyed record”时关闭非当前草稿的同会话反例；该保护真实存在，但不代表无条件不变量已经消解。
- **未覆盖子集**：重启后从未激活的草稿没有进入 renderer keyed record，按-key 查询仍返回 false；该已确认反例由 R-14 跟踪。

### R-03 · AI 建队提交没有 request owner / generation

- **判定与评分**：`未证伪的可能性`；`W/U/P/S/B = 2/3/3/1/1`，`R=13`（高）；动作类型为`显式化`。
- **涉及状态**：`agentTeamBuilderState`（H-073）、`agentTeamBuilderStartedRef`（H-074）、`agentTeamBuilderDraftIdRef`（H-075）。
- **不变量**：若 AI 建队响应要提交到 renderer，则它必须属于当前 draft id 的最新一次 start / submit / adjust / retry / commit 请求。
- **坐标**：状态响应统一无条件提交于 `app.tsx:1466–1476`；start、submit、adjust、retry、commit 的 `await` 分别在 `1531`、`1564`、`1588`、`1619`、`1655–1657`；commit 按钮只依赖下一次 render 的 `committing`，见 `team-proposal-card.tsx:124–137`，app handler 自身没有同步 in-flight guard。
- **窗口**：双击 commit 或 retry / start 与迟到响应交错时，两个请求可共享一个 draft id；后返回的旧失败或旧 phase 可覆盖先返回的新状态，外部 commit 还可能已产生团队。
- **用户后果**：已创建团队后仍显示失败、重复提交或进入错误 proposal；oracle：`docs/product/pages/agent-teams.md#AI-建队`、`openspec/specs/desktop-shell/spec.md`「AI 团队方案经验证后整支提交」「AI 建队提交对团队列表原子可见」。
- **独立 change 边界**：只声明 builder request owner / generation，不改变 AI 建队协议。

### R-04 · 来源迁移的迟到结果可覆盖新 route

- **判定与评分**：`未证伪的可能性`；`W/U/P/S/B = 2/3/2/1/2`，`R=13`（高）；动作类型为`显式化`。
- **涉及状态**：`presentationRoute` / ref（H-025/H-026）、`sourceMigrationRef`（H-046）、`state` / ref（H-019/H-020）和右栏 tabs（H-029）。
- **不变量**：若来源迁移完成时当前 presentation route 已不再是发起迁移的 route，则该结果不得提交 route、右栏开关或 tabs。
- **坐标**：effect 在 `app.tsx:3277–3314`；ref 只保存 target session id（`3293–3295`），Promise 成功后未比较当前 route 就在 `3297–3304` 提交，`finally:3305–3307` 也无 generation 检查。
- **窗口**：迁移 A 等待 `refresh` → 用户导航到 route B，effect 可启动 B 并改写同一个 ref → A 先成功，仍提交 A route 并关闭 B 的右栏，随后 A 的 finally 还把 B 的在途标记清空。
- **用户后果**：页面被旧迁移拉回、右栏突然关闭或 tab host 错位；oracle：`docs/product/pages/main-right-sidebar.md#会话归档与来源迁移`、`openspec/specs/desktop-shell/spec.md`「跨树分析导航原子切换工作现场」。
- **独立 change 边界**：只处理 source migration generation / route owner。

### R-05 · 分析草稿创建完成后无条件切换 route

- **判定与评分**：`未证伪的可能性`；`W/U/P/S/B = 2/3/2/1/2`，`R=13`（高）；动作类型为`显式化`。
- **涉及状态**：`sidebarConversationSendingId`（H-041）、drafts（H-027）、route / ref（H-025/H-026）、selection / ref（H-013/H-014）和 tabs（H-029）。
- **不变量**：若分析草稿 A 的创建完成时用户已离开 A 的现场，则 A 可以完成持久化，但不得覆盖用户当前 route、右栏开关或当前 tabs。
- **坐标**：请求 owner 只记录 draft id 于 `app.tsx:3547–3566`；创建等待在 `3567–3581`；只有 tabs state 在 `3601–3605` 比较当前 host，随后 `3613–3628` 却无条件 `commitPresentationRoute`，并在 `3629` 刷新当前 selection。
- **窗口**：提交 A → 切到其他会话 / route B → A 创建成功；tabs 更新因 host guard 可跳过，但 route 仍切到 A。
- **用户后果**：用户当前阅读现场被已离开的分析创建结果夺走；oracle：`docs/product/pages/main-right-sidebar.md#分析对话标签与跨树路由`、`openspec/specs/desktop-shell/spec.md`「服务端提交后才清理分析入口和标签」。
- **独立 change 边界**：只声明分析创建结果的 route commit owner，不改会话创建。

### R-06 · 归档完成后用旧 render 的 route 决定回退

- **判定与评分**：`未证伪的可能性`；`W/U/P/S/B = 1/3/2/1/2`，`R=12`（中）；动作类型为`显式化`。
- **涉及状态**：route / ref（H-025/H-026）、selection / ref（H-013/H-014）、tabs（H-029）。
- **不变量**：若归档响应返回后当前 route 已变化，则归档收尾只能清除被归档实体，不能根据发起时 route 改写当前 route 或 tabs host。
- **坐标**：归档回调在 `app.tsx:4487–4503`；响应后 host 从 ref 读取（`4490–4491`），但是否重置 route 使用 render 闭包中的 `presentationRoute`（`4496`），并可能在 `4498–4501` 覆盖当前 route / tabs。
- **窗口**：从 route A 发起归档 → 用户导航到 B → 归档返回；闭包仍判断 A 为被归档 route，从而把 B 重置为当前 selection 的 ordinary route。
- **用户后果**：归档另一会话后当前右栏现场被关闭或换 host；oracle：`docs/product/pages/main-right-sidebar.md#会话归档与来源迁移`、`docs/product/pages/main-left-sidebar.md#页面状态`。
- **独立 change 边界**：只处理归档收尾的 route snapshot / current-owner 判定。

### R-07 · 搜索结果导航先写 route、selection gate 可拒绝

- **判定与评分**：`未证伪的可能性`；`W/U/P/S/B = 1/3/2/1/2`，`R=12`（中）；动作类型为`显式化`。
- **涉及状态**：route / ref（H-025/H-026）、selection / ref（H-013/H-014）、selection coordinator（H-018/H-057）。
- **不变量**：若搜索结果导航不能提交目标 selection，则不得提交以该目标为前提的 presentation route、tabs 或右栏开关。
- **坐标**：搜索恢复等待与 route 提交在 `app.tsx:3876–3929`；route 在 `3902` 或 `3922–3927` 先提交，`actions.selectSession` 后调用于 `3920/3929`；后者在 `state-sync.ts:1090–1097` 遇到 selection mutation pending 会直接 return。
- **窗口**：selection mutation 在途 → 搜索结果恢复完成 → route 先写入 localStorage / state → `selectSession` 被 gate 拒绝。
- **用户后果**：左侧 selection 与主内容 / 右栏 route 指向不同会话；oracle：`docs/product/pages/search.md#键盘焦点与来源失效`、`openspec/specs/console-ui/spec.md`「Conversation view routing」「Selection mutation serialization」。
- **独立 change 边界**：只原子化搜索导航提交，不改变搜索 API。

### R-08 · 分析通知没有 route / session owner

- **判定与评分**：`已确认缺陷`；`W/U/P/S/B = 3/2/1/1/2`，`R=11`（中）；动作类型为`显式化`。
- **涉及状态**：`sessionAnalysisNotice`（H-011）、`newConversation`（H-064）、route（H-025）。
- **不变量**：若当前页面不再是产生分析错误的入口或会话，则不得显示该分析错误；不存在普通新对话已打开且仍把旧分析错误作为其 error 的时刻。
- **坐标**：notice 在 `app.tsx:3372–3414,3447–3449,3517–3519` 被写入，只在分析成功 `3516` 清除；普通新对话入口 `2886–2921` 不清除；该值无条件投影到 conversation notice `4294` 和新对话 error `4356`。
- **反例时序**：分析入口失败 → 用户选择普通会话或打开普通新对话 → 没有任何写点清 notice → 新页面继续显示旧分析失败。
- **用户后果**：无关会话 / 新对话显示错误来源不明的分析失败信息；oracle：`docs/product/pages/main-conversation.md#创建一段对话`、`docs/product/pages/main-conversation.md#页面状态`、`docs/product/pages/main-right-sidebar.md#页面状态`。
- **独立 change 边界**：只给 analysis notice 声明 owner / 生命周期。

### R-09 · 主 Agent 切换状态只容纳一个 team owner

- **判定与评分**：`未证伪的可能性`；`W/U/P/S/B = 2/2/1/1/1`，`R=9`（中）；动作类型为`显式化`。
- **涉及状态**：`primaryAgentChange`（H-080）、`agentTeamsState`（H-065）、active team（H-072）。
- **不变量**：若团队 T 的主 Agent 切换仍在途，则 T 的状态不得被另一团队请求的终态覆盖；每个完成响应只能更新自己的 owner。
- **坐标**：单槽状态声明 `app.tsx:769`；每个请求在 `1309` 写 owner，await 后在 `1324/1326` 覆盖整个槽；详情仅在 `1952–1957` 按当前 teamKey 过滤。
- **窗口**：T1 与 T2 请求重叠，T2 先完成并显示 saved，T1 后完成把槽改回 T1；T2 再打开时状态变 idle，虽然其服务端变更已完成。
- **用户后果**：保存反馈消失或错误归属，用户可能重复操作；oracle：`docs/product/pages/agent-teams.md#切换主-Agent`、`docs/product/pages/agent-teams.md#跨页面异常反馈`。
- **独立 change 边界**：只处理 primary-agent mutation 的 team owner。

### R-10 · Save-all failures 没有 team owner

- **判定与评分**：`未证伪的可能性`；`W/U/P/S/B = 1/2/1/1/1`，`R=8`（中）；动作类型为`显式化`。
- **涉及状态**：`agentTeamSaveAllFailures`（H-079）、active / selected team（H-071/H-072）、draft state / ref（H-076/H-077）。
- **不变量**：若 save-all failure 显示在团队 T 的详情中，则每个 failure 必须属于 T；其他团队的迟到 save-all 结果不得进入 T 的详情。
- **坐标**：failure shape 没有 team key，声明见 `team-state.ts:30–33`；异步 save-all 在 `app.tsx:1224–1239` 结束后无条件覆盖数组；详情在 `1951` 直接读取该数组，普通 open/close 只在 `1255/4584` 清除。
- **窗口**：T1 save-all 在途 → 用户进入 T2 并清空数组 → T1 迟到失败覆盖数组 → T2 详情收到 T1 的 member slug failure。
- **用户后果**：错误成员保存失败显示在另一团队，甚至 slug 重名时看似属于当前团队；oracle：`docs/product/pages/agent-teams.md#跨页面异常反馈`、`openspec/specs/console-ui/spec.md`「Per-member unsaved drafts」。
- **独立 change 边界**：只给 save-all result 声明 team owner。

### R-11 · 重命名完成后可用旧搜索条件覆盖新条件

- **判定与评分**：`未证伪的可能性`；`W/U/P/S/B = 2/2/0/1/1`，`R=8`（中）；动作类型为`显式化`。
- **涉及状态**：search state / request / input（H-042/H-043/H-044）和 updating title set（H-045）。
- **不变量**：若 search state 提交 condition K，则当前搜索输入必须仍为 K；标题更新不得重发已被用户替换的旧条件。
- **坐标**：rename 开始时快照 input 于 `app.tsx:4518`；搜索本身用 controller identity 正确保护 `3840–3874`；但 rename 完成 / 失败后在 `4534/4536` 调用旧 `searchInput`，会由 `3845–3855` 把当前新请求 abort 并设回旧 condition。
- **窗口**：搜索 A → 开始重命名 → 用户输入 B → B 请求开始 → rename 返回并 execute A → B 被 abort，输入仍可为 B 而结果 state 属 A。
- **用户后果**：搜索框与结果条件不一致，用户可能打开错误结果；oracle：`docs/product/pages/search.md#键盘焦点与来源失效`、`docs/product/pages/search.md#页面状态`、`openspec/specs/console-ui/spec.md`「重命名在所有生产入口一致呈现」。
- **独立 change 边界**：只处理 rename 后搜索 refresh 的 condition owner。

### R-12 · 语言 external 事件不带 revision

- **判定与评分**：`未证伪的可能性`；`W/U/P/S/B = 1/1/2/1/2`，`R=8`（中）；动作类型为`显式化`。
- **涉及状态**：language reducer（H-001）和 `requestIdRef`（H-002）。
- **不变量**：若 external locale 事件晚于本地保存请求，则更早请求的完成不得覆盖该 external locale；所有 locale commit 必须有可比较顺序。
- **坐标**：本地请求 id 在 `app.tsx:418–431`；external IPC / subscription 在 `438–444`；reducer 对本地 action 用 requestId 防迟到（`language-state.ts:37–68`），但 external 在 `29–35` 无 revision 且保留旧 requestId，因此旧 `saved` 仍可随后通过。
- **窗口**：request 1 保存 A → 收到较新的 external B → reducer 显示 B → request 1 saved A 返回，因 id 不小于 state.requestId 而重新提交 A。
- **用户后果**：应用语言在跨窗口 / 广播竞争后回跳并持久错误偏好；oracle：`docs/product/pages/settings.md#切换语言`、`docs/product/pages/settings.md#页面状态`。
- **独立 change 边界**：只统一 locale 事件顺序，不改翻译资源。

### R-13 · 右栏焦点确认只比较 tabId、不比较 host

- **判定与评分**：`未证伪的可能性`；`W/U/P/S/B = 1/1/0/1/0`，`R=4`（低）；动作类型为`显式化`。
- **涉及状态**：`rightSidebarFocusRequest`（H-030）。
- **不变量**：若焦点确认要清除请求，则确认的 hostSessionId 与 tabId 必须同时等于当前请求。
- **坐标**：request shape 同时保存 host / tab 于 `app.tsx:666–669`，写点 `2743–2747`；投影按 selected host 过滤 `4652–4656`，但确认回调在 `4658–4659` 只比较 tabId。
- **窗口**：host A 的 tab id X 发出确认 → route 切到 host B 并生成同 id X 的新请求 → A 的迟到确认清除 B 请求。
- **用户后果**：目标 tab 已打开但不获得预期焦点；oracle：`docs/product/pages/main-right-sidebar.md#标签条`、`docs/product/pages/main-right-sidebar.md#页面状态`。
- **独立 change 边界**：只收紧 focus acknowledgement identity。

### R-14 · 重启后未激活草稿的附件事实不可见

- **判定与评分**：`已确认缺陷`；`W/U/P/S/B = 2/3/3/2/1`，`R=14`（高）；动作类型为`显式化（跨重启附件 owner）`。W=2，因为需要“重启后不先打开 A 而直接关闭”的多步但正常操作；U=3，因为用户失去未发送附件的可找回入口；P=3，因为服务端附件成为无 UI owner 的持久孤儿；S=2，因为无确认、无错误；B=1，因为单次作用于一个目标草稿。
- **涉及状态**：sidebar conversation draft / tabs 的 localStorage 恢复（H-023/H-027/H-029）、renderer attachment keyed record（X-22）和服务端 managed draft attachment。
- **不变量**：若重启后恢复的未发送草稿在服务端仍有附件，则该草稿即使从未在本次 renderer 生命周期中激活，关闭判定也必须能识别附件存在。
- **坐标**：`use-managed-attachments.ts:30` 的 `drafts` 挂载初始为 `{}`；`listManagedDraftAttachments` 全仓唯一调用点在 `:300`，参数为 `input.currentDraftKey`，恢复 effect 为 `:296–351`；`hasDraftAttachments` 在 `:369–371` 只读 renderer keyed ref；草稿与 tabs 分别由 `app.tsx:648` 附近的 localStorage stores 恢复。
- **窗口**：A 仅添加附件并上传成功 → 切到 B → 退出并重启 → A 从未成为 `currentDraftKey` → 直接关闭 A；A 的服务端附件未恢复到 keyed record，关闭判定得到 `false`。
- **用户后果**：`app.tsx:4685–4687` 无确认删除草稿并调用只清 renderer 的 `clearDraft`，A 的标签和草稿消失，服务端附件成为无 UI 可找回路径的孤儿；oracle：`docs/product/pages/main-right-sidebar.md#指标与验收`（验收 34：重启不视为丢弃、普通附件触发确认）。
- **独立 change 边界**：只声明并补齐未发送草稿附件事实的跨重启 owner / 可见性，不改 R-02 已验证的同会话关闭接线，也不顺带处理服务端资源删除（见 R-15）。

### R-15 · `clearDraft` 不清理服务端草稿附件

- **判定与评分**：`已确认缺陷`；`W/U/P/S/B = 3/0/3/2/2`，`R=10`（中）；动作类型为`显式化（资源生命周期）`。W=3，因为正常确认丢弃或发送后清理都会进入该 helper；U=0，因为现有坐标不能推出即时用户可见变化；P=3，因为服务端记录没有本地清理路径；S=2，因为 UI 不报告残留；B=2，因为每个附件草稿都可累积资源。
- **涉及状态**：renderer attachment keyed record / upload handles（X-22）与服务端 managed draft attachments。
- **不变量**：若 `clearDraft(draftKey)` 表示该 managed attachment draft 的生命周期已经结束，则不存在 renderer 记录已清空而同一 key 的服务端附件仍无 owner 地保留的时刻。
- **坐标**：`use-managed-attachments.ts:179–188` 的 `clearDraft` 只 abort handle、revoke preview URL 并把 renderer key 置为空数组；`attachment-client.ts:106` 已有 `removeManagedDraftAttachment`，但全仓没有生产调用点。
- **窗口**：附件上传到服务端 → 用户确认丢弃草稿或发送后进入既有清理 → `clearDraft` 清空 renderer → 服务端附件未删除。
- **用户后果**：当前没有可从代码坐标推出的即时可见信号，因此 U=0；确定后果是服务端草稿附件脱离 UI owner 并持续累积。oracle：`docs/product/pages/main-right-sidebar.md#指标与验收`（验收 34 的“确认后草稿不再恢复”界定生命周期终点）。
- **独立 change 边界**：只闭合 managed draft attachment 的服务端删除生命周期，复用已有 remove API；不承担 R-14 的跨重启附件发现。

## 86 条 hook 完整性表

坐标列给出声明和主要写 / 读点；需要复查全部引用时使用 `rg -n '\b<state-or-ref>|\b<setter-or-dispatch>' desktop/src/console-page/app.tsx`。`G-*` 的依据见下一节；每行 disposition 只属于开放风险或登记类之一。

| ID | 组件 | hook / 声明 | 主要写 / 读坐标 | disposition |
| --- | --- | --- | --- | --- |
| H-001 | DesktopLanguageRoot | reducer `state` :411 | 写 421–443；读 434–455 | R-12 |
| H-002 | DesktopLanguageRoot | ref `requestIdRef` :416 | 写/读 419–421 | R-12 |
| H-003 | DesktopRoutes | state `onboardingCompleted` :479 | 写 487–499,517；读 508–544 | G-04 |
| H-004 | OperatorConsoleRoute | state `pendingAgentTeamKey` :557 | 初始化一次；读 591 | G-05 |
| H-005 | OperatorConsoleRoute | state `replayingOnboarding` :558 | 写 572,580；读 586–595 | G-06 |
| H-006 | OperatorConsoleRoute | ref `replayReturnFocusRef` :559 | 写 573,577–579；读 573 | G-03 |
| H-007 | OperatorConsoleApp | state `apiBase` :626 | 写 1976–1982,2027；跨 effect 1968–2033 | G-04 |
| H-008 | OperatorConsoleApp | state `executionRegistryState` :628 | 写 1992–2007；读渲染 | G-04 |
| H-009 | OperatorConsoleApp | state `executionRegistryReload` :629 | 写重试入口；effect 1990–2011 | G-04 |
| H-010 | OperatorConsoleApp | state `attachmentCapability` :630 | 写 2015–2017；附件 hooks 809–826 | G-04 |
| H-011 | OperatorConsoleApp | state `sessionAnalysisNotice` :631 | 写 3375–3519；读 4294,4356 | R-08 |
| H-012 | OperatorConsoleApp | state `initialSelectionPreference` :632 | 初始化读 storage；输入 635,639 | G-05 |
| H-013 | OperatorConsoleApp | state `selection` :635 | 统一写 2035–2038；读 route / effects | R-04/R-05/R-06/R-07 |
| H-014 | OperatorConsoleApp | ref `selectionRef` :638 | 同步写 2036；异步读多处 | R-04/R-05/R-06/R-07 |
| H-015 | OperatorConsoleApp | ref `persistedSelectionRef` :639 | 写 2052–2063；读 2058,2080 | G-05 |
| H-016 | OperatorConsoleApp | ref `startupSelectionPendingRef` :640 | 写 2083；读 2076 | G-05 |
| H-017 | OperatorConsoleApp | ref `selectionPersistenceEnabledRef` :641 | 写 2084 等；读 2079 | G-05 |
| H-018 | OperatorConsoleApp | ref `coordinatorRef` :642 | coordinator 2404–2437,3408–3523 | R-07 |
| H-019 | OperatorConsoleApp | state `state` :643 | 统一写 2065–2103、2545–2566 | R-04 |
| H-020 | OperatorConsoleApp | ref `stateRef` :644 | 同步写 2101,2565；异步读 | R-04 |
| H-021 | OperatorConsoleApp | ref `conversationDraftStoreRef` :645 | key-owned store，正文/发送多处 | G-03 |
| H-022 | OperatorConsoleApp | ref `rightSidebarTabsStoreRef` :646 | host-owned store，多处 read/write | G-03 |
| H-023 | OperatorConsoleApp | ref `sidebarConversationDraftStoreRef` :647 | draft-owned store 3345–3607,4675–4686 | R-02/R-14 |
| H-024 | OperatorConsoleApp | ref `presentationRouteStoreRef` :650 | 统一写 2040–2044 | G-03 |
| H-025 | OperatorConsoleApp | state `presentationRoute` :651 | 统一写 2040–2044；异步收尾多处 | R-04/R-05/R-06/R-07 |
| H-026 | OperatorConsoleApp | ref `presentationRouteRef` :654 | 同步写 2042；异步读 3407,3601,4490 | R-04/R-05/R-06/R-07 |
| H-027 | OperatorConsoleApp | state `sidebarConversationDrafts` :655 | store list 投影 3346,3491,3607,4686 | R-02/R-05/R-14 |
| H-028 | OperatorConsoleApp | ref `conversationReadingPositionStoreRef` :658 | session-keyed read/write 881–890,2772 | G-03 |
| H-029 | OperatorConsoleApp | state `rightSidebarTabs` :661 | host store 投影 2107–2115 及路由入口 | R-02/R-04/R-05/R-06/R-14 |
| H-030 | OperatorConsoleApp | state `rightSidebarFocusRequest` :666 | 写 2744；读/清 4652–4659 | R-13 |
| H-031 | OperatorConsoleApp | state `conversationMessageNavigation` :670 | 写 2774–2778；按 session+requestId 读 | G-03 |
| H-032 | OperatorConsoleApp | ref `conversationMessageNavigationIdRef` :675 | 单调写 2773 | G-03 |
| H-033 | OperatorConsoleApp | state `processOutputs` :676 | commit helper 2121–2129 | G-02 |
| H-034 | OperatorConsoleApp | ref `processOutputsRef` :677 | 与 H-033 同步写 2110,2126 | G-02 |
| H-035 | OperatorConsoleApp | state `processInvocationStates` :678 | commit helper 2131–2141 | G-02 |
| H-036 | OperatorConsoleApp | ref `processInvocationStatesRef` :681 | 与 H-035 同步写 2112,2138 | G-02 |
| H-037 | OperatorConsoleApp | ref `processInvocationRequestsRef` :682 | begin/finish/abortAll 2106,2152–2173 | G-04 |
| H-038 | OperatorConsoleApp | state `subSessionViews` :683 | session-keyed 2296–2348,3144–3153 | G-03 |
| H-039 | OperatorConsoleApp | state `sidebarConversationViews` :685 | session-keyed 2350–2402,3679–3707 | G-03 |
| H-040 | OperatorConsoleApp | state `sidebarConversationComposerValues` :687 | session-keyed 3609,3658,3677 | G-03 |
| H-041 | OperatorConsoleApp | state `sidebarConversationSendingId` :688 | 写 3565/3643,3667/3689 | R-05 |
| H-042 | OperatorConsoleApp | state `conversationSearchState` :689 | 写 3850–3872,4522–4527 | R-11 |
| H-043 | OperatorConsoleApp | ref `conversationSearchRequestRef` :695 | abort/current 3846–3866,4520–4521 | R-11 |
| H-044 | OperatorConsoleApp | ref `conversationSearchInputRef` :696 | 写 3845；旧快照 4518 | R-11 |
| H-045 | OperatorConsoleApp | state `updatingConversationTitleSessionIds` :701 | 写 4519,4539–4543；读 2527–2533 | R-11 |
| H-046 | OperatorConsoleApp | ref `sourceMigrationRef` :702 | 写 3294,3306；读 3293 | R-04 |
| H-047 | OperatorConsoleApp | state `subSessionComposerValues` :703 | session-keyed 3177,3187,4368–4370 | G-03 |
| H-048 | OperatorConsoleApp | state `subSessionSendingId` :704 | explicit session owner 3173–3237 | G-03 |
| H-049 | OperatorConsoleApp | state `composerDraft` :705 | 统一写 710–726；owner guard 2629–2653 | G-01 |
| H-050 | OperatorConsoleApp | ref `composerDraftRef` :709 | 与 H-049 同步写 711 | G-01 |
| H-051 | OperatorConsoleApp | ref `sessionViewTransitionQueueRef` :727 | FIFO 2606–2627 | G-01 |
| H-052 | OperatorConsoleApp | ref `sessionViewTransitionPendingRef` :728 | 同步写 2611,2624；发送 guard | G-01 |
| H-053 | OperatorConsoleApp | state `sessionViewTransitionPending` :729 | 同步写 2612,2625；投影 2629–2638 | G-01 |
| H-054 | OperatorConsoleApp | state `sessionViewTransitionError` :730 | 每次 enqueue 清、任务失败写 2613–2618 | G-01 |
| H-055 | OperatorConsoleApp | state `runnerStatus` :731 | status subscription 2023–2032 | G-04 |
| H-056 | OperatorConsoleApp | state `isSending` :732 | coordinator action set 2589 | G-01 |
| H-057 | OperatorConsoleApp | state `selectionMutationKind` :733 | coordinator action set 2588；投影 4638–4639 | R-07 |
| H-058 | OperatorConsoleApp | state `clientError` :734 | 多来源可见错误汇总 2474 | G-06 |
| H-059 | OperatorConsoleApp | reducer `desktopSettings` :735 | request-id reducer 842–879 | G-01 |
| H-060 | OperatorConsoleApp | ref `settingsUpdateRequestRef` :739 | single-flight 842–860 | G-01 |
| H-061 | OperatorConsoleApp | ref `settingsCopyRequestRef` :740 | single-flight 863–878 | G-01 |
| H-062 | OperatorConsoleApp | ref `nextSettingsRequestIdRef` :741 | 单调写 846,867 | G-01 |
| H-063 | OperatorConsoleApp | state `isProjectMutationPending` :742 | 三组独立 true/finally false | R-01 |
| H-064 | OperatorConsoleApp | reducer `newConversation` :743 | reducer events 2092–2098,2854–2996 | G-01 |
| H-065 | OperatorConsoleApp | state `agentTeamsState` :744 | load/reconcile 897–951 及 mutations | R-09 |
| H-066 | OperatorConsoleApp | state `activeCliInstallations` :745 | refs 派生 961–991 | G-01 |
| H-067 | OperatorConsoleApp | ref `cliInstallRevisionRef` :746 | 单调 revision 962–966 | G-01 |
| H-068 | OperatorConsoleApp | ref `cliInstallStatusRef` :751 | 每 CLI owner 966–986 | G-01 |
| H-069 | OperatorConsoleApp | state `lastUsedAgentTeamKey` :756 | load 934；成功发送 2980,3637 | G-05 |
| H-070 | OperatorConsoleApp | state `pendingAgentTeamKey` :757 | 一次性消费 effect 2854–2872 | G-05 |
| H-071 | OperatorConsoleApp | state `agentTeamSelection` :760 | team/member key 925,935,1241–1297 | R-10 |
| H-072 | OperatorConsoleApp | state `activeAgentTeamKey` :761 | open/close/team mutations | R-09/R-10 |
| H-073 | OperatorConsoleApp | state `agentTeamBuilderState` :762 | async response 1454–1673 | R-03 |
| H-074 | OperatorConsoleApp | ref `agentTeamBuilderStartedRef` :763 | 写 1470,1474,1497,1534,1622 | R-03 |
| H-075 | OperatorConsoleApp | ref `agentTeamBuilderDraftIdRef` :764 | lazy owner 1441–1451；清 1496 | R-03 |
| H-076 | OperatorConsoleApp | state `agentTeamDraftState` :765 | commit helper 892–895 | R-10 |
| H-077 | OperatorConsoleApp | ref `agentTeamDraftStateRef` :766 | 与 H-076 同步写 893 | R-10 |
| H-078 | OperatorConsoleApp | ref `checkingAgentTeamExternalChangesRef` :767 | team+member key 1075–1117 | G-03 |
| H-079 | OperatorConsoleApp | state `agentTeamSaveAllFailures` :768 | 无 owner，异步写 1224–1238 | R-10 |
| H-080 | OperatorConsoleApp | state `primaryAgentChange` :769 | 单槽覆盖 1309–1327 | R-09 |
| H-081 | OperatorConsoleApp | state `agentTeamsRefreshNonce` :770 | 计数写，多次 load effect cancel | G-04 |
| H-082 | OperatorConsoleApp | state `sidebarVisibilityPreference` :771 | state+storage 同步 3271–3275 | G-05 |
| H-083 | OperatorConsoleApp | state `rightSidebarVisibilityPreference` :775 | state+storage 同步 2046–2050 | G-05 |
| H-084 | OperatorConsoleApp | state `rightSidebarWidth` :776 | state+storage 同步 3316–3319 | G-05 |
| H-085 | OperatorConsoleApp | state `analysisPanelOpenBySession` :780 | session-keyed写 2699–2704 | G-03 |
| H-086 | OperatorConsoleApp | ref `resultAcknowledgementsRef` :781 | session+unreadSince key 2457–2468 | G-03 |

组件计数：`App` 0、`DesktopLanguageRoot` 2、`DesktopRoutes` 1、`OperatorConsoleRoute` 3、`OperatorConsoleApp` 80，合计 86。

## 已有保护登记

| ID | 判定性质 | 保护形状 | 机器可回查依据 |
| --- | --- | --- | --- |
| G-01 | 已有保护待登记 | reducer / owner / generation / FIFO 已表达合法组合 | `rg -n 'reduceLanguageState|reduceDesktopSettings|reduceNewConversationDraft|ConversationComposerDraftState|SessionViewTransitionQueue|requestId|revision' desktop/src/console-page/{app,language-state,settings-state,new-conversation,draft-store,state-sync}.ts*` |
| G-02 | 已有保护待登记 | state + ref 只经同一 commit helper 同步更新 | `rg -n 'commitProcessOutputs|commitProcessInvocationStates|processOutputsRef.current|processInvocationStatesRef.current' desktop/src/console-page/app.tsx` |
| G-03 | 已有保护待登记 | map / store 的 key 本身就是 session、team、draft 或 message owner | `rg -n 'sessionDraftKey|rightSidebarTabsKey|teamKey|draftId|sessionId|acknowledgementKey' desktop/src/console-page/{app,draft-store,right-sidebar-tabs-store,sidebar-conversation-drafts,team-state}.ts*` |
| G-04 | 已有保护待登记 | 异步读取有 AbortController、cancelled / active flag 或 request coordinator | `rg -n 'AbortController|cancelled|active = true|ProcessInvocationRequestCoordinator|agentTeamsRefreshNonce' desktop/src/console-page/{app,state-sync,use-managed-attachments}.ts*` |
| G-05 | 已有保护待登记 | 一次性快照、稳定 service identity 或 state + storage 同步写 | `rg -n 'rememberConfirmedSelection|forgetPersistedSelection|write.*Preference|pendingAgentTeamKey|initialSelectionPreference' desktop/src/console-page/app.tsx` |
| G-06 | 已有保护待登记 | 单一展示 mode / 错误汇总，不参与持久副作用目标 | `rg -n 'replayingOnboarding|clientError|lastError' desktop/src/console-page/app.tsx` |

## 22 个 effect ledger

| ID | effect 坐标 | 写目标 / 边界 | 结论 |
| --- | --- | --- | --- |
| E-001 | app.tsx:434 | DOM lang，同步 | G-01 |
| E-002 | app.tsx:438 | language read Promise + IPC subscription | R-12；external 无 revision |
| E-003 | app.tsx:482 | onboarding IPC `await`，active cleanup | G-04 |
| E-004 | app.tsx:561 | 清 Router navigation state，同步 effect | G-05 |
| E-005 | app.tsx:828 | application info Promise，active cleanup | G-04 |
| E-006 | app.tsx:881 | stateRef mirror + reading-position retain，同步 | G-02/G-03 |
| E-007 | app.tsx:897 | team list Promise + 250ms timer，cancelled cleanup | G-04 |
| E-008 | app.tsx:953 | CLI poll / subscription，per-CLI revision + cleanup | G-01/G-04 |
| E-009 | app.tsx:1968 | API base preload Promise，cancelled cleanup | G-04 |
| E-010 | app.tsx:1990 | registry fetch，AbortController | G-04 |
| E-011 | app.tsx:2013 | capability Promise，cancelled cleanup | G-04 |
| E-012 | app.tsx:2023 | status subscription，unsubscribe cleanup | G-04 |
| E-013 | app.tsx:2105 | host / selection 切换重置 keyed view state | G-02/G-03 |
| E-014 | app.tsx:2182 | process-output poll，controller + timer cleanup | G-04 |
| E-015 | app.tsx:2296 | sub-session poll，controller + timer cleanup | G-04 |
| E-016 | app.tsx:2350 | sidebar-conversation poll，controller + timer cleanup | G-04 |
| E-017 | app.tsx:2427 | periodic refresh，ConsoleStateCoordinator lease | G-01/G-04 |
| E-018 | app.tsx:2440 | selection → composer owner activate | G-01 |
| E-019 | app.tsx:2446 | acknowledgement Promise，session+revision key，失败删除 | G-03 |
| E-020 | app.tsx:2854 | onboarding pending team 一次消费 | G-05 |
| E-021 | app.tsx:2874 | 无效团队选择回退，reducer transition | G-01 |
| E-022 | app.tsx:3277 | source migration Promise，无 route generation | R-04 |

## 22 个邻近文件覆盖

| 文件 | 状态公开面 / 排除依据 |
| --- | --- |
| `attachment-client.ts` | 无 module mutable state；附件 HTTP adapter，owner 由参数 draft/session key 给出 |
| `attachment-preview.ts` | 无 mutable state；纯预览转换 / browser IO helper |
| `browser-fetch.ts` | 无 mutable state；receiver-safe fetch adapter |
| `console.css` | 样式文件，排除状态审计 |
| `conversation-reading-position.ts` | localStorage store，sessionId 为 owner；H-028 / G-03 |
| `css.d.ts` | 类型声明，排除状态审计 |
| `draft-store.ts` | composer owner + storage key；H-021/H-049/H-050 / G-01/G-03 |
| `edit-resend.ts` | 无持有状态；调用方显式注入 session 与副作用 |
| `index.html` | renderer 壳文件，排除状态审计 |
| `interrupt.ts` | 无持有状态；显式 sessionId/runId adapter |
| `language-state.ts` | reducer + requestId；H-001/H-002，external 分支见 R-12 |
| `new-conversation.ts` | 单一 reducer；H-064 / G-01 |
| `presentation-route.ts` | route value + localStorage store；H-024–H-026，迟到 commit 见 R-04–R-07 |
| `right-sidebar-preference.ts` | state + localStorage 同步 helper；H-083/H-084 / G-05 |
| `right-sidebar-tabs-store.ts` | hostSessionId-keyed document；H-022/H-029 / G-03 |
| `selection-preference.ts` | remembered selection 纯决策 + store；H-012–H-017 / G-05 |
| `settings-state.ts` | reducer requestId + single-flight coordinator；H-059–H-062 / G-01 |
| `sidebar-conversation-drafts.ts` | draftId-owned localStorage document；H-023/H-027；R-02 同会话子集已有局部保护，跨重启附件事实见 R-14 |
| `sidebar-preference.ts` | state + localStorage 同步 helper；H-082 / G-05 |
| `state-sync.ts` | selection / refresh lease / request coordinator / actions；H-018/H-037/H-057，原子导航缺口见 R-07 |
| `team-state.ts` | teamKey+memberSlug 纯状态转换；H-076–H-079，ownerless failures 见 R-10 |
| `use-managed-attachments.ts` | hook 内部 `drafts`、handles、revision、queue、current key；异步加载由 draft key + revision + AbortController 保护；按-key 窄查询只覆盖已进入 renderer record 的附件（R-02 部分保护），跨重启可见性与服务端清理分别见 R-14/R-15 |

## `02c1604^` 回溯自校验

不读取归档结论时，同一方法能从历史快照捞出已知缺陷：

- 历史 composer 只有裸 `composerValue`，声明于 `02c1604^:desktop/src/console-page/app.tsx:699–700`，没有 session owner。
- 展示目标在点击时先由 `setComposerValue` 切到 B（历史 `4389`），但输入持久化 owner 仍读取 `selectionRef.current.sessionId`（历史 `4278–4280`）。
- selection 直到 `transitionSessionView(...).finally(...)` 后才提交（历史 `4394–4396`；sidebar-origin 分支为 `4375–4377`），因此 Promise 窗口内展示 B、写入 A 是源码必然组合。
- selection effect 随后又从目标 key 回读并覆盖 composer（历史 `2413`），发送 callback 也捕获未带 owner 的正文。

同一方法得到的不变量是：“若 composer 正文展示为会话 B 的草稿，则正文持久化与发送目标必须都属于 B。”反例时序、用户后果（串草稿 / 清空 / 错会话发送）和动作类型“显式化”均在查看归档方案前成立。当前实现的 `ConversationComposerDraftState.key`、同步 ref、submission guard 与 FIFO 已在 H-049–H-054 登记为 G-01，不重复列为开放风险。

## 可提升为系统级不变量的候选

本轮不修改 `docs/architecture/invariants.md`。以下仅建议未来经人类裁决后提升：

- **候选 V2：迟到异步结果不得夺取用户已经切换的现场。** R-04、R-05、R-06、R-07 共享同一故障类，横跨 route、selection、tabs 与 localStorage，已不再是单入口局部规则。
- **候选 S2：删除未发送内容前必须按被删除 owner 检查全部内容种类。** R-02 同时涉及正文、文本胶囊和托管附件；同一 renderer 生命周期内已有局部保护，但 R-14 证明跨重启附件事实仍未进入 owner 模型，该规则是否提升为系统级不变量仍需人类裁决。

## 限制与未验证项

- 原审计没有运行 Electron 或组件测试；所有“未证伪的可能性”仍需要后续独立 change 先验证入口是否能在窗口内并发。R-02 同会话子集另有 `fix-inactive-analysis-draft-close-confirmation` 的纯逻辑、renderer 与真机证据；这些证据不覆盖 R-14 的重启窗口，也不外推到其他条目。
- **未验证观察**：归档入口 `removeSession`（`app.tsx:3070/4493`）会删除宿主会话的 draft tabs，但没有同步删除 sidebar conversation draft store 本体；草稿内容未由该路径删除，但标签消失后的可找回路径尚未验证。本项形状不同且归档自身通常有确认，本轮不评分、不并入 R-02/R-14/R-15。
- 动态 callback 是否被 console-ui 在 busy 状态禁用，只作为触发性评分依据，不用展示禁用替代 app handler 的 correctness guard。
- 行号以 `cf85d0b` 为准；后续代码变化必须重建 86-hook / 22-effect 基线。
- 未发现需要修改当前 PRD、spec、ADR 或 module import 边界的事实；除 R-02 标注的已验证局部保护外，本文仍是候选审计，不是已实现行为事实源。
