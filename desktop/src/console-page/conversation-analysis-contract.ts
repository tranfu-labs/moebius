export interface ConversationAnalysisReferencePort {
  load(input: {
    apiBase: string;
    sessionId: string;
    scope: "message" | "conversation";
    runId: string | null;
    messageId: number | null;
  }): Promise<{ fragment: { id: string; label: string; text: string } }>;
}
