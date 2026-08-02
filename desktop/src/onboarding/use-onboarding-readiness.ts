import type { OnboardingEnvironmentState } from "@moebius/console-ui";
import { useCallback, useRef, useState } from "react";

import type { DesktopApi } from "../console-page/desktop-api-contract.js";
import type { OnboardingCliReadinessSnapshot } from "./cli-readiness-contract.js";
import {
  createOnboardingReadinessModel,
  decideOnboardingReadinessCheckCurrent,
  decideOnboardingReadinessSnapshot,
  planOnboardingReadinessCheck,
  planOnboardingReadinessCheckingView,
  planOnboardingLegacyReadinessView,
  planOnboardingReadinessStateLoad,
  planOnboardingReadinessStateResult,
  planOnboardingReadinessTransport,
  planOnboardingReadinessView,
} from "./onboarding-readiness-model.js";

const INITIAL_ENVIRONMENT: OnboardingEnvironmentState = {
  codex: { status: "checking", revision: 0 },
  claude: { status: "checking", revision: 0 },
  kimi: { status: "checking", revision: 0 },
};

export function useOnboardingReadiness(api: DesktopApi | undefined): {
  environment: OnboardingEnvironmentState;
  checkEnvironment(): Promise<void>;
  loadReadinessState(): Promise<void>;
} {
  const [environment, setEnvironment] = useState<OnboardingEnvironmentState>(INITIAL_ENVIRONMENT);
  const modelRef = useRef(createOnboardingReadinessModel());

  const mergeSnapshot = useCallback((snapshot: OnboardingCliReadinessSnapshot): boolean => {
    const decision = decideOnboardingReadinessSnapshot(modelRef.current, snapshot);
    if (!decision.accepted) return false;
    modelRef.current = decision.model;
    setEnvironment((current) => ({
      ...current,
      [snapshot.cli]: planOnboardingReadinessView(snapshot),
    }));
    return true;
  }, []);

  const checkCli = useCallback(async (cli: OnboardingCliReadinessSnapshot["cli"]) => {
    const check = planOnboardingReadinessCheck(modelRef.current, cli);
    modelRef.current = check.model;
    setEnvironment((current) => ({
      ...current,
      [cli]: planOnboardingReadinessCheckingView(current[cli]),
    }));
    const transport = planOnboardingReadinessTransport(
      cli,
      api?.checkOnboardingCliReadiness !== undefined,
    );
    try {
      if (transport.kind === "modern") {
        const result = await api?.checkOnboardingCliReadiness?.(cli);
        if (
          result !== undefined
          && decideOnboardingReadinessCheckCurrent(modelRef.current, cli, check.sequence)
        ) mergeSnapshot(result);
        return;
      }
      if (transport.kind === "unsupported") {
        setEnvironment((current) => ({
          ...current,
          [cli]: { status: "missing", revision: current[cli].revision },
        }));
        return;
      }
      const legacy = await api?.checkOnboardingCodex?.();
      if (!decideOnboardingReadinessCheckCurrent(modelRef.current, cli, check.sequence)) return;
      setEnvironment((current) => ({
        ...current,
        codex: planOnboardingLegacyReadinessView(legacy, current.codex.revision),
      }));
    } catch {
      if (!decideOnboardingReadinessCheckCurrent(modelRef.current, cli, check.sequence)) return;
      setEnvironment((current) => ({
        ...current,
        [cli]: { status: "unavailable", revision: current[cli].revision },
      }));
    }
  }, [api, mergeSnapshot]);

  const checkEnvironment = useCallback(async () => {
    await Promise.all([checkCli("codex"), checkCli("claude"), checkCli("kimi")]);
  }, [checkCli]);

  const loadReadinessState = useCallback(async () => {
    const load = planOnboardingReadinessStateLoad(
      api?.getOnboardingCliReadinessState !== undefined,
    );
    if (load.kind === "skip") return;
    try {
      const result = planOnboardingReadinessStateResult(
        await api?.getOnboardingCliReadinessState?.(),
      );
      if (result.kind === "skip") return;
      mergeSnapshot(result.state.codex);
      mergeSnapshot(result.state.claude);
      mergeSnapshot(result.state.kimi);
    } catch {
      // Keep the last safe renderer state; manual recheck remains available.
    }
  }, [api, mergeSnapshot]);

  return { environment, checkEnvironment, loadReadinessState };
}
