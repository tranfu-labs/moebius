# console-ui delta：agent-runtime-profiles-official-team-updates

## ADDED Requirements

### Requirement: Official-source detail separates content editing from deletion protection

Source: docs/product/pages/agent-teams.md#官方来源团队详情

Official-source identity and team deletion MUST remain protected, while team information, primary
agent, members, member files and execution profiles MUST use the same editable controls and draft
protection as user teams. The UI MUST NOT derive all editability from `ownership === "system"`.

#### Scenario: Official team detail exposes content editing

- **GIVEN** an official-source team detail is usable
- **WHEN** the user opens its information, member and primary-agent controls
- **THEN** the same validated edit actions as a user team are available
- **AND** the team-level delete action remains absent.

### Requirement: Team page renders official management state without repair semantics

Source: docs/product/pages/agent-teams.md#官方版本与三方比较

The team list and detail MUST render official source, customized, update available and unable to
check update from server-provided state. Update available, customized and execution-profile
adjustment MUST NOT create the Agent Teams sidebar repair indicator. The UI MUST NOT recompute
A/B/C fingerprints or protection rules.

#### Scenario: Customized official team has an update

- **GIVEN** the server returns official-source + customized + update-available
- **WHEN** the team row and detail render
- **THEN** both surfaces show those management states
- **AND** the sidebar repair indicator remains off unless an independent structural repair issue
  exists.

### Requirement: Agent execution profile editor has independent draft state

Source: docs/product/pages/agent-teams.md#Agent-运行配置

The selected member MUST expose CLI, model and effort from a capability snapshot, its source, and
available restore/save actions. Profile drafts MUST survive member switches independently of Agent
Markdown drafts. Save failure MUST retain the draft and state that the last saved profile remains
effective. Leaving, duplicating or updating with either draft type MUST use one combined
save/discard/cancel guard.

#### Scenario: Profile save fails while Markdown is clean

- **GIVEN** a member has a dirty execution-profile draft and no Markdown draft
- **WHEN** save fails
- **THEN** all draft selections remain visible
- **AND** the saved profile is still identified as effective
- **AND** leaving the detail still triggers the dirty guard.

### Requirement: Official update shows impact before and facts after

Source: docs/product/pages/agent-teams.md#更新官方来源团队

Before update, the detail MUST show current/latest versions, member changes, recommendation
changes, protected members and whether a copy will be created. The primary action MUST be direct
update or protective-copy-and-update exactly as returned by the server. Success MUST identify the
applied version and actual changes; when a copy exists it MUST provide its stable name and an entry
to that team. Failure MUST retain the prior team and retry action.

#### Scenario: Protected update completes

- **GIVEN** the impact summary says overridden member `qa` will be removed and protected in a copy
- **WHEN** protective-copy-and-update succeeds
- **THEN** the success result names the applied version, removed member and copy
- **AND** the user can enter that copy from the result.

### Requirement: Capability failure preserves saved profile visibly

Source: docs/product/pages/agent-teams.md#运行配置不可用

Unable-to-verify and needs-adjustment states MUST show the saved CLI/model/effort when safe, explain
that no replacement occurred, and offer recheck/adjust plus restore recommendation when eligible.
This page MUST NOT decide or claim whether the state blocks conversation creation.

#### Scenario: Saved model is no longer supported

- **GIVEN** the server confirms the saved model is unsupported
- **WHEN** the member profile renders
- **THEN** the original value remains visible with needs-adjustment
- **AND** no replacement model is selected
- **AND** no conversation-creation policy text is introduced.
