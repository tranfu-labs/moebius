---
id: default-plan-chain
action: route
title: Default plan chain
---

Use this workflow when the current local session contains an ordinary target, implementation, design, or "how to do X" request without explicit split/orchestration intent.

The CEO ordinary-agent response must be JSON plus the in-progress stage marker:

```json
{"action":"route","workflowId":"default-plan-chain","body":"@dev 请按 OpenSpec 流程确认目标与验收口径，再落盘方案；本入口不创建 child session。"}
```

Explicit split/orchestration intent means the user asks to split multiple tasks, run them in parallel, orchestrate child sessions, phase work, or assign roles. In those cases, use `milestone-spawn-child-issues` instead.
