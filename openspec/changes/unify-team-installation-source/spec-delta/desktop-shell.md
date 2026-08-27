# Desktop shell spec delta

## Requirement: Installed team source metadata is descriptive only

Source: docs/product/pages/agent-teams.md#安装来源与团队生命周期

The desktop MUST persist an installed team's `installationSource` as either
`{ provider: "moebius" }` or `{ provider: "github", repository, defaultBranch }`.
This metadata MUST describe where the team was installed from and MUST NOT create an
automatic update, check, sync, detach, or revert obligation.

#### Scenario: Official and GitHub installations share the local model

- **WHEN** an official packaged team or a GitHub team is installed
- **THEN** both are written as ordinary local team records with explicit execution bindings
- **AND** the only source-specific persisted data is `installationSource`
- **AND** no `official-state-v1.json` entry is created for the new installation.

## Requirement: Team discovery does not depend on official state

Source: docs/product/pages/agent-teams.md#Agent 团队页如何发现本地团队

The desktop MUST discover a new installed team from its team directory and team record.
Missing `official-state-v1.json` or packaged `official.json` MUST NOT make that team invisible
or unusable.

#### Scenario: New team is visible without official state

- **GIVEN** a valid installed team directory and record
- **AND** no official state document exists for that team
- **WHEN** the Agent Teams page loads
- **THEN** the team is listed and can be opened and selected for a new conversation.

## Requirement: Legacy official teams remain readable without synchronization

Source: docs/product/pages/agent-teams.md#存量官方团队兼容

The desktop MUST continue reading existing `.system` official team directories and historical
session ownership without moving or overwriting their content. It MUST NOT run official baseline
migration or automatic synchronization for them.

#### Scenario: Legacy official team starts after sync removal

- **GIVEN** an existing `.system` official team and historical session are present
- **WHEN** the desktop starts
- **THEN** the team and session remain discoverable and usable when their files are valid
- **AND** no packaged `official.json` lookup is required for startup synchronization.
