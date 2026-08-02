export interface SessionExecutionOverride {
  cli: "codex" | "claude" | "kimi";
  model: string;
  effort: string;
}

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
}
