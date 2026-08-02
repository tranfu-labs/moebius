# 变更工作区（先设计再实现）

## 分档：不是每次改动都要建 change

建 change 的成本必须与留痕的必要性匹配。**判据不是改动大小，是「是否改变了已记录的事实」和「是否存在方案权衡」**：

| 情况 | 走法 | 产物 |
| --- | --- | --- |
| 事实没变（缺陷修复、内部重构、文案错字） | 直接改 | 无 |
| 行为变了、**产品意图没变** | **spec 内联改** | 与代码同一个 commit 修改 `openspec/specs/<domain>/spec.md` 的对应 Requirement，不建 change 目录、不归档 |
| **产品意图变了**（PRD 要新增或修改规则） | 完整 change | 采访 → 写 PRD → `openspec/changes/<change-id>/` → 归档 |

**spec 内联改**的留痕靠 git history（`git log -p openspec/specs/<domain>/spec.md`），commit message MUST 点明改了哪条 Requirement。之所以不为这类改动设轻量 change 模板：只要还需建目录、起 change-id、走归档，跳过的成本就永远低于执行的成本，模板再轻也会被绕过。

**边界（NEVER 越过）**：涉及产品意图变更的改动 MUST NOT 走 spec 内联——产品决策必须经用户采访拍板，不能在 commit 里单方面定下。判不准时按更重的一档走。

## 变更工作流
落到「完整 change」这一档的需求或业务变更，MUST 先建一个 `openspec/changes/<change-id>/` 目录、先设计再实现；NEVER 在没有 proposal/design 的情况下直接改实现代码。

## 目录内容
- `proposal.md`：为什么改、改什么、影响面。MUST 含「需求基线」节，写明本次对应的产品事实源锚点（`docs/product/pages/<page>.md#<小节>` 或 `flows/<flow>.md#<小节>`）与 PRD 变更记录。产品事实源在采访阶段就已聊定并于落盘时写入 PRD，本节只留指针与追溯线索，NEVER 在 change 里复制一份 PRD 内容（那会让 PRD 退化成滞后文档）。项目暂无对应 PRD 时，本节记录「PRD 缺口」及补齐落点。
- `design.md`：怎么实现、方案与权衡（不含字符图）。
- `tasks.md`：可勾选的任务清单。
- `spec-delta/`：对 `openspec/specs/` 的增删改；先写 delta，实现完成后再合并回 specs。源于产品决策的 Requirement MUST 在标题下写一行 `Source: docs/product/...#<小节>` 指回 PRD，并只写**判据**（可判定的 MUST / MUST NOT + Scenario），NEVER 复述 PRD 的决策理由、产品指标或视觉取舍——那些留在 PRD，靠 `Source:` 反查。
- `wireframes.md`（可选，本项目扩展）：仅当本次 change 涉及前端路由 / 页面 / 版式变化时新建。画字符图用，基线 MUST 引用 `docs/wireframes/pages/<page>.md`，NEVER 引用其他 change 的 wireframes.md。一个 change 涉及多页用 `## pages/<page>.md` 小节区分；超过 3 页才考虑改目录。后端 / 纯逻辑 change 不要建空文件。
- `architecture/`（可选，本项目扩展）：仅当本次 change 涉及触发链路 / 模块依赖 / 数据流等架构性变化时新建。存两张 svg：`before.svg`（变更前架构快照）与 `after.svg`（变更后架构事实源）。`design.md` MUST 用 `![现状](architecture/before.svg)` / `![改造后](architecture/after.svg)` 引用。基线 MUST 引用 `docs/architecture/` 已有图；NEVER 引用其他 change 的 svg。纯文案 / 局部修复 / 不改架构形态的 change 不要建空目录。

## 推进顺序
MUST 按 采访 → proposal → design（+ 必要时 wireframes.md）→ tasks → 实现 → 归档 的顺序推进；spec-delta 与 wireframes.md 都 MUST 在实现完成后、归档时才合并回事实源，NEVER 提前合并。

**`docs/product/` 是例外，方向相反**：产品决策在采访时拍板，落盘 change 时**就写入 PRD**，不进缓冲区、不等归档。原因是两类事实源的时间性相反——`openspec/specs/` 描述「已实现并验证的行为」，所以必须滞后，需要 `spec-delta/` 暂存；`docs/product/` 描述「产品应当是什么」，必须领先于实现，因为实现期间正是最需要它指导的时候。让 PRD 也走 delta 缓冲，等于把领先文档人为压成滞后文档。**因此 NEVER 建 `prd-delta/`。**

新建变更 MUST 复制 `_template/` 作为起点。`_template/` 不含 `wireframes.md`——按需新建。

## 归档（change 完成后必做）
MUST 同时完成下面五步，缺一不算归档：

1. **移动 change 目录**：`openspec/changes/<change-id>/` → `openspec/changes/archive/<YYYY-MM-DD>-<change-id>/`（日期为归档日）。
2. **合并 spec-delta → specs**：把 `spec-delta/` 下对应业务域的增删改合并进 `openspec/specs/<domain>/spec.md`，让事实规格反映改完之后的现状。回流前 MUST 逐条筛掉**过程约束条**：检查归档后该条主语是否仍成立，以及验收对象是产品行为还是变更评审动作；主语为 `This change`、验收对象为变更文件清单/依赖检查/评审动作的条目随 change 留在 archive，不得进入事实源。反面例子：`Humanization composites remain isolated` 中的 `This change MUST NOT ...` 和 “changed file list ... inspected” 只约束一次 change 审查，归档后不再是现行行为。
3. **回流 wireframes.md**（仅当本 change 有 `wireframes.md` 时）：**先看该页面是否已建 `docs/product/pages/<page>.md`**——已建则字符图回流至该页面 PRD 的「页面结构」节，NEVER 再写入 `docs/wireframes/`（页面 PRD 已接管，向旧 Wireframe 追加新事实会制造双源）；未建才回填 `docs/wireframes/pages/<page>.md`，流转变化同步进 `docs/wireframes/flow.md`。
4. **回流 architecture/after.svg → docs/architecture/**（仅当本 change 有 `architecture/after.svg` 时）：把 `after.svg` 复制为 `docs/architecture/<topic>.svg`（成为现状架构事实源），并在 `docs/architecture/module-map.md` 相应小节添加 `![<topic>](<topic>.svg)` 引用；`before.svg` 不回流，保留在 archive 目录作为历史快照。
5. **核对 PRD**：按 `proposal.md`「需求基线」节列出的锚点，逐条确认 `docs/product/` 里的表述与最终实现一致。PRD 在采访后、落盘时就已写入，本步只做核对与必要修正，NEVER 留到归档才第一次写——那会让产品事实源在整个实现期间处于过时状态。

第 2、3、4、5 步同等地位——specs 是行为事实源、`docs/wireframes/` 是版式事实源（迁移中）、`docs/architecture/` 是架构事实源、`docs/product/` 是产品意图事实源，都靠归档动作保持现状。

NEVER 把归档动作写进每个 change 的 `tasks.md`——它是项目级流程，由本文件统一定义。
