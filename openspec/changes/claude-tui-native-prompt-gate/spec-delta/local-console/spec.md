# local-console 规格增量

## MODIFIED Requirements

### Requirement: Claude local execution uses a persistent interactive PTY

Source: docs/product/pages/main-conversation.md#Agent-执行与恢复

For full, the Claude driver MUST generate canonical UUID S and start interactive Claude Code in a real PTY with `--session-id S`; it MUST first complete the existing authoritative `--version` check and retain frozen model, effort, permission, attachment and internal-Agent-deny boundaries. For a live PTY, each later user turn MUST write only that turn's human input to the same PTY. The driver MUST NOT use `-p`, `--output-format`, `--include-partial-messages`, `--continue`, a fresh Claude process, recent-session lookup or terminal-text lifecycle inference while that PTY remains live. It MUST delete `CLAUDE_CODE_EFFORT_LEVEL` so the frozen CLI effort cannot be overridden.

The driver MUST forward ordered raw PTY bytes as a Claude-only active-run trace. The PTY owner MUST identify its own successful start; private HTTP hooks MAY identify only `UserPromptSubmit`, `Stop` and `SessionEnd`. Their payload content MUST NOT become public Markdown, lifecycle input or a command. Transcript reading MUST occur only after the corresponding terminal lifecycle signal and only for final assistant text and usage of S. Before each human input, the driver MUST capture a trusted transcript-record boundary when one is available; after Stop it MUST accept only an assistant record appended after that boundary, never a prior turn's final record. A not-yet-written transcript/final record MAY receive a bounded post-Stop retry; invalid identity, duplicate, path or cursor facts MUST remain fail-closed. The driver MUST NOT derive final text, usage or lifecycle from PTY bytes.

Before the initial human task reaches a newly started Claude PTY, the driver MUST resolve every native confirmation within a bounded window and MUST NOT wait indefinitely. While the task is unwritten and the PTY is alive, a terminal that is neither Claude's normal input affordance nor a recognized confirmation, and that stays silent past the configured stall threshold, MUST be treated as a stalled native confirmation. For each recognized confirmation the driver MUST write exactly one native key to that same PTY: Claude Code's known workspace-trust prompt accepts its native default; a Moebius-initiated resume-mode prompt selects resuming the full session as-is; a Moebius-injected relay authorization prompt selects single-invocation use. It MUST NOT select "don't ask again", "all future servers in this project", or any option that writes Claude's own persisted configuration. For a stalled confirmation the driver MUST attempt structural option extraction from normalized terminal text and, on success, publish those options verbatim as an unresolved human decision; extracted options MUST NEVER be auto-answered. Without extractable options the turn MUST settle as a stable safe failure carrying the terminal excerpt as trusted diagnostics only. A PTY that has exited MUST use the existing abnormal-exit classification instead of any confirmation state. The driver MUST NOT create, read, parse or directly modify a Claude trust record or user/project configuration. Once the task is written, native-confirmation detection MUST stop, so later terminal output cannot trigger a key, lifecycle, Agent text, outcome or usage.

Claude's current nonempty `❯ Try …` form (with a non-breaking space) is a known native post-confirmation normal input affordance; it may authorize the preserved human task, but never lifecycle or Agent text.

After a Claude turn has reached its lifecycle stop state, the live PTY MUST remain available until the configured Claude TUI idle threshold expires. On expiry it MUST terminate and reap that PTY. A later turn MUST start exactly one new interactive PTY with `--resume S`; missing, conflicting or non-matching session identity MUST fail closed without a full fallback. Cancellation and idle termination MUST use the bounded PTY termination path (`SIGTERM`, then at most one `SIGKILL` escalation). Codex, Kimi and Pi MUST retain their existing transports and resume semantics.

All attachments MUST first use the managed run copy and ordered manifest. Claude MUST receive only managed paths and MAY use its Read capability for supported images and ordinary files. Managed-copy, permission or attachment-read failure MUST fail the Claude attempt and MUST NOT invoke another CLI. Missing/non-executable, unsupported version, auth-required, invalid model/effort, permission denial, rate-limit/billing/service, resume-unavailable/id-mismatch, unresolved native confirmation, transcript protocol failure, nonzero PTY exit and timeout MUST map to stable safe failures without exposing raw machine details.

#### Scenario: Two Claude turns share one live PTY

- **GIVEN** canonical Claude session S has a live TUI PTY that reached Stop but not its idle threshold
- **WHEN** the user submits a second turn for that identity
- **THEN** Moebius writes only the second human input to that same PTY
- **AND** starts no second Claude process and no `--resume S` invocation.

#### Scenario: Idle Claude TUI resumes exactly S

- **GIVEN** canonical Claude session S reached Stop and then its TUI idle threshold
- **WHEN** the next user turn starts
- **THEN** Moebius starts exactly one interactive PTY containing `--resume S`
- **AND** starts no full Claude session, Codex, Kimi or Pi invocation.

