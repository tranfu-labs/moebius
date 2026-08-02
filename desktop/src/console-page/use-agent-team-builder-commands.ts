import { useCallback, useMemo, useRef } from "react";
import type { OperatorAgentTeam, TeamBuilderViewState, Translate } from "@moebius/console-ui";

import type { AiTeamBuilderIpcResponse } from "../ai-team-builder/contract.js";
import {
  planBuilderOperation,
  planBuilderPendingState,
} from "./agent-team-console-model.js";

interface BuilderSession {
  setState(update: (current: TeamBuilderViewState | null) => TeamBuilderViewState | null): void;
  getDraftId(): string;
  fail(error: NonNullable<TeamBuilderViewState["error"]>): void;
  accept(response: AiTeamBuilderIpcResponse): import("../ai-team-builder/dto.js").AiTeamBuilderState | null;
  activateSelected(state: import("../ai-team-builder/dto.js").AiTeamBuilderState | null): Promise<OperatorAgentTeam | null>;
  startedRef: { current: boolean };
}

interface BuilderCommandPort {
  startAiTeamBuilder?: (draftId: string) => Promise<AiTeamBuilderIpcResponse>;
  submitAiTeamBuilder?: (draftId: string, text: string) => Promise<AiTeamBuilderIpcResponse>;
  adjustAiTeamBuilder?: (draftId: string, text: string) => Promise<AiTeamBuilderIpcResponse>;
}

export function useAgentTeamBuilderCommands(input: {
  api: BuilderCommandPort | undefined;
  session: BuilderSession;
  t: Translate;
}) {
  const inputRef = useRef(input);
  inputRef.current = input;
  const unavailable = useCallback(() => inputRef.current.session.fail({
    code: "temporarily-unavailable",
    humanMessage: inputRef.current.t("desktop.error.builderUnavailable"),
    canRetry: true,
  }), []);
  const start = useCallback(async (): Promise<OperatorAgentTeam | null> => {
    const { api, session } = inputRef.current;
    const operation = api?.startAiTeamBuilder;
    if (planBuilderOperation(operation !== undefined) === "unavailable") {
      unavailable();
      return null;
    }
    try {
      return await session.activateSelected(
        session.accept(await operation!.call(api, session.getDraftId())),
      );
    } catch {
      session.startedRef.current = false;
      unavailable();
      return null;
    }
  }, [unavailable]);
  const submit = useCallback(async (text: string): Promise<void> => {
    const { api, session } = inputRef.current;
    const operation = api?.submitAiTeamBuilder;
    if (planBuilderOperation(operation !== undefined) === "unavailable") return unavailable();
    session.setState((current) => planBuilderPendingState(current, "running"));
    try {
      session.accept(await operation!.call(api, session.getDraftId(), text));
    } catch {
      session.fail({
        code: "temporarily-unavailable",
        humanMessage: inputRef.current.t("desktop.error.builderPreserved"),
        canRetry: true,
      });
    }
  }, [unavailable]);
  const adjust = useCallback(async (text: string): Promise<void> => {
    const { api, session } = inputRef.current;
    const operation = api?.adjustAiTeamBuilder;
    if (planBuilderOperation(operation !== undefined) === "unavailable") return unavailable();
    session.setState((current) => planBuilderPendingState(current, "running"));
    try {
      session.accept(await operation!.call(api, session.getDraftId(), text));
    } catch {
      session.fail({
        code: "temporarily-unavailable",
        humanMessage: inputRef.current.t("desktop.error.builderPreserved"),
        canRetry: true,
      });
    }
  }, [unavailable]);
  return useMemo(() => ({ start, submit, adjust }), [adjust, start, submit]);
}
