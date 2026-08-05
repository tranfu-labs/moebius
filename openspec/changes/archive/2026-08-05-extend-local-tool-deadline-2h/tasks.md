# 任务：extend-local-tool-deadline-2h

- [x] 确认产品决策：连续工具在途区间上限默认两小时，保留环境覆盖，区间从 open-tool 集合由空变为非空到再次清空，区间内并行工具不重置 deadline；现有空转、provider 忙等待、长运行提醒和 managed process 语义不变。
- [x] 更新 `docs/product/pages/agent-conversation.md` 的运行监督 PRD，并确认主页面 PRD 只保留引用、不重复规则。
- [x] 审计现有配置到 Codex、Claude、Kimi 的 primary、worker、analysis、full、resume 实际传递链；六个既有未提交修复文件中其余五个保持不动，正式验收脚本仅调整 A13 的稳定终态断言，两份既有证据不被改写。
- [x] 仅将连续工具在途区间配置的默认 fallback 改为 `7_200_000` 毫秒，保留 `MOEBIUS_LOCAL_TOOL_IN_FLIGHT_TIMEOUT_MS` 及现有正整数校验；不改变区间计时和并行工具规则。
- [x] 增加隔离配置测试：空覆盖得到精确两小时；正数覆盖按原值生效；非法值仍 fail fast。
- [x] 增加三 provider 参数传递测试，证明 Codex、Claude、Kimi 在共享的 full/resume 与成员运行链中收到解析后的工具上限。
- [x] 复用既有正常长工具与挂死工具回归，确认短覆盖下“超过现有空转窗口仍完成”和“挂死按 tool deadline 收束”均保持；不复制已有分支的镜像断言。
- [x] 运行正式 `scripts/acceptance/local-runtime-supervision.ts` 真实 Electron 验收，使用 15 秒工具覆盖而不等待两小时；将过程页合法的「已暂停跟随」状态从脆弱标题断言改为过程完成、无 `running`、活动释放和挂死工具 deadline 的行为断言，并记录正式 evidence。一次性临时 harness 仅作补充证据。
- [x] 按设计中的顺序运行定向测试、typecheck、import boundaries、受影响 scope；独立复核通过后已唯一运行本 change 的完整 `pnpm test`，结果为 1942 passed / 4 skipped / 0 failed，日志见 `/tmp/moebius-extend-local-tool-deadline-full-test.log`。
- [x] 完成清单外改动审计：预期改动包含本 change 的配置、新增/调整测试、PRD/规格文档，以及既有正式验收脚本中 A13 的稳定终态断言；六个既有修复文件中的其他五个、原始 evidence、idle/provider-busy/long-run/managed-process 配置均无意外变更。
