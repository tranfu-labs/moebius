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

## 簇 2 实施检查点 — 裁决：**通过**（`949cb02`）

独立复核：

| 文件 | 基线 → 实际 | 目标 | |
| --- | --- | --- | --- |
| `index.ts` | 454 → **84** | <=180 | 低于目标 96 行 |
| `team-writer.ts` | 232 → 119 | <=180 | |
| `claude-spawner.ts` | 129 → 134 | <=129 | 超 5 |
| `codex-spawner.ts` | 263 → 277 | <=263 | 超 14 |
| `kimi-spawner.ts` | 174 → 185 | <=174 | 超 11 |
| 合计 | 1,252 → **799** | <=926 | |

- debt 25 → **18**（7 条清零）；**permit 仍为 193（净增 0）**；composition root 仍 9 个，ai-team-builder
  下仍只有 `index.ts` 一个，无新增。
- `check:boundaries` 585 source / 499 production / 3 roots 全绿。
- 独立跑完整 `pnpm test` 全绿 126s：root 99/713、slow 1/63、**desktop 114/529**（较基线 +5 文件 / +18 用例，
  与新增纯测试逐项吻合）、console-ui 45/460。测试删除 0。

**三个 spawner 超标 30 行的处置予以肯定。** 超标原因是具名 plan 调用接缝本身占行（`selectXxxSession(...)`
比内联 `??` 链长），这是提纯的固有成本。可选的另一条路是把调用点压成一行以守住预算——那正是本系列
一直在防的修饰行为。**选择如实披露而非压行，是正确的**；且总量 799 远低于 926，`index.ts` 少用的 96 行
已充分吸收。

---

## 簇 3：desktop team-* — 账已核 · 裁决：**通过，直接实施**（账 `cead83b`）

### 范围更正（dev-manager 原记有误）

本节原写「12 个 team-*」，**registry 实际为 13 个 team-* file debt + `desktop/src/main.ts`（共 14 条
file debt）+ 4 条 dependency debt = 18 条**。dev 在簇级账中以 exact registry 为准并显式保留了这项差异，
未默默采信任何一方，处理正确。以 registry 为准。

### 账目复核（dev-manager）

- 基线 **4,711 逻辑行 / 626 原始 AST 条件 / 98 去重违规**，三栏并列，沿用簇 2 口径。
- 逐文件复算与主理人独立计数在 `team-external-change.ts`(+4)、`team-store.ts`(+4)、
  `team-record-store.ts`(+1) 三处相差共 9 行（0.2%），系行数启发式与 checker AST 口径的细微差异；
  **唯一带硬门禁的 `main.ts` 双方一致为 586 行**，不影响任何判据。**以 checker 口径为准，不返工。**
- `main.ts` 目标 586 → <=260 行（留 40 行门禁余量）、<=8 wiring 条件。

**严格三分口径产生了实质效果，予以确认。** `main.ts` 复算 50 = wiring **11** / timing **31** /
business 8，并明写「表内把 codec 并入 business、transport 并入 timing 复算，避免塞进 wiring 兜底」。
按宽口径那 31 条 timing 很可能被归为 wiring，结论会变成「几乎全是装配」；严格标注后才暴露出
`main.ts` 的真实问题是**进程与窗口时序**而非装配。这说明上一轮的重标要求改变的是判断本身，不只是标签。

其余认可：

- 四处层级改登记（`team-conversation-preference` / `team-runtime-binding` / `team-ipc` → application，
  `team-onboarding-orchestration` → domain）均绑定「层级改登记、能力抽离与 dependency debt 摘除
  必须同一提交完成」，承接簇 2 自缚条款。
- 「除 `main.ts` 与改登记的 application 外，不用行数做 adapter 成败指标」——adapter 的判据是条件去向
  而非行数，避免了在 adapter 上重演压行。
- 测试净删除目标 0；真实 I/O 测试全部保留，纯测试不得抵扣；等价替代须逐条写入 test-name ledger。

### 约束

1. **计数口径分两栏**（原始 AST / 去重 violation），沿用簇 2 写法。
2. **wiring / timing / business 三分按严格口径**——这是对簇 2 那处偏差的修正：`wiring` 仅指依赖装配，
   数据解释、版本迁移、格式解码归 business 或 codec，不得当兜底桶。`main.ts` 是 composition root，
   其「timing 0 / business 0」的结论必须建立在严格标注上才有分量。
3. **层级改登记必须与能力抽离同提交完成**——沿用簇 2 `team-writer.ts` 的自缚条款。本簇 12 个 team-*
   文件里若有同类「伪 adapter」，改登记为 application 时必须同批把 fs/path/Electron 能力抽成注入 port，
   否则不允许摘 debt。
