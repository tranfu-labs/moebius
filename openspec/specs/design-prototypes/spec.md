# Design Prototypes Specification

### Requirement: Isolated high-fidelity prototype sandbox

The repository MUST keep high-fidelity prototype authoring isolated from product implementation code: prototype source MUST NOT import product runtime or UI packages, and product source MUST NOT import prototype source.

#### Scenario: Production and prototype dependency graphs remain separate

- **GIVEN** the prototype workspace and production workspaces are installed
- **WHEN** source imports are scanned
- **THEN** no import crosses between `prototypes/` and `src/`, `desktop/`, or `packages/`

### Requirement: Self-contained onboarding prototype

Source: `docs/product/pages/onboarding.md#指标与验收`

The onboarding high-fidelity prototype MUST build to one HTML file whose required script, style, image, icon, and font resources are embedded and which MUST open from a local file URL without network access.

#### Scenario: Reviewer opens the artifact offline

- **GIVEN** `docs/product/pages/onboarding.prototype.html`
- **WHEN** a reviewer opens it without a development server or network access
- **THEN** the four onboarding steps render and remain interactive
- **AND** no required resource request leaves the local file

### Requirement: Complete interactive onboarding journey

Source: `docs/product/pages/onboarding.md#操作与反馈`

The prototype MUST model Codex and Kimi as independent readiness and installation rows without claiming concrete detected versions. Codex-only, Kimi-only, and dual-ready scenarios MUST continue; only dual-not-ready MUST block. Missing, needs-login, unavailable, checking, installing, failed, cancelled, and recovered states MUST remain deterministic and MUST make no external request. The journey MUST carry the selected team through first run, allow the relay demonstration to be replayed or skipped, and finish in a new-conversation state that visibly retains the selected team and any compatibility warning.

#### Scenario: Ready review does not fake a version

- **GIVEN** the self-contained prototype is opened in a ready environment scenario
- **WHEN** step one is shown
- **THEN** generic ready copy is visible for each ready CLI
- **AND** no concrete CLI version is presented as a detected result

#### Scenario: Happy path reaches new conversation

- **GIVEN** the environment check passes and a team is selected in first-run mode
- **WHEN** the reviewer activates each primary action through step four
- **THEN** the prototype shows the new-conversation destination
- **AND** the destination displays the selected team

#### Scenario: Kimi-only continues

- **GIVEN** Codex is missing and Kimi is ready
- **WHEN** step one is shown
- **THEN** the primary continue action is enabled
- **AND** the Codex row retains its independent install action
- **AND** AI team building identifies Kimi.

#### Scenario: Both CLIs unavailable block progress

- **GIVEN** neither Codex nor Kimi is ready
- **WHEN** step one is shown
- **THEN** the primary continue action is disabled
- **AND** each row keeps its own approved install, login, or troubleshooting action
- **AND** no raw error or local path is visible.

#### Scenario: Installation recovery

- **GIVEN** a deterministic failed-installation fixture
- **WHEN** the reviewer retries the affected CLI
- **THEN** the row immediately shows ongoing staged feedback
- **AND** success auto-checks only that row and reaches ready
- **AND** no external installer or network request is made.

### Requirement: Prototype verifies dual CLI install aggregation

Source: `docs/product/pages/onboarding.md#操作与反馈`

The prototype MUST provide deterministic single and dual installation fixtures whose header aggregation, per-CLI cancellation, failure, retry, success, and navigation persistence can be verified from the self-contained HTML.

#### Scenario: Reviewer navigates while two installations run

- **GIVEN** both deterministic installers are active and one CLI is already ready
- **WHEN** the reviewer leaves step one
- **THEN** the header keeps a two-task aggregate
- **AND** opening it identifies both CLI tasks and their current stages.

### Requirement: Onboarding prototype supports deterministic replay review

Source: `docs/product/pages/onboarding.md#重新查看引导`

The self-contained prototype MUST provide a deterministic replay fixture that enters the same four-step onboarding from a mock main page with identifiable project, conversation, draft, and team display state. Replay MUST show “回看引导” and “退出”, MUST keep “开始使用” as the step-four primary action, and MUST return to the exact entry fixture on exit or step-four completion without applying the replay-only team selection.

#### Scenario: Reviewer exits replay

- **GIVEN** the reviewer enters replay from the deterministic mock main page
- **WHEN** the reviewer activates “退出”
- **THEN** the same project, conversation, draft, and team display state is visible
- **AND** first-run completion is not simulated.

#### Scenario: Reviewer finishes replay with the unchanged CTA

- **GIVEN** the reviewer entered replay and selected a different team for the relay demonstration
- **WHEN** the reviewer reaches step four and activates “开始使用”
- **THEN** the prototype returns to the same entry fixture
- **AND** the replay-only team selection is not applied to that fixture
- **AND** “完成回看” is not displayed.

#### Scenario: First-run remains independent

- **GIVEN** the prototype is opened without replay mode
- **WHEN** the reviewer completes step four with “开始使用”
- **THEN** the prototype still shows the new-conversation destination with the selected team
- **AND** no replay exit action is displayed.

### Requirement: Prototype AI builder preserves user-turn timing

Source: `docs/product/pages/onboarding.md#第-2-步-ai-建队`

For every mock AI team-builder turn, including natural-language proposal adjustment, the prototype MUST append the submitted text as a right-aligned user message before the mock reply is released. The pending typing indicator MUST follow that message. After the mock reply arrives, the submitted body MUST remain visible exactly once and MUST NOT be duplicated inside the assistant acknowledgement.

#### Scenario: Adjustment waits for the mock AI reply

- **GIVEN** a proposal is visible and the reviewer starts a natural-language adjustment
- **WHEN** the reviewer submits the adjustment while the mock reply is still pending
- **THEN** the adjustment is immediately visible in a right-aligned user bubble
- **AND** the typing indicator appears after that bubble
- **AND** the adjustment cannot be submitted again.

#### Scenario: Adjustment reply converges without duplication

- **GIVEN** the submitted adjustment and following typing indicator are visible
- **WHEN** the deterministic mock reply arrives
- **THEN** the typing indicator is removed and the proposal becomes confirmable
- **AND** the exact submitted adjustment body appears once in the conversation.

### Requirement: Motion remains optional

Source: `docs/product/pages/onboarding.md#第-3-步重播与继续`

The prototype MUST present equivalent relay order and current-member information when reduced motion is requested, without relying on continuous spatial movement.

#### Scenario: Reduced-motion reviewer follows the relay

- **GIVEN** reduced motion is active
- **WHEN** the relay demonstration runs
- **THEN** each relay stage remains identifiable through static highlight and content changes
- **AND** the reviewer can replay or continue normally

### Requirement: Onboarding prototype mirrors the implemented desktop presentation

Source: `docs/product/pages/onboarding.md#页面结构`

The isolated onboarding prototype MUST present the same user-facing step titles, subtitles, team-selection labels, AI team-builder labels and actions, relay-demo labels, and completion actions as the current approved desktop onboarding page. Review-only controls MAY remain outside the product surface, but MUST NOT replace or alter product copy.

#### Scenario: Reviewer compares prototype copy with the approved page

- **GIVEN** the onboarding PRD records the approved desktop presentation
- **WHEN** a reviewer opens `docs/product/pages/onboarding.prototype.html`
- **THEN** every onboarding step uses the PRD-recorded title and subtitle
- **AND** the AI builder and relay demonstration expose the PRD-recorded labels and actions
- **AND** review-only controls are visibly identified as outside the product interface
