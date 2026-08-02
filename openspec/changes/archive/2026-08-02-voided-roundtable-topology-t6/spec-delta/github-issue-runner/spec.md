# github-issue-runner Delta

## Added Rules
- MUST support a v0 serialized roundtable topology as a CEO ordinary-agent workflow, not as a new moderator agent.
- MUST load a required CEO script `roundtable-plan-review` whose action is `roundtable`.
- MUST keep v0 roundtable compatible with the global GitHub interaction protocol: each published roundtable handoff comment MUST contain at most one legal agent mention.
- MUST NOT change the default mention trigger to fan out to multiple agents as part of v0.
- MUST let CEO start a roundtable only through structured `roundtable` orchestration output validated by TypeScript.
- MUST create or recover a same-repository child issue as the roundtable venue before asking multiple roles to speak.
- MUST render roundtable child issue bodies with parent issue reference, workflow id, ledger task id when available, hidden roundtable key, quality baseline, topic, input summary, ordered participants, fixed one-round rule, initial handoff, and provenance.
- MUST instruct roundtable participants that their response is a sourced roundtable contribution, not the formal `plan-written` qa gate or final acceptance gate, and that control returns to CEO after their contribution.
- MUST use a stable hidden roundtable key that does not depend on title, free-text description, or CEO wording.
- MUST recover existing roundtable child issues by hidden key before creating a new issue.
- MUST keep roundtable provenance in child issue body, CEO output, parent issue summary, and bounded task child ref notes; MUST NOT add a dedicated runtime state file for roundtable v0.
- MUST route v0 roundtable participants serially inside the child issue, one participant per handoff.
- MUST make each participant handoff ask the participant to return control to CEO after speaking.
- MUST render participant handoff bodies through runner-controlled roundtable rendering that forces the return-to-CEO instruction; raw CEO wording alone MUST NOT be trusted for that instruction.
- MUST write the return-to-CEO instruction in a handoff comment without adding a second legal `@ceo` mention; the handoff comment's only legal mention remains the target participant.
- MUST verify the next route target is the next not-yet-spoken participant, based on normalized timeline speaker identity rather than natural-language self-claims.
- MUST verify route bodies contain exactly one legal mention and that mention targets the expected next participant.
- MUST detect a roundtable participant comment that lacks a handoff back to CEO before normal no-trigger absorption.
- MUST publish a visible single-mention recovery comment to `@ceo` when a participant has spoken without handing control back to CEO.
- MUST publish a visible correction and avoid following the wrong handoff when a roundtable participant routes control to a non-CEO role.
- MUST dedupe no-handoff recovery for the same participant source comment.
- MUST verify roundtable completion only after every participant has spoken in the child issue.
- MUST require roundtable completion summaries to preserve each participant's source role, position, evidence, and disagreements.
- MUST post completed roundtable summaries back to the parent issue with a hidden completion key and a link to the child issue.
- MUST derive the hidden completion key from roundtable key, ordered participants, and participant source message identities; it MUST NOT include CEO summary wording.
- MUST dedupe parent roundtable summary posts by hidden completion key, including retries after child completion notice or CEO role-thread save failures.
- MUST leave a visible fail-closed trail when a participant has not responded, when CEO attempts to summarize without all required contributions, or when parent issue return fails.
- MUST leave a visible fail-closed trail that includes the created child issue URL when child issue creation succeeds but ledger child-ref save fails.
- MUST bound hidden-key lookup, child issue creation, parent issue fetch/post, child issue post, and ledger child-ref save operations.
- MUST recover already-created roundtable child issues by hidden key after ledger child-ref save failure, without creating duplicates.
- MUST NOT treat a roundtable completion as T4 integration acceptance pass.
- MUST NOT change existing `plan-written` qa review governance; roundtable review is an explicit dogfood workflow, not an automatic replacement.
- MUST NOT grant new workspaceAccess through roundtable; participants keep their existing agent persona permissions.
- MUST record v1 fan-out + join primitive as future design only until v0 dogfood demonstrates value.
- MUST NOT implement runtime multi-agent fan-out, multi-mention trigger exceptions, observer UI changes, goal-intake, or visual dogfood as part of T6 v0.

