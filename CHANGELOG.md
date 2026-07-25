# Changelog

All notable changes to Moebius will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/tranfu-labs/moebius/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/tranfu-labs/moebius/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/tranfu-labs/moebius/releases/tag/v0.1.0
