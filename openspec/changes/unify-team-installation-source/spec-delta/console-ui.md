# Console UI spec delta

## Requirement: Team management exposes installation source without update controls

Source: docs/product/pages/agent-teams.md#团队来源展示

The Agent Teams page MUST show a GitHub repository link when `installationSource.provider` is
`github`, and MAY show the official Moebius source label when it is `moebius`.
It MUST NOT show check, sync, revert, detach, following, unreachable, pending-update, or
recent-sync controls or statuses.

#### Scenario: Source metadata does not create a second team workflow

- **WHEN** a user opens an official or GitHub-installed team
- **THEN** the same local editing, execution-profile, repair, copy, and delete controls are used
- **AND** no source-specific update action is offered.
