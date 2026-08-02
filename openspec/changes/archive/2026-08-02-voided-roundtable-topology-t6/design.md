# 设计：roundtable-topology-t6

## 方案

### 1. 运行模型
v0 圆桌是 CEO 普通 agent 的一个受控 workflow，不是新 agent：

1. 父 issue 中 CEO 识别需要圆桌评审，输出 `roundtable.start`。
2. runner 创建或找回独立 roundtable child issue，并在 child body 中写入主题、输入材料、参与者顺序、固定一轮规则、parent reference 与 hidden roundtable key。
3. child issue 初始 handoff 给第一位参与者。每位参与者按自身 persona 发言，末尾把控制权交回 CEO；CEO 在 child issue 中输出 `roundtable.route`，runner 发布下一位参与者的 handoff。
4. 参与者均发言后，CEO 输出 `roundtable.complete`。runner 校验发言完整性与汇总结构，回流父 issue；父 issue 只接收汇总结论、分歧、依据和 child issue 链接，不承载整场讨论。

这保留“一条消息最多一个合法 mention”：每次 handoff 只有一个目标角色。v1 多 agent fan-out 不进入本轮运行时。

### 2. CEO 剧本与 action
新增 `agents/ceo-scripts/roundtable-plan-review.md`：

- `id: roundtable-plan-review`
- `action: roundtable`
- 场景：方案评审团 dogfood。
- 默认参与者顺序：qa → dev-manager → hermes-user。
- 固定一轮：三位参与者各发言一次后 CEO 汇总；需要下一轮时，CEO 必须显式再发起新 round，不自动追问。
- 输出要求：汇总必须按角色保留观点、依据和分歧，不能把不同角色意见压成无来源共识。

`src/ceo-scripts.ts` 把 `CeoScriptAction` 扩展为 `"route" | "spawn_child_issues" | "roundtable"`，并把 `roundtable-plan-review` 加入 required workflows。缺脚本或 action mismatch 仍 fail closed。

### 3. Roundtable 输出契约
`src/ceo-orchestration.ts` 扩展 `ParsedCeoOrchestration`：

```ts
type ParsedRoundtable =
  | {
      action: "roundtable";
      workflowId: "roundtable-plan-review";
      mode: "start";
      roundtableId: string;
      ledgerTaskId: string;
      title: string;
      topic: string;
      inputSummary: string;
      participants: string[];
      firstRole: string;
      qualityBaseline: "demo" | "data-correct" | "production";
      provenance: string;
    }
  | {
      action: "roundtable";
      workflowId: "roundtable-plan-review";
      mode: "route";
      roundtableKey: string;
      participants: string[];
      nextRole: string;
      body: string;
    }
  | {
      action: "roundtable";
      workflowId: "roundtable-plan-review";
      mode: "complete";
      roundtableKey: string;
      participants: string[];
      summary: string;
      contributions: Array<{
        role: string;
        position: string;
        evidence: string;
        disagreements: string[];
      }>;
      decision: string;
      provenance: string;
    };
```

校验规则：

- `workflowId` 必须命中 `roundtable-plan-review`，且脚本 action 必须是 `roundtable`。
- `participants` 非空、去重，且每个 role 都在当前 `availableAgentNames` 中；dogfood 场景必须包含 qa、dev-manager、hermes-user。如果实现基线缺 qa，runner fail closed 留痕，不顺手新增 agent。
- `start.firstRole` 必须等于 `participants[0]`。
- `route.body` 必须恰好含一个合法 mention，且目标等于 `nextRole`。
- `complete.contributions` 必须逐角色覆盖 `participants`，每项都有非空 position / evidence；disagreements 可为空数组但字段必须存在。
- parser 只做结构和白名单校验，不调用 GitHub、文件系统或 ledger。

新增 hidden key：

```text
moebius-roundtable-key:<sha256(parent issue + workflow id + roundtable id)>
moebius-roundtable-completion-key:<sha256(roundtable key + ordered participants digest + participant source indexes digest)>
```

roundtable key 不含标题、自由描述或参与者措辞，避免 CEO 重跑文本漂移导致重复创建。
completion key 不含 `summary` / `decision` / CEO 自由文本，避免父 issue 汇总已经发布、child 完成说明或 role thread 保存失败后，CEO 重试换措辞导致重复父汇总。参与者 source indexes 来自 child issue timeline 中已归一化的参与者评论 index；同一轮参与者发言不变时，completion key 稳定。

### 4. Runner start 路径
当 CEO action 为 `roundtable.start`：

