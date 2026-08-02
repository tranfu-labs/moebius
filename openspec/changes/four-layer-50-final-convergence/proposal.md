# 提案：four-layer-50-final-convergence

## 需求基线

| 文件 | 小节 | 变更 | 状态 |
| --- | --- | --- | --- |
| `docs/architecture/module-map.md` | 全部生产模块与禁止依赖 | 回流已验证四层归属与边界 | 实现后更新 |
| `docs/architecture/invariants.md` | 当前 local/runtime invariants | 删除已退役 GitHub L1/S1/V1，核对剩余约束 | 实现后更新 |
| 全部 `openspec/specs/*` | 当前行为 Requirements | 核对六个 change 未偏离 | 无变更 |
| 全部相关页面/流程 PRD | 操作、状态、验收 | 联合真机 oracle | 无变更 |
| `openspec/changes/four-layer-architecture-series/design.md` | 全部系列目标 | 最终收口契约 | 待主理人核验 |

`spec-delta/` 保持为空。30 批的产品变化由其 PRD 与 spec-delta 独立留痕；其他前序 change 若产生未
批准行为差异，必须先回滚或另走产品 change，不能在最终收口时补写规格洗白。

## 背景

前五个执行 change 分别建立门禁并迁移主要运行边界。本 change 只负责 legacy debt 归零、门禁
去重、测试替代总账、指标复测和架构事实源回流，防止“局部都完成但全仓仍有漏网文件”。

## 提案

- 全生产文件唯一归属，legacy exception 清零，composition-root allowlist 去 stale。
- 复核所有 IB/NI、删除已被矩阵完全覆盖的重复规则但保留稳定可读诊断。
- 汇总每个被删/合并集成 test name 的纯测试替代和保留接缝；30 批契约退役型净删单列。
- 同口径复测纯比例、完整闸门和真实 IO 墙钟下限。
- 联合真机 smoke 后回流 after.svg 和 module-map；不再迁移大块生产逻辑。

## 影响

以 checker registry、测试 ledger 和架构文档为主；生产业务逻辑迁移上限 500 行，超过即退回前一
change 处理。
