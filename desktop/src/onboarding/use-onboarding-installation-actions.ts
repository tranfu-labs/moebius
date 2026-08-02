import type { OnboardingCli, Translate } from "@moebius/console-ui";
import { useCallback, useRef } from "react";

import type { DesktopApi } from "../console-page/desktop-api-contract.js";
import type { OnboardingCliInstallSnapshot } from "./cli-installer-contract.js";
import {
  decideOnboardingInstallationCancellation,
  decideOnboardingInstallationMutation,
  planOnboardingCliDisplayName,
} from "./onboarding-installation-model.js";
import type { OnboardingInstallationStateController } from "./use-onboarding-installation-state.js";

export function useOnboardingInstallationActions(input: {
  api: DesktopApi | undefined;
  state: OnboardingInstallationStateController;
  t: Translate;
}): {
  install(cli: OnboardingCli): Promise<void>;
  updateClaude(): Promise<void>;
  cancel(cli: OnboardingCli): Promise<void>;
} {
  const { api, state, t } = input;
  const pendingRef = useRef(new Set<OnboardingCli>());
  const start = useCallback(async (
    cli: OnboardingCli,
    operation: (() => Promise<OnboardingCliInstallSnapshot>) | undefined,
  ) => {
    const admission = decideOnboardingInstallationMutation({
      transportAvailable: operation !== undefined,
      pending: pendingRef.current.has(cli),
      status: state.current(cli).status,
    });
    if (admission.kind === "skip") return;
    pendingRef.current.add(cli);
    state.setCli(cli, {
      cli,
      status: "running",
      revision: state.current(cli).revision,
      stage: "starting",
    });
    try {
      state.mergeSnapshot(await operation!());
    } catch {
      state.setCli(cli, {
        cli,
        status: "failed",
        revision: state.current(cli).revision,
      });
      await state.loadInstallState();
    } finally {
      pendingRef.current.delete(cli);
    }
  }, [state]);
  const install = useCallback((cli: OnboardingCli) => start(
    cli,
    api?.startOnboardingCliInstall?.bind(api, cli),
  ), [api, start]);
  const updateClaude = useCallback(() => start(
    "claude",
    api?.startOnboardingClaudeUpdate?.bind(api),
  ), [api, start]);
  const cancel = useCallback(async (cli: OnboardingCli) => {
    const admission = decideOnboardingInstallationMutation({
      transportAvailable: api?.cancelOnboardingCliInstall !== undefined,
      pending: pendingRef.current.has(cli),
      status: "idle",
    });
    if (admission.kind === "skip") return;
    const confirmation = decideOnboardingInstallationCancellation(window.confirm(
      t("onboarding.cancelInstallConfirm", { cli: planOnboardingCliDisplayName(cli) }),
    ));
    if (confirmation.kind === "skip") return;
    pendingRef.current.add(cli);
    try {
      state.mergeSnapshot(await api!.cancelOnboardingCliInstall!(cli));
    } catch {
      await state.loadInstallState();
    } finally {
      pendingRef.current.delete(cli);
    }
  }, [api, state, t]);

  return { install, updateClaude, cancel };
}
