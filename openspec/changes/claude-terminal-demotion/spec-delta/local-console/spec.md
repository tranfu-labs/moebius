# local-console 规格增量

## ADDED Requirements

### Requirement: Claude native confirmation choices use a narrow one-shot control

Source: docs/product/pages/main-conversation.md#Claude-运行中的呈现与原生确认

Local console MUST expose exactly one control route for answering a published Claude native confirmation, accepting only the session, the decision identifier and the selected option index. It MUST reject any request carrying keys, text, commands or an index outside the published option set, and MUST NOT provide any other path that writes to a Claude PTY on a user's behalf. The key actually written to the PTY MUST be derived server-side from the option index; the renderer MUST never supply or observe a key value.

A decision identifier MUST be minted per waiting turn and consumed at most once: repeated submissions MUST be idempotent and MUST NOT write the PTY again. Once the turn has left the waiting state — the user stopped it, the PTY exited, or the TUI was cleaned up — the route MUST reject the choice, explain that the state changed, and write nothing.

Ordered raw Claude terminal bytes MUST be retained per attempt for the diagnostics area rather than only for the active run, under a bounded retention policy; when retention is exceeded the run MUST report that attempt's terminal diagnostics as incomplete rather than silently truncating. Terminal bytes MUST remain excluded from public Agent text, Markdown parsing, lifecycle, outcome and usage.

#### Scenario: A choice writes exactly one key

- **GIVEN** a Claude turn is waiting on a published confirmation with three options
- **WHEN** the user selects the second option
- **THEN** local console writes the key for that option to the same PTY exactly once
- **AND** the request carried only the session, decision identifier and index.

#### Scenario: Repeated submission is idempotent

- **GIVEN** a choice for a decision identifier was already accepted
- **WHEN** the same choice arrives again
- **THEN** the response is idempotent
- **AND** no second key reaches the PTY.

#### Scenario: A stale choice is rejected

- **GIVEN** a waiting turn was stopped, exited or cleaned up
- **WHEN** a choice for its decision identifier arrives
- **THEN** the route rejects it and explains that the state changed
- **AND** nothing is written to any PTY.

#### Scenario: Arbitrary input is not accepted

- **GIVEN** a request carries a key sequence, free text, a command or an out-of-range index
- **WHEN** the control route validates it
- **THEN** the request is rejected
- **AND** no PTY write occurs.
