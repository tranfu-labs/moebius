# local-console 规格增量

## MODIFIED Requirements

### Requirement: Claude local execution uses a persistent interactive PTY

Source: docs/product/pages/main-conversation.md#Agent-执行与恢复

For full, the Claude driver MUST generate canonical UUID S and start interactive Claude Code in a real PTY with --session-id S; it MUST first complete the existing authoritative --version check and retain frozen model, effort, permission, attachment and internal-Agent-deny boundaries. For a live PTY, each later user turn MUST write only that turn's human input to the same PTY. The driver MUST NOT use -p, --output-format, --include-partial-messages, --continue, a fresh Claude process, recent-session lookup or terminal-text lifecycle inference while that PTY remains live. It MUST delete CLAUDE_CODE_EFFORT_LEVEL so the frozen CLI effort cannot be overridden.

The driver MUST forward ordered raw PTY bytes as a Claude-only active-run trace. The PTY owner MUST identify its own successful start; private HTTP hooks MAY identify only UserPromptSubmit, Stop and SessionEnd. Their payload content MUST NOT become public Markdown, lifecycle input or a command. Transcript reading MUST occur only after the corresponding terminal lifecycle signal and only for final assistant text and usage of S. Before each human input, the driver MUST capture a trusted transcript-record boundary when one is available; after Stop it MUST accept only an assistant record appended after that boundary, never a prior turn's final record. A not-yet-written transcript/final record MAY receive a bounded post-Stop retry; invalid identity, duplicate, path or cursor facts MUST remain fail-closed. The driver MUST NOT derive final text, usage or lifecycle from PTY bytes.

Before the initial human task reaches a newly started Claude PTY, the driver MAY recognize only Claude Code's known native workspace-trust prompt. On one recognized prompt it MUST write exactly one native default-accept Enter to that same PTY, switch the detector to post-trust normal-prompt observation, and write the preserved task only after the normal input prompt returns. It MUST NOT create, read, parse or directly modify a Claude trust record; it MUST NOT expose or accept a human trust decision through local-console, and it MUST NOT treat other terminal text, hooks or transcript data as authority to send Enter. Once the task is written, workspace-trust detection MUST stop, so later terminal output cannot trigger it. An incomplete or unrecognized prompt MUST receive no automatic Enter or task write.

Claude's current nonempty ❯ Try … form (with a non-breaking space) is a known native post-trust normal input affordance; it may authorize the preserved human task, but never lifecycle or Agent text.

After a Claude turn has reached its lifecycle stop state, the live PTY MUST remain available until the configured Claude TUI idle threshold expires. On expiry it MUST terminate and reap that PTY. A later turn MUST start exactly one new interactive PTY with --resume S; missing, conflicting or non-matching session identity MUST fail closed without a full fallback. Cancellation and idle termination MUST use the bounded PTY termination path (SIGTERM, then at most one SIGKILL escalation). Codex, Kimi and Pi MUST retain their existing transports and resume semantics.

All attachments MUST first use the managed run copy and ordered manifest. Claude MUST receive only managed paths and MAY use its Read capability for supported images and ordinary files. Managed-copy, permission or attachment-read failure MUST fail the Claude attempt and MUST NOT invoke another CLI. Missing/non-executable, unsupported version, auth-required, invalid model/effort, permission denial, rate-limit/billing/service, resume-unavailable/id-mismatch, transcript protocol failure, nonzero PTY exit and timeout MUST map to stable safe failures without exposing raw machine details.

#### Scenario: Native workspace trust auto-confirms exactly once

- **GIVEN** a newly started Claude PTY displays its known native workspace-trust prompt before the first task is sent
- **WHEN** the pre-task detector recognizes that prompt
- **THEN** Moebius writes exactly one Enter to that same PTY without creating a workspaceTrust active-run state or a human decision request
- **AND** writes the preserved task only after Claude's normal input prompt returns
- **AND** starts no additional Claude process.

#### Scenario: Other terminal text cannot grant workspace trust

- **GIVEN** a Claude PTY has not yet received its first task
- **WHEN** its terminal output is incomplete, ordinary, duplicated after auto-confirmation, or not the known native workspace-trust prompt
- **THEN** Moebius writes no additional Enter on its account
- **AND** no lifecycle, Markdown, usage or trust state is derived from that text.
