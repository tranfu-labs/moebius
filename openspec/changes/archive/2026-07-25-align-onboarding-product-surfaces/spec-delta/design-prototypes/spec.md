# design-prototypes 规格增量

## MODIFIED Requirements

### Requirement: Complete interactive onboarding journey

Source: `docs/product/pages/onboarding.md#操作与反馈`

The prototype MUST use generic ready-state copy without claiming a concrete Codex version because it does not run the production environment check. It MUST enforce the environment hard gate for both missing and unavailable Codex states, carry the selected team through the first-run journey, allow the relay demonstration to be replayed or skipped by continuing, and finish first-run onboarding in a new-conversation state that visibly retains the selected team.

#### Scenario: Ready review does not fake a version

- **GIVEN** the self-contained prototype is opened in its ready environment scenario
- **WHEN** step one is shown
- **THEN** generic Codex-ready copy is visible
- **AND** no concrete Codex version is presented as a detected result

#### Scenario: Happy path reaches new conversation

- **GIVEN** the environment check passes and a team is selected in first-run mode
- **WHEN** the reviewer activates each primary action through step four
- **THEN** the prototype shows the new-conversation destination
- **AND** the destination displays the selected team

#### Scenario: Missing Codex blocks progress

- **GIVEN** the missing-Codex review scenario
- **WHEN** step one is shown
- **THEN** the primary continue action is disabled
- **AND** the install command and copy action are visible
- **AND** a recheck action can restore the ready state without reloading

#### Scenario: Unavailable Codex blocks progress without installation guidance

- **GIVEN** the unavailable-Codex review scenario
- **WHEN** step one is shown
- **THEN** the primary continue action is disabled
- **AND** the approved login / troubleshooting guidance and recheck action are visible
- **AND** no install command, copy action, raw error, or local path is visible
- **AND** a successful recheck restores the ready state without reloading

## ADDED Requirements

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
