import { decideSessionMemberExecutionUpdate } from "./session-settings-plan.js";
import {
  LocalConsoleSessionRunningError,
  type LocalConsoleAgentTeamSnapshot,
  type LocalConsoleExecutionProfile,
  type LocalConsoleStore,
} from "./types.js";

export async function updateSessionMemberExecution(input: {
  store: LocalConsoleStore;
  storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
  nowIso(): string;
  hasActiveRun(sessionId: string): boolean;
  request: {
    sessionId: string;
    memberName: string;
    action: "migrate" | "end";
    executionProfile?: LocalConsoleExecutionProfile;
  };
}): Promise<LocalConsoleAgentTeamSnapshot> {
  const update = input.store.updateSessionMemberExecution;
  const decision = decideSessionMemberExecutionUpdate({
    activeRun: input.hasActiveRun(input.request.sessionId),
    capabilityAvailable: update !== undefined,
  });
  if (decision.kind === "running") throw new LocalConsoleSessionRunningError();
  if (decision.kind === "unavailable") {
    throw new Error("local console session execution migration unavailable");
  }
  return await input.storeCall("local-console-store-update-session-member-execution", () =>
    update!.call(input.store, { ...input.request, now: input.nowIso() }));
}
