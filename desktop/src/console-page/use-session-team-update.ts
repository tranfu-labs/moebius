import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionTeamUpdateViewState } from "@moebius/console-ui";
import {
  decideSessionTeamUpdatePolling,
  planSessionTeamUpdateFailure,
  planSessionTeamUpdateRequest,
  planSessionTeamUpdateResponse,
} from "../session-team-update-view-plan.js";

export function useSessionTeamUpdate(input: {
  apiBase: string | null;
  sessionId: string | null;
  sessionRevision: string | null;
  load(options: { apiBase: string; sessionId: string; signal?: AbortSignal }): Promise<SessionTeamUpdateViewState>;
  mutate(options: {
    apiBase: string;
    sessionId: string;
    action: "apply" | "retry" | "cancel";
    updateToken?: string | null;
  }): Promise<SessionTeamUpdateViewState>;
}) {
  const [state, setState] = useState<SessionTeamUpdateViewState>({ status: "idle", categories: [] });
  const requestId = useRef(0);
  const mutationInFlight = useRef(false);
  const stateRef = useRef(state);
  const loadRef = useRef(input.load);
  const mutateRef = useRef(input.mutate);
  stateRef.current = state;
  loadRef.current = input.load;
  mutateRef.current = input.mutate;
  useEffect(() => {
    const plan = planSessionTeamUpdateRequest(input);
    const requestPlan = plan as Extract<typeof plan, { kind: "request" }>;
    return ({
      idle: () => {
        setState({ status: "idle", categories: [] });
      },
      request: () => {
        const controller = new AbortController();
        setState({ status: "loading", categories: [] });
        const commit = (id: number, next: SessionTeamUpdateViewState) => ({
          commit: () => setState(next),
          ignore: () => undefined,
        })[planSessionTeamUpdateResponse({
          aborted: controller.signal.aborted,
          requestId: id,
          currentRequestId: requestId.current,
        })]();
        const inspect = () => {
          if (decideSessionTeamUpdatePolling({
            mutationInFlight: mutationInFlight.current,
            status: stateRef.current.status,
          }) === "hold") return;
          const id = ++requestId.current;
          void loadRef.current({
            apiBase: requestPlan.apiBase,
            sessionId: requestPlan.sessionId,
            signal: controller.signal,
          }).then((next) => commit(id, next)).catch(() => commit(id, { status: "idle", categories: [] }));
        };
        inspect();
        const interval = window.setInterval(inspect, 3_000);
        return () => {
          controller.abort();
          window.clearInterval(interval);
        };
      },
    })[plan.kind]();
  }, [input.apiBase, input.sessionId, input.sessionRevision]);

  const mutate = useCallback(async (action: "apply" | "retry" | "cancel") => {
    const plan = planSessionTeamUpdateRequest(input);
    const requestPlan = plan as Extract<typeof plan, { kind: "request" }>;
    await ({
      idle: async () => undefined,
      request: async () => {
        const id = ++requestId.current;
        mutationInFlight.current = true;
        setState({
          status: "loading",
          categories: stateRef.current.categories,
          updateToken: stateRef.current.updateToken,
        });
        const commit = (next: SessionTeamUpdateViewState) => ({
          commit: () => setState(next),
          ignore: () => undefined,
        })[planSessionTeamUpdateResponse({ aborted: false, requestId: id, currentRequestId: requestId.current })]();
        try {
          commit(await mutateRef.current({
            apiBase: requestPlan.apiBase,
            sessionId: requestPlan.sessionId,
            action,
            updateToken: stateRef.current.updateToken,
          }));
        } catch {
          commit(planSessionTeamUpdateFailure(stateRef.current));
        } finally {
          mutationInFlight.current = false;
        }
      },
    })[plan.kind]();
  }, [input.apiBase, input.sessionId]);

  const apply = useCallback(() => void mutate("apply"), [mutate]);
  const retry = useCallback(() => void mutate("retry"), [mutate]);
  const cancel = useCallback(() => void mutate("cancel"), [mutate]);

  return {
    state,
    apply,
    retry,
    cancel,
  };
}
