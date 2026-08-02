# 提案：roundtable-topology-t6

## 背景
M3 T6 要新增第二种会话拓扑，但 product-manager 已确认本轮正确问题不是先追求运行时并发吞吐，而是先验证“主持人圆桌”能否降低复杂 issue 中多角色评审 / 采访的人工路由成本，同时不破坏两个既有边界：

- 一个 issue = 一场对话。多方讨论落在独立子 issue，父 issue 只接收结论与 provenance。
- 每条消息最多一个合法 agent mention。v0 串行圆桌继续用单 mention 逐个移交；v1 多 agent fan-out 仅写设计/spec，不改默认触发协议。

现有能力已经具备 v0 的基础：CEO 可作为普通 agent 运行，剧本库可声明 workflow，runner 可受控创建 / 找回子 issue，role thread 已按 issue + role 独立，qa、hermes-user 和 product-manager 已有 `read-run` workspaceAccess，dev-manager 不写代码。缺口在于：CEO 编排只有 `route` 与 `spawn_child_issues`，没有“创建圆桌 issue、按固定参与者逐个发言、收口并回流父 issue”的受控 workflow。

## 提案
新增 v0 串行主持人圆桌能力，范围限定为 CEO 剧本 workflow + runner 受控副作用：

1. 新增 CEO 剧本 `roundtable-plan-review`，action 为 `roundtable`，用于 dogfood 场景“方案评审团”：qa、dev-manager、hermes-user 依次评审 dev 方案，CEO 汇总。
2. 扩展 CEO 剧本 loader 与 `ceo-orchestration` 解析器，支持结构化 `roundtable` action。该 action 分为 `start`、`route`、`complete` 三个 mode：父 issue 启动圆桌、子 issue 内逐个移交、全部参与者发言后完成汇总。
3. runner 为 `roundtable.start` 创建或按 hidden roundtable key 找回同仓库子 issue；子 issue body 必须包含 parent reference、workflow id、roundtable key、主持人、参与角色顺序、主题、输入材料、固定一轮规则、下一步初始 handoff 和 provenance。
4. runner 为 `roundtable.route` 只在当前圆桌子 issue 内发布下一位参与者的 handoff 评论，并校验正文恰好含一个合法 mention，且目标是参与者列表中的下一位未发言角色；handoff 文案由 runner 强制包含“发言后回交 CEO”的裸写指令。
5. runner 在 roundtable child issue 的 no-trigger 分支识别“参与者已发言但未回交 CEO”的卡住状态，发布一条可见 recovery 评论唤醒 CEO，避免 child issue 静默停住。
6. runner 为 `roundtable.complete` 校验固定参与者均已在圆桌 issue 中发言，且 CEO 输出的汇总按角色保留观点、依据与分歧；随后把带 hidden completion key 的汇总结论回流父 issue，并在子 issue 留下完成说明。completion key 不包含 CEO summary wording，确保父回流成功后即使收尾失败重试也不重复刷父 issue。
7. roundtable provenance 只复用既有 child issue body、CEO 输出、父 issue 汇总与 task child ref bounded note；不新增 goal-ledger schema 字段，不复用 T4 child pass integration join 数据结构。
8. v0 不改变现有 `plan-written` 的 qa 审查治理链路；圆桌是可 dogfood 的新增 workflow，不自动替代所有方案阶段回流。
9. v1 fan-out + join 原语只写入 design/spec 的后续进入条件：只有 v0 dogfood 证明圆桌模式有价值，再实现“一条消息触发 N 个 agent + join 唤醒收口角色”的运行时代码。

## 影响
受影响模块与文件：

- `agents/ceo-scripts/`：新增 `roundtable-plan-review.md`。
- `agents/ceo.md`：补充普通 CEO agent 对 roundtable workflow 的识别与输出约束；guardrail 阶段回流规则保持不变。
- `src/ceo-scripts.ts`：新增 `roundtable` action 与 required workflow。
- `src/ceo-orchestration.ts`：新增 roundtable structured output parser、hidden key builder、子 issue body renderer、汇总 renderer 与单 mention / contribution 校验。
- `src/runner.ts`：在 CEO agent 编排路径中新增 roundtable start / route / complete 的受控副作用、no-handoff recovery、父 issue 回流、失败可见留痕和幂等查重。
- `tests/`：补齐 CEO 剧本加载、roundtable parser、runner 父子 issue 副作用、协议合规、失败路径与 v1 非执行边界测试。
- `openspec/specs/github-issue-runner/spec.md` 与 `openspec/specs/goal-ledger/spec.md`：通过本 change 的 spec delta 记录 v0 行为与 ledger 非目标边界。
- `docs/protocols/github-interaction.md`、`docs/architecture/module-map.md`、`AGENTS.md`、`docs/roadmap/milestone-3-orchestration.md`：实现和归档时同步事实源与 T6 验收证据。

明确不做：观察页升级、goal-intake、人工 dogfood 扩展、视觉对照 dogfood、默认多 mention 协议改造、运行时 fan-out + join 原语、独立 `moderator` agent、goal-ledger roundtable schema。
