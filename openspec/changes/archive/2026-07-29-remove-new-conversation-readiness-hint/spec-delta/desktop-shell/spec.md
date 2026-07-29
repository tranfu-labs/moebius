# desktop-shell delta：remove-new-conversation-readiness-hint

## MODIFIED Requirements

### Requirement: Environment capability probing remains outside team management

Source: docs/product/pages/agent-teams.md#Agent-运行配置
Source: docs/product/pages/agent-teams.md#非目标
Source: docs/product/pages/main-conversation.md#选择工作空间与团队

Execution capability probing MAY serve onboarding, AI team building or an explicit runtime diagnostics surface. The Agent Teams list/detail and profile mutation IPC MUST NOT expose capability snapshots, refresh actions, unable-to-verify state or needs-adjustment state. Removing team-management probing MUST NOT weaken onboarding's existing readiness, installation, revision or redaction contract.

The normal operator console MUST NOT start Codex/Kimi readiness checks on mount, shell-ready, team navigation or message submission. It MUST NOT consume onboarding readiness for new-conversation member preparation or compatibility presentation. It MUST preserve onboarding's post-install recheck while an installation initiated there is still completing.

#### Scenario: Opening a team while both CLIs are missing

- **GIVEN** neither Codex nor Kimi can be resolved on PATH
- **WHEN** the user opens a valid team and switches between members
- **THEN** every saved static profile remains readable and editable
- **AND** team management exposes no runtime-health state
- **AND** onboarding readiness behavior is unchanged.

#### Scenario: Opening the normal console does not expose readiness

- **GIVEN** onboarding is not active and readiness is checking, ready, missing, needs-login or unavailable
- **WHEN** the normal operator console mounts, receives shell-ready, opens Agent Teams and enters new conversation
- **THEN** neither Codex nor Kimi readiness check is started for normal-console presentation
- **AND** no readiness snapshot drives member preparation or compatibility copy in new conversation.

#### Scenario: Onboarding installation finishes after entering the console

- **GIVEN** onboarding started a CLI installation and the user entered the normal console while it was running
- **WHEN** that installation succeeds
- **THEN** the shell rechecks only the installed CLI according to the onboarding contract
- **AND** the result is not projected into a new-conversation preparation hint.
