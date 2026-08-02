import { AiTeamBuilder } from "../ai-team-builder/index.js";
import { registerAiTeamBuilderIpc } from "../ai-team-builder-ipc.js";
import { AI_TEAM_BUILDER_IPC_CHANNELS } from "../ai-team-builder/contract.js";
import type { DoctorCheck } from "../env-doctor.js";
import { ONBOARDING_IPC_CHANNELS } from "./contract.js";
import { OnboardingCliInstallManager } from "./cli-installer-manager.js";
import { OnboardingCliReadinessService } from "./cli-readiness.js";
import { registerOnboardingCoreIpc, type OnboardingIpcMain } from "./ipc.js";

export { ONBOARDING_IPC_CHANNELS } from "./contract.js";
export type { OnboardingIpcMain } from "./ipc.js";

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
  registerOnboardingCoreIpc({ ...input, readiness, installer });

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