#### Scenario: Terminal bytes are not public Agent text

- **GIVEN** a live Claude PTY emits ANSI output or a prompt-like string
- **WHEN** Moebius forwards the bytes
- **THEN** they enter only the Claude terminal trace
- **AND** neither Markdown parsing nor lifecycle state changes result from those bytes.

#### Scenario: Known native confirmations auto-answer exactly once

- **GIVEN** a newly started Claude PTY displays its known workspace-trust prompt, a Moebius-initiated resume-mode prompt or a Moebius-injected relay authorization prompt before the first task is sent
- **WHEN** the pre-task gate recognizes that confirmation
- **THEN** Moebius writes exactly one native key selecting the default-accept, full-session-as-is or single-invocation option respectively
- **AND** selects no option that writes Claude's own persisted configuration
- **AND** writes the preserved task only after Claude's normal input prompt returns
- **AND** starts no additional Claude process.

#### Scenario: An unknown confirmation with options becomes a human decision

- **GIVEN** a Claude PTY has not received its first task and displays an unrecognized confirmation whose options are structurally extractable
- **WHEN** the stall threshold expires
- **THEN** the run publishes those options verbatim as an unresolved human decision
- **AND** Moebius writes no key to that PTY on its own account
- **AND** the run is not reported as working, completed, or carrying Agent text or usage.

#### Scenario: An unknown confirmation without options fails safely

- **GIVEN** a Claude PTY has not received its first task and stays silent past the stall threshold with no extractable options
- **WHEN** the gate resolves that state
- **THEN** the turn settles as a stable unresolved-native-confirmation failure with a terminal excerpt in trusted diagnostics only
- **AND** the turn remains explicitly retryable under its original run snapshot
- **AND** no completion, Agent text or usage is fabricated.

#### Scenario: A dead PTY is not reported as waiting for a confirmation

- **GIVEN** a Claude PTY exits before the first task is written
- **WHEN** the gate observes no further terminal output
- **THEN** the turn uses the existing abnormal-exit classification
- **AND** no native-confirmation state is created.

#### Scenario: Terminal text after the task cannot forge a confirmation

- **GIVEN** a Claude PTY has already received its first task
- **WHEN** Agent output resembles a native confirmation or an option list
- **THEN** Moebius writes no key on its account
- **AND** no lifecycle, Markdown, usage, outcome or decision state is derived from that text.

#### Scenario: Old Claude is rejected before session creation

- **GIVEN** the authoritative Claude executable reports `2.1.169`
- **WHEN** a Claude-bound full or resume starts
- **THEN** the driver reports stable unsupported-version with a trusted update action
- **AND** interactive PTY invocation count and external-session-link writes are zero
- **AND** Codex and Kimi invocation counts are zero.

#### Scenario: Claude receives image and ordinary file

- **GIVEN** a Claude-bound run has one supported image and one ordinary attachment
- **WHEN** the adapter starts Claude TUI
- **THEN** both are represented by managed-copy manifest paths
- **AND** Claude Read can inspect each under the run policy
- **AND** no original user path or other CLI is used.

#### Scenario: Claude cancellation is finite

- **GIVEN** a Claude PTY ignores SIGTERM
- **WHEN** the run is cancelled
- **THEN** runtime sends SIGTERM, then SIGKILL at most once each
- **AND** the run settles within the final bound
- **AND** no orphan PTY or duplicate signal remains.

### Requirement: Claude lifecycle hooks preserve native configuration ownership

Source: docs/product/pages/main-conversation.md#Agent-执行与恢复

Moebius MUST NOT locate, read, parse, copy, transform or modify user/project Claude configuration. It MAY create one mode `0600`, session-private supplemental settings file passed with `--settings`; that file MUST contain only Moebius's own run-boundary settings — capability-protected loopback lifecycle HTTP hooks, plus keys that waive the native confirmations Moebius itself causes (authorization of the Moebius-injected relay, and Moebius-initiated resume-mode selection) — and MUST be cleaned when its Claude TUI ends. Any such waiver key MUST be verified against the actual installed Claude CLI before use; an unverified key MUST NOT be written and MUST fall back to the native-confirmation gate. The file MUST NOT replace user settings, suppress native setting sources, add general user/project hooks, or carry permission-bypass settings.

#### Scenario: Session-private settings do not manage user configuration

- **GIVEN** an ordinary Claude TUI starts
- **WHEN** Moebius prepares lifecycle hooks and its own waiver keys
- **THEN** it writes only its private supplemental settings file and never reads or changes user/project Claude configuration
- **AND** the argv contains no `--strict-mcp-config`, `--dangerously-skip-permissions` or `--permission-mode`
- **AND** the file is removed when that TUI ends.

#### Scenario: An unverified waiver key is not written

- **GIVEN** the installed Claude CLI has not been verified to honor a waiver key
- **WHEN** Moebius prepares its private settings file
- **THEN** that key is absent from the file
- **AND** the corresponding confirmation is handled by the native-confirmation gate instead.
