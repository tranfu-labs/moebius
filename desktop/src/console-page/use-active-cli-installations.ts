import { useEffect, useRef, useState } from "react";

import type {
  OnboardingCliInstallSnapshot,
  OnboardingCliInstallState,
} from "../onboarding/cli-installer-contract.js";
import type { OnboardingCli } from "../onboarding/cli-readiness-contract.js";
import {
  createOnboardingInstallationModel,
  decideConsoleInstallationSnapshot,
  decideOnboardingInstallationPolling,
  planActiveOnboardingInstallations,
  planOnboardingInstallationStateResult,
} from "../onboarding/onboarding-installation-model.js";

export interface ConsoleCliInstallationPort {
  getOnboardingCliInstallState?: () => Promise<OnboardingCliInstallState>;
  onOnboardingCliInstallSnapshot?: (
    listener: (snapshot: OnboardingCliInstallSnapshot) => void,
  ) => () => void;
  checkOnboardingCliReadiness?: (cli: OnboardingCli) => Promise<unknown>;
}

export function useActiveCliInstallationsBundle(api: ConsoleCliInstallationPort | undefined) {
  const modelRef = useRef(createOnboardingInstallationModel());
  const [activeCliInstallations, setActiveCliInstallations] = useState<OnboardingCli[]>([]);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: number | undefined;

    const recheckAfterInstall = async (cli: OnboardingCli) => {
      await api?.checkOnboardingCliReadiness?.(cli).catch(() => undefined);
    };
    const applySnapshot = (snapshot: OnboardingCliInstallSnapshot) => {
      const decision = decideConsoleInstallationSnapshot(modelRef.current, snapshot);
      if (decision.accepted) {
        modelRef.current = decision.model;
        setActiveCliInstallations(planActiveOnboardingInstallations(decision.model));
      }
      return decision;
    };
    const pollInstallations = async () => {
      const result = planOnboardingInstallationStateResult(
        await api?.getOnboardingCliInstallState?.().catch(() => undefined),
      );
      if (cancelled || result.kind === "skip") return;
      const decisions = (["codex", "claude", "kimi"] as const).map(
        (cli) => applySnapshot(result.state[cli]),
      );
      await Promise.all(decisions.filter((decision) => decision.leftRunning).map(
        (decision) => recheckAfterInstall(decision.cli),
      ));
      const polling = decideOnboardingInstallationPolling({
        transportAvailable: api?.getOnboardingCliInstallState !== undefined,
        statuses: (["codex", "claude", "kimi"] as const).map(
          (cli) => modelRef.current.accepted[cli].status,
        ),
      });
      if (polling.kind === "poll") {
        pollTimer = window.setTimeout(() => void pollInstallations(), 750);
      }
    };

    void pollInstallations();
    const unsubscribe = api?.onOnboardingCliInstallSnapshot?.((snapshot) => {
      if (cancelled) return;
      const decision = applySnapshot(snapshot);
      if (decision.shouldRecheckEvent) {
        void recheckAfterInstall(snapshot.cli);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
      window.clearTimeout(pollTimer);
    };
  }, [api]);

  return { activeCliInstallations };
}
