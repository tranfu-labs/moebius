import type { SessionTeamUpdateViewState } from "@moebius/console-ui";

export type SessionTeamUpdateRequestPlan =
  | { kind: "idle" }
  | { kind: "request"; apiBase: string; sessionId: string };

export function planSessionTeamUpdateRequest(input: {
  apiBase: string | null;
  sessionId: string | null;
}): SessionTeamUpdateRequestPlan {
  return input.apiBase === null || input.sessionId === null
    ? { kind: "idle" }
    : { kind: "request", apiBase: input.apiBase, sessionId: input.sessionId };
}

export function planSessionTeamUpdateResponse(input: {
  aborted: boolean;
  requestId: number;
  currentRequestId: number;
}): "commit" | "ignore" {
  return !input.aborted && input.requestId === input.currentRequestId ? "commit" : "ignore";
}

export function decideSessionTeamUpdatePolling(input: {
  mutationInFlight: boolean;
  status: SessionTeamUpdateViewState["status"];
}): "poll" | "hold" {
  return input.mutationInFlight || input.status === "failed" ? "hold" : "poll";
}

export function planSessionTeamUpdateFailure(
  current: SessionTeamUpdateViewState,
): SessionTeamUpdateViewState {
  return {
    status: "failed",
    categories: current.categories,
    updateToken: current.updateToken,
    failure: { code: "TEAM_UPDATE_REQUEST_FAILED", summary: "团队更新请求失败，请重试。" },
  };
}
