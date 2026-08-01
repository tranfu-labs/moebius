import type { OnboardingCli, OnboardingInstallationState } from "@moebius/console-ui";
import { useCallback, useEffect, useRef, useState } from "react";

import type { DesktopApi } from "../console-page/app.js";
import type { OnboardingCliInstallSnapshot } from "./cli-installer-contract.js";
import {
  createOnboardingInstallationModel,
  decideOnboardingInstallationPolling,
  decideOnboardingInstallationSnapshot,
  decideOnboardingReadinessRefresh,
  planOnboardingInstallationStateLoad,
  planOnboardingInstallationStateResult,
  planOnboardingInstallationView,
} from "./onboarding-installation-model.js";

const INITIAL_INSTALLATIONS: OnboardingInstallationState = {
  codex: { cli: "codex", status: "idle", revision: 0 },
  claude: { cli: "claude", status: "idle", revision: 0 },
  kimi: { cli: "kimi", status: "idle", revision: 0 },
};

export interface OnboardingInstallationStateController {
  installations: OnboardingInstallationState;
  current(cli: OnboardingCli): OnboardingInstallationState[OnboardingCli];
  setCli(cli: OnboardingCli, next: OnboardingInstallationState[OnboardingCli]): void;
  mergeSnapshot(snapshot: OnboardingCliInstallSnapshot): {
    accepted: boolean;
    becameSucceeded: boolean;
  };
  loadInstallState(): Promise<void>;
}

export function useOnboardingInstallationState(input: {
  api: DesktopApi | undefined;
  loadReadinessState(): Promise<void>;
}): OnboardingInstallationStateController {
  const { api, loadReadinessState } = input;
  const [installations, setInstallations] = useState(INITIAL_INSTALLATIONS);
  const modelRef = useRef(createOnboardingInstallationModel());
  const currentRef = useRef(INITIAL_INSTALLATIONS);

  const current = useCallback((cli: OnboardingCli) => currentRef.current[cli], []);
  const setCli = useCallback((cli: OnboardingCli, next: OnboardingInstallationState[OnboardingCli]) => {
    currentRef.current = { ...currentRef.current, [cli]: next };
    setInstallations((value) => ({ ...value, [cli]: next }));
  }, []);
  const mergeSnapshot = useCallback((snapshot: OnboardingCliInstallSnapshot) => {
    const decision = decideOnboardingInstallationSnapshot(modelRef.current, snapshot);
    if (!decision.accepted) return decision;
    modelRef.current = decision.model;
    setCli(snapshot.cli, planOnboardingInstallationView(snapshot));
    return decision;
  }, [setCli]);
  const loadInstallState = useCallback(async () => {
    const load = planOnboardingInstallationStateLoad(
      api?.getOnboardingCliInstallState !== undefined,
    );
    if (load.kind === "skip") return;
    try {
      const result = planOnboardingInstallationStateResult(
        await api?.getOnboardingCliInstallState?.(),
      );
      if (result.kind === "skip") return;
      const decisions = [
        mergeSnapshot(result.state.codex),
        mergeSnapshot(result.state.claude),
        mergeSnapshot(result.state.kimi),
      ];
      if (decideOnboardingReadinessRefresh(decisions)) await loadReadinessState();
    } catch {
      // Polling failure does not erase the last known task state.
    }
  }, [api, loadReadinessState, mergeSnapshot]);

  useEffect(() => {
    const subscription = planOnboardingInstallationStateLoad(
      api?.onOnboardingCliInstallSnapshot !== undefined,
    );
    if (subscription.kind === "skip") return;
    return api?.onOnboardingCliInstallSnapshot?.((snapshot) => {
      const merged = mergeSnapshot(snapshot);
      if (decideOnboardingReadinessRefresh([merged])) void loadReadinessState();
    });
  }, [api, loadReadinessState, mergeSnapshot]);
  useEffect(() => {
    const polling = decideOnboardingInstallationPolling({
      transportAvailable: api?.getOnboardingCliInstallState !== undefined,
      statuses: [
        installations.codex.status,
        installations.claude.status,
        installations.kimi.status,
      ],
    });
    if (polling.kind === "skip") return;
    const timer = window.setInterval(() => void loadInstallState(), 750);
    return () => window.clearInterval(timer);
  }, [api, installations, loadInstallState]);

  return { installations, current, setCli, mergeSnapshot, loadInstallState };
}
