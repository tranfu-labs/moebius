# 任务：optimize-long-session-performance

> 状态：实现与验证已完成，本文件为事后补录；未在本轮重新执行完整门禁。

- [x] 用脱敏大样本拆分加载、轮询、状态提交、DOM 挂载和切换时序，确认主要成本不是 store 热读。
- [x] 对账数据边界：store 211 条 = 143 条公开 `local-message` + 68 条内部 `local-worker-run` placeholder；API 只暴露 143 条，placeholder 不进入 DOM。
- [x] 在主会话页 PRD 的「指标与验收」中补充长会话可用性预算，并以现有会话区和侧边栏 PRD 作为需求基线。
- [x] 在 `src/local-console/server.ts` 与桌面刷新适配层落地 ETag/304 条件刷新；不改变活动运行、失败、选择和终态的变化语义。
- [x] 在 `packages/console-ui/src/console/operator-console.tsx` 落地主时间线窗口化；以 `conversation-layout.ts` 集中布局、Relay 和阅读恢复纯逻辑。
- [x] 覆盖动态 Markdown 高度、首尾滚动、未挂载消息定位、中段阅读恢复和末尾新消息跟随。
- [x] 统一普通、搜索和 hosted 分析导航的完整场景捕获与失败恢复，保留右栏 visibility、host、tabs 文档、active tab、主内容、草稿和阅读位置。
- [x] 将性能 Profiler 限制在显式验收 query；正常运行不创建全局性能探针。
- [x] 添加和保留行为测试：ETag/304、活动变化走 200、错误状态清除、窗口布局/定位/恢复、普通和 hosted 失败回滚。
- [x] 完成定向测试、机器计算的 `--scope`、类型检查、边界检查、桌面构建及独立 Electron 验收；真实结果记录只保留脱敏计数、枚举、耗时和布尔信号。
- [x] 在 QA 独立复核修复错误状态 ref 回退和右栏组合现场后完成一次完整 `pnpm test`，退出码为 0；本次文档补录不重复运行。

## 未纳入本轮的后续观察

- 真实 provider 额度约束下的活动运行频率仍以逻辑测试、状态接口测试和既有活动运行证据为主；若未来发现真实 provider 的变化无法按现有频率抵达，再单独建立基线。
- 若新的样本显示 store 投影而非传输或 DOM 成为主瓶颈，再独立评估增量投影缓存。
