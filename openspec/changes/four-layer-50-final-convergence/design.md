# 设计：four-layer-50-final-convergence

## 方案

最终审计按机器清单而非抽样：

- 全生产 TS/TSX exactly-one layer；静态官网明确不进入本系列 registry 或收口清单；
- zero legacy debt；所有 composition roots exact 且仍存在；
- domain closure 无副作用路径，view/application/adapter 方向矩阵全绿；
- `module-map.md` 的 IB registry 双向一致，NI 均指向可执行验证；
- 六批 test ledger 无空列、无净删除、无唯一接缝丢失。

指标用与基线相同机器和命令。完整闸门仍只跑本 change 一次；各 suite/test duration 从该日志提取。
纯比例按系列固定职责分类复算。目标：纯规则 ≥72%（目标 75%）、完整闸门 ≤110 秒、明确真实 IO
下限占比 ≤40%。速度目标未达不自动否定架构正确性，但必须逐项解释且不得宣称速度收益。

## 真实运行验收

执行 RA-16 联合 smoke：新会话发送/停下/重试、左侧栏会话快速往返、搜索、分析、团队编辑、设置、
右栏标签、附件，随后重启复查持久事实。每个动作记录入口、操作、屏幕观察、与承诺一致否、环境=真机。

GitHub mode RA-11/RA-12 与 provider RA-15 若前序已在同一最终代码基线后没有再触及对应代码，可
引用前序 change 记录；若后续有重叠改动必须重做，不用旧证据抵扣。

## 风险

- 最终批继续大改：生产迁移超过 500 行即说明前序未收口，退回对应 change。
- 为达耗时目标误删集成测试：正确性与接缝覆盖优先，ledger 不完整禁止删除。
- after 图先于事实：只有 checker、测试和真机都通过后才回流 `docs/architecture/`。
