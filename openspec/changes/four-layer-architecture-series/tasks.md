# 任务：four-layer-architecture-series

本目录只管理跨 change 契约，不修改生产代码。每个执行批次使用独立顶层 change，以满足“一次
change、一次完整闸门、一次归档”的仓库节奏。

## A · 系列方案

- [x] 记录用户选择全面四层重构、功能开发冻结和单人执行前提
- [x] 定义 view / application / domain / adapter 四层及唯一归属、依赖矩阵和 composition-root 窄例外
- [x] 登记可判定 `[IB:*]` 与不可静态判定 `[NI:*]` 的验证责任
- [x] 给出六个子 change 的范围、依赖、改动量、自洽停止点和累计量化目标
- [x] 给出 test-name 级集成 → 纯单测替代 ledger 模板和禁止净删除规则
- [x] 给出按 change 组织的自动化与真实页面验收清单
- [x] 画出全局 before / after 架构图

## B · 执行 change 顺序

- [x] 完成并归档 `four-layer-00-boundary-foundation`
- [ ] 完成并归档 `four-layer-10-local-console`
- [ ] 完成并归档 `four-layer-20-desktop-renderer`
- [ ] 完成并归档 `four-layer-30-github-runner`
- [ ] 完成并归档 `four-layer-40-adapter-convergence`
- [ ] 完成并归档 `four-layer-50-final-convergence`

## C · 系列收口条件

- [ ] 六个执行 change 均有独立完整闸门、typecheck、必要构建和真实运行证据
- [ ] layer registry 覆盖全生产代码且 legacy exception 为零
- [ ] 纯逻辑/业务规则 ≥72%（目标 75%），或对剩余不可提纯分支逐项举证
- [ ] 完整闸门目标 ≤110 秒、真实 IO 墙钟下限占比 ≤40%；未达到时按原口径报告，不阻塞正确性但不得宣称速度收益
- [ ] 所有集成测试删除均有 test-name 级纯测试替代和保留接缝
- [ ] 最终 change 把 architecture after 图和四层边界登记回流到 `docs/architecture/`
