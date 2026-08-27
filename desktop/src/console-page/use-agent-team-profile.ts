import { useCallback, useMemo, useRef, useState } from "react";
import type { Translate } from "@moebius/console-ui";

import type {
  AgentTeamExecutionProfileDocument,
  AgentTeamExecutionProfileSaveRequest,
  AgentTeamMemberDocument,
  AgentTeamMemberOrderWriteRequest,
  AgentTeamMemberRequest,
  AgentTeamMemberWriteRequest,
  AgentTeamPrimaryAgentWriteRequest,
  AgentTeamListItem,
} from "../team-ipc-contract.js";
import {
  planAgentTeamCatalogReplace,
  planAgentTeamMemberSummary,
  planAgentTeamPortraitOperation,
  planAgentTeamPrimaryOperation,
  planAgentTeamProfileOperation,
  planAgentTeamReorderOperation,
  planFindOperatorAgentTeam,
  planOperatorAgentTeam,
} from "./agent-team-console-model.js";
import { planConsoleErrorMessage } from "./console-state-plan.js";
import type { AgentTeamCatalogBundle } from "./use-agent-team-catalog.js";

interface AgentTeamProfilePort {
  setAgentTeamPrimaryAgent?: (request: AgentTeamPrimaryAgentWriteRequest) => Promise<AgentTeamListItem>;
  reorderAgentTeamMembers?: (request: AgentTeamMemberOrderWriteRequest) => Promise<AgentTeamListItem>;
  writeAgentTeamMember?: (request: AgentTeamMemberWriteRequest) => Promise<AgentTeamMemberDocument>;
  saveAgentTeamExecutionProfile?: (
    request: AgentTeamExecutionProfileSaveRequest,
  ) => Promise<AgentTeamExecutionProfileDocument>;
  restoreAgentTeamRecommendedProfile?: (
    request: AgentTeamMemberRequest,
  ) => Promise<AgentTeamExecutionProfileDocument>;
}

export interface PrimaryAgentChangeState {
  teamKey: string;
  status: "saving" | "saved" | "failed";
  error: string | null;
}

export interface PortraitChangeState {
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
  const [portraitChange, setPortraitChange] = useState<PortraitChangeState | null>(null);
  const clearPrimaryAgentChange = useCallback(() => setPrimaryAgentChange(null), []);
  const clearPortraitChange = useCallback(() => setPortraitChange(null), []);
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
  const reorderMembers = useCallback(async (teamKey: string, memberSlugs: string[]): Promise<void> => {
    const runtime = inputRef.current;
    const team = planFindOperatorAgentTeam(runtime.catalog.state, teamKey);
    const operation = runtime.api?.reorderAgentTeamMembers;
    if (planAgentTeamReorderOperation(team, memberSlugs, operation !== undefined) === "skip") return;
    // Reordering into first place *is* appointing the primary Agent; one status line covers it.
    setPrimaryAgentChange({ teamKey, status: "saving", error: null });
    try {
      const updated = planOperatorAgentTeam(await operation!.call(runtime.api, {
        teamId: team!.id,
        ownership: team!.ownership,
        memberOrder: memberSlugs,
      }));
      inputRef.current.catalog.setState((current) => planAgentTeamCatalogReplace(current, updated));
      setPrimaryAgentChange({ teamKey, status: "saved", error: null });
    } catch (error) {
      setPrimaryAgentChange({ teamKey, status: "failed", error: planConsoleErrorMessage(error) });
      // The detail's save flow keeps the order draft on a failed commit, so the caller needs
      // the rejection rather than a silent resolve.
      throw error;
    }
  }, []);
  const changeMemberPortrait = useCallback(async (
    teamKey: string,
    memberSlug: string,
    portraitId: string | null,
  ): Promise<void> => {
    const runtime = inputRef.current;
    const team = planFindOperatorAgentTeam(runtime.catalog.state, teamKey);
    const operation = runtime.api?.writeAgentTeamMember;
    if (planAgentTeamPortraitOperation(team, memberSlug, operation !== undefined) === "skip") return;
    setPortraitChange({ teamKey, status: "saving", error: null });
    try {
      const document = await operation!.call(runtime.api, {
        teamId: team!.id,
        ownership: team!.ownership,
        memberSlug,
        portraitId,
      });
      inputRef.current.catalog.setState((current) => planAgentTeamMemberSummary(current, teamKey, document));
      setPortraitChange({ teamKey, status: "saved", error: null });
    } catch (error) {
      setPortraitChange({ teamKey, status: "failed", error: planConsoleErrorMessage(error) });
      // The detail's save flow keeps the portrait draft on a failed commit.
      throw error;
    }
  }, []);
  const saveExecutionProfile = useCallback(async (
    teamKey: string,
    memberSlug: string,
    profile:
      | { cli: "codex" | "claude" | "kimi"; model: string; effort: string }
      | { cli: "pi"; providerId: "deepseek"; providerProfileId: string; model: string; effort: string },
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
  return useMemo(() => ({
    primaryAgentChange,
    clearPrimaryAgentChange,
    portraitChange,
    clearPortraitChange,
    changePrimaryAgent,
    reorderMembers,
    changeMemberPortrait,
    saveExecutionProfile,
    restoreRecommendedProfile,
  }), [
    changeMemberPortrait,
    changePrimaryAgent,
    reorderMembers,
    clearPortraitChange,
    clearPrimaryAgentChange,
    portraitChange,
    primaryAgentChange,
    restoreRecommendedProfile,
    saveExecutionProfile,
  ]);
}
