import { formatLocalError } from "./runtime-domain.js";
import { planChildSessionCreation } from "./session-metadata-plan.js";
import type { LocalConsoleSessionSummary } from "./types.js";

export class LocalConsoleSessionMetadataRuntime {
  constructor(private readonly input: {
    nowIso(): string;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
    assertProjectDirectoryAvailable(projectId: string): Promise<void>;
    createChildSession(input: ReturnType<typeof planChildSessionCreation>): Promise<LocalConsoleSessionSummary>;
    recordVisibleChildFailure(parentSessionId: string, reason: string): Promise<void>;
    setLastError(error: string | null): void;
    sessionFactLogPath(sessionId: string): string;
    interruptRun(input: { sessionId: string; runId: string }): boolean;
    markSessionResultRead(input: { sessionId: string; unreadSince: string; now: string }): Promise<boolean>;
    updateSessionReadState(input: {
      sessionId: string;
      action: "mark-read-attention" | "mark-read-unread" | "mark-unread";
      expectedAttentionRevision: number;
      expectedReadStateRevision: number;
      expectedTitleRevision: number;
      isCurrent: boolean;
      now: string;
    }): Promise<LocalConsoleSessionSummary>;
    armSessionManualUnread(input: { sessionId: string; now: string }): Promise<LocalConsoleSessionSummary>;
    markSessionViewed(input: { sessionId: string; now: string }): Promise<LocalConsoleSessionSummary>;
    setSessionPinned(input: {
      sessionId: string;
      pinned: boolean;
      expectedPinnedAt: string | null;
      now: string;
    }): Promise<LocalConsoleSessionSummary>;
    renameSession(input: {
      sessionId: string;
      title: string;
      expectedTitleRevision: number;
      now: string;
    }): Promise<LocalConsoleSessionSummary>;
  }) {}

  async createChildSession(input: {
    parentSessionId: string;
    childSessionId: string;
    projectId: string;
    title: string;
    relation?: string;
    hiddenKey: string;
    initialBody: string;
    initialRole?: string | null;
  }): Promise<LocalConsoleSessionSummary> {
    await this.input.assertProjectDirectoryAvailable(input.projectId);
    try {
      return await this.input.storeCall("local-console-store-create-child-session", () =>
        this.input.createChildSession(planChildSessionCreation({ ...input, now: this.input.nowIso() })));
    } catch (error) {
      const message = formatLocalError(error);
      this.input.setLastError(message);
      await this.input.recordVisibleChildFailure(input.parentSessionId, message);
      throw error;
    }
  }

  getSessionFactLogPath(sessionId: string): string {
    return this.input.sessionFactLogPath(sessionId);
  }

  async interruptRun(input: { sessionId: string; runId: string }): Promise<boolean> {
    return this.input.interruptRun(input);
  }

  async markSessionResultRead(input: { sessionId: string; unreadSince: string }): Promise<boolean> {
    return await this.input.storeCall("local-console-store-mark-session-result-read", () =>
      this.input.markSessionResultRead({ ...input, now: this.input.nowIso() }));
  }

  async updateSessionReadState(input: {
    sessionId: string;
    action: "mark-read-attention" | "mark-read-unread" | "mark-unread";
    expectedAttentionRevision: number;
    expectedReadStateRevision: number;
    expectedTitleRevision: number;
    isCurrent: boolean;
  }): Promise<LocalConsoleSessionSummary> {
    return await this.input.storeCall("local-console-store-update-session-read-state", () =>
      this.input.updateSessionReadState({ ...input, now: this.input.nowIso() }));
  }

  async armSessionManualUnread(sessionId: string): Promise<LocalConsoleSessionSummary> {
    return await this.input.storeCall("local-console-store-arm-session-manual-unread", () =>
      this.input.armSessionManualUnread({ sessionId, now: this.input.nowIso() }));
  }

  async markSessionViewed(sessionId: string): Promise<LocalConsoleSessionSummary> {
    return await this.input.storeCall("local-console-store-mark-session-viewed", () =>
      this.input.markSessionViewed({ sessionId, now: this.input.nowIso() }));
  }

  async setSessionPinned(input: {
    sessionId: string;
    pinned: boolean;
    expectedPinnedAt: string | null;
  }): Promise<LocalConsoleSessionSummary> {
    return await this.input.storeCall("local-console-store-set-session-pinned", () =>
      this.input.setSessionPinned({ ...input, now: this.input.nowIso() }));
  }

  async renameSession(input: {
    sessionId: string;
    title: string;
    expectedTitleRevision: number;
  }): Promise<LocalConsoleSessionSummary> {
    return await this.input.storeCall("local-console-store-rename-session", () =>
      this.input.renameSession({ ...input, now: this.input.nowIso() }));
  }
}
