# Runner token 成本备忘

本文件记录 runner 驱动 codex 时的 token 消耗观察与**未实施的**优化候选。不是决策，也不是排期任务；作为下次讨论 runner 提速 / 降本时的参考。

当前约束：ADR-0008 已取代 ADR-0007。Desktop 持久 Agent 现在首次创建 provider session，后续强制 resume；local 通过 per-Agent 公开时间线 cursor 补齐其他成员产生的新事实。下列 2026-07-23 数据是全量重建时期的历史基线，不再描述当前执行模式；候选若要实施，必须证明不会重复注入 provider session 已有上下文。

## 观察（2026-07-23 一次会话样本）

- **会话形态**：dev-manager 调度 5 次 + dev 落地 5 次 + qa 复核 4 次，共 14 个 codex run。
- **当时每个 run 都是新的 codex thread**（thread_id 全不同），符合已被取代的 ADR-0007。
- **API 等价费用**：约 $31.5 / 会话（gpt-5.6-sol / reasoning=high，短上下文 $5/M input、$0.5/M cached、$30/M output）。实际付 $0：走 ChatGPT/Codex 订阅池，参见私域运维记录 `codex-model-quota-policy`。
- **两层膨胀**：
  1. **within-run**：单个 run 内每次 LLM 调用把全部历史回喂，膨胀比 14-31×。90% 走 prompt cache，属 codex + prompt cache 的正常工作机制。
  2. **cross-run**：dev↔qa 交棒时下一个 run 读的文件里 55-80% 是刚才另一个 agent 已经读过的。会话内独立文件 63 个，被读 149 次，平均 2.4×。这是旧全量重建模式的历史代价；当前同一 Agent 的后续轮次由 resume 保留私有执行上下文。

## 跨 run 反复重读的核心文档

以本次会话为样本，8 个 run 里被同一批 codex 会话重扫的文件：

- `docs/architecture/module-map.md`
- `openspec-driven-development/SKILL.md`（skill 侧）
- `server/AGENTS.md`、`AGENTS.md`、`openspec/changes/AGENTS.md`
- `openspec/specs/board/spec.md`、`openspec/specs/ingest/spec.md`
- 若干 `docs/adr/*.md`

上述文件的共同特征：**新会话冷启动时的"定向文档"**，内容稳定、每次都要看、大小可控（大多 100-600 行）。

## 优化候选（未实施）

### 候选 A：dev-manager 交棒时附上取证摘要

由 dev-manager（或 dev 收尾时）在时间线正文里列出本轮读过的关键文件路径 + 行号 + 已确认结论，qa 从时间线拿到这份"取证包"直接看，不做全局 rg。

- 与 ADR-0008 的公开事实边界一致：**跨 Agent 的可共享结论仍应进入时间线**，不能只留在 provider 私有上下文。
- 只需改角色 prompt / skill 文本，runner 不动。
- 预期收益：qa 冷启动的重探索显著变窄。按本次样本估算，每次交棒少 30-60K fresh input，累计每会话 $1-2。
- 风险：取证包写得草率或过量，反而挤占时间线预算；需在角色 prompt 层给出格式与上限。

### 候选 B：稳定的"项目 pod"注入 codex system prompt

把上述定向文档打包成一个稳定的项目 pod，作为 codex system prompt 的固定前缀注入，不再依赖每个新会话现场 `sed` 拉取。

- 在 ADR-0008 下不再天然正交：pod 若在每次 resume 时重复注入，会浪费上下文并可能与 provider session 中的旧版本冲突；只有 provider/CLI 提供可验证的稳定 system prompt 契约时才可重启评估。
- 预期收益：每次交棒 60-100K fresh input 省去，5 次交棒累计 400-500K；前缀稳定 → prompt cache 跨 session 命中率进一步上升；少跑一批 `sed` / `rg`，附带省一部分 reasoning。**合计每会话约 $3-5**（当前 $31.5 的 10-15%）。
- 未做的原因：
  - 需要 runner 层改动（system prompt 组装）。
  - 需要"pod 内容清单 + 大小上限"策略：过大反而占死上下文预算；过小又救不了主要重读项。
  - 需要 pod 内容的失效策略：定向文档改动后 pod 也要重生成，否则 codex 拿到过期版本。
  - 与 codex CLI 的 system prompt 注入接口是否稳定绑定，需在动手前先核实。

候选 A 与候选 B 可叠加：A 收窄"每次要看什么"，B 让"必看的那部分"不再产生 fresh input。

## 触发时机

下次以下情况发生时再拆开这块：

- 会话 token 明显超预算或订阅额度频繁触顶。
- runner 侧引入并行 loop、单位时间多倍会话，把 token 成本放大到需要面对。
- codex CLI 提供了更明确的 system prompt / cache 注入接口。
