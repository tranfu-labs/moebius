# 设计：fix-inactive-analysis-draft-close-confirmation

## PRD 边界结论

本次对象受 `docs/product/pages/main-right-sidebar.md#关闭标签` 覆盖，不是 PRD 缺口：

1. `#标签条` 把分析入口首次发送前的对象称为“分析入口产生的未发送草稿”；
2. `#页面状态` 单列“分析新对话·未发送”，其可用操作明确包含关闭标签；
3. `openspec/specs/console-ui/spec.md` 的“消息与对话分析入口使用同一生产会话组合”要求它复用右侧栏普通新对话及普通附件；
4. `#分析对话标签与跨树路由` 的“关闭分析对话标签只关闭视图”描述的是已创建分析对话，不覆盖仍未发送的草稿；
5. `#指标与验收` 的验收 34 明确要求普通附件触发丢弃确认，取消后内容和焦点不变。因此未发送分析草稿适用“以关闭瞬间的最终草稿判断”。

不新增“分析专用”关闭规则；只是让现有通用规则按关闭目标而非当前活动目标执行。

## 不变量与提交顺序

- 若被关闭的分析草稿含正文、文本胶囊（代码字段 `textFragments`）或任一普通附件，则必须在删除标签、草稿或附件前得到用户确认。
- 若用户取消确认，则不存在草稿 store、附件 record 或 tabs state 被删除或清空的时刻；当前选中标签与关闭按钮焦点保持。
- 若关闭目标是草稿 A，则附件事实必须从 A 的 `attachmentDraftKey` 读取；当前活动草稿 B 的 key 或附件数不得参与 A 的判定。
- pending、failed、ready 都是仍存在于最终草稿中的普通附件；确认判定只看目标 key 下是否存在附件，不把上传状态当成“无附件”。

关闭回调的顺序固定为：解析目标 tab → 读取目标 draft → 按目标 attachment key 查询 → 调纯函数 → 必要时确认 → 仅在无需确认或确认接受后执行既有 remove / list refresh / clear。取消路径在第一笔 mutation 前返回。

## 方案

### 1. 在草稿纯模块集中关闭判定

在 `desktop/src/console-page/sidebar-conversation-drafts.ts` 增加 `sidebarConversationDraftRequiresDiscardConfirmation(draft, hasAttachments)`（实现时可在不改变语义的前提下微调命名）。它复用现有 `sidebarConversationDraftHasUserChanges(draft)`，并把目标附件 boolean 纳入同一个 OR 判定。

该函数只接收普通数据，不读取 storage 或 hook，不调用 UI。`desktop/tests/sidebar-conversation-drafts.test.ts` 直接覆盖：默认草稿且无附件为 false；只含附件为 true；正文 / 文本胶囊 / 最终 context 变化仍为 true；附件从有变无且其他字段恢复默认后为 false。参数化合并同一分支，不新增镜像文案断言。

### 2. 附件 hook 暴露按 key 的窄查询

`useManagedAttachmentDrafts` 返回一个稳定的 `hasDraftAttachments(draftKey)` 查询。它从 hook 现有 `draftsRef.current[draftKey]` 同步读取并只返回 boolean：

- 不返回整张 keyed record，避免页面获得与当前展示无关的可变集合；
- 不复制 attachment count 到第二份 React state，避免新增同步不变量；
- 使用现有 ref 读取最新 render 已提交的 record，使关闭事件不依赖创建回调时的活动 key 或旧 `drafts` 闭包；
- 对目标 key 下任意 attachment item 返回 true，不按 pending / failed / ready 过滤。

现有 `attachments` 当前-key 投影、上传、恢复、重试、remove、`clearDraft(draftKey)` 与预览 URL 生命周期均保持不变。

### 3. 页面只编排目标身份、确认与既有清理

`app.tsx` 的 `onBeforeCloseRightSidebarTab` 保留现有 tab locator 与 draft store 读取。删除 `activeSidebarConversationDraftId === draft.draftId` 条件，改为用 `draft.attachmentDraftKey` 调用按-key 查询，再把目标草稿和 boolean 交给纯判定函数。

页面不自行重新拼正文 / 片段 / context 条件，也不读取 hook 内部 record。`window.confirm` 仍只由页面调用；纯模块不知道文案或浏览器。取消后立即返回 false，既有 tabs 组件因此不提交 close state；草稿 remove 与附件 clear 仍只在确认接受或空草稿时执行。

### 4. 审计清单回写部分保护与剩余风险

实现与验证完成后更新 `docs/architecture/console-state-composition-audit.md`：

