# goal-ledger spec delta：ceo-default-plan-chain

## 新增行为规则

- MUST treat goal-intake ledger admission as an explicit orchestration path, not as the default result of every target-shaped issue body.
- MUST NOT create draft, pending, ready goal, milestone, phase, task, or child issue references merely because ordinary CEO bootstrap routes a plain target-shaped request through `default-plan-chain`.
- MUST allow ledger writes for goal-intake only after the caller has selected the `goal-intake` workflow for explicit split/orchestration intent, or after a user confirms an existing goal-intake proposal.
- MUST keep the goal-ledger module free of natural-language split-intent parsing; callers decide whether they are executing `default-plan-chain` or `goal-intake`, and the ledger only validates the structured state mutation it receives.

## 新增场景

### 场景 T4.1：default plan-chain bootstrap does not write ledger entries
Given an empty goal ledger
And ordinary CEO bootstrap routes “我想做一个 X” through `default-plan-chain`
When the route handoff is published
Then the goal ledger remains unchanged
And no pending goal-intake proposal is recorded
And no task child issue reference is recorded

### 场景 T4.2：explicit split may enter goal-intake ledger admission
Given an empty goal ledger
And ordinary CEO bootstrap receives “把这个拆成多个任务并行做”
When CEO selects `goal-intake.propose`
Then the existing goal-intake pending proposal helpers MAY write pending goal, milestone, phase, and task entries according to the goal-intake contract
And the write remains subject to existing ready-field, provenance, quality baseline, and atomic persistence validation
