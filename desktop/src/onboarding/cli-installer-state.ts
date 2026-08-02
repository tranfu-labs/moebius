import type {
  OnboardingCliInstallSnapshot,
  OnboardingCliInstallStage,
  OnboardingCliInstallState,
  OnboardingCliInstallStatus,
} from "./cli-installer-contract.js";
import type { OnboardingCli } from "./cli-readiness-contract.js";

export const ONBOARDING_INSTALLER_CLIS = ["codex", "claude", "kimi"] as const;

export function createOnboardingCliInstallState(
  displayCommands: Readonly<Record<OnboardingCli, string>>,
  updatedAt: string,
): OnboardingCliInstallState {
  return {
    codex: createInitialSnapshot("codex", displayCommands.codex, updatedAt),
    claude: createInitialSnapshot("claude", displayCommands.claude, updatedAt),
    kimi: createInitialSnapshot("kimi", displayCommands.kimi, updatedAt),
  };
}

export function planOnboardingCliInstallSnapshot(
  current: OnboardingCliInstallSnapshot,
  input: {
    status: OnboardingCliInstallStatus;
    stage: OnboardingCliInstallStage | null;
    displayCommand: string;
    startedAt: string | null;
    updatedAt: string;
  },
): OnboardingCliInstallSnapshot {
  return {
    cli: current.cli,
    status: input.status,
    stage: input.stage,
    revision: current.revision + 1,
    displayCommand: input.displayCommand,
    startedAt: input.startedAt,
    updatedAt: input.updatedAt,
  };
}

function createInitialSnapshot(
  cli: OnboardingCli,
  displayCommand: string,
  updatedAt: string,
): OnboardingCliInstallSnapshot {
  return {
    cli,
    status: "idle",
    stage: null,
    revision: 0,
    displayCommand,
    startedAt: null,
    updatedAt,
  };
}
