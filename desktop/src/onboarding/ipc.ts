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

export { ONBOARDING_IPC_CHANNELS } from "./contract.js";

export interface OnboardingIpcMain {
  handle(
    channel: string,
    listener: (
      event: unknown,
      request?: unknown,
    ) => Promise<OnboardingCompletionStatus | DoctorCheck | AiTeamBuilderIpcResponse | void>,
  ): void;
}

export function registerOnboardingIpc(input: {
  ipcMain: OnboardingIpcMain;
  getDataRoot: () => string;
  checkCodex?: () => Promise<DoctorCheck>;
  clipboard: { writeText(value: string): void };
}): void {
  input.ipcMain.handle(ONBOARDING_IPC_CHANNELS.status, async () =>
    readOnboardingCompletion(input.getDataRoot()));
  input.ipcMain.handle(ONBOARDING_IPC_CHANNELS.complete, async () =>
    writeOnboardingCompletion(input.getDataRoot()));
  input.ipcMain.handle(ONBOARDING_IPC_CHANNELS.checkCodex, async () =>
    (input.checkCodex ?? checkCodex)());
  input.ipcMain.handle(ONBOARDING_IPC_CHANNELS.copyInstallCommand, async () => {
    input.clipboard.writeText("brew install codex");
  });

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
    builder: new AiTeamBuilder({ dataRoot: input.getDataRoot() }),
  });
}
