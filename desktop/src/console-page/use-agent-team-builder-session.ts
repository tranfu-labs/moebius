import { useCallback, useMemo, useRef, useState } from "react";
import type { OperatorAgentTeam, TeamBuilderViewState, Translate } from "@moebius/console-ui";

import type { AiTeamBuilderIpcResponse } from "../ai-team-builder/contract.js";
import type { AiTeamBuilderState } from "../ai-team-builder/dto.js";
import type { AgentTeamListItem, AgentTeamListResponse } from "../team-ipc-contract.js";
import {
  toTeamBuilderIpcViewError,
  toTeamBuilderViewState,
} from "../team-builder-view-state.js";
import {
  planAgentTeamBuilderDraftSource,
  planAgentTeamBuilderResponse,
  planBuilderFailureState,
  planBuiltAgentTeam,
  planOperatorAgentTeam,
  planSelectedBuilderTeamId,
} from "./agent-team-console-model.js";
import { planConsoleErrorMessage } from "./console-state-plan.js";

export interface AgentTeamBuilderSessionPort {
  listAgentTeams?: () => Promise<AgentTeamListResponse>;
}

export function useAgentTeamBuilderSession(input: {
  api: AgentTeamBuilderSessionPort | undefined;
  storage: Storage;
  storageKey: string;
  createDraftId(): string;
  activateCopiedTeam(item: AgentTeamListItem): Promise<string>;
  replaceTeams(teams: OperatorAgentTeam[]): void;
  t: Translate;
}) {
  const inputRef = useRef(input);
  inputRef.current = input;
  const [state, setState] = useState<TeamBuilderViewState | null>(null);
  const startedRef = useRef(false);
  const draftIdRef = useRef<string | null>(null);
  const getDraftId = useCallback((): string => {
    const currentInput = inputRef.current;
    const stored = currentInput.storage.getItem(currentInput.storageKey);
    const source = planAgentTeamBuilderDraftSource(draftIdRef.current, stored);
    if (source === "current") return draftIdRef.current!;
    const draftId = source === "stored" ? stored! : currentInput.createDraftId();
    draftIdRef.current = draftId;
    currentInput.storage.setItem(currentInput.storageKey, draftId);
    return draftId;
  }, []);
  const fail = useCallback((error: NonNullable<TeamBuilderViewState["error"]>) => {
    setState((current) => planBuilderFailureState(current, error));
  }, []);
  const accept = useCallback((response: AiTeamBuilderIpcResponse): AiTeamBuilderState | null => {
    const result = planAgentTeamBuilderResponse(response);
    if (result.kind === "rejected") {
      startedRef.current = false;
      fail(toTeamBuilderIpcViewError(result.error, inputRef.current.t));
      return null;
    }
    startedRef.current = true;
    setState(toTeamBuilderViewState(result.state, inputRef.current.t));
    return result.state;
  }, [fail]);
  const activateSelected = useCallback(async (
    builderState: AiTeamBuilderState | null,
  ): Promise<OperatorAgentTeam | null> => {
    const teamId = planSelectedBuilderTeamId(builderState);
    if (teamId === null) return null;
    try {
      const api = inputRef.current.api;
      const result = await api?.listAgentTeams?.call(api);
      const readyTeams = result?.status === "ready" ? result.teams : null;
      const item = planBuiltAgentTeam(readyTeams, teamId);
      if (item === null) throw new Error(inputRef.current.t("desktop.error.teamCreatedDetail"));
      const selected = planOperatorAgentTeam(item);
      await inputRef.current.activateCopiedTeam(item);
      inputRef.current.replaceTeams(readyTeams!.map(planOperatorAgentTeam));
      inputRef.current.storage.removeItem(inputRef.current.storageKey);
      draftIdRef.current = null;
      startedRef.current = false;
      return selected;
    } catch (error) {
      startedRef.current = false;
      fail({ code: "temporarily-unavailable", humanMessage: planConsoleErrorMessage(error), canRetry: true });
      return null;
    }
  }, [fail]);
  return useMemo(() => ({
    state,
    setState,
    startedRef,
    getDraftId,
    fail,
    accept,
    activateSelected,
  }), [accept, activateSelected, fail, getDraftId, state]);
}
