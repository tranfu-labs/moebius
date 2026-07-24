### Requirement: Onboarding prototype mirrors the implemented desktop presentation

Source: `docs/product/pages/onboarding.md#页面结构`

The isolated onboarding prototype MUST present the same user-facing step titles, subtitles, team-selection labels, AI team-builder labels and actions, relay-demo labels, and completion actions as the current approved desktop onboarding page. Review-only controls MAY remain outside the product surface, but MUST NOT replace or alter product copy.

#### Scenario: Reviewer compares prototype copy with the approved page

- **GIVEN** the onboarding PRD records the approved desktop presentation
- **WHEN** a reviewer opens `docs/product/pages/onboarding.prototype.html`
- **THEN** every onboarding step uses the PRD-recorded title and subtitle
- **AND** the AI builder and relay demonstration expose the PRD-recorded labels and actions
- **AND** review-only controls are visibly identified as outside the product interface
