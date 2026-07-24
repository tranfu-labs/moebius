# Contributing to Moebius

Thanks for helping improve Moebius. Bug reports, feature proposals, documentation fixes, tests, and focused code changes are welcome.

By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

Moebius is a Node.js and TypeScript pnpm workspace. Use Node.js 24 and pnpm 9.15.4.

```bash
git clone https://github.com/tranfu-labs/agent-moebius.git
cd agent-moebius
corepack enable
pnpm install
pnpm start
```

`pnpm start` launches the local console runtime. GitHub runner development additionally requires the local `codex` and `gh` CLIs, an authenticated `gh` session, and an explicit mode flag:

```bash
pnpm start -- --github-mode
```

The optional Electron desktop shell is available on macOS:

```bash
pnpm desktop
```

## Repository map

- `src/`: runner, GitHub intake, local console, observer, and shared runtime logic
- `desktop/`: Electron main process, preload boundary, and renderer
- `packages/console-ui/`: reusable React console components and design tokens
- `agents/`: built-in agent role definitions
- `docs/`: product, architecture, protocol, and decision records
- `tests/` and `desktop/tests/`: automated tests
- `openspec/`: current specifications and proposed changes

See [AGENTS.md](AGENTS.md) for the full project contract and current operational commands.

## Branch strategy

We use trunk-based development:

- Branch from `main` with a focused name such as `feat/agent-routing`, `fix/session-recovery`, or `docs/readme`.
- Open a pull request back to `main`.
- Do not maintain a long-lived `develop` branch.
- Do not push directly to `main`, including for urgent fixes.

## Commit convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat: add session recovery indicator`
- `fix: preserve runner intake cursor`
- `docs: explain github mode startup`
- `refactor: isolate local console state`
- `test: cover duplicate issue dispatch`
- `chore: update development dependency`

Keep each commit scoped to one coherent change.

## Validation

Run the checks relevant to your change before opening a pull request:

```bash
pnpm test
pnpm typecheck
pnpm --filter @moebius/desktop build
```

On macOS, changes to brand assets should also pass:

```bash
pnpm brand:check
```

The repository does not currently define a lint or formatting command. Follow the surrounding TypeScript style and keep strict type checking clean.

New behavior should include tests. For a bug fix, prefer adding a failing reproduction test before changing the implementation. Update product, architecture, protocol, or OpenSpec documentation when the corresponding contract changes.

## Pull request process

1. Fork the repository or create a branch if you have write access.
2. Keep the change focused and update tests and documentation with the implementation.
3. Complete the pull request template with the problem, approach, and evidence.
4. Wait for CI to pass and at least one reviewer to approve.
5. Address review feedback with additional commits.
6. Maintainers merge approved pull requests with squash merge.

No DCO sign-off or CLA is currently required.

First-time contributors can start with issues labeled `good first issue` or ask a focused question in GitHub Discussions. Issue response times are best effort.

## Reporting bugs and proposing features

Use the structured [GitHub Issue forms](https://github.com/tranfu-labs/agent-moebius/issues/new/choose). Search existing issues first and include reproducible evidence where possible.

Do not report vulnerabilities in a public issue. Use [GitHub Security Advisories](https://github.com/tranfu-labs/agent-moebius/security/advisories/new) instead.