4. `branch-total` 判据不变：分支搬去 domain，不得拆成两个 adapter 分摊计数。
5. 不先抽公共抽象。

### 40 批收口条件

- 18 条 debt 全部清零，permit 与 composition root 净增为 0（如需新增须单独报批并附条件审计）。
- **RA-15 真机验收**：三家 provider 新调用与 resume；缺失环境按既定规则逐家标记「待真机验收」，
  **不以另一家结果抵扣**。
- 合并点跑本 change 唯一一次完整 `pnpm test`；红了修完重跑全量。
- 归档前把全簇实绩（行数、条件数、debt、permit、闸门数据）写入 tasks.md，单样本不声明可归因速度收益。

## 当前闸门基线（簇 2 实施后，主理人实测）

root 99/713（另 1 file / 4 tests skipped）、slow 1/63、**desktop 114/529**、console-ui 45/460，126s，全绿。

## 读取约定

dev 在每个检查点后读本文件前，先确认已取到最新提交——裁决落盘晚于 dev 的检查点提交属正常时序。
以本文件中**最靠后的一节**为准；若某检查点对应的裁决尚未出现，说明尚未落盘，可继续等待或按最近一次
放行范围内的工作推进，不必重发交棒。

---

## 簇 3 实施检查点 — 裁决：**打回（仅闸门项）**

代码本体通过，合并点闸门红，需修复后重跑。

### 已核实通过的部分

- `main.ts` **586 → 248 逻辑行**（目标 <=260），AST 条件 **50 → 0**——强于 <=8 wiring 的目标。
- **40 批 debt 18 → 0**，permit 保持 **193**、composition root 保持 **9**，均无增长。
- `check:boundaries` 617 source / 531 production / 3 roots 全绿。
- QA 的 RA-13～RA-15 三条全部真机通过且三家 provider 均可用、无「待真机验收」项；resume 同源直接对账
  provider 原生记录（Codex `thread_id` / Claude `session_id` / Kimi ACP `sessionId`），不靠 UI 推断。
  两个侧注（退出恢复那次 codex 答上一轮问题、`showItemInFolder` 对缺失路径静默）如实标注且不阻塞，处理正确。

### 合并点闸门（主理人执行）— 红

`pnpm test` 116s，desktop scope 失败：

```
FAIL tests/status-page-update-entry.test.ts
  > removes the migrated update action and its deprecated IPC surface
  → expected main.ts to contain 'registerSettingsIpc'
```

**根因**：该测试 5 条断言中，前 4 条是「已废弃表面不存在」的否定断言，全部仍通过；第 5 条
`expect(main).toContain("registerSettingsIpc")` 断裂，因为 `main.ts` 收窄为 248 行 root 后，settings IPC
装配已移至 `desktop/src/desktop-core-ipc-register.ts:60`。**生产代码正确，断言落点过时。**

### 修复方向（不得靠删断言修绿）

这是本系列第三次源码镜像断言在合并点断裂（10 批镜像清单、30 批 guard 路径、本次符号位置）。据此确立口径：

- **证明「不存在」**（前 4 条）→ 文本断言合适且应保留，行为测试无法证明缺席。
- **证明「存在」**（第 5 条）→ **不应使用源码文本 grep**。`registerSettingsIpc` 是否真的注册，可用行为
  验证：传入 fake `ipcMain` 调用注册入口，断言实际注册的 channel 名。这样后续重构挪动实现位置不会再断。

允许的最小修法是把第 5 条重指到 `desktop-core-ipc-register.ts`；**推荐**改为上述行为断言。两者均可，
但不得直接删除该断言——它保护的是「update 能力确实迁到了 settings IPC」这一事实。

### 其余待办（归档前）

1. **提交清单漏 1 个**：实际 18 个提交中 `32bb8bf` 为主理人裁决提交（正确排除），其余 17 个为 dev 所出，
   报告列了 16，漏 `7813b10 test(desktop): define onboarding orchestration plans`（本簇首个提交）。
2. **`tasks.md` 尚有 10 条未勾**，其中第 10/11/14/15/16 条（清理各处共居判据、保持 `LocalConsoleStore`
   API/schema 不变、scope 与 build 全绿）已由 debt 归零与实测结果证明完成，需据实勾选；第 3/8/9 条
   （剩余 layer debt 导出、provider 前提核对记录、parser/classifier test-name ledger）需补齐内容。
3. **QA 写入的 `tasks.md` 尚未提交**，工作区不干净。
4. 修复后**重跑完整 `pnpm test` 全量**（不接受只补跑 desktop scope），并把闸门实测数据写入 tasks.md。
