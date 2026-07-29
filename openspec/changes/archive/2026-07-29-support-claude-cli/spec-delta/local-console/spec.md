# local-console 规格增量

## MODIFIED Requirements

### Requirement: Session team snapshot freezes each member execution profile

Source: docs/product/pages/main-conversation.md#选择工作空间与团队

New and explicitly switched team snapshots MUST persist each member's effective
`codex | claude | kimi` CLI, model and effort with slug and Agent Markdown. Later team-page changes
MUST NOT change an existing snapshot. Legacy rows without a profile MUST preserve one legacy Codex
identity across first and resume attempts, MUST NOT be populated from current team state and MUST NOT
switch to Claude or Kimi.

The schema migration that admits Claude MUST preserve all existing snapshot rows and relationships
transactionally and idempotently.

#### Scenario: Claude profile is frozen

- **GIVEN** a session snapshot captured `@dev` with Claude/sonnet/high
- **WHEN** the team page later changes `@dev` to Kimi
- **THEN** the existing session still runs Claude/sonnet/high
- **AND** a later new session can capture Kimi.

### Requirement: Local Agent run is hard-routed to the snapshotted engine

Source: docs/product/pages/main-conversation.md#Agent-执行与恢复

The local console MUST select Codex, Claude or Kimi from the immutable member/run snapshot and MUST
pass that snapshot's model and effort to full and resume. Missing executable, unsupported version,
invalid configuration, authentication, permission or driver failure MUST become an explicit failed
attempt. The system MUST NOT invoke another CLI as fallback.

For Kimi and Claude, executable discovery MUST preserve host `PATH` order and make the first existing
candidate authoritative. Only when PATH contains no candidate MAY Kimi inspect
`~/.kimi-code/bin/kimi` and Claude inspect `~/.local/bin/claude`. The selected candidate MUST be an
executable regular file and MUST be spawned by absolute path with `shell:false`. An existing invalid
authoritative candidate MUST fail rather than selecting another version. Spawn success MUST be
observed within a bounded interval before protocol input is sent.

Every Claude full/resume MUST run a bounded `--version` check against that same resolved absolute
path before print-mode/session side effects. A version below `2.1.170` MUST fail with a stable
unsupported-version reason and trusted update action. It MUST NOT invoke `-p`, create or modify an
external session link, or call Codex/Kimi.

Failures MUST retain stable engine-specific safe reasons. Raw paths, OS errors, stderr and provider
payloads MUST remain outside the normal timeline.

#### Scenario: Bound Claude is missing

- **GIVEN** the selected member snapshot is bound to Claude
- **AND** the Claude executable cannot be started
- **WHEN** the member run begins
- **THEN** the run fails with a safe Claude-specific reason
- **AND** Codex and Kimi drivers are never called.

#### Scenario: Claude official default location is used only after PATH

- **GIVEN** PATH contains no `claude`
- **AND** host `~/.local/bin/claude` is an executable regular file
- **WHEN** a Claude-bound run begins
- **THEN** runtime spawns that absolute path without a shell
- **AND** writes no prompt before spawn succeeds.

### Requirement: Moebius 角色运行禁用 CLI 内部 Agent 工具

Source: docs/product/pages/main-conversation.md#Agent-执行与恢复

