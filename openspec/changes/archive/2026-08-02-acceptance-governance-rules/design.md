# 设计：acceptance-governance-rules

## 方案

### 1. 协议事实源新增“验收治理”
在 `docs/protocols/github-interaction.md` 的规则总览中新增第 6 条，并在验收截图契约之后新增“验收治理”小节。该小节作为单一事实源，覆盖：

- 验收语句包括原始 issue / 需求中给出的验收语句，以及经需求持有者或用户确认并入的 QA 增补验收语句。
- 验收语句变更、缩小验收范围、扩大范围后自判通过、覆盖验收角色不通过结论，都必须由需求持有者或真人用户确认后生效。
- 有效确认必须清晰落在 issue 时间线，至少表达“谁确认、确认什么变更、适用于哪组验收语句或哪次结论”。
- 沉默、继续执行、执行方自述、执行方转述、loop watcher 代述都不是确认。
- CEO / 执行方 / loop watcher 不得直接替需求持有者改写新验收语句；只能要求补确认或请需求持有者表态。

协议小节需要保留 T2 风格：提供正例、反例和合规改写，避免 persona 各自复制长规则。

### 2. CEO 增加 append-only 介入规则
在 `agents/ceo.md` 的业务场景中新增“验收治理违规”场景，优先识别以下四类：

1. 执行方或 loop watcher 未经确认改写验收语句。
2. 未经确认缩小验收范围。
3. 未经确认扩大验收范围后自判通过。
4. 覆盖 product-manager / hermes-user 等验收角色的不通过结论。

CEO 介入方式保持 append-only：输出 `{"action":"append","as":"ceo","body":"..."}`，正文最多一个合法 mention，优先 mention 显式需求持有者；若无法识别需求持有者且只有真人用户，则不强行 mention 不存在对象，正文要求真人用户或需求持有者补确认。

CEO 正文只要求补确认或表态，不替需求侧写新验收语句，不直接把 override 判为有效。

### 3. Persona 最小补充
`agents/dev.md` 在“plan-written 方案验收语句要求”附近补充：

- 用户已给验收语句时默认沿用；任何细化只能让其更机械可执行，并说明细化理由。
- 不得自行改变验收目标、删减范围、合并或替换验收语句；确需调整时必须请需求持有者或用户在时间线确认。
- 实现阶段只能基于已确认清单和已确认的 QA 增补执行。

`agents/product-manager.md` 与 `agents/hermes-user.md` 在“验收职责”补充：

- 只按已确认验收语句和已确认并入的 QA 增补逐条验收。
- 若发现执行方或 watcher 改写 / rescope / override，应指出未经确认并要求回到需求持有者或用户确认。
- 自身作为需求持有者调整验收语句时，也必须明确写出确认记录。

`agents/qa.md` 在“验收语句增补 delta”或 mention 协议附近补充：

- QA 增补是测试设计建议；通过交棒时必须标注增补部分。
- QA 增补只有在需求持有者或用户明确接受后才并入验收清单。

### 4. OpenSpec delta
在 `spec-delta/github-issue-runner/spec.md` 新增行为规则与场景，归档时合入 `openspec/specs/github-issue-runner/spec.md`：

- 协议必须覆盖验收治理规则。
- persona 必须只做最小引用 / 职责补充。
- CEO 必须识别未经确认的验收语句变更和验收结论 override，并要求需求持有者或用户确认。
- QA 增补确认后才成为需求侧资产。

### 5. 验证策略
本 change 不改运行时代码，所以不新增单元测试。实现阶段验证使用文档与 persona 的可执行检查：

- `rg` 检查协议和 persona 是否包含验收治理关键规则。
- 文本检查 `agents/ceo.md` 是否有 CEO append-only 介入规则，并且不要求 CEO 直接改写新验收语句。
- 构造一段执行方擅自改写验收语句并自判通过的时间线，按 `agents/ceo.md` 输出契约做 persona-level 校验：CEO 应 append 介入，指出变更未经确认并要求需求持有者表态。
- 覆盖 product-manager 已确认并入的 QA 增补场景：执行方转述“已确认”但时间线无确认记录、loop watcher 未经确认缩小范围、执行方未经确认扩大范围后自判通过、验收角色不通过后被 override、需求持有者明确确认的合法变更不被误拦，以及 `git diff --name-only` 不出现 `src/` 运行时代码路径。
- 运行 `git diff --check`；如改动不触碰 TypeScript，`pnpm test` / `pnpm typecheck` 可作为可选回归验证，不作为本纯文档 change 的必要门槛。

## 权衡
- 选择把完整规则放在 `docs/protocols/github-interaction.md`，persona 只最小引用和补职责，避免多处重复定义后漂移。
- 选择不改运行时代码，因为任务原文明确“不改运行时代码”，且当前 CEO 规则演化入口就是 persona 文本；这也避免把治理判据硬编码进 `src/format-ceo.ts`。
- 选择 CEO append-only 而非 replace，保留原违规评论作为审计证据，符合既有协议违规纠偏模式。
- 选择让 QA 增补“建议先行、确认后生效”，兼顾 QA 的对抗性测试设计价值和需求侧资产归属。

## 风险
- Persona-level CEO 识别依赖文本规则，不能像运行时测试一样完全确定；用明确示例和输出约束降低解释空间。
- 规则过严可能让合理的机械化细化看起来像 rescope；因此 dev 允许把用户原文细化为可机械执行版本，但必须说明细化理由，且不得改变验收目标。
- 若未来引入无 mention 路由或 loop watcher 自动补评论，本规则仍要求确认必须来自需求持有者或用户，不能由 watcher 代述；后续任务应继续引用本协议事实源。
