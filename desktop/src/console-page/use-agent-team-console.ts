import { useMemo } from "react";
import type { Translate } from "@moebius/console-ui";

import type { DesktopApi } from "./app.js";
import { useAgentTeamBuilderController } from "./use-agent-team-builder.js";
import { useAgentTeamCatalog } from "./use-agent-team-catalog.js";
import { useAgentTeamCopy } from "./use-agent-team-copy.js";
import { useAgentTeamMemberEditor } from "./use-agent-team-member-editor.js";
import { useAgentTeamMemberMutations } from "./use-agent-team-member-mutations.js";
import { useAgentTeamNavigation } from "./use-agent-team-navigation.js";
import { useAgentTeamProfile } from "./use-agent-team-profile.js";
import { useAgentTeamRecordMutations } from "./use-agent-team-record-mutations.js";
import { useAgentTeamRegistration } from "./use-agent-team-registration.js";
import { AGENT_TEAM_BUILDER_DRAFT_STORAGE_KEY } from "./agent-team-console-model.js";

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
  }), [builder, catalog, copy, member, memberMutations, navigation, profile, recordMutations, registration]);
}