1. 用 parent issue source、workflow id 和 `roundtableId` 计算 roundtable key。
2. 先从最新 ledger task child refs 的 bounded note 中查找 roundtable key；若已有 child ref，发布 parent 可见说明，不重复创建。
3. 若 ledger 没有 ref，通过 `findIssueByOrchestrationKey` 或等价 hidden-key lookup 在父 repo 查找 child issue；唯一命中则写回 ledger task child ref，作为 recovered-existing。
4. 未命中时调用 `createIssue` 创建 child issue；child body 通过 renderer 强制包含：
   - Parent issue URL
   - Workflow id
   - Ledger task id
   - Roundtable key
   - Quality baseline
   - Topic / input summary
   - Participants in order
   - Fixed one-round rule
   - Initial handoff with exactly one mention
   - Participant instruction: this is a roundtable contribution, not the formal `plan-written` qa gate or final acceptance gate; each participant must give their sourced opinion and hand control back to CEO with exactly one legal mention
   - Provenance
5. 创建或恢复成功后，用既有 `saveGoalLedgerEntry("tasks", ledgerTaskId, ...)` 追加 child ref，note 中保存 bounded roundtable key 与 provenance；不新增 ledger 字段。
6. 在父 issue 发布 CEO 可见评论，列出 child issue URL、参与者顺序和当前等待的第一位角色。

所有 GitHub lookup、createIssue、ledger save 与失败评论发布必须有界。失败且尚未留下可见结果时返回 failed，不推进 intake；已发布 fail-closed 评论时不保存 CEO role thread。若 `createIssue` 已成功但 ledger save 失败 / timeout，fail-closed 评论必须列出已创建 child issue URL 与 roundtable key；下一轮重试先查 ledger，再按 hidden roundtable key 查 GitHub，找回后补写 ledger，不能重复创建。

### 5. Runner route 路径
当 CEO action 为 `roundtable.route`：

1. 从当前 issue body 解析 roundtable key、parent issue URL 与参与者顺序；解析失败 fail closed。
2. 基于当前 child issue timeline 统计每个参与者是否已发言。发言判定使用 speaker metadata / role envelope 归一化后的 speaker，不靠自然语言自称。
3. 校验 `nextRole` 是参与者列表中下一位未发言角色；不得跳过未发言角色，也不得重复路由给已发言角色。
4. 发布 `route.body` 到当前 child issue；该 body 只有一个合法 mention，交给 `nextRole`。
5. runner 不直接信任 CEO 自由文本中的回交说明，而是通过 `renderRoundtableRouteBody()` 强制追加标准回交指令：本轮是圆桌发言，不是正式验收裁决；发言后必须把控制权交回 CEO 主持人，不能直接交给 dev 或 product-manager。handoff 评论自身只能有一个合法 mention 指向 `nextRole`；回交说明里写裸 `CEO`，不得在同一条 handoff 里再写 `@ceo`。渲染后的正文再次校验只含一个合法 mention 且指向 `nextRole`。
6. 成功后保存 CEO role thread。

route 不写父 issue、不写 ledger、不改 workspaceAccess。

### 6. Roundtable no-handoff recovery
参与者发言后如果没有把控制权交回 CEO，普通 mention trigger 不会唤醒任何角色，child issue 会静默停住。T6 必须新增一个只作用于 roundtable child issue 的 no-trigger recovery：

1. 在普通 no-trigger 吸收之前，runner 检测当前 issue body 是否含 roundtable key、latest timeline message speaker 是否为当前 roundtable participant、且该消息不是 runner metadata-only / dead-letter / CEO 评论。
2. 如果该参与者评论没有合法 mention，runner 发布一条 `ceo` role envelope 的可见 recovery 评论，正文只含一个合法 mention `@ceo`，说明哪个参与者已发言但未回交，并请求 CEO 继续 route 或 complete。
3. 如果该参与者评论 mention 了非 CEO 角色，runner 发布可见协议纠偏，要求回到 CEO 主持人；不得继续执行错误 handoff。
4. recovery 评论发布成功后，本轮按可见结果推进；下一轮 active poll 由普通 mention trigger 唤醒 CEO。发布失败则返回 failed，不推进 intake，走既有 retry / dead-letter。
5. recovery 按 comment index / speaker 做幂等记录，避免同一条缺 handoff 参与者评论每轮重复刷屏。记录可以落在既有 intake fallback route ledger 或 roundtable-specific bounded marker 中，但不得新增独立 runtime state file。

### 7. Runner complete 路径
当 CEO action 为 `roundtable.complete`：

