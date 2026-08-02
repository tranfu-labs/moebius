---
id: integration-repair-child-issues
action: spawn_child_issues
title: Integration Repair Child Issues
---

当 parent session 的目标级集成验收失败时，CEO 不把整项目直接交给实现角色，而是把失败项回流成修复 child session：

1. 识别场景：父级集成验收结果明确列出失败的目标级验收语句。
2. 识别工作流：使用 `integration-repair-child-issues`，按失败语句和冲突面分组；能独立验证则拆分，未知依赖或范围重叠则合成一个串行修复子任务。
3. 修复子任务继承当前 phase 的 quality baseline，验收语句来自失败项，并保留 parent session provenance。每个 child session 只能有一个合法初始角色。

本地应用负责稳定 task id、创建或恢复 child session，并在修复任务通过后回到同一 parent session 重新验收。
