# console-ui 规格增量

## ADDED Requirements

### Requirement: Claude active runs render a read-only terminal stream

Source: docs/product/pages/main-conversation.md#Agent-执行与恢复

For a live Claude TUI, the console MUST render ordered raw terminal output in a read-only terminal surface. It MUST NOT treat that stream as Markdown, HTML or a composer input. The normal Agent Markdown block MUST be populated only after the local-console final-result flow completes.

#### Scenario: ANSI output remains terminal output

- **GIVEN** a Claude PTY emits ANSI-coloured text and cursor control bytes
- **WHEN** the user views the active run
- **THEN** the terminal surface receives the bytes in order
- **AND** no raw terminal sequence is rendered as public Markdown or executable HTML.

#### Scenario: Composer remains the only input path

- **GIVEN** a live Claude TUI is displayed
- **WHEN** the user navigates the run block by keyboard
- **THEN** the terminal surface offers no command-entry control
- **AND** a human message can only be submitted through the existing composer.

### Requirement: Claude workspace trust requires an explicit, non-dismissible decision

Source: docs/product/pages/main-conversation.md#Agent-执行与恢复

When a Claude active run reports that its native workspace-trust prompt is pending, the console MUST present a non-dismissible decision dialog. It MUST offer only explicit trust and decline actions, must not expose the terminal prompt as editable text, and must not imply that Moebius can alter Claude's trust record. The dialog action MUST target the exact active run and refresh the console state after the server accepts it.

#### Scenario: A native trust gate cannot be dismissed as consent

- **GIVEN** an active Claude run is waiting at its native workspace-trust prompt
- **WHEN** the user presses Escape, clicks outside the dialog, or attempts to close it
- **THEN** the dialog remains open
- **AND** no trust decision is sent to Claude.

#### Scenario: A user can explicitly decline native trust

- **GIVEN** an active Claude run is waiting at its native workspace-trust prompt
- **WHEN** the user chooses not to trust the folder
- **THEN** the console sends a decline decision for that exact run
- **AND** it refreshes to the resulting stopped run state.
