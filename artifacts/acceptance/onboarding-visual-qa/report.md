# Onboarding dual-CLI visual QA

Verdict: **PASS**, with two explicit evidence limits and no observed product defect.

## Scope

The production `@moebius/console-ui` static Storybook build was checked against the confirmed onboarding prototype and `packages/console-ui/DESIGN.md`. The run covered light and dark themes, wide and narrow widths, independent Codex/Kimi readiness, every install phase, single and dual titlebar aggregation, failed-install recovery, partial team compatibility, the neutral completion state, keyboard order, visible focus, and the live-region contract.

## Step health

1. Environment readiness — healthy. Codex-only and Kimi-only both enabled Continue; both missing disabled it and retained two independent install instructions.
2. Responsive and theme presentation — healthy. Light/dark states preserved hierarchy. At the 460 px captured canvas width, the component reported equal client and scroll widths with no horizontal overflow.
3. Installation feedback — healthy. Starting, downloading, installing, and verifying each presented distinct ongoing copy. Single and dual aggregates were accurate, cancellation remained per CLI, and failure exposed a scoped retry.
4. Team selection — healthy. A mixed Codex/Kimi team displayed the affected-member warning without preventing selection.
5. Completion — healthy. Partial compatibility used the neutral `Users` mark with `bg-sunken text-sub`, not the success check.
6. Keyboard and announcements — healthy. Focus advanced through recovery/install/recheck controls with a visible keyboard outline; the disabled Continue control was skipped. CLI status and recovery content lived in an `aria-live="polite"` region.

## Evidence limits

- The separate New Conversation page warning was not visually captured. Its current stories do not expose a combined CLI-readiness/execution-profile fixture, while the onboarding story deliberately leaves `onComplete` as a no-op.
- The browser connection could not emulate `prefers-reduced-motion`; the code's `motion-safe` guard was not treated as visual proof.

These are fixture/browser evidence gaps rather than observed UI failures. Exact DOM facts and evidence filenames are recorded in `evidence.json`.
