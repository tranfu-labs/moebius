# 设计：ceo-default-plan-chain

## 方案

### 1. bootstrap context 从“只能入账”改为“可路由”

保留 `resolveCeoLedgerPromptContext()` 的职责边界：它只判断当前 issue 是否有唯一 active ledger owner / active phase projection，不做自然语言拆分意图识别。无 active phase 时仍返回 bootstrap context，但 prompt 文案改为：

- 当前 issue 没有 active phase projection。
- 允许使用 `default-plan-chain` route workflow，把普通目标形状交给 `@dev` 走 OpenSpec 方案链。
- 允许使用 `goal-intake` workflow，但仅当公开时间线出现明确拆分 / 编排意图，或用户正在确认已有 goal-intake proposal。
- 继续禁止 `spawn_child_issues` / `roundtable`，因为 bootstrap 没有 visible task ids，TypeScript 对这些 action 仍应 fail-closed。

这样机制层只解锁“route 或 goal-intake”的合法动作集合，不把中文意图词硬编码进 TypeScript。

### 2. 新增 `default-plan-chain` CEO 剧本

在 `agents/ceo-scripts/default-plan-chain.md` 新增 `action: route` 剧本，正文固定表达：

- 使用场景：无 active ledger projection，最新用户请求是普通目标 / 实现 / 设计 / 怎么做类入口，且没有明确拆分 / 编排意图。
- 输出要求：CEO ordinary-agent JSON 使用 `action:"route"`、`workflowId:"default-plan-chain"`，`body` 只能包含一个合法 mention，目标为 `@dev`。
- handoff 内容：要求 dev 按 OpenSpec 流程先采访、再落盘方案；不要创建 ledger proposal 或 child issue。

同时把 `default-plan-chain` 加入 `REQUIRED_CEO_SCRIPT_IDS`，保证打包态或数据根缺文件时 fail-closed，而不是静默退回 goal-intake。

### 3. 收紧 `agents/ceo.md` 判据

调整两个位置：

1. 外部无 mention 兜底路由：目标形状 issue body / comment 仍可 append `@ceo` 来唤醒普通 CEO，但文本中明确说明这只是“让 CEO 裁决入口”，不是默认 goal-intake。
2. 普通 CEO 目标入账 workflow：把当前 “deterministic context 显示 intake bootstrap 时必须使用 goal-intake” 改为：
   - 无明确拆分 / 编排意图：使用 `default-plan-chain` route，交给 `@dev`。
   - 明确拆分 / 编排意图：使用 `goal-intake`。
   - 已有 goal-intake pending proposal 且用户确认：使用 `goal_intake.confirm`。

明确拆分 / 编排意图采用 product-manager 确认的最小口径：拆成多个任务、并行做、编排多个子任务、创建子 issue / 子任务、阶段化拆解并分派角色。普通目标形状如“我想做一个 X”“帮我实现 X”“帮我设计 X”“怎么做 X”默认不算。

### 4. TypeScript parser 保持窄校验

`parseCeoOrchestrationOutput()` 已允许 `route` action 在 `visibleTaskIds = []` 时通过，只校验 workflow id、单 mention 和白名单。实现阶段只补一条测试固定该行为：`default-plan-chain` route 在 bootstrap visibleTaskIds 为空时应通过，并且不会触发 child issue descriptor 校验。

### 5. spec-delta 与归档

新增两个 spec-delta：

- `github-issue-runner`：定义 bootstrap route / goal-intake 分流、默认方案链剧本、外部 no-mention 目标入口和普通 CEO bootstrap 的职责边界。
- `goal-ledger`：定义 plain goal bootstrap route 不写 ledger；goal-intake 相关 ledger admission 只在明确拆分 / 编排或用户确认 proposal 时发生。

归档时合入对应 `openspec/specs/*/spec.md`，不提前修改现状 spec。

### 6. 验证策略

单元测试与文本检查覆盖：

- `tests/runner.test.ts`：
  - 普通目标 body `我想做一个 X`、空 ledger、CEO 输出 `default-plan-chain` route 到 `@dev` 时，断言 runner 发布可见 CEO handoff，`createIssue` 未调用，goal ledger 写入 adapter 未调用，ledger 保持空。
  - 无 mention 普通目标 body `我想做一个 X` 第一轮 fallback 只追加 `@ceo` handoff；下一轮 CEO bootstrap 输出 `default-plan-chain` route 时，断言未执行 `goal_intake.propose`，未创建 child issue，未写 pending ledger。
  - 明确拆分 body `把这个拆成多个任务并行做`、空 ledger、CEO 输出 `goal_intake.interview` 或 `goal_intake.propose` 时，断言该路径不要求 `default-plan-chain`；若为 propose，只写 pending ledger，不创建 child issue。
- `tests/ceo-ledger-context.test.ts`：空账本 bootstrap context 不再包含 “only use goal-intake”，应包含 `default-plan-chain` 与 `goal-intake` 分流说明；仍包含禁止 `spawn_child_issues` / `roundtable` 的约束。
- `tests/ceo-scripts.test.ts`：required script ids 包含 `default-plan-chain`，且加载结果 action 为 `route`。
- `tests/ceo-orchestration.test.ts`：`default-plan-chain` route 在 `visibleTaskIds: []` 下可解析成功，body 只含 `@dev`。
- 文本检查：`agents/ceo.md` 包含“明确拆分 / 编排意图”的最小口径和普通目标默认方案链口径。
- 回归：运行 `pnpm test -- tests/runner.test.ts tests/ceo-ledger-context.test.ts tests/ceo-scripts.test.ts tests/ceo-orchestration.test.ts`，必要时运行 `pnpm test` 与 `pnpm typecheck`。

## 权衡

- 不在 `ceo-ledger-context.ts` 里做关键词识别：preScript 没有完整自然语言路由职责，且意图判定属于 CEO persona / 剧本事实源；硬编码会让判据难以演进。
- 新增 route 剧本而不是复用 `plan-review`：`plan-review` 是 `plan-written` 后派 qa 的阶段回流剧本；初始目标入口交给 dev 是另一条 workflow，复用会让审计和测试语义混淆。
- 不改变 external no-mention append 的机制：目标形状无 mention 仍可先 append `@ceo`，但普通 CEO 决策会把无拆分意图导向 `@dev`，从而不再拆子 issue。
- 不引入真实 GitHub 端到端测试：本轮质量基准是数据正确级，product-manager 已确认自动化验收以纯单元测试 / 纯函数测试为主；真实端到端会扩大范围并引入不稳定外部依赖。
- 增加 runner spy 测试而不做真实 GitHub 端到端：副作用边界属于 runner 编排契约，必须用注入 dependency spy 固定 `postComment` / `createIssue` / ledger write 行为；真实 GitHub e2e 仍不进入本轮范围。

## 风险

- Persona 判据仍依赖 CEO 模型理解，无法做到纯 TypeScript 完全决定；通过剧本文案、spec 场景和 prompt context 明确边界，降低误判。
- 新增 required CEO script 会让缺少该文件的数据根 fail-closed；这是期望行为，因为少了默认方案链剧本时静默运行会退回不稳定旧路径。
- 后续若要让 dev-manager 固定参与每个方案链，需要单独调整阶段回流或 roundtable 规则；本 T1 只恢复默认 `@dev -> plan-written -> @qa -> 需求持有者验收` 的现有治理链，不新增多角色圆桌。
