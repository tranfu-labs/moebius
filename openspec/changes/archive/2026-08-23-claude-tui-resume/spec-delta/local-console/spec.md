# local-console 规格增量

## MODIFIED Requirements

### Requirement: Claude local execution uses a persistent interactive PTY

Source: docs/product/pages/main-conversation.md#Agent-执行与恢复

For full, the Claude driver MUST generate canonical UUID S and start interactive Claude Code in a real PTY with `--session-id S`; it MUST first complete the existing authoritative `--version` check and retain frozen model, effort, permission, attachment and internal-Agent-deny boundaries. For a live PTY, each later user turn MUST write only that turn's human input to the same PTY. The driver MUST NOT use `-p`, `--output-format`, `--include-partial-messages`, `--continue`, a fresh Claude process, recent-session lookup or terminal-text lifecycle inference while that PTY remains live.

The driver MUST forward ordered raw PTY bytes as a Claude-only active-run trace. The PTY owner MUST identify its own successful start; private HTTP hooks MAY identify only `UserPromptSubmit`, `Stop` and `SessionEnd`. Their payload content MUST NOT become public Markdown, lifecycle input or a command. Transcript reading MUST occur only after the corresponding terminal lifecycle signal and only for final assistant text and usage of S. Before each human input, the driver MUST capture a trusted transcript-record boundary when one is available; after Stop it MUST accept only an assistant record appended after that boundary, never a prior turn's final record. A not-yet-written transcript/final record MAY receive a bounded post-Stop retry; invalid identity, duplicate, path or cursor facts MUST remain fail-closed. The driver MUST NOT derive final text, usage or lifecycle from PTY bytes.

Before the initial human task reaches a newly started Claude PTY, the driver MAY recognize only Claude Code's native workspace-trust prompt to open an explicit human trust gate. It MUST NOT select trust automatically, alter a Claude trust record, or treat that prompt as lifecycle or Agent text. On an explicit trust decision, it MUST write the native decision and then the preserved task to that same PTY only after its normal input prompt returns; an explicit decline MUST safely terminate the current run.

Claude's current nonempty `❯ Try …` form (with a non-breaking space) is a known native pre-task normal input affordance after an explicit trust decision; it may authorize the preserved human task, but never lifecycle or Agent text.

After a Claude turn has reached its lifecycle stop state, the live PTY MUST remain available until the configured Claude TUI idle threshold expires. On expiry it MUST terminate and reap that PTY. A later turn MUST start exactly one new interactive PTY with `--resume S`; missing, conflicting or non-matching session identity MUST fail closed without a full fallback. Codex, Kimi and Pi MUST retain their existing transports and resume semantics.

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

#### Scenario: Native workspace trust remains a human decision

- **GIVEN** a newly started Claude PTY displays its native workspace-trust prompt before the first task is sent
- **WHEN** the user has not explicitly selected trust
- **THEN** Moebius writes no task or automatic trust response to that PTY
- **WHEN** the user explicitly trusts the workspace
- **THEN** Moebius writes that trust response and the preserved task to the same PTY in that order
- **AND** no hook, transcript, terminal byte, Codex, Kimi or Pi path substitutes for the human decision.

### Requirement: Claude lifecycle hooks preserve native configuration ownership

Source: docs/product/pages/main-conversation.md#Agent-执行与恢复

Moebius MUST NOT locate, read, parse, copy, transform or modify user/project Claude configuration. It MAY create one mode `0600`, session-private supplemental settings file passed with `--settings`; that file MUST contain only capability-protected loopback lifecycle HTTP hooks and MUST be cleaned when its Claude TUI ends. It MUST NOT replace user settings, suppress native setting sources or add general user/project hooks.

#### Scenario: Session-private hooks do not manage user configuration

- **GIVEN** an ordinary Claude TUI starts
- **WHEN** Moebius prepares lifecycle hooks
- **THEN** it writes only its private supplemental settings file and never reads or changes user/project Claude configuration
- **AND** the file is removed when that TUI ends.

### Requirement: Claude persistent TUI keeps managed-process authority turn-scoped

Source: docs/product/pages/main-conversation.md#托管运行项

An interactive Claude TUI MAY keep one stdio managed-process relay connected across turns, but the relay MUST NOT retain a permanent provider-run capability. For each active Claude provider run, local console MUST mint one distinct existing-supervisor capability bound to that run, expose it only through a mode `0600` lease file, and revoke it before a later turn receives its own lease. The relay command arguments and environment MUST contain the socket and lease-file path only, never a capability value.

On Claude `Stop`, idle expiry, cancellation, abnormal PTY exit and normal TUI close, local console MUST revoke the active capability and remove the lease file. A relay without an active lease MUST stay connected for later turns but reject managed-process tool calls as unavailable. The public `managed_process_start/list/inspect/read_logs/stop` schema, session/workspace admission and no-shell/no-env/no-PID input constraints remain unchanged for Claude, Codex, Kimi and Pi.

#### Scenario: A live Claude relay cannot reuse an earlier turn capability

- **GIVEN** a Claude TUI relay completed provider run R1 and remains connected
- **WHEN** R1 ends, R2 starts, or the TUI enters idle/cancelled/exited cleanup
- **THEN** R1's capability is revoked before it can authorize another tool call
- **AND** R2, if active, receives a distinct capability through the same relay path
- **AND** without an active lease the relay remains connected but returns an unavailable tool result.
