---
id: goal-intake
action: goal_intake
title: Goal intake
---

Use this workflow when a user explicitly asks to turn a broad goal into a staged local execution plan.

The workflow is intentionally bounded:

- Ask only 2-4 interview questions when required to identify the missing decisions.
- Propose 2-5 coarse milestones.
- Fully decompose only phase one, with 3-7 local child sessions.
- Each phase-one child task must have 1-3 mechanical acceptance statements.
- Implementation tasks default to dev. Rule maintenance goes to secretary, requirement clarification to product-manager, test design to qa, architecture tradeoffs to dev-manager, and user reaction validation to hermes-user.
- Quality baseline may default to demo if the proposal makes that assumption explicit and asks the user to correct it before confirmation.
- Payment examples such as Alipay-style products must state that the demo does not cover real funds movement, financial licenses, clearing, or settlement unless a later confirmed task explicitly changes the scope.

The CEO ordinary-agent response must be JSON plus the in-progress stage marker. Supported modes:

1. `interview`: ask the missing questions in the current local session. No child sessions are created.
2. `propose`: present a pending local plan. The user must confirm before child sessions are created.
3. `confirm`: confirm the pending proposal and let the local application create phase-one child sessions.

`switch_phase` remains a future contract. This workflow must not emit a runtime `switch_phase` side effect.
