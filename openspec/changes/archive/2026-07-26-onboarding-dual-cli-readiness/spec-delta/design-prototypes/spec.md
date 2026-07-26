# design-prototypes 规格增量

## MODIFIED Requirements

### Requirement: Complete interactive onboarding journey

Source: `docs/product/pages/onboarding.md#操作与反馈`

The self-contained onboarding prototype MUST model Codex and Kimi as independent readiness and
installation rows without claiming concrete detected versions. Codex-only, Kimi-only, and dual-ready
scenarios MUST continue; only dual-not-ready MUST block. Missing, needs-login, unavailable, checking,
installing, failed, cancelled, and recovered states MUST remain deterministic and MUST make no
external request.

#### Scenario: Kimi-only prototype journey

- **GIVEN** the Kimi-only review scenario
- **WHEN** step one is shown
- **THEN** continue is enabled
- **AND** AI team building identifies Kimi
- **AND** partial team compatibility remains visible through completion and destination.

#### Scenario: Installation recovery

- **GIVEN** a failed installation fixture
- **WHEN** the reviewer retries the affected CLI
- **THEN** the row immediately shows ongoing feedback
- **AND** success auto-checks only that row and reaches ready
- **AND** no external installer or network request is made.

## ADDED Requirements

### Requirement: Prototype verifies dual CLI install aggregation

Source: `docs/product/pages/onboarding.md#操作与反馈`

The prototype MUST provide deterministic single and dual installation fixtures whose header
aggregation, per-CLI cancellation, failure, retry, success, and navigation persistence can be
verified from the self-contained HTML.

#### Scenario: Reviewer navigates while two installations run

- **GIVEN** both deterministic installers are active and one CLI is already ready
- **WHEN** the reviewer leaves step one
- **THEN** the header keeps a two-task aggregate
- **AND** opening it identifies both CLI tasks and their current stages.
