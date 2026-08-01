import crypto from "node:crypto";
import {
  buildMoebiusReferenceText,
  plainTextExcerpt,
} from "./session-reference-text.js";
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
  }) {}

  async search(input: { query: string; includeArchived: boolean }): Promise<LocalConsoleSessionSearchResult[]> {
    if (this.input.store.searchSessions === undefined) throw new Error("local console session search unavailable");
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
    const session = sessions.find((candidate) => candidate.sessionId === input.sessionId);
    if (session === undefined) throw new Error(`local console session not found: ${input.sessionId}`);
    const messages = input.scope === "message"
      ? await this.input.storeCall("local-console-store-list-reference-messages", () =>
          this.input.store.listMessages(input.sessionId))
      : [];
    const targetMessage = input.scope === "message"
      ? input.messageId == null
        ? [...messages].reverse().find((message) => message.runId === (input.runId ?? null))
        : messages.find((message) => message.id === input.messageId)
      : undefined;
    if (input.scope === "message" && targetMessage === undefined) {
      throw new Error(`local console source message not found: ${input.sessionId}`);
    }
    const text = input.scope === "conversation"
      ? buildMoebiusReferenceText({ scope: "conversation", sessionId: input.sessionId, title: session.title })
      : buildMoebiusReferenceText({
          scope: "message",
          sessionId: input.sessionId,
          messageId: targetMessage!.id,
          role: targetMessage!.role ?? (targetMessage!.speaker === "user" ? "用户" : "协作者"),
          excerpt: plainTextExcerpt(targetMessage!.body),
        });
    return {
      sessionId: input.sessionId,
      runId: input.runId ?? null,
      scope: input.scope,
      fragment: { id: crypto.randomUUID(), label: "文本片段", text },
    };
  }
}