## Added Scenarios
### Scenario T6.1: start creates one roundtable child issue
Given CEO outputs a valid `roundtable.start` for workflow `roundtable-plan-review`
When runner processes the output on the parent issue
Then exactly one same-repository child issue is created or recovered by hidden roundtable key
And the parent issue receives a visible comment linking the child issue and listing the ordered participants

### Scenario T6.2: child body contains required roundtable fields
Given a roundtable child issue is rendered
When the body is inspected
Then it contains parent issue reference, workflow id, roundtable key, topic, input summary, participants, fixed one-round rule, initial handoff, and provenance
And it instructs participants to return control to CEO after contributing
And it contains exactly one legal initial handoff mention

### Scenario T6.3: route advances one participant at a time
Given qa has spoken in a roundtable child issue
And dev-manager has not spoken
When CEO outputs a valid `roundtable.route` to dev-manager
Then runner posts one child issue comment containing exactly one legal mention to dev-manager
And the rendered handoff instructs dev-manager to return control to CEO after speaking
And no parent issue comment is posted

### Scenario T6.4: route cannot skip or repeat participants
Given the next required participant has not spoken
When CEO outputs a route to a later participant or to an already-spoken participant
Then runner rejects the route visibly
And it does not publish the invalid handoff

### Scenario T6.5: completion waits for every participant
Given a roundtable child issue is missing a required participant comment
When CEO outputs `roundtable.complete`
Then runner posts a visible child issue failure that lists the missing participant
And no parent summary is posted

### Scenario T6.5a: participant missing CEO handoff is recovered
Given a roundtable participant has posted a sourced contribution without a legal `@ceo` handoff
When runner processes the child issue before normal no-trigger absorption
Then runner posts one visible recovery comment with exactly one legal mention to CEO
And the child issue does not silently downgrade to idle without a visible trail

### Scenario T6.6: completion preserves disagreement sources
Given qa, dev-manager, and hermes-user have all spoken
When CEO outputs `roundtable.complete`
Then the parent issue summary includes each role's position, evidence, and disagreements
And it does not collapse conflicting opinions into an unattributed consensus

### Scenario T6.7: parent return failure is visible
Given every participant has spoken
And posting the roundtable summary to the parent issue fails
When runner handles completion
Then the child issue receives a fail-closed explanation
And CEO role thread is not saved for that failed completion

### Scenario T6.7a: parent summary dedupe survives completion cleanup failure
Given the parent issue summary was posted successfully
And posting the child completion notice or saving the CEO role thread fails
When CEO retries completion with different summary wording
Then runner detects the existing parent summary by the same completion key
And it does not post a second parent summary

### Scenario T6.7b: start partial success recovers by hidden key
Given roundtable child issue creation succeeds
And saving the ledger child ref times out
When runner records the visible failure
Then the failure body includes the created child issue URL
And a later retry recovers that child issue by hidden roundtable key without creating a duplicate

### Scenario T6.7c: hidden-key lookup timeout is bounded
Given roundtable hidden-key lookup never settles
When the configured timeout elapses
Then runner returns visibly through fail-closed or existing retry/dead-letter handling
And the issue does not remain permanently in-flight

### Scenario T6.8: roundtable is not integration acceptance
Given a roundtable completes successfully
When goal-ledger integration join is evaluated
Then the roundtable completion alone is not treated as a child acceptance pass or parent integration acceptance event

### Scenario T6.9: v1 fan-out remains inactive
Given a message contains multiple legal agent mentions outside code regions
When mention trigger evaluates the latest message
Then v0 behavior still selects at most the first supported mention
And no fan-out or join primitive is invoked
