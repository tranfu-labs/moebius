import { useEffect, useState, type ComponentType } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";

import type { OnboardingCompletionStatus } from "../onboarding/first-run-marker.js";
import { finishOnboardingPresentation } from "../onboarding/onboarding-completion.js";
import { OnboardingRoute } from "../onboarding/onboarding-route.js";
import {
  planDesktopRoute,
  planActiveRouteCommit,
  planOnboardingCompletion,
  planOnboardingStatusRead,
} from "./desktop-routing-model.js";
import { OperatorConsoleRoute } from "./operator-console-route.js";

interface OperatorConsoleRouteProps {
  pendingAgentTeamKey: string | null;
  onReplayOnboarding(): void;
}

interface DesktopOnboardingPort {
  getOnboardingStatus?: () => Promise<OnboardingCompletionStatus>;
  completeOnboarding?: () => Promise<OnboardingCompletionStatus>;
}

export function DesktopRoutesController(props: {
  api: DesktopOnboardingPort | undefined;
  onboardingSaveError: string;
  operatorConsole: ComponentType<OperatorConsoleRouteProps>;
}): JSX.Element {
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    const readStatus = async () => {
      if (planOnboardingStatusRead(props.api?.getOnboardingStatus !== undefined) === "assume-complete") {
        if (planActiveRouteCommit(active)) setOnboardingCompleted(true);
        return;
      }
      try {
        const result = await props.api!.getOnboardingStatus!.call(props.api);
        if (planActiveRouteCommit(active)) setOnboardingCompleted(result.completed);
      } catch {
        if (planActiveRouteCommit(active)) setOnboardingCompleted(false);
      }
    };
    void readStatus();
    return () => { active = false; };
  }, [props.api]);
  const routePlan = planDesktopRoute(onboardingCompleted);
  if (routePlan === "loading") {
    return <main className="h-screen min-h-[560px] bg-canvas" data-testid="desktop-route-loading" />;
  }
  const completeOnboarding = async (pendingAgentTeamKey: string) => {
    const result = await props.api?.completeOnboarding?.();
    if (planOnboardingCompletion(result?.completed) === "reject") {
      throw new Error(props.onboardingSaveError);
    }
    setOnboardingCompleted(true);
    navigate("/", {
      replace: true,
      state: { pendingAgentTeamKey },
    });
  };
  return (
    <Routes>
      <Route
        path="/onboarding/*"
        element={routePlan === "onboarding"
          ? <OnboardingRoute onComplete={(teamKey) => finishOnboardingPresentation({
              mode: "first-run",
              teamKey,
              onFirstRunComplete: completeOnboarding,
            })} />
          : <Navigate replace to="/" />}
      />
      <Route
        path="/*"
        element={routePlan === "onboarding"
          ? <Navigate replace to="/onboarding" />
          : <OperatorConsoleRoute operatorConsole={props.operatorConsole} />}
      />
    </Routes>
  );
}
