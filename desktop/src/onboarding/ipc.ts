import { checkCodex, type DoctorCheck } from "../env-doctor.js";
import type { AiTeamBuilderIpcResponse } from "../ai-team-builder/contract.js";
import {
  readOnboardingCompletion,
  writeOnboardingCompletion,
  type OnboardingCompletionStatus,
} from "./first-run-marker.js";
import { ONBOARDING_IPC_CHANNELS } from "./contract.js";
import {
  isOnboardingCli,
  type OnboardingCli,
  type OnboardingCliReadinessSnapshot,
  type OnboardingCliReadinessState,
} from "./cli-readiness-contract.js";
import { OnboardingCliReadinessService } from "./cli-readiness.js";
import type {
  OnboardingCliInstallSnapshot,
  OnboardingCliInstallState,
} from "./cli-installer-contract.js";
import { OnboardingCliInstallManager } from "./cli-installer-manager.js";

export { ONBOARDING_IPC_CHANNELS } from "./contract.js";

export interface OnboardingIpcMain {
  handle(
    channel: string,
    listener: (
      event: unknown,
      request?: unknown,
    ) => Promise<
      | OnboardingCompletionStatus
      | AiTeamBuilderIpcResponse
      | DoctorCheck
      | OnboardingCliReadinessState
      | OnboardingCliReadinessSnapshot
      | OnboardingCliInstallState
      | OnboardingCliInstallSnapshot
      | void
    >,
  ): void;
}

export function registerOnboardingCoreIpc(input: {
  ipcMain: OnboardingIpcMain;
  getDataRoot: () => string;
  checkCodex?: () => Promise<DoctorCheck>;
  clipboard: { writeText(value: string): void };
  readiness: OnboardingCliReadinessService;
  installer: OnboardingCliInstallManager;
}): void {
  const { readiness, installer } = input;
  input.ipcMain.handle(ONBOARDING_IPC_CHANNELS.status, async () =>
    readOnboardingCompletion(input.getDataRoot()));
  input.ipcMain.handle(ONBOARDING_IPC_CHANNELS.complete, async () =>
    writeOnboardingCompletion(input.getDataRoot()));
  input.ipcMain.handle(ONBOARDING_IPC_CHANNELS.checkCodex, async () =>
    (input.checkCodex ?? checkCodex)());
  input.ipcMain.handle(ONBOARDING_IPC_CHANNELS.copyInstallCommand, async () => {
    input.clipboard.writeText("npm install -g @openai/codex");
  });
  input.ipcMain.handle(ONBOARDING_IPC_CHANNELS.cliReadinessState, async () =>
    readiness.getState());
  input.ipcMain.handle(ONBOARDING_IPC_CHANNELS.cliReadinessCheck, async (_event, rawRequest) =>
    readiness.check(parseCliRequest(rawRequest)));
  input.ipcMain.handle(ONBOARDING_IPC_CHANNELS.cliInstallState, async () =>
    installer.getState());
  input.ipcMain.handle(ONBOARDING_IPC_CHANNELS.cliInstallStart, async (_event, rawRequest) =>
    installer.start(parseCliRequest(rawRequest)));
  input.ipcMain.handle(ONBOARDING_IPC_CHANNELS.claudeUpdateStart, async (_event, rawRequest) => {
    if (rawRequest !== undefined) {
      throw new OnboardingIpcRequestError();
    }
    return installer.startClaudeUpdate(
      await readiness.getOrResolveTrustedClaudeExecutable(),
    );
  });
  input.ipcMain.handle(ONBOARDING_IPC_CHANNELS.cliInstallCancel, async (_event, rawRequest) =>
    installer.cancel(parseCliRequest(rawRequest)));

}

function parseCliRequest(value: unknown): OnboardingCli {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || Object.keys(value).length !== 1
    || !("cli" in value)
    || !isOnboardingCli(value.cli)
  ) {
    throw new OnboardingIpcRequestError();
  }
  return value.cli;
}

export class OnboardingIpcRequestError extends Error {
  readonly code = "ONBOARDING_IPC_REQUEST_INVALID";

  constructor() {
    super("Invalid onboarding IPC request.");
    this.name = "OnboardingIpcRequestError";
  }
}