Codex full/resume MUST continue using `agents.enabled=false`. Claude full/resume MUST pass deny
rules for `Agent`, legacy `Task`, `AskUserQuestion`, `TeamCreate`, `TeamDelete`, `SendMessage`,
`TaskCreate`, `TaskGet`, `TaskList`, `TaskUpdate`, `TaskOutput` and `TaskStop`; MUST delete
`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, `CLAUDE_AUTO_BACKGROUND_TASKS` and
`CLAUDE_CODE_FORWARD_SUBAGENT_TEXT`; MUST set `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`; and MUST NOT
pass `--forward-subagent-text`. The observed init tool inventory MUST contain none of those
Agent/team tools or the run MUST fail before accepting any visible assistant/tool event. Moebius
MUST NOT allow an individual role run to create hidden internal delegates; role handoff MUST remain
visible on the Moebius public timeline. Kimi behavior MUST remain unchanged.

#### Scenario: Claude cannot create an internal delegate

- **GIVEN** a Claude-bound Moebius Agent needs full or resume
- **WHEN** the adapter constructs the invocation
- **THEN** required subagent/team features are disabled and Agent is disallowed
- **AND** a role handoff occurs only after a visible Moebius reply names a legal team member.

### Requirement: Messages snapshot then directly start the bound engine

Source: docs/product/pages/main-conversation.md#选择工作空间与团队
Source: docs/product/pages/main-conversation.md#Agent-执行与恢复

The first-message transaction MUST persist the session, user message, ordered attachments and complete
team snapshot before starting the primary Agent. First messages, later messages, handoffs and retries
MUST directly invoke the driver selected by immutable CLI/model/effort without separate runtime
readiness or model-enumeration preflight; the selected driver's minimum-version gate still runs.
Spawn, authentication, profile application, permission or driver failure MUST become an explicit
“这一步没跑起来” fact while preserving session, message and snapshot. No other CLI may
be invoked.

Recognized structured errors MUST reduce to stable safe codes and actionable explanations. Unknown
failures MUST retain generic failed-attempt presentation and local diagnostic evidence; raw provider
payload and machine-only reasons MUST not enter the timeline.

#### Scenario: First-message Claude authentication fails

- **GIVEN** a new conversation snapshots a Claude-bound primary Agent
- **AND** Claude reports authentication required
- **WHEN** the first message is submitted
- **THEN** session, message and Claude profile remain persisted
- **AND** the run becomes failed with safe login guidance
- **AND** Codex and Kimi call counts are zero.

### Requirement: Execution session links are engine and profile specific

Source: docs/product/pages/main-conversation.md#Agent-执行与恢复

Each Agent identity MUST own at most one canonical Codex thread, Claude session or Kimi session.
External links MUST bind session, team snapshot, role, workspace, persona, engine, profile fingerprint
and external id. Full MAY create identity only when none is bound. Once matching engine protocol
evidence reveals an id, it MUST be persisted even if the turn later fails. All later messages,
handoffs back, retries, reruns and restart recovery MUST resume that exact id.

Resume MUST validate the entire immutable identity and the provider-observed id. Missing, conflicting,
non-unique or incompatible links, provider session absence or resume failure MUST perform only that
resume attempt and enter “原执行已经无法继续”. The system MUST NOT clear the id, choose a recent
session, rebuild from history, issue a second full/session-new call or cross CLI.

#### Scenario: Claude returns a different resume id

- **GIVEN** an Agent identity is linked to Claude session S
- **WHEN** resume reports session T
- **THEN** the attempt fails closed after exactly one resume
- **AND** S remains the canonical link
- **AND** no full, Codex or Kimi invocation follows.

## ADDED Requirements

### Requirement: Claude local execution uses bounded headless stream-json

Source: docs/product/pages/main-conversation.md#Agent-执行与恢复

For full, the Claude driver MUST generate a UUID S and invoke headless print mode with stream-json,
verbose output, `--include-partial-messages`, frozen model/effort, `--permission-mode auto`,
bounded internal-agent deny rules and `--session-id S`. For resume it MUST invoke `--resume S` with
the same immutable profile, cwd and policy. It MUST delete
`CLAUDE_CODE_EFFORT_LEVEL` so the frozen CLI effort cannot be overridden. It MUST NOT use
`--continue`, interactive session selection, filesystem time or “most recent” lookup.

The driver MUST parse JSONL with per-line and total bounds. It MUST observe a `system/init` session id
equal to S before persisting the canonical link or publishing success. Any observed terminal session
id MUST also equal S. Missing init id, conflicting ids, malformed/oversized protocol, unsupported
required permission controls or profile rejection MUST fail closed. Matching init is sufficient to
bind S even if the turn later fails.

The driver MUST derive incremental Markdown only from `stream_event` records whose nested event is
`content_block_delta` and delta is `text_delta`, appending the nested text in order. Thinking, tool
events, protocol metadata and records with `parent_tool_use_id` MUST NOT enter the public timeline.
Raw JSONL/stdout/stderr MUST remain in bounded local diagnostics and MUST NOT appear in renderer DTOs
or the public timeline.

Ordinary-Agent full/resume MUST leave native Claude configuration outside Moebius control. Moebius MUST NOT pass
`--safe-mode`, `--setting-sources`, `--strict-mcp-config`, `--disable-slash-commands` or `--tools`,
MUST NOT create replacement settings, and MUST NOT locate, read, parse, copy, transform or manage
user/project Claude configuration. Which CLAUDE.md, settings, hooks, MCP, skills, plugins, commands
or custom agents Claude itself loads is outside Moebius implementation and acceptance scope. The
common internal-Agent deny and environment boundary MUST remain enforced. AI-team-builder isolation
is a separate desktop execution profile and does not alter this ordinary-Agent behavior.

All attachments MUST first use the managed run copy and ordered manifest. Claude MUST receive only
managed paths and MAY use its Read capability for supported images and ordinary files. Managed-copy,
permission or attachment-read failure MUST fail the Claude attempt and MUST NOT invoke another CLI.

Cancellation MUST be idempotent and settle in finite time through the necessary prefix of
SIGINT → SIGTERM → SIGKILL. Idle and max-duration watchdogs MUST terminate the same bounded process.
Missing/non-executable, unsupported version, auth-required, invalid model/effort, permission denial,
rate-limit/billing/service, resume-unavailable/id-mismatch, malformed protocol, nonzero exit and
timeout MUST map to stable safe failures without exposing raw machine details.

#### Scenario: Specific Claude session resumes

- **GIVEN** an Agent identity has canonical Claude session S and frozen sonnet/high
- **WHEN** the next turn runs
- **THEN** invocation contains `--resume S`, sonnet and high
- **AND** matching init/result ids continue S
- **AND** no `--session-id`, `--continue`, Codex or Kimi invocation occurs.

#### Scenario: Old Claude is rejected before session creation

- **GIVEN** the authoritative Claude executable reports `2.1.169`
- **WHEN** a Claude-bound full or resume starts
- **THEN** the driver reports stable unsupported-version with a trusted update action
- **AND** print-mode invocation count and external-session-link writes are zero
- **AND** Codex and Kimi invocation counts are zero.

#### Scenario: Ordinary Claude configuration is not managed by Moebius

- **GIVEN** an ordinary Claude-bound full or resume
- **WHEN** Moebius constructs and starts the invocation
- **THEN** argv contains none of the configuration-suppression flags
- **AND** replacement-settings writes and Claude-config locate/read/parse/copy calls are zero
- **AND** exact argv/env and init inventory still prove Agent/team tools unavailable.

#### Scenario: Partial stream produces visible Markdown

- **GIVEN** Claude emits a `stream_event/content_block_delta/text_delta` sequence
- **WHEN** the bounded parser consumes the JSONL
- **THEN** public Markdown grows in the same text order before the terminal result
- **AND** thinking, tool and protocol events remain private.

#### Scenario: Internal Agent capability fails closed

- **GIVEN** a fake Claude init advertises `Agent` or a team tool despite the required argv and env
- **WHEN** the adapter validates init
- **THEN** it fails before accepting a visible assistant/tool event and publishes no subagent text
- **AND** Codex and Kimi call counts remain zero.

#### Scenario: Matching init persists identity before later failure

- **GIVEN** a first Claude run uses generated UUID S
- **WHEN** matching system/init arrives and the process later exits nonzero
- **THEN** S is persisted immediately for that Agent identity
- **AND** the next explicit retry can only resume S.

#### Scenario: Claude receives image and ordinary file

- **GIVEN** a Claude-bound run has one supported image and one ordinary attachment
- **WHEN** the adapter starts Claude
- **THEN** both are represented by managed-copy manifest paths
- **AND** Claude Read can inspect each under the run policy
- **AND** no original user path or other CLI is used.

#### Scenario: Claude cancellation is finite

- **GIVEN** a spawned Claude process ignores SIGINT and SIGTERM
- **WHEN** the run is cancelled
- **THEN** runtime sends SIGINT, then SIGTERM, then SIGKILL at most once each
- **AND** the run settles within the final bound
- **AND** no orphan process or duplicate signal remains.

## RENAMED Requirements

- FROM: `### Requirement: Moebius 角色运行禁用 Codex 内部 Agent 工具`
  TO: `### Requirement: Moebius 角色运行禁用 CLI 内部 Agent 工具`
