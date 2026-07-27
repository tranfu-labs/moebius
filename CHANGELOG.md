# Changelog

All notable changes to Moebius will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.3] - 2026-07-27

### Added

- Added a collapsible conversation relay rail with participant lanes, message previews, timeline navigation, and per-conversation reading-position restoration.
- Added anchored expansion, path-drawing, preview-following motion, and an equivalent reduced-motion presentation for the relay rail.
- Added attempt-scoped Codex debug invocation chains with recorded prompt layers, raw tool events, model metadata, precise timestamps, completion states, and token usage while continuing to exclude reasoning content.
- Added persistent provider-session continuity for local desktop agents, AI team building, and the desktop GitHub runner, with fail-closed behavior when a prior session cannot be resumed safely.

### Changed

- Made team runtime profiles portable static configuration and deferred CLI, model, authentication, and execution validation to the actual agent run.
- Kept existing runtime-readiness guidance informational so it no longer blocks conversation creation, team selection, or the first message.
- Consolidated real-application evidence requirements into the bundled development-team roles.
- Required AI-generated teams to assign expensive validation and publication methods to one responsible member and state the conditions that activate them.

### Fixed

- Preserved relay-rail keyboard focus while navigating between conversation events.

## [0.1.2] - 2026-07-26

### Added

- Added Codex and Kimi CLI readiness detection, installation flows, and runtime profiles for desktop teams.
- Added official-team update management and bundled content-production, development, and product-development team definitions.
- Added live agent run activity, elapsed-time reporting, richer run outcomes, and a dedicated agent-conversation experience.

### Changed

- Required real-app evidence for product-development team acceptance and reused existing evidence rules across team roles.
- Added console screenshots to the English and Chinese project documentation.

### Fixed

- Isolated role runs from nested-agent state so delegated executions retain the correct runtime context.

## [0.1.1] - 2026-07-25

### Added

- Unified the desktop and prototype onboarding flow, including clearer environment readiness, recheck, and first-team setup states.

### Changed

- Reused verified QA evidence across agent handoffs to reduce repeated validation work.

### Fixed

- Allowed desktop instances with different data roots to run concurrently while retaining the single-instance guard for the same data root.
- Preferred the inherited shell `PATH` when repairing the desktop environment.
- Hid unused compatibility projects from the local console.
- Preserved session member display names throughout local-console state synchronization.

## [0.1.0] - 2026-07-24

### Added

- Initial public macOS Apple Silicon desktop release with the local conversation console, persistent sessions and agent teams, GitHub Issue runner, and read-only observer.
- Initial public project documentation, contribution guidelines, issue forms, pull request template, and continuous integration workflow.

[Unreleased]: https://github.com/tranfu-labs/moebius/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/tranfu-labs/moebius/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/tranfu-labs/moebius/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/tranfu-labs/moebius/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/tranfu-labs/moebius/releases/tag/v0.1.0
