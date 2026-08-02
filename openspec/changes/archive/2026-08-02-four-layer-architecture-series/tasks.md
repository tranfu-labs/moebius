# 任务：four-layer-architecture-series

本目录只管理跨 change 契约，不修改生产代码。每个执行批次使用独立顶层 change，以满足“一次
change、一次完整闸门、一次归档”的仓库节奏。

## A · 系列方案

- [x] 记录用户选择全面四层重构、功能开发冻结和单人执行前提
- [x] 定义 view / application / domain / adapter 四层及唯一归属、依赖矩阵和 composition-root 窄例外
- [x] 登记可判定 `[IB:*]` 与不可静态判定 `[NI:*]` 的验证责任
- [x] 给出六个子 change 的范围、依赖、改动量、自洽停止点和累计量化目标；30 批产品裁决后已重算
- [x] 给出 test-name 级集成 → 纯单测替代 ledger 模板和禁止净删除规则
- [x] 给出按 change 组织的自动化与真实页面验收清单
- [x] 画出全局 before / after 架构图

## B · 执行 change 顺序

- [x] 完成并归档 `four-layer-00-boundary-foundation`
- [x] 完成并归档 `four-layer-10-local-console`
- [x] 完成并归档 `four-layer-20-desktop-renderer`
- [x] 完成并归档 `four-layer-30-github-runner`
- [x] 完成并归档 `four-layer-40-adapter-convergence`
- [x] 完成并归档 `four-layer-50-final-convergence`

## C · 系列收口条件

- [x] 六个执行 change 均有独立完整闸门、typecheck、必要构建和真实运行证据
- [x] layer registry 覆盖全生产代码且 legacy exception 为零
- [x] 以 30 批删除后新基线复算，纯逻辑/业务规则 ≥68%（目标 72%），或对剩余不可提纯分支逐项举证
- [x] 完整闸门目标 ≤110 秒、真实 IO 墙钟下限占比 ≤40%；未达到时按原口径报告，不阻塞正确性但不得宣称速度收益
- [x] 重构型测试删除均有 test-name 级纯测试替代和保留接缝；30 批契约退役型净删单列
- [x] 最终 change 把 architecture after 图和四层边界登记回流到 `docs/architecture/`

## 系列收官核对（dev-manager）

六个执行 change 全部完成并归档：`00-boundary-foundation`、`10-local-console`、`20-desktop-renderer`、
`30-github-runner`、`40-adapter-convergence`、`50-final-convergence`。

### 机械可核的终态

| 层 | 文件 | 逻辑行 | 占比 |
| --- | ---: | ---: | ---: |
| view | 77 | 21,436 | 25.5% |
| application | 171 | 17,062 | 20.3% |
| adapter | 101 | 26,277 | 31.3% |
| domain | 182 | 19,304 | 23.0% |
| **合计** | **531** | **84,079** | |

531 个生产文件各自唯一归层，零未归属、零多归属；`fileDebt` 与 `dependencyDebt` 均为 **0**；
composition roots **9** 个且全部存在；condition permits **193** 条、无 stale。

### 两项目标未干净达标，如实记录

**1. 纯逻辑/业务规则比例：目标 ≥68%（理想 72%），实测区间 65–79%，下界低于目标 3pp。**

该区间由 00 批人工职责抽样（34–41%）按 domain closure 增长外推而得，带宽 14pp 且跨越目标线，
不构成「达标」结论。50 批报告明确拒绝把 DTO、常量与文件迁移包装成纯逻辑来抬高下界，这个取舍正确。

本条要求含 OR 分支「或对剩余不可提纯分支逐项举证」，**该分支已实质满足**：193 条 exact condition
permit 逐条钉到 `ruleId:file:exportName:源码指纹`，每条附 `kind`（external-contract / transport-control）
与 `contract` 说明，且由 `four-layer-boundaries.ts` 的 stale 检测保证一旦源码变动即失效报红。其中
137 条集中于 `sqlite-state-worker.ts` 的协议分派与 DB codec，经复核确认为协议表面积的函数、
不可通过下沉消除（改表驱动只是把分支变成数据并丢失判别联合的穷尽性检查）。

即：剩余不可提纯分支不是估算值，而是 193 条带契约、带指纹、可回归的登记项。**以此条 OR 分支收口，
不宣称比例达标。**

注：上表的层分布（domain 占生产行 23.0%）与 65–79% 口径不同——前者分母是全部生产代码，后者分母是
承载业务规则的代码——列在此处仅作补充事实，不作为比例目标的替代口径。

**2. 完整闸门耗时：目标 ≤110s，实测 129s，未达标。**

真实 I/O duration 下限 26.6s、占总墙钟 **20.6%**，达成 ≤40% 的子目标。耗时集中在 `codex` 8.9s、
`claude` 7.3s、`session-jsonl-fact-log` 3.1s 三个真实接缝（占 I/O 下限 72%），均不可替换。
按系列既定口径：**不宣称任何速度收益，记 0**；未通过删测、调等待或缩减真实 I/O 接缝制造达标。
六批测试净删除合计：重构型 0，仅 30 批契约退役型单列（342 条，随 GitHub runner 形态移除）。

### 系列实绩

| 项 | 结果 |
| --- | --- |
| `src/local-console/runtime.ts` | 5,535 → 299 逻辑行 |
| `desktop/src/console-page/app.tsx` | 4,801 → 262 逻辑行 |
| `desktop/src/main.ts` | 586 → 248 逻辑行，AST 条件 50 → 0 |
| GitHub runner 形态 | 生产代码净删 16,689 行 |
| 四层架构 debt | 全部归零 |
| condition permits / composition roots | 193 / 9，全程净增 0 |
| 重构型测试净删除 | 0 |
