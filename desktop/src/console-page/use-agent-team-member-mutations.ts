import { useCallback, useMemo, useRef } from "react";
import type { Translate } from "@moebius/console-ui";

import type {
  AgentTeamMemberAddRequest,
  AgentTeamMemberAddResponse,
  AgentTeamMemberDuplicateRequest,
  AgentTeamMemberTrashRequest,
  AgentTeamListItem,
} from "../team-ipc-contract.js";
import {
  planAgentTeamCatalogReplace,
  planAgentTeamMemberRemoval,
  planAgentTeamMemberSelection,
  planAgentTeamMutation,
  planFindOperatorAgentTeam,
  planOperatorAgentTeam,
} from "./agent-team-console-model.js";
import { finishAgentTeamMemberLoad, removeAgentTeamMemberDraft } from "./team-state.js";
import type { AgentTeamCatalogBundle } from "./use-agent-team-catalog.js";
import type { useAgentTeamCopy } from "./use-agent-team-copy.js";
import type { useAgentTeamMemberEditor } from "./use-agent-team-member-editor.js";
import type { useAgentTeamNavigation } from "./use-agent-team-navigation.js";

type CopyBundle = ReturnType<typeof useAgentTeamCopy>;
type MemberBundle = ReturnType<typeof useAgentTeamMemberEditor>;
type NavigationBundle = ReturnType<typeof useAgentTeamNavigation>;

interface AgentTeamMemberMutationPort {
  duplicateAgentTeamMember?: (
    request: AgentTeamMemberDuplicateRequest,
  ) => Promise<AgentTeamMemberAddResponse>;
  trashAgentTeamMember?: (request: AgentTeamMemberTrashRequest) => Promise<AgentTeamListItem>;
  addAgentTeamMember?: (request: AgentTeamMemberAddRequest) => Promise<AgentTeamMemberAddResponse>;
}

export function useAgentTeamMemberMutations(input: {
  api: AgentTeamMemberMutationPort | undefined;
  catalog: AgentTeamCatalogBundle;
  copy: CopyBundle;
  member: MemberBundle;
  navigation: NavigationBundle;
  t: Translate;
}) {
  const inputRef = useRef(input);
  inputRef.current = input;
  const duplicateMember = useCallback(async (teamKey: string, memberSlug: string): Promise<void> => {
    const runtime = inputRef.current;
    runtime.copy.assertDraftsResolved(teamKey);
    const team = planFindOperatorAgentTeam(runtime.catalog.state, teamKey);
    const operation = runtime.api?.duplicateAgentTeamMember;
    if (planAgentTeamMutation(team, "any", operation !== undefined) === "unavailable") {
      throw new Error(runtime.t("desktop.error.duplicateAgent"));
    }
    const result = await operation!.call(runtime.api, {
      teamId: team!.id,
      ownership: team!.ownership,
      memberSlug,
    });
    const current = inputRef.current;
    const updated = planOperatorAgentTeam(result.team);
    current.catalog.setState((state) => planAgentTeamCatalogReplace(state, updated));
    current.member.commitDrafts(finishAgentTeamMemberLoad(
      current.member.draftsRef.current,
      teamKey,
      result.member.slug,
      result.member.agentMarkdown,
    ));
    current.navigation.activateSelection(teamKey, result.member.slug);
  }, []);
  const trashMember = useCallback(async (teamKey: string, memberSlug: string): Promise<void> => {
    const runtime = inputRef.current;
    runtime.copy.assertDraftsResolved(teamKey);
    const team = planFindOperatorAgentTeam(runtime.catalog.state, teamKey);
    const operation = runtime.api?.trashAgentTeamMember;
    const plan = planAgentTeamMemberRemoval(team, memberSlug, operation !== undefined);
    if (plan === "unavailable") throw new Error(runtime.t("desktop.error.deleteAgent"));
    if (plan === "primary") throw new Error(runtime.t("desktop.error.deletePrimary"));
    const updated = planOperatorAgentTeam(await operation!.call(runtime.api, {
      teamId: team!.id,
      ownership: "user",
      memberSlug,
    }));
    const current = inputRef.current;
    current.catalog.setState((state) => planAgentTeamCatalogReplace(state, updated));
    current.member.commitDrafts(removeAgentTeamMemberDraft(
      current.member.draftsRef.current,
      teamKey,
      memberSlug,
    ));
    current.navigation.activate(teamKey, planAgentTeamMemberSelection(updated, null));
  }, []);
  const addMember = useCallback(async (teamKey: string): Promise<void> => {
    const runtime = inputRef.current;
    const team = planFindOperatorAgentTeam(runtime.catalog.state, teamKey);
    const operation = runtime.api?.addAgentTeamMember;
    if (planAgentTeamMutation(team, "any", operation !== undefined) === "unavailable") {
      throw new Error(runtime.t("desktop.error.addAgent"));
    }
    const result = await operation!.call(runtime.api, { teamId: team!.id, ownership: team!.ownership });
    const current = inputRef.current;
    const updated = planOperatorAgentTeam(result.team);
    current.catalog.setState((state) => planAgentTeamCatalogReplace(state, updated));
    current.member.commitDrafts(finishAgentTeamMemberLoad(
      current.member.draftsRef.current,
      teamKey,
      result.member.slug,
      result.member.agentMarkdown,
    ));
    current.navigation.activateSelection(teamKey, result.member.slug);
  }, []);
  return useMemo(() => ({ duplicateMember, trashMember, addMember }), [addMember, duplicateMember, trashMember]);
}
