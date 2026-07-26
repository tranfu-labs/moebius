# console-ui spec delta：defer-runtime-validation-to-execution

## MODIFIED Requirements

### Requirement: Agent execution profile editor has independent draft state

Source: docs/product/pages/agent-teams.md#Agent-运行配置

The selected member MUST expose the saved CLI, model and effort, its source, and eligible
restore/save actions without waiting for runtime capability data. CLI MUST be a Codex/Kimi enum;
model and effort MUST be direct text values with static validation. Profile drafts MUST survive
member switches independently of Agent Markdown drafts. Save failure MUST retain the draft and
state that the last saved profile remains effective. Leaving, duplicating or updating with either
draft type MUST use one combined save/discard/cancel guard.

### Scenario: Parent rerenders while a profile is displayed

- GIVEN a member's static profile is visible and the parent rerenders repeatedly with new callback identities
- WHEN no team or member data changes
- THEN the same profile and draft remain visible
- AND no loading state or additional profile-read request appears.

### Scenario: Blank model is not saved

- GIVEN a member has a valid saved profile
- WHEN the user clears model and attempts to save
- THEN the model field shows a static validation reason
- AND save is disabled or rejected
- AND the last saved profile remains effective.

### Scenario: Unknown text values are normalized and saved

- GIVEN a member has a valid saved profile
- WHEN the user enters `"  future-model  "` and `"  future-effort  "` and saves
- THEN the profile is saved and rendered as `future-model` and `future-effort`
- AND no local capability option is required.

### Requirement: Team page renders official management state without repair semantics

Source: docs/product/pages/agent-teams.md#官方版本与三方比较

The team list and detail MUST render official source, customized and update available from
server-provided state. Update available and customized MUST NOT create the Agent Teams sidebar
repair indicator. The UI MUST NOT recompute A/B/C fingerprints or protection rules and MUST NOT
introduce a runtime-profile management status.

#### Scenario: Customized official team has an update

- GIVEN the server returns official-source + customized + update-available
- WHEN the team row and detail render
- THEN both surfaces show those management states
- AND the sidebar repair indicator remains off unless an independent structural repair issue exists.

## REMOVED Requirements

### Requirement: Capability failure preserves saved profile visibly

本 change 删除团队页展示 unable-to-verify / needs-adjustment、保留 capability-derived 选项并
提供 recheck/adjust 的要求。结构有效的保存值直接进入静态编辑器；动态失败由真实 run 呈现。

## ADDED Requirements

### Requirement: Team management renders no runtime capability health

Source: docs/product/pages/agent-teams.md#运行配置静态校验

The team list and detail MUST NOT render “正在读取运行配置”, unable-to-verify,
needs-adjustment, recheck, capability-derived options or a runtime-profile repair badge. They MUST
render persisted profile values and ordinary static/save errors. Runtime availability MUST NOT
create the Agent Teams sidebar repair indicator.

### Scenario: Local Kimi is unavailable

- GIVEN a member has a structurally valid saved Kimi profile and local Kimi is unavailable
- WHEN team list and detail render
- THEN the saved CLI/model/effort are editable
- AND no runtime warning, recheck action or repair indicator appears.
