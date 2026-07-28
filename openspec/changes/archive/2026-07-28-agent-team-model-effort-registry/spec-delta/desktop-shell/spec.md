## MODIFIED Requirements

### Requirement: Agent execution profile is saved per team member

Source: docs/product/pages/agent-teams.md#Agent-运行配置

The desktop MUST save a complete CLI/model/effort profile for each stable team id and member slug.
Team list, detail, save and recommendation-restore operations MUST resolve only persisted bindings,
current applied recommendations and static profile rules. They MUST NOT spawn, probe, authenticate or
enumerate Codex or Kimi. Official members MUST distinguish recommendation from user override; user
teams and user-added members MUST use explicit profiles. Bindings MUST survive team relocation and
MUST NOT enter team content fingerprints.

The desktop MUST expose a product-bundled model registry for new Agent Team profile selections. The
registry MUST map each selectable CLI model to that model's own effort list. A member without a
persisted binding or applied official recommendation MUST resolve to `Codex / gpt-5.6-sol / high`.
The UI MUST preserve a previously saved model or effort absent from the current registry as an
explicitly unsupported legacy custom value until the user selects a supported combination.
Persistence, copy, official-update and runtime snapshot boundaries MUST continue accepting and
preserving those legacy values.

The Codex selection registry MUST include `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`,
`gpt-5.4` and `gpt-5.4-mini`; it MUST NOT offer `ultra` or `gpt-5.3-codex-spark`. The Kimi registry
MUST save the full aliases `kimi-code/k3`, `kimi-code/k3-256k`, `kimi-code/kimi-for-coding` and
`kimi-code/kimi-for-coding-highspeed`, and MUST label membership-restricted choices.

#### Scenario: Same slug in two teams remains independent

- **GIVEN** `@dev` exists in two stable teams
- **WHEN** one member is saved as Kimi/k3/high and the other as Codex/medium
- **THEN** each team detail returns its own saved value
- **AND** changing either profile does not modify the other team or either `AGENT.md`.

#### Scenario: Model selection exposes only its supported efforts

- **GIVEN** the user edits an Agent Team member runtime profile
- **WHEN** the user selects a CLI and model
- **THEN** model is a dropdown containing that CLI's bundled models
- **AND** effort is a dropdown containing only the selected model's supported efforts
- **AND** changing model preserves the effort only when the new model supports it
- **AND** neither Codex nor Kimi is started.

#### Scenario: Missing binding uses the Codex default

- **GIVEN** a team member has neither a persisted binding nor an applied official recommendation
- **WHEN** the team detail or a new conversation snapshot resolves the member
- **THEN** its effective profile is `Codex / gpt-5.6-sol / high`
- **AND** no prior settings save is required.

#### Scenario: Unsupported historical value is preserved

- **GIVEN** a member already stores a model or effort absent from the bundled registry
- **WHEN** the team detail opens or the user switches between members
- **THEN** the original values remain selected and are labelled as an unsupported legacy custom profile
- **AND** the values are not silently replaced or persisted
- **WHEN** the user selects a supported model
- **THEN** the draft changes to a supported model/effort combination that can be saved.

#### Scenario: Static profile is invalid at the persistence boundary

- **GIVEN** a persisted, imported or IPC profile contains only whitespace for model or effort
- **WHEN** the desktop validates the profile
- **THEN** it is rejected with a field-safe reason
- **AND** the previous binding remains effective
- **AND** no CLI capability result is consulted.
