# 任务：session-title-generation-entry-points

- [x] 单元 1：`session-creation-runtime.ts` 在 create 落库后接入 `decideTitleGeneration` 判定与 `generateSessionTitle` 触发（端口必填）
- [x] 单元 1：`session-command-wiring.ts` creation 端口组新增 `generateSessionTitle`（复用 MessagePorts 形状）
- [x] 单元 1：`runtime-session-wiring.ts` 提取 `fireTitleGeneration`，同一 title runtime 实例注入 submit 与 creation 两处
- [x] 单元 2：`tests/local-console-session-title.test.ts` 新增 4 个桌面形态用例（触发生成 / 不重复生成 / 纯附件不生成 / 无消息不触发）
- [x] 单元 2：typecheck EXIT 0、check:boundaries ok、相关 34 tests 全绿
- [x] 单元 3：PRD 落盘（main-conversation.md 页面标题节 + 验收 #3）
- [x] 单元 3：proposal.md / design.md / tasks.md / spec-delta / architecture svg
- [x] 单元 3：spec-delta 写入（触发面 MUST 覆盖两条入口）
- [x] 步骤 4：边界矩阵 + 全量回归对比基线（100/100 通过，无回归项）
- [x] 归档：change 目录移入 archive、spec-delta 合并入 specs、after.svg 回流 docs/architecture/、module-map 更新、PRD 核对
- [x] 步骤 5：真机桌面端新建对话验证（真实 Electron + 真实 codex：30.2s 生成「分析竞品推特推广策略」，UI 一致；evidence 见脚本运行输出）
- [x] 步骤 5：交付六件套（待用户验收）