1. 从当前 child issue body 解析 parent issue source 与 roundtable key。
2. 基于 timeline 校验所有参与者均已发言；若缺任何角色，发布 child fail-closed 评论，说明缺谁并要求 CEO 继续 route，不回流父 issue。
3. 校验 `contributions` 覆盖所有参与者，并保留角色来源、依据和分歧。
4. 用 roundtable key、ordered participants 和参与者 source indexes digest 计算 completion key。在父 issue 查询是否已有同 completion key 的回流评论；有则不重复发布，只在 child issue 说明已回流。
5. 未回流时，先向父 issue 发布汇总评论，正文包含：
   - roundtable child issue URL
   - topic / input summary
   - 每个角色的 position / evidence
   - disagreements
   - decision / next step
   - hidden completion key
6. 父 issue 回流成功后，在 child issue 发布完成说明并保存 CEO role thread。若 child 完成说明或 CEO role thread 保存失败，后续重试仍使用同一 completion key 查到父 issue 已回流，不重复发布父汇总；child 完成说明可补发或记录已回流状态。
7. 父 issue 回流失败时，在 child issue 发布 fail-closed 评论，说明 parent return failed；不保存 CEO role thread。若 child fail-closed 评论也失败，则返回 failed 进入既有 retry / dead-letter。

### 8. 协议、权限与非目标
- 不改 mention trigger 默认行为；一条消息仍最多一个合法 mention。
- 圆桌参与者的回交目标是 CEO 主持人；这只是 roundtable child issue 内的控制权回交，不改变 `plan-written` 的正式 qa 审查治理链路。
- 不让 issue body/comment 指定脚本或任意执行动作；roundtable 所有副作用经 runner adapter。
- 不新增 `moderator` agent；主持人身份复用 CEO。
- 不改 T4 integration join 结构；roundtable complete 是剧本级收口，不代表验收 pass。
- 不改现有 `plan-written` → qa 审查治理链路；roundtable 是可显式发起的额外 dogfood 场景。
- 不改 workspaceAccess。qa / hermes-user 仍 read-run，dev-manager 仍不写代码，roundtable workflow 不授予任何新文件权限。
- 不改 observer、goal-intake、视觉对照 dogfood。

### 9. 测试设计
本 change 含可测业务逻辑，必须有单元测试和 runner 编排测试：

- CEO scripts：required workflows 包含 `roundtable-plan-review`；缺失 / duplicate / action mismatch fail closed。
- parser：接受合法 start / route / complete；拒绝未知 role、缺 qa、重复 participant、route 多 mention、route mention 与 nextRole 不一致、complete contribution 缺角色或缺 evidence。
- renderer：roundtable child body 含 parent reference、workflow id、ledger task id、roundtable key、participants、fixed one-round rule、provenance，并且只有一个 initial handoff mention。
- runner start：创建 child issue、保存 task child ref bounded note、父 issue发布 child URL；重复执行按 key 找回，不重复创建。
- runner route：按 timeline speaker 判断下一位参与者，只发布一个 handoff mention，不写父 issue，并通过 renderer 强制参与者回交 CEO。
- runner no-handoff recovery：参与者已发言但缺 `@ceo` 时，runner 发布一条可见 recovery 评论唤醒 CEO；错误 handoff 到非 CEO 时可见纠偏。
- runner complete：所有参与者发言后回流父 issue；父汇总保留分歧和依据；completion key 与 summary wording 无关，按参与者来源稳定去重。
- failure：参与者未响应时不汇总；父 issue 回流失败时 child issue 可见 fail closed；hidden lookup / createIssue / ledger save 永久挂起时受 timeout 收敛；createIssue 成功但 ledger save 失败时失败评论包含 child URL 且重试找回。
- protocol boundary：v0 测试证明 mention trigger 仍只选择单 mention；多 mention fan-out 没有运行时代码入口。

验证命令：`pnpm test -- ceo-scripts ceo-orchestration runner`、`pnpm test`、`pnpm typecheck`、`git diff --check`。

## 验收语句

