import { useCallback, useMemo } from "react";
import type { Translate } from "@moebius/console-ui";

import type { DesktopApi } from "./desktop-api-contract.js";
import { useAgentTeamBuilderController } from "./use-agent-team-builder.js";
import { useAgentTeamCatalog } from "./use-agent-team-catalog.js";
import { useAgentTeamCopy } from "./use-agent-team-copy.js";
import { useAgentTeamMemberEditor } from "./use-agent-team-member-editor.js";
import { useAgentTeamMemberMutations } from "./use-agent-team-member-mutations.js";
import { useAgentTeamNavigation } from "./use-agent-team-navigation.js";
import { useAgentTeamProfile } from "./use-agent-team-profile.js";
import { useAgentTeamRecordMutations } from "./use-agent-team-record-mutations.js";
import { useAgentTeamRegistration } from "./use-agent-team-registration.js";
import {
  AGENT_TEAM_BUILDER_DRAFT_STORAGE_KEY,
  planAgentTeamFileManagerTranslationKey,
  planAgentTeamDetailState,
  planAgentTeamIdentityMarkdown,
} from "./agent-team-console-model.js";
import {
  discardAgentTeamMemberDraft,
  discardAllAgentTeamDrafts,
  getAgentTeamMemberDraft,
  updateAgentTeamMemberDraft,
} from "./team-state.js";

export function useAgentTeamConsole(
  api: DesktopApi | undefined,
  storage: Storage,
  createDraftId: () => string,
  t: Translate,
) {
  const catalog = useAgentTeamCatalog(api);
  const member = useAgentTeamMemberEditor({ api, catalog, t });
  const navigation = useAgentTeamNavigation({ catalog, member });
  const profile = useAgentTeamProfile({ api, catalog, t });
  const registration = useAgentTeamRegistration({ api, catalog, open: navigation.open, t });
  const copy = useAgentTeamCopy({ api, catalog, member, navigation, t });
  const memberMutations = useAgentTeamMemberMutations({ api, catalog, copy, member, navigation, t });
  const recordMutations = useAgentTeamRecordMutations({
    api,
    catalog,
    copy,
    member,
    navigation,
    profile,
    t,
  });
  const builder = useAgentTeamBuilderController({
    api,
    storage,
    storageKey: AGENT_TEAM_BUILDER_DRAFT_STORAGE_KEY,
    createDraftId,
    activateCopiedTeam: copy.activateCopiedTeam,
    replaceTeams: catalog.replaceTeams,
    t,
  });
  const detailState = useMemo(() => planAgentTeamDetailState({
    activeTeamKey: navigation.activeTeamKey,
    catalog: catalog.state,
    selection: catalog.selection,
    drafts: member.drafts,
    saveAllFailures: member.saveAllFailures,
    primaryAgentChange: profile.primaryAgentChange,
    portraitChange: profile.portraitChange,
  }), [catalog.selection, catalog.state, member.drafts, member.saveAllFailures,
    navigation.activeTeamKey, profile.primaryAgentChange, profile.portraitChange]);
  const close = useCallback(() => {
    navigation.close();
    profile.clearPrimaryAgentChange();
    profile.clearPortraitChange();
  }, [navigation, profile]);
  const changeMember = useCallback((teamKey: string, memberSlug: string, agentMarkdown: string) => {
    member.commitDrafts(updateAgentTeamMemberDraft(
      member.draftsRef.current,
      teamKey,
      memberSlug,
      agentMarkdown,
    ));
  }, [member]);
  const changeMemberIdentity = useCallback((
    teamKey: string,
    memberSlug: string,
    identity: { displayName?: string; description?: string },
  ) => {
    const current = getAgentTeamMemberDraft(member.draftsRef.current, teamKey, memberSlug);
    if (current?.loadStatus !== "ready") return;
    member.commitDrafts(updateAgentTeamMemberDraft(
      member.draftsRef.current,
      teamKey,
      memberSlug,
      planAgentTeamIdentityMarkdown(current.draftMarkdown, identity),
    ));
  }, [member]);
  const discardMember = useCallback((teamKey: string, memberSlug: string) => {
    member.commitDrafts(discardAgentTeamMemberDraft(member.draftsRef.current, teamKey, memberSlug));
  }, [member]);
  const discardAll = useCallback((teamKey: string) => {
    member.commitDrafts(discardAllAgentTeamDrafts(member.draftsRef.current, teamKey));
    member.setSaveAllFailures([]);
  }, [member]);
  const intents = useMemo(() => ({
    close,
    changeMember,
    changeMemberIdentity,
    discardMember,
    discardAll,
    fileManagerLabel: t(planAgentTeamFileManagerTranslationKey(api?.agentTeamFileManagerKind)),
  }), [api?.agentTeamFileManagerKind, changeMember, changeMemberIdentity, close, discardAll, discardMember, t]);
  return useMemo(() => ({
    catalog,
    member,
    navigation,
    profile,
    registration,
    copy,
    memberMutations,
    recordMutations,
    builder,
    detailState,
    intents,
  }), [builder, catalog, copy, detailState, intents, member, memberMutations, navigation, profile,
    recordMutations, registration]);
}
