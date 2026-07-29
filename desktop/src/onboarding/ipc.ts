import { AiTeamBuilder } from "../ai-team-builder/index.js";
import {
  registerAiTeamBuilderIpc,
} from "../ai-team-builder-ipc.js";
import {
  AI_TEAM_BUILDER_IPC_CHANNELS,
  type AiTeamBuilderIpcResponse,
} from "../ai-team-builder/contract.js";
import { checkCodex, type DoctorCheck } from "../env-doctor.js";
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
      | DoctorCheck
      | AiTeamBuilderIpcResponse
      | OnboardingCliReadinessState
      | OnboardingCliReadinessSnapshot
      | OnboardingCliInstallState
      | OnboardingCliInstallSnapshot
      | void
    >,
  ): void;
}

export function registerOnboardingIpc(input: {
  ipcMain: OnboardingIpcMain;
  getDataRoot: () => string;
  checkCodex?: () => Promise<DoctorCheck>;
  clipboard: { writeText(value: string): void };
  readiness?: OnboardingCliReadinessService;
  installer?: OnboardingCliInstallManager;
  teamBuilder?: AiTeamBuilder;
}): void {
  const readiness = input.readiness ?? new OnboardingCliReadinessService();
  const installer = input.installer ?? new OnboardingCliInstallManager({
    onInstallSucceeded: async (cli) => {
      await readiness.check(cli);
    },
  });
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

  const channelMap = new Map<string, string>([
    [AI_TEAM_BUILDER_IPC_CHANNELS.state, ONBOARDING_IPC_CHANNELS.teamBuilderState],
    [AI_TEAM_BUILDER_IPC_CHANNELS.start, ONBOARDING_IPC_CHANNELS.teamBuilderStart],
    [AI_TEAM_BUILDER_IPC_CHANNELS.submit, ONBOARDING_IPC_CHANNELS.teamBuilderSubmit],
    [AI_TEAM_BUILDER_IPC_CHANNELS.adjust, ONBOARDING_IPC_CHANNELS.teamBuilderAdjust],
    [AI_TEAM_BUILDER_IPC_CHANNELS.retry, ONBOARDING_IPC_CHANNELS.teamBuilderRetry],
    [AI_TEAM_BUILDER_IPC_CHANNELS.commit, ONBOARDING_IPC_CHANNELS.teamBuilderCommit],
  ]);
  registerAiTeamBuilderIpc({
    ipcMain: {
      handle(channel, listener) {
        const onboardingChannel = channelMap.get(channel);
        if (onboardingChannel === undefined) {
          throw new Error(`Unsupported onboarding AI team builder channel: ${channel}`);
        }
        input.ipcMain.handle(onboardingChannel, listener);
      },
    },
    builder: input.teamBuilder ?? new AiTeamBuilder({
      dataRoot: input.getDataRoot(),
      resolveExecutionProfile: async () => readiness.resolveBuilderExecutionProfile(),
    }),
  });
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
