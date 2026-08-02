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

## 簇 2：ai-team-builder — 账已核 · 裁决：**通过，直接实施**（账 `d310438`）

范围：`desktop/src/ai-team-builder/` 下 `index.ts`、`team-writer.ts`、`claude-spawner.ts`、`codex-spawner.ts`、`kimi-spawner.ts` 共 5 个文件。

### 账目复核（dev-manager）

底数逐项复算无误：五主体文件 454+232+129+263+174 = **1,252** 逻辑行、55+23+14+21+13 = **126** 原始 AST
条件；目标 180+180+129+263+174 = **926**、5+8+10+16+10 = **49**。`index.ts` §5.1 复算
55 = wiring 25 + timing 14 + business 16，与原始总数吻合。

认可的关键判断：

- **计数口径按要求分两栏**，并明写「去重违规不能反推原始 AST 数」——簇 1 目标算错 10 条的根因已堵上。
- **拒绝宣称系统性收益**：「下降值只表示原边界收薄，不宣称全系统少了 77 个决策」。126→49 比簇 1 的
  1,502→1,428 漂亮得多，但没有拿它当政绩。
- 三条否决理由都成立：拆 adapter 摊薄判为「指标修绿」；先抽基类会「迫使 provider-specific 分支进基类」。
- 三个 spawner 目标行数不变，只降条件数——没有靠挪行数凑好看。
- `team-writer.ts` 是层级归位（adapter → application）而非切割，且自缚「层级变更必须与 fs/path 抽离同提交
  完成，否则不允许摘 debt」，堵死了本簇最便宜的作弊路径。
- 36 条留在 spawner 的条件已被 checker 机械识别为 codec/transport control，**permit 净增 0**——与簇 1 的
  150 条形成对照，正说明两处判断都成立：worker 是不可约的协议分派，builder 是可下沉的业务逻辑。

### 一处分类偏差（不拦实施，收口时重标）

`stored draft migration L393-447` 的 14 条划为 **wiring**，去向却是 domain 的 `draft-persistence-plan.ts`。
v1/v2/v3 的 JSON 版本迁移是数据解释，不是依赖装配；按 10 批口径更接近 business 或 codec。**去向对、标签错。**

之所以要紧：三分法的全部价值在于「timing 0 / business 0」这句结论有分量。若 wiring 沦为「非 timing 非
business 的兜底桶」，该结论即失去信息量。本簇收口复算与簇 3 立账时按严格口径重标，**不需返工代码**。

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
