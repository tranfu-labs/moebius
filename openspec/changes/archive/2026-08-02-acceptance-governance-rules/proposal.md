# 提案：acceptance-governance-rules

## 背景
里程碑 2 T5 要补上里程碑 1 T4 暴露的治理缺口：验收语句是需求侧资产，而不是执行方为了闭环可以自行调整的实现细节。当前仓库已经有 `docs/protocols/github-interaction.md` 作为 GitHub issue 共享时间线协议事实源，也已有 dev 输出验收语句、qa 增补验收语句、product-manager / hermes-user 逐条验收、CEO 阶段回流这些机制。

缺口在于：协议和 persona 还没有明确规定验收语句变更、范围 rescope、验收结论 override 必须由需求持有者或用户确认，并且确认记录必须出现在 issue 时间线。这样会让执行方或 loop watcher 可能在长链路协作中偷换验收标准，形成“看似通过、实际失真”的结果。

## 提案
新增验收治理规则，范围限定为协议、persona 和 OpenSpec 规格，不改运行时代码：

1. 在 `docs/protocols/github-interaction.md` 新增“验收治理”小节，声明验收语句和经确认并入的 QA 增补验收语句均为需求侧资产；任何变更、缩小范围、扩大范围后自判通过、或覆盖验收角色不通过结论，必须由需求持有者或真人用户明确确认。
2. 明确确认必须落在 issue 时间线，且至少能看出谁确认、确认了什么变更、适用于哪组验收语句或哪次验收结论；沉默、继续执行、执行方自述、执行方转述或 loop watcher 代述都不能视为确认。
3. 在 `agents/ceo.md` 增加识别规则：发现未经确认的验收语句变更、rescope、自判通过或 override 时，CEO 只 append 要求补确认或请需求持有者表态，不直接替需求持有者改写新验收语句，避免 CEO 自身成为新的 override 来源。
4. 在 `agents/dev.md`、`agents/product-manager.md`、`agents/hermes-user.md`、`agents/qa.md` 做最小职责补充：persona 引用协议事实源，dev 不得自行 rescope；验收角色只按已确认清单验收；qa 增补是测试设计建议，只有需求持有者或用户确认后才并入清单。
5. 同步 `openspec/specs/github-issue-runner/spec.md` 的 delta，新增治理行为规则与 CEO 介入场景。

## 影响
受影响文件：

- `docs/protocols/github-interaction.md`
- `agents/ceo.md`
- `agents/dev.md`
- `agents/product-manager.md`
- `agents/hermes-user.md`
- `agents/qa.md`
- `openspec/specs/github-issue-runner/spec.md`（通过本 change 的 spec delta，归档时合入）
- `docs/roadmap/milestone-2-stability-oracle.md`（实现验收完成后追记 T5 证据并勾选）

不改运行时代码，不修改 `src/`，不新增触发器、状态文件或 CEO adapter 能力。CEO 的识别和输出仍由 `agents/ceo.md` persona 承载，`src/format-ceo.ts` 只保留既有 JSON 格式校验边界。
