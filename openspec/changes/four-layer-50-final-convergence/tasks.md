# 任务：four-layer-50-final-convergence

- [ ] 生成全生产文件 layer 报告：零未归属、零多归属、零 legacy debt、零 stale root
- [ ] 审核 IB/NI 双向登记，删除完全重复规则并保留稳定诊断 ID/迁移说明
- [ ] 汇总六批 test-name ledger，逐条确认等价纯测试与保留接缝
- [ ] 清零 `production-copy-guard` 的 exact debt：6 个 console-page `.ts` 文件 / 16 条存量中文文案全部进入 locale resources
- [ ] 复测纯逻辑/业务规则比例，报告固定口径与剩余非纯分支
- [ ] QA/主理人复核后、合并前运行本 change 唯一一次 `pnpm test`，提取 suite/真实 IO 下限耗时
- [ ] 跑 typecheck、desktop build、brand/boundary 必要检查
- [ ] 执行 RA-16 联合真机 smoke；按重叠改动决定是否重做 GitHub/provider 验收
- [ ] 回流 after.svg 与 `module-map.md`，核对全部 specs/PRD 未偏离
- [ ] 确认本批生产逻辑迁移不超过 500 行；超过则退回前序 change
