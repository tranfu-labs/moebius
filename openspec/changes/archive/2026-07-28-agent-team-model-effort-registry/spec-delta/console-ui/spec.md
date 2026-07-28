## MODIFIED Requirements

### Requirement: Agent execution profile editor has independent draft state

Source: docs/product/pages/agent-teams.md#Agent-运行配置

The selected member MUST expose the saved CLI, model and effort, its source, and eligible restore/save
actions without waiting for runtime capability data. CLI MUST be a Codex/Kimi enum. Model MUST be a
dropdown backed by the product-bundled registry for the selected CLI, and effort MUST be a dropdown
containing only the selected model's supported efforts. Changing CLI MUST choose that CLI's compatibility
default. Changing model MUST preserve the current effort only when the new model supports it and otherwise
choose the model's default effort.

A previously saved model or effort absent from the current registry MUST remain visible as an explicitly
unsupported legacy custom value. Opening the detail, switching members and parent rerenders MUST NOT
replace or persist that value. Selecting a current model MUST replace the legacy draft with a supported
model/effort combination.

Profile drafts MUST survive member switches independently of Agent Markdown drafts. Save failure MUST
retain the draft and state that the last saved profile remains effective. Leaving, duplicating or updating
with either draft type MUST use one combined save/discard/cancel guard.

#### Scenario: Profile save fails while Markdown is clean

- **GIVEN** a member has a dirty execution-profile draft and no Markdown draft
- **WHEN** save fails
- **THEN** all draft selections remain visible
- **AND** the saved profile is still identified as effective
- **AND** leaving the detail still triggers the dirty guard.

#### Scenario: Parent rerenders while a profile is displayed

- **GIVEN** a member's static profile is visible and the parent rerenders repeatedly with new callback identities
- **WHEN** no team or member data changes
- **THEN** the same profile and draft remain visible
- **AND** no loading state or additional profile-read request appears.

#### Scenario: Model selection updates its effort choices

- **GIVEN** a member profile editor shows a supported CLI/model/effort combination
- **WHEN** the user selects another model
- **THEN** the effort dropdown contains only efforts supported by the new model
- **AND** an effort supported by both models remains selected
- **AND** an unsupported effort is replaced by the new model's default.

#### Scenario: Historical unknown profile remains visible

- **GIVEN** a member previously saved a model or effort absent from the bundled registry
- **WHEN** the user opens the detail or switches away and back
- **THEN** the original value remains selected and is labelled as an unsupported legacy custom value
- **AND** no save occurs until the user selects a supported combination and explicitly saves it.
