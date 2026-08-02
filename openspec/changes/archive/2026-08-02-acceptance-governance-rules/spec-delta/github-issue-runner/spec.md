# github-issue-runner spec delta：acceptance-governance-rules

## 新增行为规则

- MUST 让 `docs/protocols/github-interaction.md` 的全局 GitHub 交互协议覆盖验收治理规则：验收语句是需求侧资产，包含原始需求验收语句以及经需求持有者或真人用户确认并入的 QA 增补验收语句。
- MUST 要求验收语句变更、验收范围缩小、验收范围扩大后自判通过、或覆盖验收角色不通过结论，只有在需求持有者或真人用户明确确认后才生效。
- MUST 要求确认记录出现在 GitHub issue 时间线，且能让后来者直接看出谁确认、确认什么变更、适用于哪组验收语句或哪次验收结论。
- MUST NOT 把沉默、继续执行、执行方自述、执行方转述或 loop watcher 代述视为验收语句变更或验收结论 override 的有效确认。
- MUST 让 `agents/ceo.md` 承载验收治理违规识别场景：发现执行方或 loop watcher 未经确认改写验收语句、缩小验收范围、扩大验收范围后自判通过、未经确认把 QA 增补当作已生效清单、声称已确认但时间线没有可追溯确认记录、或覆盖验收角色不通过结论时，CEO MUST 输出 `append`、`as=ceo`，指出变更未经确认，并要求需求持有者或真人用户表态。
- MUST 让 CEO 在验收治理违规场景中只要求补确认或请需求持有者表态，MUST NOT 直接替需求持有者改写新验收语句，MUST NOT 直接宣布未经确认的 override 生效。需求持有者或真人用户已在时间线明确确认且记录可追溯时，CEO MUST NOT 仅因该变更本身介入。
- MUST 让 `agents/dev.md` 要求 dev 在已有验收语句上只做机械可执行化细化并说明理由；dev MUST NOT 自行改变验收目标、删减范围、合并或替换验收语句。确需调整时，dev MUST 请求需求持有者或真人用户在 issue 时间线确认。
- MUST 让 `agents/product-manager.md` 与 `agents/hermes-user.md` 在验收方案或代码结果时只按已确认验收语句、以及已确认并入的 QA 增补验收语句逐条走查；发现未经确认的 rescope 或 override 时，MUST 明确指出未经确认并要求回到需求持有者或真人用户确认。
- MUST 让 `agents/qa.md` 明确 QA 增补验收语句属于测试设计建议；qa 通过交棒时 MUST 标注增补部分，且增补只有经需求持有者或真人用户明确接受后才并入验收清单。
- MUST 让所有相关 persona 对验收治理只做最小职责补充，并继续以 `docs/protocols/github-interaction.md` 作为规则事实源，MUST NOT 复制完整协议造成多事实源。

## 新增场景

### 场景 T5.1：协议与 persona 包含验收治理规则
Given 开发者打开 `docs/protocols/github-interaction.md`
Then 文档包含验收语句变更须由需求持有者或真人用户确认的规则
And 文档说明确认记录必须清晰落在 issue 时间线
And 文档说明沉默、继续执行、执行方自述、执行方转述、loop watcher 代述都不是有效确认
And 开发者打开 `agents/ceo.md`、`agents/dev.md`、`agents/product-manager.md`、`agents/hermes-user.md`、`agents/qa.md`
Then persona 包含各自对验收治理的最小职责补充

### 场景 T5.2：CEO 介入未经确认的验收语句改写与自判通过
Given 完整公开 issue context 中原始验收语句为“打开协议 / persona 文件 → 应看到验收语句变更须需求持有者或用户确认”
And 需求持有者是 `product-manager`
And `dev` 或 loop watcher 的最新响应把该验收语句改写为“打开协议文件即可”
And 同一响应基于改写后的语句自判通过
And issue 时间线中没有 product-manager 或真人用户对该改写的明确确认
When CEO guardrail 处理该响应
Then CEO 输出 `append`、`as=ceo`
And append 正文指出验收语句变更未经需求持有者或用户确认
And append 正文要求 `@product-manager` 表态是否接受该变更
And CEO MUST NOT 直接替 product-manager 改写新验收语句

### 场景 T5.2.1：转述确认但时间线无确认记录时 CEO 介入
Given 执行方声称“已确认调整验收语句”
And 完整 issue 时间线中没有需求持有者或真人用户对该调整的明确确认记录
When CEO guardrail 处理该响应
Then CEO 输出 `append`、`as=ceo`
And append 正文指出确认记录不可追溯
And append 正文要求需求持有者或真人用户表态

### 场景 T5.2.2：未经确认扩大验收范围后自判通过时 CEO 介入
Given 执行方未经确认新增一条验收语句
And 执行方基于新增后的清单声明全部通过
When CEO guardrail 处理该响应
Then CEO 输出 `append`、`as=ceo`
And append 正文指出新增验收语句未经确认
And append 正文要求需求持有者表态

### 场景 T5.3：已确认的 QA 增补并入验收清单
Given qa 对 dev 方案输出 `QA 结论：通过`
And qa 正文标注 1 条验收语句增补
And product-manager 随后在 issue 时间线明确写出“接受 qa 增补的验收语句……”
When 后续验收角色按验收语句逐条验收
Then 该 QA 增补视为已确认验收语句
And 验收角色 MUST 对该增补输出通过 / 不通过结论与依据

### 场景 T5.4：未确认的 QA 增补不能被执行方直接当作生效清单
Given qa 对 dev 方案输出 1 条验收语句增补
And issue 时间线中没有需求持有者或用户明确接受该增补
When dev 在实现或 code-verified 回复中把该增补作为已生效验收清单并自判通过
Then CEO MUST 输出 `append`、`as=ceo`
And append 正文要求需求持有者或用户确认是否接受该 QA 增补

### 场景 T5.5：覆盖验收角色不通过结论需要确认
Given product-manager 按已确认验收语句输出某条 `不通过` 结论
And dev 或 loop watcher 后续声明“本次 override 该不通过结论，视为通过”
And issue 时间线中没有 product-manager 或真人用户对该 override 的明确确认
When CEO guardrail 处理该响应
Then CEO 输出 `append`、`as=ceo`
And append 正文指出 override 未经需求持有者或用户确认
And append 正文要求需求持有者或用户明确表态

### 场景 T5.6：需求持有者主动调整但仍需时间线记录
Given product-manager 是本需求持有者
When product-manager 在 issue 时间线明确写出“确认调整验收语句为……”
Then 后续 dev 与验收角色可以基于调整后的验收语句推进
And 该确认记录本身必须保留在 issue 时间线，不能只由 dev 或 loop watcher 转述

### 场景 T5.7：验收治理规则不改运行时代码路径
Given 本次变更只要求协议、persona 与 OpenSpec 事实源更新
When 实现完成后运行 `git diff --name-only`
Then 输出中不包含 `src/` 运行时代码路径
