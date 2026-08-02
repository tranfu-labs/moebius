# 40 批评审裁决（dev-manager）

> 本文件是不依赖消息时间线的裁决落盘处。dev 在每个簇检查点后先读本文件，以最新一节为准。

## 簇 1：provider / infra — 裁决：**通过**（基线 `8b79f7b`）

### 独立复核结果

- **permit 机制**：实际执行 registry 得 **193 条 permit（43 存量 + 150 新增），193 个 permitKey 全部唯一**，无重复。分布 worker 137 / kimi 10 / claude 2 / sqlite-path 1，与账面一致。
- `adapterPermitGroup` 为纯 `.map`，每条指纹展开成独立 permit，四元键 `ruleId:file:exportName:fingerprint` 唯一，**无通配**。17 组声明代替 150 行平铺，比原先要求的「加分组注释」更优，该附加要求视为以更优方式满足。
- **独立反证（未复用 dev 的 fixture）**：
  - 探针 A：`src/sqlite-state-worker.ts` 的 `case "local-init"` 改为 `"local-init-probe"` → 同时报 `<stale-permit> for "local-init"` 与 `<unclassified> for "local-init-probe"`。旧登记失效与新条件未登记**两头都堵**。
  - 探针 B：受 permit 函数内新增条件 → 同样退出 1。
  - 两次测毕均已还原，工作区干净。
- **完整闸门**：root 99/713（另 1 file / 4 tests skipped）、slow 1/63、desktop 109/511、console-ui 45/460，126s，无失败标记。较基线 +3 测试文件 / +14 用例，测试净删除 0。
- **debt**：40 批 33 → 25，8 条清零；composition root 未增加。
- **−10 偏差已认可**：根因是「原始 `conditionNodes` 计数」与「去重后 violation 计数」两套口径混用；`if (a && b)` 产生两个 AST 条件但同指纹在 violation 输出中只留一个，业务判据整体下沉时这 10 个重复节点一并消失。属口径差，非多删业务分支。

### 带到后续簇的口径要求

后两张簇级账**开头必须写明采用哪套计数口径**（原始 AST / 去重 violation）；两套都列时分列两栏。40 批还剩 25 条 debt，口径每漂一次就多一轮「是否达标」的争论。

---

## 簇 2：ai-team-builder — **已放行，出账后直接实施**

范围：`desktop/src/ai-team-builder/` 下 `index.ts`、`team-writer.ts`、`claude-spawner.ts`、`codex-spawner.ts`、`kimi-spawner.ts` 共 5 个文件。

### 约束

1. **不要先抽公共基类。** 三个 spawner 形状相近，但簇 1 已经证明「各自把判据下沉到共享 domain」优于「先造抽象」——三家 `terminalForFailure` 归位到 `execution-failure-plan.ts` 后重复自然减少，且没有产生谁都不合身的基类。spawner 同理，先各自归位，三条路径干净后再评估真重复。
2. **`index.ts` 的 `application-use-case-shape` 是 composition root 类债**，参照 10/20 批口径：≤300 逻辑行，且每个条件必须委派 domain `decide*`/`plan*` 结果或持 exact permit。该规则在 `src/testing/four-layer-boundaries.ts:128` 是硬校验，不是建议。
3. **`branch-total` 的判据不变**：分支必须搬去 domain（决策变纯函数、adapter 只剩 I/O），不得靠拆成两个 adapter 分摊计数。审计文档逐条写清分支去向。

### 流程（沿用）

- 出簇级账 → 主理人核 → 实施 → 检查点。账目自审通过后可直接实施，不必再等第二轮确认。
- 提交清单列出自上个检查点起的**全部**提交。
- 账内任何一项超预算（含 permit 数偏离账面）主动报告。
- 新增 composition root 附条件分类审计（wiring / timing / business 复算）。
- 合并点跑本 change 唯一一次完整 `pnpm test`；红了修完重跑全量。

---

## 簇 3：desktop team-* — 待簇 2 完成后开

12 个文件（`team-store` / `team-ipc` / `team-official-*` / `team-record-store` / `team-runtime-binding` 等），加 `desktop/src/main.ts`。

## 当前闸门基线

root 99/713、slow 1/63、desktop 109/511、console-ui 45/460，约 126s，全绿。
