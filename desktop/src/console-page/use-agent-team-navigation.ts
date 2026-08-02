import { useCallback, useMemo, useRef, useState } from "react";

import {
  planAgentTeamMemberSelection,
  planAgentTeamMemberLoadTarget,
  planAgentTeamMemberTarget,
  planFindOperatorAgentTeam,
} from "./agent-team-console-model.js";
import type { AgentTeamCatalogBundle } from "./use-agent-team-catalog.js";
import type { useAgentTeamMemberEditor } from "./use-agent-team-member-editor.js";

type AgentTeamMemberBundle = ReturnType<typeof useAgentTeamMemberEditor>;

export function useAgentTeamNavigation(input: {
  catalog: AgentTeamCatalogBundle;
  member: AgentTeamMemberBundle;
}) {
  const inputRef = useRef(input);
  inputRef.current = input;
  const [activeTeamKey, setActiveTeamKey] = useState<string | null>(null);
  const activateSelection = useCallback((teamKey: string, memberSlug: string | null) => {
    setActiveTeamKey(teamKey);
    inputRef.current.catalog.setSelection({ teamKey, memberSlug });
    inputRef.current.member.setSaveAllFailures([]);
  }, []);
  const activate = useCallback((teamKey: string, memberSlug: string | null) => {
    activateSelection(teamKey, memberSlug);
    if (planAgentTeamMemberLoadTarget(memberSlug)) {
      void inputRef.current.member.loadMember(teamKey, memberSlug!);
    }
  }, [activateSelection]);
  const open = useCallback((teamKey: string) => {
    const team = planFindOperatorAgentTeam(inputRef.current.catalog.state, teamKey);
    if (team === undefined) return;
    activate(teamKey, planAgentTeamMemberSelection(team, inputRef.current.catalog.selection));
  }, [activate]);
  const selectMember = useCallback((teamKey: string, memberSlug: string) => {
    const team = planFindOperatorAgentTeam(inputRef.current.catalog.state, teamKey);
    if (!planAgentTeamMemberTarget(team, memberSlug)) return;
    activate(teamKey, memberSlug);
  }, [activate]);
  const close = useCallback(() => {
    setActiveTeamKey(null);
    inputRef.current.member.setSaveAllFailures([]);
  }, []);
  return useMemo(() => ({
    activeTeamKey,
    activate,
    activateSelection,
    open,
    selectMember,
    close,
  }), [activate, activateSelection, activeTeamKey, close, open, selectMember]);
}
