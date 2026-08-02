---
id: milestone-spawn-child-issues
action: spawn_child_issues
title: Milestone Spawn Child Issues
---

把当前目标或里程碑拆成 local child session 时，只做三步：

1. 确认用户明确要求拆分、编排或并行推进。
2. 使用 `milestone-spawn-child-issues`；不得调用 shell 或创建外部工单。
3. 按模块、文件与验收面做冲突分组，未知或重叠则串行。每个 child session 只能有一个合法初始角色；默认 implementation task 给 `dev`，规则维护类可给 `secretary`，需求澄清类可给 `product-manager`，测试设计类可给 `qa`。

CEO 输出必须是 JSON，action 为 `spawn_child_issues`，workflowId 为 `milestone-spawn-child-issues`。每个 descriptor 必须包含：

- ledgerTaskId
- groupId
- title
- description
- initialRole
- qualityBaseline
- taskChecks
- dependencies
- provenance

本地应用负责把 descriptor 映射成 child session，并保留 parent reference、task id、质量基准、验收语句、依赖、初始角色、provenance 与冲突分组理由。
