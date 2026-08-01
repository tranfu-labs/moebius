import type { OnboardingCli, OnboardingInstallationState, Translate } from "@moebius/console-ui";

import type { DesktopApi } from "../console-page/app.js";
import { useOnboardingInstallationActions } from "./use-onboarding-installation-actions.js";
import { useOnboardingInstallationState } from "./use-onboarding-installation-state.js";

export function useOnboardingInstallations(input: {
  api: DesktopApi | undefined;
  loadReadinessState(): Promise<void>;
  t: Translate;
}): {
  installations: OnboardingInstallationState;
  loadInstallState(): Promise<void>;
  install(cli: OnboardingCli): Promise<void>;
  updateClaude(): Promise<void>;
  cancel(cli: OnboardingCli): Promise<void>;
} {
  const state = useOnboardingInstallationState(input);
  const actions = useOnboardingInstallationActions({ api: input.api, state, t: input.t });
  return {
    installations: state.installations,
    loadInstallState: state.loadInstallState,
    ...actions,
  };
}
