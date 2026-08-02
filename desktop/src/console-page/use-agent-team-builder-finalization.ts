import { useCallback, useMemo, useRef } from "react";
import type { OperatorAgentTeam, TeamBuilderViewState, Translate } from "@moebius/console-ui";

import type { AiTeamBuilderIpcResponse } from "../ai-team-builder/contract.js";
import {
  planBuilderOperation,
  planBuilderPendingState,
  planBuilderRetry,
  planBuilderRetryPhase,
} from "./agent-team-console-model.js";

interface BuilderSession {
  setState(update: (current: TeamBuilderViewState | null) => TeamBuilderViewState | null): void;
  getDraftId(): string;
  fail(error: NonNullable<TeamBuilderViewState["error"]>): void;
  accept(response: AiTeamBuilderIpcResponse): import("../ai-team-builder/dto.js").AiTeamBuilderState | null;
  activateSelected(state: import("../ai-team-builder/dto.js").AiTeamBuilderState | null): Promise<OperatorAgentTeam | null>;
  startedRef: { current: boolean };
}

interface BuilderFinalizationPort {
  retryAiTeamBuilder?: (draftId: string) => Promise<AiTeamBuilderIpcResponse>;
  commitAiTeamBuilder?: (draftId: string, proposalRevision: number) => Promise<AiTeamBuilderIpcResponse>;
}

export function useAgentTeamBuilderFinalization(input: {
  api: BuilderFinalizationPort | undefined;
  session: BuilderSession;
  start(): Promise<OperatorAgentTeam | null>;
  t: Translate;
}) {
  const inputRef = useRef(input);
  inputRef.current = input;
  const retry = useCallback(async (): Promise<OperatorAgentTeam | null> => {
    const { api, session, start, t } = inputRef.current;
    if (planBuilderRetry(session.startedRef.current) === "start") return start();
    const operation = api?.retryAiTeamBuilder;
    if (planBuilderOperation(operation !== undefined) === "unavailable") {
      session.fail(unavailableError(t));
      return null;
    }
    session.setState((current) => planBuilderPendingState(
      current,
      planBuilderRetryPhase(current),
    ));
    try {
      return await session.activateSelected(
        session.accept(await operation!.call(api, session.getDraftId())),
      );
    } catch {
      session.startedRef.current = false;
      session.fail({
        code: "temporarily-unavailable",
        humanMessage: t("desktop.error.builderPreserved"),
        canRetry: true,
      });
      return null;
    }
  }, []);
  const commit = useCallback(async (proposalRevision: number): Promise<OperatorAgentTeam | null> => {
    const { api, session, t } = inputRef.current;
    const operation = api?.commitAiTeamBuilder;
    if (planBuilderOperation(operation !== undefined) === "unavailable") {
      session.fail(unavailableError(t));
      return null;
    }
    session.setState((current) => planBuilderPendingState(current, "committing"));
    try {
      return await session.activateSelected(session.accept(
        await operation!.call(api, session.getDraftId(), proposalRevision),
      ));
    } catch {
      session.fail({
        code: "temporarily-unavailable",
        humanMessage: t("desktop.error.teamCreatePreserved"),
        canRetry: true,
      });
      return null;
    }
  }, []);
  return useMemo(() => ({ retry, commit }), [commit, retry]);
}

function unavailableError(t: Translate): NonNullable<TeamBuilderViewState["error"]> {
  return { code: "temporarily-unavailable", humanMessage: t("desktop.error.builderUnavailable"), canRetry: true };
}
