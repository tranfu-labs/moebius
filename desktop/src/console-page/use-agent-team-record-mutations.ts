import { useCallback, useMemo, useRef } from "react";
import type { AgentTeamInformationInput, OperatorAgentTeam, Translate } from "@moebius/console-ui";

import type {
  AgentTeamCreateRequest,
  AgentTeamListItem,
  AgentTeamTrashUserRequest,
  AgentTeamUpdateInformationRequest,
} from "../team-ipc-contract.js";
import type { AgentTeamFileManagerRequest } from "../team-file-manager-contract.js";
import type { AgentTeamRelocateRequest, AgentTeamRepairRequest } from "../team-repair-contract.js";
import {
  planAgentTeamCatalogAppend,
  planAgentTeamCatalogPort,
  planAgentTeamCatalogRemove,
  planAgentTeamCatalogReplace,
  planAgentTeamCatalogTeams,
  planAgentTeamFallbackSelection,
  planAgentTeamMutation,
  planAgentTeamRelocation,
  planAgentTeamRelocationDirectory,
  planAgentTeamSelectionAfterRemoval,
  planAgentTeamShouldClose,
  planFindOperatorAgentTeam,
  planOperatorAgentTeam,
} from "./agent-team-console-model.js";
import { removeAgentTeamDrafts } from "./team-state.js";
import type { AgentTeamCatalogBundle } from "./use-agent-team-catalog.js";
import type { useAgentTeamCopy } from "./use-agent-team-copy.js";
import type { useAgentTeamMemberEditor } from "./use-agent-team-member-editor.js";
import type { useAgentTeamNavigation } from "./use-agent-team-navigation.js";
import type { useAgentTeamProfile } from "./use-agent-team-profile.js";

type CopyBundle = ReturnType<typeof useAgentTeamCopy>;
type MemberBundle = ReturnType<typeof useAgentTeamMemberEditor>;
type NavigationBundle = ReturnType<typeof useAgentTeamNavigation>;
type ProfileBundle = ReturnType<typeof useAgentTeamProfile>;

interface AgentTeamRecordMutationPort {
  trashUserAgentTeam?: (request: AgentTeamTrashUserRequest) => Promise<void>;
  createAgentTeam?: (request: AgentTeamCreateRequest) => Promise<AgentTeamListItem>;
  updateAgentTeamInformation?: (request: AgentTeamUpdateInformationRequest) => Promise<AgentTeamListItem>;
  openAgentTeamLocation?: (request: AgentTeamFileManagerRequest) => Promise<void>;
  selectAgentTeamRelocationFolder?: () => Promise<string | null>;
  relocateAgentTeamRecord?: (request: AgentTeamRelocateRequest) => Promise<AgentTeamListItem>;
  removeAgentTeamRecord?: (request: AgentTeamRepairRequest) => Promise<void>;
}

