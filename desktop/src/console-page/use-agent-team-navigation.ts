import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  planAgentTeamOpenMemberSelection,
  planAgentTeamMemberLoadTarget,
  planAgentTeamMemberTarget,
  planFindOperatorAgentTeam,
} from "./agent-team-console-model.js";
import type { AgentTeamCatalogBundle } from "./use-agent-team-catalog.js";
import type { useAgentTeamMemberEditor } from "./use-agent-team-member-editor.js";

type AgentTeamMemberBundle = ReturnType<typeof useAgentTeamMemberEditor>;

type PendingOpenTarget = {
  teamKey: string;
  memberSlug?: string;
};

export function useAgentTeamNavigation(input: {
  catalog: AgentTeamCatalogBundle;
  member: AgentTeamMemberBundle;
}) {
  const inputRef = useRef(input);
  inputRef.current = input;
  const catalogState = input.catalog.state;
  const [activeTeamKey, setActiveTeamKey] = useState<string | null>(null);
  const [pendingOpenTarget, setPendingOpenTarget] = useState<PendingOpenTarget | null>(null);
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

  const activateOpenTarget = useCallback((target: PendingOpenTarget) => {
    const team = planFindOperatorAgentTeam(inputRef.current.catalog.state, target.teamKey);
    if (team === undefined) {
      // The team may not have reached the catalog yet (e.g. right after a
      // GitHub install whose refresh is still in flight); open it as soon as
      // it appears instead of dropping the intent.
      setPendingOpenTarget(target);
      return;
    }

    setPendingOpenTarget(null);
    const memberSlug = planAgentTeamOpenMemberSelection(
      team,
      target.memberSlug,
      inputRef.current.catalog.selection,
    );
    activate(target.teamKey, memberSlug);
  }, [activate]);

  const open = useCallback((teamKey: string) => {
    activateOpenTarget({ teamKey });
  }, [activateOpenTarget]);

  const openMember = useCallback((teamKey: string, memberSlug: string) => {
    activateOpenTarget({ teamKey, memberSlug });
  }, [activateOpenTarget]);

  useEffect(() => {
    if (pendingOpenTarget === null) return;
    const team = planFindOperatorAgentTeam(catalogState, pendingOpenTarget.teamKey);
    if (team === undefined) return;
    activateOpenTarget(pendingOpenTarget);
  }, [activateOpenTarget, catalogState, pendingOpenTarget]);
  const selectMember = useCallback((teamKey: string, memberSlug: string) => {
    const team = planFindOperatorAgentTeam(inputRef.current.catalog.state, teamKey);
    if (!planAgentTeamMemberTarget(team, memberSlug)) return;
    activate(teamKey, memberSlug);
  }, [activate]);
  const close = useCallback(() => {
    setActiveTeamKey(null);
    setPendingOpenTarget(null);
    inputRef.current.member.setSaveAllFailures([]);
  }, []);
  return useMemo(() => ({
    activeTeamKey,
    activate,
    activateSelection,
    open,
    openMember,
    selectMember,
    close,
  }), [activate, activateSelection, activeTeamKey, close, open, openMember, selectMember]);
}
