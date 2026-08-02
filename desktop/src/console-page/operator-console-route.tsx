import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { finishOnboardingPresentation } from "../onboarding/onboarding-completion.js";
import { OnboardingRoute } from "../onboarding/onboarding-route.js";
import {
  planPendingAgentTeamKey,
  planReplayPresentation,
  planReplayReturnFocus,
} from "./desktop-routing-model.js";

interface OperatorConsoleRouteProps {
  pendingAgentTeamKey: string | null;
  onReplayOnboarding(): void;
}

export function OperatorConsoleRoute(props: {
  operatorConsole: ComponentType<OperatorConsoleRouteProps>;
}): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const [pendingAgentTeamKey] = useState(() => planPendingAgentTeamKey(location.state));
  const [replayingOnboarding, setReplayingOnboarding] = useState(false);
  const replayReturnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const navigationTeamKey = planPendingAgentTeamKey(location.state);
    if (navigationTeamKey === null) return;
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: null },
    );
  }, [location.hash, location.pathname, location.search, location.state, navigate]);
  const finishReplay = useCallback(() => {
    setReplayingOnboarding(false);
    window.requestAnimationFrame(() => replayReturnFocusRef.current?.focus());
  }, []);
  const startReplay = useCallback(() => {
    replayReturnFocusRef.current = planReplayReturnFocus<HTMLElement>(
      document.activeElement instanceof HTMLElement,
      document.activeElement as HTMLElement,
    );
    setReplayingOnboarding(true);
  }, []);
  const replayPlan = planReplayPresentation(replayingOnboarding);
  const OperatorConsoleComponent = props.operatorConsole;
  return (
    <>
      <div
        className={replayPlan === "show-onboarding" ? "hidden" : "contents"}
        aria-hidden={replayPlan === "show-onboarding" ? "true" : undefined}
        data-testid="operator-console-preserved-during-onboarding-replay"
      >
        <OperatorConsoleComponent
          pendingAgentTeamKey={pendingAgentTeamKey}
          onReplayOnboarding={startReplay}
        />
      </div>
      {replayPlan === "show-onboarding" ? (
        <OnboardingRoute
          mode="replay"
          onExit={finishReplay}
          onComplete={() => finishOnboardingPresentation({
            mode: "replay",
            onReplayComplete: finishReplay,
          })}
        />
      ) : null}
    </>
  );
}
