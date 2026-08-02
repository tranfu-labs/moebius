import { useCallback, useMemo, useRef } from "react";
import type { Translate } from "@moebius/console-ui";

import type {
  AgentTeamDuplicateBuiltInRequest,
  AgentTeamDuplicateUserRequest,
  AgentTeamListItem,
  AgentTeamMemberDocument,
  AgentTeamMemberRequest,
} from "../team-ipc-contract.js";
import {
  planAgentTeamCatalogAppend,
  planAgentTeamCatalogPort,
  planAgentTeamDirtyGuard,
  planAgentTeamMemberLoadTarget,
  planAgentTeamMemberSelection,
  planAgentTeamMutation,
  planFindOperatorAgentTeam,
  planOperatorAgentTeam,
} from "./agent-team-console-model.js";
import { planConsoleErrorMessage } from "./console-state-plan.js";
import { getDirtyAgentTeamMemberSlugs, failAgentTeamMemberLoad, finishAgentTeamMemberLoad, startAgentTeamMemberLoad } from "./team-state.js";
import type { AgentTeamCatalogBundle } from "./use-agent-team-catalog.js";
import type { useAgentTeamMemberEditor } from "./use-agent-team-member-editor.js";
import type { useAgentTeamNavigation } from "./use-agent-team-navigation.js";

type MemberBundle = ReturnType<typeof useAgentTeamMemberEditor>;
type NavigationBundle = ReturnType<typeof useAgentTeamNavigation>;

interface AgentTeamCopyPort {
  duplicateBuiltInAgentTeam?: (request: AgentTeamDuplicateBuiltInRequest) => Promise<AgentTeamListItem>;
  duplicateUserAgentTeam?: (request: AgentTeamDuplicateUserRequest) => Promise<AgentTeamListItem>;
  readAgentTeamMember?: (request: AgentTeamMemberRequest) => Promise<AgentTeamMemberDocument>;
}

export function useAgentTeamCopy(input: {
  api: AgentTeamCopyPort | undefined;
  catalog: AgentTeamCatalogBundle;
  member: MemberBundle;
  navigation: NavigationBundle;
  t: Translate;
}) {
  const inputRef = useRef(input);
  inputRef.current = input;
  const activateCopiedTeam = useCallback(async (item: AgentTeamListItem): Promise<string> => {
    const runtime = inputRef.current;
    const copiedTeam = planOperatorAgentTeam(item);
    runtime.catalog.setState((current) => planAgentTeamCatalogAppend(current, copiedTeam));
    const memberSlug = planAgentTeamMemberSelection(copiedTeam, null);
    runtime.navigation.activateSelection(copiedTeam.teamKey, memberSlug);
    if (planAgentTeamMemberLoadTarget(memberSlug)) {
      runtime.member.commitDrafts(startAgentTeamMemberLoad(
        runtime.member.draftsRef.current,
        copiedTeam.teamKey,
        memberSlug!,
      ));
      try {
        const document = await runtime.api?.readAgentTeamMember?.call(runtime.api, {
          teamId: copiedTeam.id,
          ownership: copiedTeam.ownership,
          memberSlug: memberSlug!,
        });
        if (planAgentTeamCatalogPort(document !== undefined) === "unavailable") {
          throw new Error(runtime.t("desktop.error.duplicateRead"));
        }
        inputRef.current.member.commitDrafts(finishAgentTeamMemberLoad(
          inputRef.current.member.draftsRef.current,
          copiedTeam.teamKey,
          memberSlug!,
          document!.agentMarkdown,
        ));
      } catch (error) {
        inputRef.current.member.commitDrafts(failAgentTeamMemberLoad(
          inputRef.current.member.draftsRef.current,
          copiedTeam.teamKey,
          memberSlug!,
          planConsoleErrorMessage(error),
        ));
      }
    }
    return copiedTeam.teamKey;
  }, []);
  const assertDraftsResolved = useCallback((teamKey: string) => {
    const dirtyCount = getDirtyAgentTeamMemberSlugs(inputRef.current.member.draftsRef.current, teamKey).length;
    if (planAgentTeamDirtyGuard(dirtyCount) === "reject") {
      throw new Error(inputRef.current.t("desktop.error.unsavedTeam"));
    }
  }, []);
  const duplicateBuiltIn = useCallback(async (teamKey: string): Promise<string> => {
    const runtime = inputRef.current;
    const team = planFindOperatorAgentTeam(runtime.catalog.state, teamKey);
    const operation = runtime.api?.duplicateBuiltInAgentTeam;
    if (planAgentTeamMutation(team, "system", operation !== undefined) === "unavailable") {
      throw new Error(runtime.t("desktop.error.duplicateBuiltIn"));
    }
    return activateCopiedTeam(await operation!.call(runtime.api, { teamId: team!.id, ownership: "system" }));
  }, [activateCopiedTeam]);
  const duplicateUser = useCallback(async (teamKey: string): Promise<string> => {
    assertDraftsResolved(teamKey);
    const runtime = inputRef.current;
    const team = planFindOperatorAgentTeam(runtime.catalog.state, teamKey);
    const operation = runtime.api?.duplicateUserAgentTeam;
    if (planAgentTeamMutation(team, "user", operation !== undefined) === "unavailable") {
      throw new Error(runtime.t("desktop.error.duplicateUserTeam"));
    }
    return activateCopiedTeam(await operation!.call(runtime.api, { teamId: team!.id, ownership: "user" }));
  }, [activateCopiedTeam, assertDraftsResolved]);
  return useMemo(() => ({
    activateCopiedTeam,
    assertDraftsResolved,
    duplicateBuiltIn,
    duplicateUser,
  }), [activateCopiedTeam, assertDraftsResolved, duplicateBuiltIn, duplicateUser]);
}
