# github-issue-runner spec delta：ceo-default-plan-chain

## 新增行为规则

- MUST load a required CEO route workflow script `default-plan-chain` whose action is `route`.
- MUST let the CEO ledger context bootstrap prompt expose two allowed bootstrap paths when no active phase projection exists: `default-plan-chain` route for ordinary target-shaped requests without explicit split/orchestration intent, and `goal-intake` for explicit split/orchestration intent or confirmation of an existing goal-intake proposal.
- MUST NOT instruct CEO in bootstrap context that it may only use `goal-intake`; bootstrap context MAY allow `route` workflows that do not require visible ledger task ids.
- MUST keep bootstrap `spawn_child_issues` and `roundtable` unavailable unless an active projection supplies visible task ids; TypeScript validation MUST continue to reject task-bound orchestration that references missing visible task ids.
- MUST let `agents/ceo.md` define the minimal explicit split/orchestration intent predicate: user text explicitly asks to split into multiple tasks, do work in parallel, orchestrate multiple child tasks, create child issues/tasks, or phase and assign work to roles.
- MUST let `agents/ceo.md` define ordinary target-shaped requests such as “我想做一个 X”, “帮我实现 X”, “帮我设计 X”, or “怎么做 X” as default-plan-chain inputs, not goal-intake inputs, unless the same public timeline also contains explicit split/orchestration intent.
- MUST let external no-mention fallback routing continue to append a single `@ceo` for target-shaped messages that need CEO entry adjudication, but that append MUST NOT imply goal-intake by itself; ordinary CEO bootstrap MUST perform the default-plan-chain vs goal-intake decision.
- MUST allow CEO `route` orchestration outputs for `default-plan-chain` to parse successfully with an empty `visibleTaskIds` array, provided the route body contains at most one legal known agent mention.
- MUST publish a default-plan-chain route as a visible CEO handoff comment and leave the mentioned role to run on the next active poll, preserving the existing route action semantics.
- MUST keep route judgement in `agents/ceo.md` / CEO scripts and format validation in TypeScript; runner submodules MUST NOT become the natural-language split-intent fact source.

## 新增场景

### 场景 T1.1：plain goal bootstrap routes to the plan chain
Given a GitHub issue body says “我想做一个 X”
And the issue has no active ledger owner or active phase projection
And the public timeline contains no explicit split/orchestration intent
When ordinary `@ceo` runs in bootstrap context
Then CEO MUST output a `route` action with workflow id `default-plan-chain`
And the route body MUST contain exactly one legal mention to `@dev`
And runner MUST publish a visible CEO handoff comment
And runner MUST NOT execute `goal_intake.propose`
And runner MUST NOT create child issues in that run

### 场景 T1.2：explicit split bootstrap uses goal-intake
Given a GitHub issue body says “把这个拆成多个任务并行做”
And the issue has no active ledger owner or active phase projection
When ordinary `@ceo` runs in bootstrap context
Then CEO MAY use `goal-intake`
And the visible result is a goal-intake interview, pending proposal, or proposal confirmation flow according to the existing goal-intake contract
And `default-plan-chain` MUST NOT be required for this explicit split/orchestration request

### 场景 T1.3：bootstrap route does not require visible ledger task ids
Given CEO outputs a valid `route` action with workflow id `default-plan-chain`
And `visibleTaskIds` is empty
When TypeScript parses CEO orchestration output
Then parsing succeeds
And no child issue descriptor or ledger task id validation is required for that route action

### 场景 T1.4：task-bound orchestration remains rejected without visible tasks
Given CEO outputs `spawn_child_issues` or `roundtable.start` in bootstrap context
And `visibleTaskIds` is empty
When TypeScript parses CEO orchestration output
Then parsing fails closed
And runner publishes the existing visible CEO orchestration failure path

### 场景 T1.5：external target-shaped issue body still enters through CEO
Given issue body says “我想做一个 X”
And issue body contains no legal agent mention
And the issue body is eligible for bounded no-mention fallback routing
When runner processes the issue
Then external route MAY append a single `@ceo` handoff
And the current run MUST NOT directly run CEO
When the next active poll processes the CEO handoff
Then ordinary CEO bootstrap applies scenario T1.1 or T1.2 based on the public timeline intent
