import { useCallback, useMemo, useRef } from "react";
import type { Translate } from "@moebius/console-ui";

import type { AgentTeamListResponse } from "../team-ipc-contract.js";
import { planAgentTeamCatalogLoad, planAgentTeamCatalogPort } from "./agent-team-console-model.js";
import type { AgentTeamCatalogBundle } from "./use-agent-team-catalog.js";
import { reconcileAgentTeamSelection } from "./team-state.js";

interface AgentTeamRegistrationPort {
  showAgentTeamSeedConflictLocation?: () => Promise<void>;
  resolveAgentTeamSeedConflict?: () => Promise<AgentTeamListResponse>;
}

export function useAgentTeamRegistration(input: {
  api: AgentTeamRegistrationPort | undefined;
  catalog: AgentTeamCatalogBundle;
  open(teamKey: string): void;
  t: Translate;
}) {
  const inputRef = useRef(input);
  inputRef.current = input;
  const viewConflict = useCallback(() => inputRef.current.open("user:general-assistant"), []);
  const showConflictLocation = useCallback(async (): Promise<void> => {
    const operation = inputRef.current.api?.showAgentTeamSeedConflictLocation;
    if (planAgentTeamCatalogPort(operation !== undefined) === "unavailable") {
      throw new Error(inputRef.current.t("desktop.error.openLocation"));
    }
    await operation!.call(inputRef.current.api);
  }, []);
  const preserveConflicts = useCallback(async (): Promise<void> => {
    const runtime = inputRef.current;
    const operation = runtime.api?.resolveAgentTeamSeedConflict;
    if (planAgentTeamCatalogPort(operation !== undefined) === "unavailable") {
      throw new Error(runtime.t("console.agentTeams.registrationConflictActionFailed"));
    }
    const response = await operation!.call(runtime.api);
    const plan = planAgentTeamCatalogLoad(response, null);
    if (plan.kind !== "ready") {
      throw new Error(runtime.t("console.agentTeams.registrationConflictActionFailed"));
    }
    runtime.catalog.setState(plan.state);
    runtime.catalog.setSelection((current) => reconcileAgentTeamSelection(plan.teams, current));
  }, []);
  return useMemo(() => ({
    viewConflict,
    showConflictLocation,
    preserveConflicts,
  }), [preserveConflicts, showConflictLocation, viewConflict]);
}
