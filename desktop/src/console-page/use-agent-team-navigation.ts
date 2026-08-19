import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  const catalogState = input.catalog.state;
  const [activeTeamKey, setActiveTeamKey] = useState<string | null>(null);
  const [pendingOpenTeamKey, setPendingOpenTeamKey] = useState<string | null>(null);
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
    if (team === undefined) {
      // The team may not have reached the catalog yet (e.g. right after a
      // GitHub install whose refresh is still in flight); open it as soon as
      // it appears instead of dropping the intent.
      setPendingOpenTeamKey(teamKey);
      return;
    }
    activate(teamKey, planAgentTeamMemberSelection(team, inputRef.current.catalog.selection));
  }, [activate]);
  useEffect(() => {
    if (pendingOpenTeamKey === null) return;
    const team = planFindOperatorAgentTeam(catalogState, pendingOpenTeamKey);
    if (team === undefined) return;
    setPendingOpenTeamKey(null);
    activate(pendingOpenTeamKey, planAgentTeamMemberSelection(team, inputRef.current.catalog.selection));
  }, [activate, catalogState, pendingOpenTeamKey]);
  const selectMember = useCallback((teamKey: string, memberSlug: string) => {
    const team = planFindOperatorAgentTeam(inputRef.current.catalog.state, teamKey);
    if (!planAgentTeamMemberTarget(team, memberSlug)) return;
    activate(teamKey, memberSlug);
  }, [activate]);
  const close = useCallback(() => {
    setActiveTeamKey(null);
    setPendingOpenTeamKey(null);
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
