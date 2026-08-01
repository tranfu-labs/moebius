# 任务：four-layer-30-github-runner

- [ ] 冻结 issue processing 阶段顺序、L1/S1/V1 和 visible publication 行为矩阵
- [ ] 开工前核对 proposal 的 sandbox 白名单、gh 权限、专用 issue 与至少一个真实 provider 前提；记录用户/主理人对缺失前提的合并/归档策略
- [ ] 从系列 design 复制 30 批三条精确 test-name 映射，建立 runner ledger；补齐 duration、接缝和删除/保留结论，先补尚缺的纯 decision tests
- [ ] 提取 issue processing application flow 与窄 ports
- [ ] 把剩余纯判据放回 conversation/intake/ledger/trigger/orchestration 或新窄 planner
- [ ] `runner.ts` 收为 composition root，删除本 change 对应 layer debt
- [ ] 保留 gh/Codex、timeout、cursor、visible failure、restart 唯一接缝
- [ ] scope、定向测试、typecheck 全绿，执行 RA-11/RA-12
- [ ] 报告纯比例、闸门耗时和 test ledger
- [ ] QA/主理人复核后、合并前运行本 change 唯一一次 `pnpm test`
