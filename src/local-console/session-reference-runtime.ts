import {
  decideSessionReferenceRead,
  decideSessionReferenceSession,
  decideSessionSearchCapability,
  planSessionReferenceTarget,
  planSessionReferenceText,
  planSessionReferenceRunId,
} from "./session-reference-plan.js";
import type {
  LocalConsoleSessionReferenceScope,
  LocalConsoleSessionReferenceText,
  LocalConsoleSessionSearchResult,
  LocalConsoleStore,
} from "./types.js";

export class LocalSessionReferenceRuntime {
  constructor(private readonly input: {
    store: LocalConsoleStore;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
    randomId(): string;
  }) {}

  async search(input: { query: string; includeArchived: boolean }): Promise<LocalConsoleSessionSearchResult[]> {
    const capability = decideSessionSearchCapability(this.input.store.searchSessions !== undefined);
    if (capability.kind === "unavailable") throw new Error("local console session search unavailable");
    return await this.input.storeCall("local-console-store-search-sessions", () =>
      this.input.store.searchSessions!(input));
  }

  async referenceText(input: {
    sessionId: string;
    scope: LocalConsoleSessionReferenceScope;
    runId?: string | null;
    messageId?: number | null;
  }): Promise<LocalConsoleSessionReferenceText> {
    const sessions = await this.input.storeCall("local-console-store-list-sessions-for-reference", () =>
      this.input.store.listSessions());
    const sessionDecision = decideSessionReferenceSession(
      sessions.find((candidate) => candidate.sessionId === input.sessionId),
    );
    if (sessionDecision.kind === "missing") throw new Error(`local console session not found: ${input.sessionId}`);
    const read = decideSessionReferenceRead(input.scope);
    const messages = read.kind === "message"
      ? await this.input.storeCall("local-console-store-list-reference-messages", () =>
          this.input.store.listMessages(input.sessionId))
      : [];
    const target = planSessionReferenceTarget({
      scope: input.scope,
      messages,
      runId: input.runId,
      messageId: input.messageId,
    });
    if (target.kind === "missing-message") {
      throw new Error(`local console source message not found: ${input.sessionId}`);
    }
    const text = planSessionReferenceText({ session: sessionDecision.session, target });
    return {
      sessionId: input.sessionId,
      runId: planSessionReferenceRunId(input.runId),
      scope: input.scope,
      fragment: { id: this.input.randomId(), label: "文本片段", text },
    };
  }
}
