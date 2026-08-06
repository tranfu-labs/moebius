export type SessionExecutionOverride = {
  cli: "codex" | "claude" | "kimi";
  model: string;
  effort: string;
} | {
  cli: "pi";
  providerId: "deepseek";
  providerProfileId: string;
  model: string;
  effort: string;
};

export interface SessionRunPort {
  interrupt(
    apiBase: string,
    sessionId: string,
    runId: string,
    refresh: () => Promise<unknown>,
  ): Promise<"interrupted" | "already-finished">;
  submitMessage(
    apiBase: string,
    sessionId: string,
    body: string,
    attachmentIds: readonly string[],
  ): Promise<void>;
  retryRun(
    apiBase: string,
    sessionId: string,
    runId: string,
    executionOverride?: SessionExecutionOverride,
  ): Promise<void>;
  updateMemberExecution?(
    apiBase: string,
    sessionId: string,
    memberName: string,
    action: "migrate" | "end",
    executionProfile?: SessionExecutionOverride,
  ): Promise<void>;
}
