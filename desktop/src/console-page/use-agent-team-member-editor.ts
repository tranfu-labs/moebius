import { useMemo } from "react";
import type { Translate } from "@moebius/console-ui";

import type { AgentTeamCatalogBundle } from "./use-agent-team-catalog.js";
import { useAgentTeamDraftState } from "./use-agent-team-draft-state.js";
import { useAgentTeamMemberLoading } from "./use-agent-team-member-loading.js";
import { useAgentTeamMemberSaving } from "./use-agent-team-member-saving.js";
import { useAgentTeamExternalChange } from "./use-agent-team-external-change.js";

type MemberApi = Parameters<typeof useAgentTeamMemberLoading>[0]["api"]
  & Parameters<typeof useAgentTeamMemberSaving>[0]["api"]
  & Parameters<typeof useAgentTeamExternalChange>[0]["api"];

export function useAgentTeamMemberEditor(input: {
  api: MemberApi | undefined;
  catalog: AgentTeamCatalogBundle;
  t: Translate;
}) {
  const draftBundle = useAgentTeamDraftState();
  const loadingBundle = useAgentTeamMemberLoading({ ...input, draft: draftBundle });
  const checkExternalChange = useAgentTeamExternalChange({
    ...input,
    draft: draftBundle,
    updateSummary: loadingBundle.updateSummary,
  });
  const savingBundle = useAgentTeamMemberSaving({
    ...input,
    draft: draftBundle,
    updateSummary: loadingBundle.updateSummary,
  });
  return useMemo(() => ({
    ...draftBundle,
    ...loadingBundle,
    ...savingBundle,
    checkExternalChange,
  }), [checkExternalChange, draftBundle, loadingBundle, savingBundle]);
}
