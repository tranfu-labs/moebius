# 任务：four-layer-40-adapter-convergence

- [ ] 导出 30 change 后剩余 layer debt，按外部边界分组并逐项归属
  - [x] provider / infra：8 文件，1,502 条 AST 条件、214 条未分类，目标 1,438 / 0；见 `provider-infra-cluster-ledger.md`
  - [x] ai-team-builder：5 个主体文件 1,252 逻辑行 / 126 条原始 AST 条件；目标原文件 <=926 行 / <=49 条，清除 5 条 file debt 与 2 条 dependency debt；见 `ai-team-builder-cluster-ledger.md`
  - [ ] desktop team-* 与其他 desktop root：开工前补簇级账
- [ ] 开工前逐项核对 Codex/Claude/Kimi 认证与额度、Electron 页面可达性和网络前提；记录用户/主理人对缺失前提的合并/归档策略
- [ ] 建 parser/classifier test-name ledger，列明不可删除 IO 接缝
- [ ] 清理 desktop main/team/onboarding/IPC/browser storage 共居判据
- [ ] 清理 provider/files/trusted JSONL/workspace/attachment 共居判据
  - [x] provider / infra 第一簇：8 条 file debt 清零，150 条 exact permit、64 条账面业务条件下沉，测试净删除 0
- [ ] 清理 local SQLite/JSONL state、HTTP server 与 composition root 共居判据
- [ ] 保持 `LocalConsoleStore` API/schema 不变，删除本 change 对应 debt
- [ ] scope、定向测试、typecheck、desktop build 全绿
- [ ] 执行 RA-13～RA-15，报告环境前提和真实观察
- [ ] 报告纯比例、闸门耗时与速度净收益（允许为零）
- [ ] QA/主理人复核后、合并前运行本 change 唯一一次 `pnpm test`