1. 跑 `pnpm test -- ceo-scripts` -> 应看到 `roundtable-plan-review` 是 required workflow，且 action 为 `roundtable`。
2. 跑 `pnpm test -- ceo-orchestration` -> 应看到 roundtable child body 含 parent reference、workflow id、ledger task id、roundtable key、参与者顺序、固定一轮规则、初始 handoff 和 provenance。
3. 跑 `pnpm test -- runner` -> 应看到 roundtable start 创建或找回一个同仓库 child issue，并在父 issue 留下 child issue 链接。
4. 跑 `pnpm test -- runner` -> 应看到 roundtable route 每次只发布一个合法 handoff mention，且只能交给下一位未发言参与者。
5. 跑 `pnpm test -- runner` -> 应看到参与者已发言但未 `@ceo` 时，系统发布可见 recovery 评论唤醒 CEO，不静默降回 idle。
6. 跑 `pnpm test -- runner` -> 应看到三位参与者未全部发言时，CEO complete 不会回流父 issue，并会在 child issue 留可见失败说明。
7. 跑 `pnpm test -- runner` -> 应看到三位参与者都发言后，父 issue 收到包含 child issue 链接、逐角色观点、依据、分歧和结论的汇总评论。
8. 跑 `pnpm test -- runner` -> 应看到父 issue 汇总发布成功后，即使 child 完成说明或 CEO role thread 保存失败，后续用不同 summary wording 重试也不会重复发布父汇总。
9. 跑 `pnpm test -- runner` -> 应看到 `createIssue` 成功但 `saveGoalLedgerEntry` 超时时，可见 fail-closed 评论包含已创建 child URL，后续重试按 hidden key 找回且不重复创建。
10. 跑 `pnpm test -- runner` -> 应看到 hidden-key lookup 永不 settle 时在配置 timeout 内收敛，不保持 in-flight。
11. 跑 `pnpm test -- ceo-orchestration runner` -> 应看到 route handoff 由 renderer 强制包含回交 CEO 的裸写指令，且同条评论仍只有目标参与者一个合法 mention。
12. 跑 `pnpm test -- runner` -> 应看到包含多个合法 agent mention 的消息仍不触发 fan-out，v0 只保留现有单 mention 行为。
13. 打开 `openspec/changes/roundtable-topology-t6/spec-delta/goal-ledger/spec.md` -> 应看到 v0 不新增 roundtable schema，roundtable completion 不计为 child acceptance fact 或 integration acceptance event。
14. 打开 `openspec/changes/roundtable-topology-t6/design.md` -> 应看到 roundtable 不改变现有 `plan-written` 的 qa 审查治理链路，也不授予新的 workspaceAccess 权限。
15. 跑 `pnpm test -- runner` -> 应看到 roundtable 参与者错误移交给非 CEO 角色时，runner 在普通 mention trigger 运行目标角色前拦截，并发布可见纠偏，不执行错误 handoff。
16. 跑 `pnpm test -- runner` -> 应看到同一条缺 handoff 的参与者评论重复处理时，只发布一条 recovery 评论，不重复刷屏。

## 权衡
- 选择 CEO workflow，而不是新增 `moderator` agent：复用一个身份、两条路径的既有设计，避免增加 persona / role thread / guardrail 白名单维护面。
- 选择 v0 串行 route，而不是本轮实现 fan-out：先验证圆桌模式价值，保留协议稳定性；真正并发会放大 interrupt、driver pool、role thread 和 join 去重复杂度。
- 选择 child issue 承载圆桌全量讨论，父 issue 只接汇总：保持一个 issue = 一场对话，避免复杂父 issue 时间线被多角色交错发言淹没。
- 选择 runner 校验 participants 与 contributions，而不是只信 CEO 自述：固定一轮收口必须可机械判定，避免“缺某角色发言但 CEO 直接总结”。
- 选择复用 task child ref note，而不是新增 ledger schema：v0 只需要 provenance 锚点；圆桌是否值得一等公民状态要等 dogfood 后再判断。

## 风险
- **CEO route 卡住**：某参与者不响应时，roundtable complete 会 fail closed 并指出缺失角色；不会伪造汇总。
- **参与者不回交 CEO 导致静默**：roundtable no-handoff recovery 在 no-trigger 前发布可见 `@ceo` recovery 评论，避免 child issue 静默降回 idle。
- **父 issue 回流重复**：completion key 不含 summary wording；已回流时不重复发父评论。
- **父 issue 回流失败**：child issue 留 fail-closed 评论；若连 child 评论也失败，返回 failed 走既有 retry / dead-letter，满足可见性与不丢指令原则。
- **参与者意见被压成无来源共识**：parser 要求 contributions 分角色，renderer 固定输出每个角色的 position / evidence / disagreements。
- **无意改变阶段治理链路**：`plan-written` 自动回流仍走 qa；roundtable 只在显式 workflow 下启动。
- **未来 v1 设计债**：spec 明确 v1 进入条件为 v0 dogfood 证明价值后再做；本轮测试要证明不存在 fan-out runtime 入口。

回滚方式：移除 `roundtable-plan-review` required workflow、删除 `roundtable` action parser 与 runner 分支；CEO 既有 route / spawn_child_issues / integration 行为保持不变。