- R-02 保留分数、无条件不变量与原反例，判定性质改为“已确认缺陷（部分消解）”；
- 标注 change id、纯判定函数、按-key 查询、页面接线与测试坐标，并明确它们只覆盖附件事实已进入 renderer keyed record 的同会话子集；
- 把重启后未激活草稿的附件不可见与 `clearDraft` 不删除服务端附件分别登记为 R-14、R-15，撤销原先过度声明的 G-07；
- 同步结论、计数、排序与邻近文件说明，不改 R-08 或其余 11 条既有候选的内容与分数。

## 现有方案调研

本题判为 C 型退化：内部 keyed state 与页面用例边界错位，导致同一类状态的公开面不足；不需要外部依赖。

- **候选 A（采用）· 窄按-key boolean 查询 + 纯判定函数**：只暴露关闭用例需要的事实，保持附件 record 单一事实源；页面只负责确认与 mutation 编排。代价是 hook 多一个公开方法，但它有明确用例和 renderer 回归。
- **候选 B · 暴露完整 `attachmentsByDraftKey` record**：页面可直接索引，也能修缺陷；但把所有草稿附件和 item 结构扩散到页面，增加无关重渲染与误写 / 误用表面积，超过关闭用例所需。
- **候选 C · 在 App 另存 `draftKey → attachmentCount`**：不扩 hook API；但产生第二事实源，每次 add / restore / retry / remove / clear 都要同步，重新制造本轮要消除的跨状态不变量。
- **基线候选（维持现状）**：非当前仅附件草稿继续绕过确认并静默丢失用户现场，不满足 PRD 与 R-02 不变量。
- **结论**：采用候选 A；它是最小公开面，也让确认规则可脱离 UI 单测。候选 B / C 不提供额外验收价值。

## 测试设计

### 纯逻辑护栏

扩充既有 `desktop/tests/sidebar-conversation-drafts.test.ts`，直接测试纯判定。用例只断言 boolean 外部行为，不读取源码、PRD、配置或文案；与现有 `sidebarConversationDraftHasUserChanges` 同分支的参数化项合并，避免重复存在性断言。

### Renderer 接缝回归

扩充既有 `desktop/tests/console-app-sidebar-conversation-regressions.test.tsx`，复用 jsdom App 内存 harness，不启动 Electron、不建 SQLite、不读写 JSONL，也不增加真实网络等待：

1. 建立分析草稿 A、B，A 没有正文 / 文本胶囊 / context 变化，只有一个普通附件；A 初始活动以便附件通过可控异步 fetch 进入 hook keyed record。
2. 让 A 的附件读取延迟完成，期间触发既有父级状态刷新；完成后切到 B，使 App / hook 重渲染并更换页面回调身份。B 的附件读取走失败替身并产生既有错误反馈，证明失败返回不会清掉 A 已提交的 keyed record。
3. 在 B 仍为活动标签时点击 A 的关闭按钮，`window.confirm` 第一次返回 false；断言确认被调用一次，A/B 标签都仍存在、B 仍选中，焦点仍在 A 的关闭按钮。再选择 A，附件卡仍可见。
4. 再切回 B，第二次关闭 A 时让确认返回 true；断言 A 消失、B 保持选中且没有误清 B。该阶段覆盖确认后的既有恢复路径，不额外冻结确认文案。

该单一 renderer 场景同时覆盖用户给出的最短反例、父级重渲染、callback identity 变化、慢成功与失败异步返回、取消和确认两个外部结果。若现有 harness 无法在不引入测试专用生产 API 的前提下精确控制两次附件读取，允许把“hook 的慢 / 失败 + rerender”拆成同文件的一个窄 harness 用例，但不得降级成只测稳定引用 happy path，也不得使用真实 I/O 或固定 sleep。

### 测试剪枝

实现时核对现有关闭 / 草稿测试。若新纯函数用例与旧 `sidebarConversationDraftHasUserChanges` 某条完全重复同一分支，则合并为一组边界值并在交付说明列出；不把旧断言改成复述新实现来“修绿”。当前没有已知必须删除的测试。

## 验证与收口

