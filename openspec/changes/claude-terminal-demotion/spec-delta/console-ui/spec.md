# console-ui 规格增量

两条 MODIFIED 均含重命名，归档合并时按下表对位替换，不得留下同义旧条目：

| specs 中的原 Requirement | 本 change 的替代 Requirement |
| --- | --- |
| `Claude active runs render a read-only terminal stream` | `Claude raw terminal is diagnostics, not the timeline` |
| `Claude native workspace trust auto-confirmation creates no interactive control` | `Claude native confirmations render as decisions, never as a terminal` |

## MODIFIED Requirements

### Requirement: Claude raw terminal is diagnostics, not the timeline

Source: docs/product/pages/main-conversation.md#Claude-运行中的呈现与原生确认

An active Claude run MUST render the same structured process steps, activity line and post-Stop Agent Markdown as the other engines; the main timeline MUST NOT render raw terminal output for any run state. Ordered raw Claude terminal bytes MUST be available only inside the per-attempt terminal diagnostics area of the process tab, collapsed by default, as a read-only replay. That surface MUST NOT treat the stream as Markdown, HTML or a composer input, MUST NOT offer a command-entry control, and MUST NOT accept keystrokes. When the retained bytes for an attempt are incomplete or absent, the area MUST say so for that attempt while the remaining native records stay readable.

#### Scenario: ANSI output stays out of the timeline

- **GIVEN** a Claude PTY emits ANSI-coloured text and cursor control bytes
- **WHEN** the user views the active run in the main timeline
- **THEN** the run block shows process steps and the activity line, not a terminal
- **AND** the ordered bytes are reachable only by expanding that attempt's terminal diagnostics.

#### Scenario: Composer remains the only text input path

- **GIVEN** a Claude terminal diagnostics area is expanded
- **WHEN** the user navigates it by keyboard
- **THEN** the surface offers no command-entry control and consumes no keystrokes
- **AND** a human message can only be submitted through the existing composer.

### Requirement: Claude native confirmations render as decisions, never as a terminal

Source: docs/product/pages/main-conversation.md#Claude-运行中的呈现与原生确认

Confirmations that local-console answers on its own (Moebius-injected relay authorization, Moebius-initiated resume mode, workspace trust) MUST NOT produce any console control or visible state. When local-console publishes an unresolved confirmation carrying extracted options, the run block MUST render those options verbatim as a single-choice list with a collapsible terminal excerpt, MUST NOT reorder, translate, summarize or add options, and MUST NOT present the run as working, completed, or carrying Agent text or usage. When no options were extracted, the run block MUST use the existing safe-failure form with the terminal excerpt and an explicit retry. Options and excerpts MUST render as plain read-only text without interpreting HTML, Markdown, scripts or terminal control sequences. The console MUST NOT expose any action that sends arbitrary keys, text or commands to a Claude PTY; a user choice MUST carry only which option was selected.

#### Scenario: Auto-answered confirmations stay invisible

- **GIVEN** a new Claude run reaches workspace trust, resume mode or relay authorization
- **WHEN** local-console answers it in the PTY
- **THEN** no dialog, decision control or confirmation state appears in the console
- **AND** the run block continues to show ordinary process steps.

#### Scenario: An unknown confirmation offers its own options

- **GIVEN** local-console publishes an unresolved confirmation with three extracted options
- **WHEN** the run block renders
- **THEN** the three options appear verbatim, in order, as a single-choice list
- **AND** the block is not shown as working, completed or carrying usage
- **AND** selecting one submits only that option's index.

#### Scenario: An unknown confirmation without options is a safe failure

- **GIVEN** local-console publishes an unresolved confirmation with no extracted options
- **WHEN** the run block renders
- **THEN** it uses the existing safe-failure form with a collapsible terminal excerpt and an explicit retry
- **AND** offers no input control.
