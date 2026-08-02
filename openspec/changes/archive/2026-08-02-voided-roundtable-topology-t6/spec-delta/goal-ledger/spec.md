# goal-ledger Delta

## Added Rules
- MUST allow T6 roundtable child issues to be referenced with existing task child issue refs and bounded notes.
- MUST allow bounded notes on child refs to contain a hidden roundtable key and short provenance summary.
- MUST NOT introduce dedicated roundtable entities, participant state, fan-out state, or moderator state into goal-ledger for v0.
- MUST NOT treat roundtable completion as child acceptance fact, integration acceptance event, phase switch, or task status transition.
- MUST keep goal-ledger pure: roundtable creation, participant routing, parent issue return, hidden-key lookup, and GitHub comments remain runner / GitHub adapter responsibilities.

## Added Scenarios
### Scenario T6.GL1: roundtable child ref uses existing bounded note
Given runner creates or recovers a roundtable child issue for a visible ledger task
When it records the child reference
Then the task child refs can store the child issue with relation `child`, status `open`, and a bounded note containing the hidden roundtable key
And no new roundtable-specific top-level ledger collection is required

### Scenario T6.GL2: roundtable completion is not acceptance
Given a task has a roundtable child ref
And the roundtable child issue has a completed summary
When integration acceptance join evaluates the current active phase
Then that roundtable completion is not counted as a passed child acceptance fact
And no integration acceptance event is recorded from roundtable completion alone

### Scenario T6.GL3: ledger does not route participants
Given a roundtable child issue has pending participants
When participant routing is needed
Then goal-ledger does not compute next participant, call GitHub, or inspect issue comments
And runner / CEO orchestration remains responsible for roundtable routing side effects
