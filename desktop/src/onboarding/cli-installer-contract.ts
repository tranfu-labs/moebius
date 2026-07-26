import type { OnboardingCli } from "./cli-readiness-contract.js";

export type OnboardingCliInstallStatus =
  | "idle"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed-out";

export type OnboardingCliInstallStage =
  | "starting"
  | "downloading"
  | "installing"
  | "verifying";

export interface OnboardingCliInstallSnapshot {
  cli: OnboardingCli;
  status: OnboardingCliInstallStatus;
  stage: OnboardingCliInstallStage | null;
  revision: number;
  displayCommand: string;
  startedAt: string | null;
  updatedAt: string;
}

export interface OnboardingCliInstallState {
  codex: OnboardingCliInstallSnapshot;
  kimi: OnboardingCliInstallSnapshot;
}
