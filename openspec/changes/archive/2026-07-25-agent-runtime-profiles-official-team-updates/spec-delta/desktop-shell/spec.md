# desktop-shell delta：agent-runtime-profiles-official-team-updates

## MODIFIED Requirements

### Requirement: Team storage layout and write ownership

Source: docs/product/pages/agent-teams.md#官方来源团队详情

- MUST store teams under `<dataRoot>/teams/`, with official-source teams under the reserved
  `.system/` subtree and user teams as recorded siblings or relocated directories.
- MUST give official-source and user teams the same editable content shape: `team.json` plus
  `members/<slug>/AGENT.md` and allowed related member files.
- MUST store only team core in `team.json`; member identity remains owned by `AGENT.md`.
- MUST allow team core, primary agent, members and member files under `.system/` to be edited
  through the same validated store operations used for user teams.
- MUST keep the official source id stable and MUST reject deleting, trashing or converting an
  official-source team.
- MUST store execution bindings and official baseline metadata outside the team content directory.
- MUST NOT convert an official-source team into a user team because its content changed.

#### Scenario: Official content is editable but source identity is protected

- **GIVEN** an official-source team exists under `.system/development`
- **WHEN** the user changes its description, primary agent and one member `AGENT.md`
- **THEN** all three validated writes succeed
- **AND** the team remains official source `development`
- **AND** a request to trash that team is rejected below the UI.

### Requirement: Built-in team seeding by content fingerprint

Source: docs/product/pages/agent-teams.md#更新官方来源团队

- MUST package official team content and a versioned recommendation manifest in `seed/teams`.
- MUST register packaged content as the latest official version C without overwriting an existing
  editable `.system` team B.
- MUST create B and a verified applied baseline A from C only when that official team has never
  been installed.
- MUST migrate the legacy root marker conservatively: proven-clean content MAY become verified A;
  content that cannot be proven clean MUST be preserved and treated as customized.
- MUST NOT use a package fingerprint mismatch as authority to replace `.system`.
- MUST keep user team directories byte-identical while registering or applying official updates,
  except for an explicitly requested protective copy.

#### Scenario: Upgrade registers rather than applies

- **GIVEN** the current official-source team has local edits
- **WHEN** a new application version carries different official content
- **THEN** startup leaves the current team unchanged
- **AND** the team reports an available official update
- **AND** applying the packaged version still requires an explicit team-page action.

## ADDED Requirements

### Requirement: Agent execution profile is saved per team member

Source: docs/product/pages/agent-teams.md#Agent-运行配置

The desktop MUST save a complete CLI/model/effort profile for each stable team id and member slug.
Official members MUST distinguish current-version recommendation from user override; user teams and
user-added members MUST use explicit profiles. Bindings MUST survive team relocation and MUST NOT
enter team content fingerprints.

#### Scenario: Same slug in two teams remains independent

- **GIVEN** `@dev` exists in two stable teams
- **WHEN** one member is saved as Kimi/high and the other as Codex/medium
- **THEN** each team detail returns its own saved value
- **AND** changing either profile does not modify the other team or either `AGENT.md`.

### Requirement: Execution capabilities are probed without inventing options

Source: docs/product/pages/agent-teams.md#Agent-运行配置

The desktop MUST derive Codex and Kimi model/effort options from each local CLI's machine-readable
capability surface. A missing CLI, failed probe, unsupported protocol or stale option MUST produce a
safe structured status. The system MUST retain saved values and MUST NOT silently choose a different
CLI, model or effort. Raw stderr, secrets and local paths MUST NOT reach renderer DTOs.

#### Scenario: Kimi capability probe becomes unavailable

- **GIVEN** a member has a saved Kimi profile
- **AND** `kimi provider list --json` currently fails
- **WHEN** the team detail loads
- **THEN** it reports the profile as unable to verify and preserves all three saved values
- **AND** no Codex option is substituted.

### Requirement: Official three-way state is derived from A, B and C

Source: docs/product/pages/agent-teams.md#官方版本与三方比较

The desktop MUST compare the applied official baseline A, current editable content B and packaged
latest official version C. Team content fingerprints MUST include core/member content and MUST
exclude onboarding orchestration, official manifests, execution profiles, caches and internal
metadata. Protection for removed/renamed overridden members and user-member slug collisions MUST
take priority over a `B == C` fast path.

#### Scenario: Equal content still needs protection

- **GIVEN** B content equals C content
- **AND** C removes a member whose saved source is user override
- **WHEN** the update state is derived
- **THEN** the primary action is protective-copy-and-update
- **AND** the equal-content registration path is not offered.

### Requirement: Official update is explicit, planned and failure-safe

Source: docs/product/pages/agent-teams.md#更新官方来源团队

The desktop MUST show current/latest versions, member changes, recommendation changes and protected
bindings before update. It MUST revalidate an immutable update plan immediately before commit.
When protection is required it MUST create a valid user-team copy with explicit saved profiles
before making the official latest state visible. Failure or retry MUST leave either the complete old
state or the complete copy-plus-latest state, without visible partial copies or duplicate copies.

#### Scenario: Diverged content is preserved before update

- **GIVEN** B differs from A and C
- **WHEN** the user confirms protective-copy-and-update
- **THEN** a user team preserves B and every saved member profile as explicit
- **AND** the official team becomes C with same-slug overrides preserved and recommendations
  migrated
- **AND** the copy has no official update identity.

#### Scenario: Stale update plan is rejected

- **GIVEN** an update plan was prepared from a specific A/B/C state
- **AND** a member file changes before commit
- **WHEN** the plan is submitted
- **THEN** the store rejects it as stale
- **AND** neither the official team nor a user copy is changed.

### Requirement: Official member profile migration uses stable slug only

Source: docs/product/pages/agent-teams.md#官方成员与运行配置迁移

Same-slug overrides MUST remain unchanged; same-slug recommended members MUST adopt C's current
recommendation; new official slugs MUST use C's recommendation. Removed or renamed slugs MUST NOT
transfer profiles to another slug. Removing/renaming an overridden member and colliding with a
user-added slug MUST require a protective copy.

#### Scenario: Rename does not steal an override

- **GIVEN** A has overridden member `qa`
- **AND** C removes `qa` and adds `quality`
- **WHEN** the protected update completes
- **THEN** the user copy retains `qa` and its saved profile
- **AND** official `quality` uses C's recommendation
- **AND** `qa`'s profile is not attached to `quality`.
