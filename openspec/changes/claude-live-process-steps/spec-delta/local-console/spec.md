# local-console 规格增量

## ADDED Requirements

### Requirement: Claude in-flight process comes from a read-only transcript follower

Source: docs/product/pages/main-conversation.md#Agent-执行与恢复

While a Claude turn is in flight, the driver MUST project Claude's own already-persisted transcript records into the same structured activity channel the other engines use, so that Claude runs show process steps and an activity line with the same shape as Codex, Kimi and Pi. The follower MUST start from the trusted record boundary captured for that turn before its human input was written, and MUST NOT project records that precede that boundary.

The follower MUST reuse the existing transcript identity rules (config root resolution, exact session UUID, immutable cwd cross-check) and MUST stop and degrade silently on identity, path, duplicate-candidate, truncation or cursor-regression facts, never switching to another file or reconstructing missing records. It MUST stop and release its handles on Stop, idle expiry, cancellation, abnormal PTY exit and before a later turn starts.

The follower MUST remain read-only with respect to the run's outcome: it MUST NOT drive lifecycle, MUST NOT produce final Agent text or usage, and MUST NOT make a turn's completion depend on having projected any event. Final Agent text and usage MUST continue to come only from the post-Stop resolver under its existing boundary and fail-closed rules. In-flight terminal bytes MUST NOT be used to fabricate steps when the transcript has not yet been written.

#### Scenario: Steps appear before the turn stops

- **GIVEN** a Claude turn is in flight and Claude has appended thinking and tool records after this turn's boundary
- **WHEN** the follower reads the new records
- **THEN** structured activity events are published in transcript order before the lifecycle Stop arrives
- **AND** those events carry no final Agent text or usage.

#### Scenario: A previous turn's records are not this turn's process

- **GIVEN** the transcript already contains records from an earlier turn of the same session
- **WHEN** the follower runs for the current turn
- **THEN** only records appended after the current turn's boundary are projected.

#### Scenario: Follower failure does not affect the result

- **GIVEN** the follower stops early, throws, or never projects an event
- **WHEN** the turn reaches lifecycle Stop
- **THEN** the run still resolves its final Agent text and usage through the existing post-Stop resolver
- **AND** the run's outcome classification is unchanged.

#### Scenario: Following stops at the turn boundary

- **GIVEN** a Claude turn reached lifecycle Stop
- **WHEN** later records are appended to the same transcript
- **THEN** the stopped turn publishes no further in-flight activity events.
