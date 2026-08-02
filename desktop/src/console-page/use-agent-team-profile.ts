import { useCallback, useMemo, useRef, useState } from "react";
import type { Translate } from "@moebius/console-ui";

import type {
  AgentTeamExecutionProfileDocument,
  AgentTeamExecutionProfileSaveRequest,
  AgentTeamMemberRequest,
  AgentTeamOfficialUpdateCommitRequest,
  AgentTeamOfficialUpdateCommitResponse,
  AgentTeamOfficialUpdatePrepareResponse,
  AgentTeamOfficialUpdateRequest,
  AgentTeamPrimaryAgentWriteRequest,
  AgentTeamListItem,
} from "../team-ipc-contract.js";
import {
  planAgentTeamCatalogAddIfMissing,
  planAgentTeamCatalogReplace,
  planAgentTeamPrimaryOperation,
  planAgentTeamProfileOperation,
  planAgentTeamOfficialUpdate,
  planFindOperatorAgentTeam,
  planOptionalOperatorAgentTeam,
  planOperatorAgentTeam,
} from "./agent-team-console-model.js";
import { planConsoleErrorMessage } from "./console-state-plan.js";
import type { AgentTeamCatalogBundle } from "./use-agent-team-catalog.js";

interface AgentTeamProfilePort {
  setAgentTeamPrimaryAgent?: (request: AgentTeamPrimaryAgentWriteRequest) => Promise<AgentTeamListItem>;
  saveAgentTeamExecutionProfile?: (
    request: AgentTeamExecutionProfileSaveRequest,
  ) => Promise<AgentTeamExecutionProfileDocument>;
  restoreAgentTeamRecommendedProfile?: (
    request: AgentTeamMemberRequest,
  ) => Promise<AgentTeamExecutionProfileDocument>;
  prepareAgentTeamOfficialUpdate?: (
    request: AgentTeamOfficialUpdateRequest,
  ) => Promise<AgentTeamOfficialUpdatePrepareResponse>;
  applyAgentTeamOfficialUpdate?: (
    request: AgentTeamOfficialUpdateCommitRequest,
  ) => Promise<AgentTeamOfficialUpdateCommitResponse>;
}

export interface PrimaryAgentChangeState {
  teamKey: string;
  status: "saving" | "saved" | "failed";
  error: string | null;
}

export function useAgentTeamProfile(input: {
  api: AgentTeamProfilePort | undefined;
  catalog: AgentTeamCatalogBundle;
  t: Translate;
}) {
  const inputRef = useRef(input);
  inputRef.current = input;
  const [primaryAgentChange, setPrimaryAgentChange] = useState<PrimaryAgentChangeState | null>(null);
  const clearPrimaryAgentChange = useCallback(() => setPrimaryAgentChange(null), []);
  const changePrimaryAgent = useCallback(async (teamKey: string, memberSlug: string): Promise<void> => {
    const runtime = inputRef.current;
    const team = planFindOperatorAgentTeam(runtime.catalog.state, teamKey);
    const operation = runtime.api?.setAgentTeamPrimaryAgent;
    if (planAgentTeamPrimaryOperation(team, memberSlug, operation !== undefined) === "skip") return;
    setPrimaryAgentChange({ teamKey, status: "saving", error: null });
    try {
      const updated = planOperatorAgentTeam(await operation!.call(runtime.api, {
        teamId: team!.id,
        ownership: team!.ownership,
        primaryAgentSlug: memberSlug,
      }));
      inputRef.current.catalog.setState((current) => planAgentTeamCatalogReplace(current, updated));
      setPrimaryAgentChange({ teamKey, status: "saved", error: null });
    } catch (error) {
      setPrimaryAgentChange({ teamKey, status: "failed", error: planConsoleErrorMessage(error) });
    }
  }, []);
  const saveExecutionProfile = useCallback(async (
    teamKey: string,
    memberSlug: string,
    profile: { cli: "codex" | "claude" | "kimi"; model: string; effort: string },
  ) => {
    const runtime = inputRef.current;
    const team = planFindOperatorAgentTeam(runtime.catalog.state, teamKey);
    const operation = runtime.api?.saveAgentTeamExecutionProfile;
    if (planAgentTeamProfileOperation(team, operation !== undefined) === "unavailable") {
      throw new Error(runtime.t("desktop.error.profileSave"));
    }
    const document = await operation!.call(runtime.api, {
      teamId: team!.id,
      ownership: team!.ownership,
      memberSlug,
      profile,
    });
    inputRef.current.catalog.refresh();
    return document;
  }, []);
  const restoreRecommendedProfile = useCallback(async (teamKey: string, memberSlug: string) => {
    const runtime = inputRef.current;
    const team = planFindOperatorAgentTeam(runtime.catalog.state, teamKey);
    const operation = runtime.api?.restoreAgentTeamRecommendedProfile;
    if (planAgentTeamProfileOperation(team, operation !== undefined) === "unavailable") {
      throw new Error(runtime.t("desktop.error.profileRestore"));
    }
    const document = await operation!.call(runtime.api, {
      teamId: team!.id,
      ownership: team!.ownership,
      memberSlug,
    });
    inputRef.current.catalog.refresh();
    return document;
  }, []);
  const applyOfficialUpdate = useCallback(async (teamKey: string) => {
    const runtime = inputRef.current;
    const team = planFindOperatorAgentTeam(runtime.catalog.state, teamKey);
    const prepare = runtime.api?.prepareAgentTeamOfficialUpdate;
    const apply = runtime.api?.applyAgentTeamOfficialUpdate;
    if (planAgentTeamOfficialUpdate(team, prepare !== undefined, apply !== undefined) === "unavailable") {
      throw new Error(runtime.t("desktop.error.officialUpdate"));
    }
    const prepared = await prepare!.call(runtime.api, { teamId: team!.id, ownership: "system" });
    const result = await apply!.call(runtime.api, { plan: prepared });
    const copiedTeam = planOptionalOperatorAgentTeam(result.copiedTeam);
    if (copiedTeam !== null) {
      inputRef.current.catalog.setState((current) => planAgentTeamCatalogAddIfMissing(current, copiedTeam));
    }
    inputRef.current.catalog.refresh();
    return {
      copiedTeamId: result.copiedTeamId,
      appliedOfficialVersion: result.appliedOfficialVersion,
      memberChanges: result.memberChanges,
    };
  }, []);
  return useMemo(() => ({
    primaryAgentChange,
    clearPrimaryAgentChange,
    changePrimaryAgent,
    saveExecutionProfile,
    restoreRecommendedProfile,
    applyOfficialUpdate,
  }), [
    applyOfficialUpdate,
    changePrimaryAgent,
    clearPrimaryAgentChange,
    primaryAgentChange,
    restoreRecommendedProfile,
    saveExecutionProfile,
  ]);
}
