# console-ui delta：console-message-run-humanization

说明：本文件供 OpenSpec CLI 严格校验；项目级镜像位于 `openspec/changes/console-message-run-humanization/spec-delta/console-ui/spec.md`。两者语义保持一致。

## ADDED Requirements

### Requirement: Agent messages use progressive disclosure

The console UI component library MUST provide an independent agent message component that defaults to a collapsed summary containing the localized role name, localized stage, conclusion, and handoff line.

The component MUST derive conclusion, stage marker, and handoff line from the raw agent Markdown by default.

The component MUST allow explicit conclusion, stage, and handoff fields to override the derived values.

The collapsed summary MUST NOT expose the English stage marker or other raw protocol metadata.

The expanded view MUST preserve the complete raw Markdown without deleting protocol metadata.

#### Scenario: Agent message is concise by default and auditable on demand

Given a raw agent response contains `## 结论`, a legal stage marker, and a handoff line
When the agent message Story first renders
Then the user sees the localized role, localized stage, conclusion, and handoff summary
And the complete raw response is not expanded by default
When the user expands the message
Then the complete original response is visible.

#### Scenario: Explicit structured fields override parsing

Given raw Markdown can be parsed and the caller also supplies explicit summary fields
When the agent message renders
Then each explicit field is shown in preference to its parsed counterpart
And the original raw Markdown remains unchanged in the expanded view.

### Requirement: Run blocks support steps and a no-step fallback

The console UI component library MUST provide an independent run block component with a presentation-only model that does not depend on local-console runtime types.

The run block MUST show the localized role name, human-readable elapsed time, and an accessible interrupt button whether or not step data exists.

When elapsed time is missing, empty, or whitespace-only, the run block MUST show「耗时未知」.

When steps exist, the run block MUST show each step as completed, running, or pending and MUST make each available raw step output expandable.

When steps do not exist, the run block MUST show a non-empty single-line human summary and MUST make available raw run output expandable.

When both steps and a usable summary are absent, the run block MUST show「正在运行，等待进展」instead of an empty card.

Raw output MUST remain collapsed by default.

#### Scenario: Planned run shows step progress

Given a run has completed, running, and pending steps
When its Story renders
Then every step and status is visible
And the localized role, elapsed time, and interrupt button are visible
And raw output is available through collapsed details.

#### Scenario: Unplanned run degrades to one useful line

Given a run has no step data but has a human summary and raw output
When its Story renders
Then the summary appears instead of an empty step area
And the localized role, elapsed time, and interrupt button are visible
And the raw output is available only after expanding details.

#### Scenario: Missing presentation data has a deterministic fallback

Given step data is absent and summary and elapsed time are missing, empty, or whitespace-only
When the run block renders
Then it shows「正在运行，等待进展」
And it shows「耗时未知」
And the run block is not blank.

### Requirement: Terminal run outcomes are humanized without losing evidence

The console UI component library MUST map failed to「运行失败」, stuck to「运行长时间无响应」, interrupted to「运行已中断」, and dead-letter to「多次尝试仍失败，已停止自动重试」in the user-visible summary.

The collapsed summary MUST NOT expose raw machine reasons such as `exit`, `idle-timeout`, or `dead-letter`.

The component MUST preserve the original machine reason and raw output in collapsed details that the user can expand.

The expanded content MUST preserve line breaks, angle brackets, ampersands, and machine strings such as `exit:42` as text without interpreting or altering them.

#### Scenario: Four terminal outcomes are understandable and auditable

Given Stories exist for failed, stuck, interrupted, and dead-letter outcomes with raw machine reasons
When each Story first renders
Then its user-visible area contains the confirmed Chinese summary
And raw `exit`, `idle-timeout`, and dead-letter strings are not visible
When the user expands details
Then the corresponding original machine reason is visible unchanged.

### Requirement: Disclosure and interrupt controls are keyboard-operable

Agent message, run step output, and run outcome disclosure controls MUST toggle within one Enter or Space activation.

Machine text inside each disclosure MUST be invisible to the user while collapsed and fully visible after expansion.

The run block interrupt button MUST invoke `onInterrupt` exactly once for one mouse activation and exactly once for one keyboard activation without crashing the component.

Visibility verification MUST use rendered browser visibility rather than treating text presence in the DOM as visible content.

#### Scenario: Keyboard toggles every disclosure once

Given agent message, run step output, and run outcome details are collapsed
When the user focuses each disclosure control and activates it once with Enter or Space
Then that disclosure toggles to expanded
And its complete machine text becomes visible
When the user activates it once again
Then it returns to collapsed
And its machine text is not visible.

#### Scenario: Interrupt fires once per activation

Given a run block receives an `onInterrupt` counting spy
When the user activates the interrupt button once with a mouse
Then the count increases by one
When the user activates the interrupt button once with a keyboard
Then the count increases by one again
And the component remains rendered.

#### Scenario: Special machine text is preserved behind disclosure

Given raw output contains line breaks, angle brackets, ampersands, and `exit:42`
When the component first renders collapsed
Then that raw content is not visible
When the user expands the disclosure
Then the rendered text content equals the original value.

### Requirement: Humanization composites remain isolated

The new agent message, run block, and run outcome components MUST be implemented as independent console-ui components and Stories.

This change MUST NOT modify `packages/console-ui/src/console/operator-console.tsx` or integrate the components into it.

This change MUST NOT modify `packages/console-ui/src/index.ts` or add shared package exports.

The components MUST NOT import local-console runtime, desktop IPC, runner, Codex, SQLite, or GitHub dependencies.

#### Scenario: The implementation stays within the parallel-safe slice

Given the change is ready for verification
When the changed file list and component imports are inspected
Then only independent component, Story, test, and OpenSpec files are present
And `operator-console.tsx` and `src/index.ts` are unchanged
And no runtime integration dependency has been introduced.
