import type { CeoScript } from "../ceo-scripts.js";
import { parseCeoOrchestrationOutput } from "./ceo-orchestration-parser.js";
import {
  localChildSessionId,
  localOrchestrationKey,
  planLocalCeoVisibleTaskIds,
  planLocalChildDescriptors,
  planLocalChildGroup,
  renderLocalChildSessionInitialBody,
} from "./local-child-session-plan.js";
import { formatLocalError } from "./runtime-domain.js";
import { planChildSessionCreation } from "./session-metadata-plan.js";
import type {
  LocalConsoleSessionSummary,
  LocalConsoleStore,
} from "./types.js";

export class LocalConsoleSessionMetadataRuntime {
  constructor(private readonly input: {
    now(): Date;
    nowIso(): string;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
    assertProjectDirectoryAvailable(projectId: string): Promise<void>;
    createChildSession(input: ReturnType<typeof planChildSessionCreation>): Promise<LocalConsoleSessionSummary>;
    recordSystemMessage(input: Parameters<LocalConsoleStore["recordSystemMessage"]>[0]): Promise<void>;
    getSessionWorkspace(sessionId: string): Promise<{ projectId: string }>;
    loadCeoScripts(): Promise<readonly CeoScript[]>;
    processPending(sessionId: string): void;
    reportError(event: string, error: string, originalError: string): void;
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
      await this.recordVisibleChildFailure(input.parentSessionId, message);
      throw error;
    }
  }

  async executeChildOrchestration(input: {
    sessionId: string;
    runId: string;
    runDir: string;
    finalText: string;
    availableAgentNames: string[];
  }): Promise<{ sourceId: string; childSessionIds: string[] } | null> {
    const visibleTaskIds = planLocalCeoVisibleTaskIds(input.finalText);
    if (visibleTaskIds.length === 0) return null;
    const scripts = await this.input.loadCeoScripts();
    const descriptors = planLocalChildDescriptors(parseCeoOrchestrationOutput({
      output: input.finalText,
      scripts,
      availableAgentNames: input.availableAgentNames,
      visibleTaskIds,
      childTaskCheckPolicy: "local-optional",
    }));
    if (descriptors.kind === "skip") return null;
    const workspace = await this.input.storeCall("local-console-store-session-workspace", () =>
      this.input.getSessionWorkspace(input.sessionId));
    const created: LocalConsoleSessionSummary[] = [];
    for (const descriptor of descriptors.issues) {
      const group = planLocalChildGroup(descriptors.groups, descriptor.groupId);
      if (group.kind === "missing") {
        throw new Error(`local child orchestration missing group: ${descriptor.groupId}`);
      }
      const hiddenKey = localOrchestrationKey({
        parentSessionId: input.sessionId,
        workflowId: descriptors.workflowId,
        ledgerTaskId: descriptor.ledgerTaskId,
      });
      created.push(await this.createChildSession({
        parentSessionId: input.sessionId,
        childSessionId: localChildSessionId(input.sessionId, descriptor.ledgerTaskId),
        projectId: workspace.projectId,
        title: descriptor.title,
        relation: "task",
        hiddenKey,
        initialRole: descriptor.initialRole,
        initialBody: renderLocalChildSessionInitialBody({
          parentSessionId: input.sessionId,
          workflowId: descriptors.workflowId,
          group: group.group,
          descriptor,
          orchestrationKey: hiddenKey,
        }),
      }));
    }
    for (const child of created) this.input.processPending(child.sessionId);
    return {
      sourceId: `workflow:${descriptors.workflowId}`,
      childSessionIds: created.map((child) => child.sessionId),
    };
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

  async recordVisibleChildFailure(parentSessionId: string, reason: string): Promise<void> {
    try {
      await this.input.storeCall("local-console-store-child-session-failure", () =>
        this.input.recordSystemMessage({
          sessionId: parentSessionId,
          body: "子任务没有创建成功。你可以继续说话，或换一个成员接手。",
          systemEventKind: "run-not-started",
          runId: `local-child-session-${this.input.now().toISOString()}`,
          runDir: null,
          error: reason,
          status: "failed",
          now: this.input.nowIso(),
        }));
    } catch (error) {
      const message = formatLocalError(error);
      this.input.setLastError(message);
      this.input.reportError("local-console-child-session-failure-record-failed", message, reason);
    }
  }
}