export function useAgentTeamRecordMutations(input: {
  api: AgentTeamRecordMutationPort | undefined;
  catalog: AgentTeamCatalogBundle;
  copy: CopyBundle;
  member: MemberBundle;
  navigation: NavigationBundle;
  profile: ProfileBundle;
  t: Translate;
}) {
  const inputRef = useRef(input);
  inputRef.current = input;
  const trashTeam = useCallback(async (teamKey: string): Promise<void> => {
    const runtime = inputRef.current;
    runtime.copy.assertDraftsResolved(teamKey);
    const team = planFindOperatorAgentTeam(runtime.catalog.state, teamKey);
    const operation = runtime.api?.trashUserAgentTeam;
    if (planAgentTeamMutation(team, "user", operation !== undefined) === "unavailable") {
      throw new Error(runtime.t("desktop.error.trashTeam"));
    }
    await operation!.call(runtime.api, { teamId: team!.id, ownership: "user" });
    const current = inputRef.current;
    const nextState = planAgentTeamCatalogRemove(current.catalog.state, teamKey);
    const remainingTeams = planAgentTeamCatalogTeams(nextState);
    current.catalog.setState(nextState);
    current.member.commitDrafts(removeAgentTeamDrafts(current.member.draftsRef.current, teamKey));
    current.catalog.setSelection(planAgentTeamFallbackSelection(remainingTeams));
    current.navigation.close();
    current.profile.clearPrimaryAgentChange();
  }, []);
  const createTeam = useCallback(async (
    information: AgentTeamInformationInput,
  ): Promise<OperatorAgentTeam> => {
    const runtime = inputRef.current;
    const operation = runtime.api?.createAgentTeam;
    if (planAgentTeamCatalogPort(operation !== undefined) === "unavailable") {
      throw new Error(runtime.t("desktop.error.createTeam"));
    }
    const created = planOperatorAgentTeam(await operation!.call(runtime.api, information));
    const current = inputRef.current;
    current.catalog.setState((state) => planAgentTeamCatalogAppend(state, created));
    current.navigation.activate(created.teamKey, null);
    current.profile.clearPrimaryAgentChange();
    return created;
  }, []);
  const updateInformation = useCallback(async (
    teamKey: string,
    information: AgentTeamInformationInput,
  ): Promise<void> => {
    const runtime = inputRef.current;
    const team = planFindOperatorAgentTeam(runtime.catalog.state, teamKey);
    const operation = runtime.api?.updateAgentTeamInformation;
    if (planAgentTeamMutation(team, "any", operation !== undefined) === "unavailable") {
      throw new Error(runtime.t("desktop.error.updateTeam"));
    }
    const updated = planOperatorAgentTeam(await operation!.call(runtime.api, {
      teamId: team!.id,
      ownership: team!.ownership,
      ...information,
    }));
    inputRef.current.catalog.setState((current) => planAgentTeamCatalogReplace(current, updated));
  }, []);
  const openLocation = useCallback(async (teamKey: string, memberSlug?: string): Promise<void> => {
    const runtime = inputRef.current;
    const team = planFindOperatorAgentTeam(runtime.catalog.state, teamKey);
    const operation = runtime.api?.openAgentTeamLocation;
    if (planAgentTeamMutation(team, "any", operation !== undefined) === "unavailable") {
      throw new Error(runtime.t("desktop.error.openLocation"));
    }
    await operation!.call(runtime.api, {
      teamId: team!.id,
      ownership: team!.ownership,
      memberSlug,
    });
  }, []);
  const relocateTeam = useCallback(async (teamKey: string): Promise<void> => {
    const runtime = inputRef.current;
    const team = planFindOperatorAgentTeam(runtime.catalog.state, teamKey);
    const selectFolder = runtime.api?.selectAgentTeamRelocationFolder;
    const relocateRecord = runtime.api?.relocateAgentTeamRecord;
    if (planAgentTeamRelocation(team, selectFolder !== undefined, relocateRecord !== undefined) === "unavailable") {
      throw new Error(runtime.t("desktop.error.relocateTeam"));
    }
    const directory = await selectFolder!.call(runtime.api);
    if (planAgentTeamRelocationDirectory(directory) === "cancel") return;
    const updated = planOperatorAgentTeam(await relocateRecord!.call(runtime.api, {
      teamId: team!.id,
      ownership: "user",
      directory: directory!,
    }));
    inputRef.current.catalog.setState((current) => planAgentTeamCatalogReplace(current, updated));
  }, []);
  const removeRecord = useCallback(async (teamKey: string): Promise<void> => {
    const runtime = inputRef.current;
    const team = planFindOperatorAgentTeam(runtime.catalog.state, teamKey);
    const operation = runtime.api?.removeAgentTeamRecord;
    if (planAgentTeamMutation(team, "user", operation !== undefined) === "unavailable") {
      throw new Error(runtime.t("desktop.error.removeTeamRecord"));
    }
    await operation!.call(runtime.api, { teamId: team!.id, ownership: "user" });
    const current = inputRef.current;
    current.catalog.setState((state) => planAgentTeamCatalogRemove(state, teamKey));
    if (planAgentTeamShouldClose(current.navigation.activeTeamKey, teamKey)) current.navigation.close();
    current.catalog.setSelection((selection) => planAgentTeamSelectionAfterRemoval(selection, teamKey));
    current.member.setSaveAllFailures([]);
    current.profile.clearPrimaryAgentChange();
  }, []);
  return useMemo(() => ({
    trashTeam,
    createTeam,
    updateInformation,
    openLocation,
    relocateTeam,
    removeRecord,
  }), [createTeam, openLocation, relocateTeam, removeRecord, trashTeam, updateInformation]);
}
