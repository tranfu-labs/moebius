import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import {
  EMPTY_AGENT_TEAM_DRAFT_STATE,
  type AgentTeamDraftState,
  type AgentTeamSaveAllFailure,
} from "./team-state.js";

export interface AgentTeamDraftBundle {
  drafts: AgentTeamDraftState;
  draftsRef: { current: AgentTeamDraftState };
  commitDrafts(next: AgentTeamDraftState): void;
  externalChecksRef: { current: Set<string> };
  saveAllFailures: AgentTeamSaveAllFailure[];
  setSaveAllFailures: Dispatch<SetStateAction<AgentTeamSaveAllFailure[]>>;
}

export function useAgentTeamDraftState(): AgentTeamDraftBundle {
  const [drafts, setDrafts] = useState<AgentTeamDraftState>(EMPTY_AGENT_TEAM_DRAFT_STATE);
  const draftsRef = useRef(drafts);
  const externalChecksRef = useRef(new Set<string>());
  const [saveAllFailures, setSaveAllFailures] = useState<AgentTeamSaveAllFailure[]>([]);
  const commitDrafts = useCallback((next: AgentTeamDraftState) => {
    draftsRef.current = next;
    setDrafts(next);
  }, []);
  return useMemo(() => ({
    drafts,
    draftsRef,
    commitDrafts,
    externalChecksRef,
    saveAllFailures,
    setSaveAllFailures,
  }), [commitDrafts, drafts, saveAllFailures]);
}