- 定向测试：`pnpm --filter @moebius/desktop exec vitest run tests/sidebar-conversation-drafts.test.ts tests/console-app-sidebar-conversation-regressions.test.tsx --maxWorkers=1 --no-file-parallelism`。
- 迭代收口：先确认 `78adb95` 是当前分支祖先，再运行 `pnpm run test --scope 78adb95`；记录命令报告的受影响文件数，若为 0 视为假绿并停止声明验证。
- 静态与构建：`pnpm typecheck`、`pnpm --filter @moebius/desktop build`。仓库无 lint 命令，如实登记未配置。
- 完整 `pnpm test` 不在开发 / 复核前运行；只在 QA / 主理人复核通过后、合并点由主理人点名时运行一次。
- 用户可见行为必须由真实 Electron 复核，下面语句是 code-verified 的必要证据，单测与构建不能抵扣。

## 真机验收语句

1. **非当前仅附件分析草稿取消关闭**：入口为真实 Electron 主对话的右侧栏，从分析入口打开草稿 A，只通过附件入口加入一个普通文件且正文为空；再打开 / 切到草稿 B。操作为在 B 保持选中时点击 A 的关闭按钮并在丢弃确认中选择取消。**主证据**是丢弃确认弹窗确实出现；辅证是取消后 A、B 两个标签仍在，B 仍为选中内容，键盘焦点返回 A 的关闭按钮，重新选择 A 后原附件卡仍可见且无需重新选择文件。
2. **确认只丢弃目标草稿**：沿用同一入口，再切回 B，关闭 A 并接受丢弃。可断言信号：A 标签消失，B 标签、B 内容、B 的草稿与选中态保持；若 A 是最后一个标签，则只在裁决完成后按既有规则关闭右侧栏，不在确认前改变现场。
3. **空的非当前分析草稿直接关闭**：入口为右侧栏草稿 A、B，A 的正文、文本胶囊、附件和最终上下文都等于初始值，B 处于选中。操作为点击 A 的关闭按钮。可断言信号：不出现丢弃确认，A 关闭，B 的内容、选中态与焦点规则保持。

每条记录环境、入口、操作、屏幕观察和与承诺是否一致；附件必须从真实 UI 添加，不通过 API / localStorage 预置。验收后清理临时草稿与附件现场。

## 方案验收清单

- [x] 范围只包含 R-02；没有修改 R-08、迟到提交族、页面结构或其他关闭规则。
- [x] proposal 明确回答 PRD 覆盖分析草稿 tab，并以 `#标签条`、`#关闭标签`、`#分析对话标签与跨树路由`、`#页面状态` 和验收 34 的对象边界为依据，不存在未采访的产品假设。
- [x] 关闭判定是可脱离 React / Electron / storage / 网络 / SQLite / JSONL 测试的纯函数。
- [x] 附件公开面按目标 draft key 查询且只返回所需事实，不暴露完整 record、不复制第二份计数状态。
- [x] 取消确认发生在任何草稿、附件或 tabs mutation 前；确认与空草稿继续沿用既有清理顺序。
- [x] pending / failed / ready 附件均算“存在普通附件”，当前活动 draft 身份不参与目标判定。
- [x] 单元测试覆盖纯规则边界且不写镜像测试；renderer 回归覆盖非当前 A、父级重渲染、callback identity 变化、慢 / 失败异步返回、取消保留与确认后只清目标。
- [x] renderer 回归复用内存 harness，不新增真实 I/O、真实进程、固定 sleep 或生产 test hook。
- [x] 三条真机语句都写明页面入口和可断言信号；第一条完整覆盖用户指定的 A 附件 → B → 关闭 A → 取消时序。
- [x] 审计文档把 R-02 更新为“已确认缺陷（部分消解）”，标注 change / 代码 / 测试坐标与覆盖子集；R-14/R-15 独立登记，G-07 撤销，其他既有候选结论不变。
- [x] `pnpm run test --scope 78adb95` 报告受影响文件数非零，定向测试、typecheck、Desktop build 均通过；完整闸门留到主理人点名的合并点。
- [x] 实现符合度反思确认没有 PRD / spec / module-map / ADR 事实漂移，并列出测试合并 / 删除情况或明确无需剪枝。

## 风险与回滚

- **读取时点**：按-key 查询若捕获旧 `drafts` 会在切换后复现缺陷；使用同步维护的现有 ref，并以 rerender / identity 回归证明事件读取最新值。
- **异步失败误清**：B 的加载失败不得删除 A 已有 record；renderer 测试把失败放在切换后，断言 A 仍触发确认。
- **范围外持久附件清理**：本 change 不改变 `clearDraft` 的服务端清理语义、上传队列或预览 URL 生命周期；发现相关问题只登记到审计限制节，不顺手修。
- **回滚**：页面接线、hook 查询和纯函数是同一小闭环；若回归，整体回滚该闭环即可恢复原行为，不涉及 schema、持久化迁移或外部 API。
