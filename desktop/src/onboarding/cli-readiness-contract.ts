export type OnboardingCli = "codex" | "claude" | "kimi";

export type OnboardingCliReadinessStatus =
  | "checking"
  | "ready"
  | "missing"
  | "needs-login"
  | "unavailable";

export type OnboardingCliReadinessCode =
  | "checking"
  | "ready"
  | "cli-missing"
  | "version-unavailable"
  | "version-unsupported"
  | "authentication-required"
  | "capability-unavailable";

export interface OnboardingCliReadinessSnapshot {
  cli: OnboardingCli;
  status: OnboardingCliReadinessStatus;
  code: OnboardingCliReadinessCode;
  revision: number;
  version: string | null;
  checkedAt: string | null;
}

export interface OnboardingCliReadinessState {
  codex: OnboardingCliReadinessSnapshot;
  claude: OnboardingCliReadinessSnapshot;
  kimi: OnboardingCliReadinessSnapshot;
}

export function isOnboardingCli(value: unknown): value is OnboardingCli {
  return value === "codex" || value === "claude" || value === "kimi";
}

export function createInitialOnboardingCliReadinessState(): OnboardingCliReadinessState {
  return {
    codex: initialSnapshot("codex"),
    claude: initialSnapshot("claude"),
    kimi: initialSnapshot("kimi"),
  };
}

function initialSnapshot(cli: OnboardingCli): OnboardingCliReadinessSnapshot {
  return {
    cli,
    status: "checking",
    code: "checking",
    revision: 0,
    version: null,
    checkedAt: null,
  };
}
