import { buildLocalConsoleRoutingTimeline, buildLocalConsoleTimeline } from "./timeline.js";
import { planPrimaryCloseoutRecordability, resolveClaimedControlAction } from "./control-dispatch.js";
import type { LocalConsoleAgentFile } from "./agent-file.js";
import type { LocalCodexResumeIntentFact } from "./codex-resume.js";
import type { LocalPrimaryRunInput } from "./primary-preparation-runtime.js";
import {
  decidePrimaryClaim,
  decidePrimaryControlRetryLookup,
  decidePrimaryInactive,
  decidePrimaryRouteResult,
  planPrimaryAgentName,
  planPrimaryControlAction,
  planPrimaryProposalVersion,
  planPrimaryRunId,
  planPrimaryTimelineMessages,
} from "./primary-runtime-plan.js";
import { resolveTrigger } from "../triggers/index.js";
import type {
  LocalConsoleMessage,
  LocalConsoleSessionSummary,
  LocalConsoleSessionWorkspaceSource,
  LocalConsoleStore,
} from "./types.js";
import type { LocalRouteJudgment } from "./route-bus.js";

export type LocalPrimaryDispatchOutcome =
  | { kind: "stop" }
  | { kind: "continue" }
  | { kind: "run"; run: LocalPrimaryRunInput };

export class LocalPrimaryDispatchRuntime {
  constructor(private readonly input: {
    store: LocalConsoleStore;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
    nowIso(): string;
    nextRunId(): string;
    inactive(sessionId: string): boolean;
    gracefulResumeTargets(sessionId: string): Promise<Array<{ sourceMessageId: number; targetRunId: string }>>;
    loadAgentFiles(sessionId: string): Promise<LocalConsoleAgentFile[]>;
    sessionSummary(sessionId: string): Promise<LocalConsoleSessionSummary>;
    loadRetryIntent(sessionId: string, sourceMessageId: number): Promise<LocalCodexResumeIntentFact | null>;
    routeWithoutPrimary(input: {
      message: LocalConsoleMessage;
      sessionId: string;
      timeline: ReturnType<typeof buildLocalConsoleTimeline>;
      availableAgentNames: string[];
      runId: string;
      runDir: string | null;
      routeJudgment?: LocalRouteJudgment;
    }): Promise<{ kind: string; reason?: string }>;
    recordTerminalFailure(message: LocalConsoleMessage, sessionId: string, runId: string, runDir: string | null, reason: string): Promise<void>;
    formatError(error: unknown): string;
    setError(error: string | null): void;
    scheduleWorker(input: import("./worker-dispatch-runtime.js").LocalWorkerRunInput): void;
  }) {}

  async claim(
    sessionId: string,
    workspaceSource: LocalConsoleSessionWorkspaceSource,
    onClaim: (message: LocalConsoleMessage, runId: string) => void,
    onRelease: () => void,
  ): Promise<LocalPrimaryDispatchOutcome> {
    const gracefulResumeTargets = await this.input.gracefulResumeTargets(sessionId);
    const freshRunId = this.input.nextRunId();
    const claim = decidePrimaryClaim(await this.input.storeCall("local-console-store-claim", () =>
      this.input.store.claimNextPendingMessage({
        sessionId,
        runId: freshRunId,
        gracefulResumeTargets,
        now: this.input.nowIso(),
      })));
    if (claim.kind === "stop") return { kind: "stop" };
    const claimedMessage = claim.message;
    const runId = planPrimaryRunId(gracefulResumeTargets, claimedMessage.id, freshRunId);
    onClaim(claimedMessage, runId);
    const claimCheckpoint = decidePrimaryInactive(this.input.inactive(sessionId));
    if (claimCheckpoint.kind === "stop") return { kind: "stop" };
    const agentFiles = await this.input.loadAgentFiles(sessionId);
    const agentCheckpoint = decidePrimaryInactive(this.input.inactive(sessionId));
    if (agentCheckpoint.kind === "stop") return { kind: "stop" };
    const messages = await this.input.storeCall("local-console-store-list", () =>
      this.input.store.listMessages(sessionId));
    const policySession = await this.input.sessionSummary(sessionId);
    const analysisGateEnabled = policySession.writePolicy === "confirm-current-plan-before-write";
    const timelineMessages = planPrimaryTimelineMessages(messages);
    const agentNames = agentFiles.map((agent) => agent.name);
    const timeline = buildLocalConsoleTimeline(timelineMessages, agentNames);
    const routingTimeline = buildLocalConsoleRoutingTimeline(timelineMessages, claimedMessage.id, agentNames);
    const explicitTrigger = resolveTrigger({ timeline: routingTimeline, availableAgentNames: agentNames });
    const primaryAgent = planPrimaryAgentName(agentFiles);
    let controlAction = planPrimaryControlAction(resolveClaimedControlAction({
      source: claimedMessage,
      primaryAgent,
      explicitTrigger,
      availableAgentNames: agentNames,
      retryIntent: null,
    }));
    const retryLookup = decidePrimaryControlRetryLookup({
      actionKind: controlAction.kind,
      sourceSpeaker: claimedMessage.speaker,
    });
    if (retryLookup.kind === "read") {
      const retryIntent = await this.input.loadRetryIntent(sessionId, claimedMessage.id);
      controlAction = planPrimaryControlAction(resolveClaimedControlAction({
        source: claimedMessage,
        primaryAgent,
        explicitTrigger,
        availableAgentNames: agentNames,
        retryIntent,
      }));
    }
    if (controlAction.kind === "record-retry-trigger-missing") {
      await this.input.storeCall("local-console-store-record-retry-trigger-missing", () =>
        this.input.store.recordFailure({
          userMessageId: claimedMessage.id,
          sessionId,
          error: "retry-source-trigger-missing",
          runId,
          runDir: null,
          body: "这一步没跑起来。你可以直接告诉主理人下一步怎么处理。",
          systemEventKind: "run-not-started",
          sourceKind: "local-retry-intent",
          sourceId: controlAction.intent.intentId,
          now: this.input.nowIso(),
        }));
      return { kind: "continue" };
    }
    if (controlAction.kind === "complete-source") {
      await this.input.storeCall("local-console-store-primary-closeout-complete", () =>
        this.input.store.recordMessageProcessed({
          userMessageId: claimedMessage.id,
          sessionId,
          runId,
          runDir: null,
          now: this.input.nowIso(),
        }));
      const closeout = planPrimaryCloseoutRecordability({
        speaker: claimedMessage.speaker,
        role: claimedMessage.role,
        primaryAgent,
        recordCapable: this.input.store.recordPrimaryCloseout !== undefined,
      });
      if (closeout.kind === "record") {
        await this.input.storeCall("local-console-store-record-primary-closeout", () =>
          this.input.store.recordPrimaryCloseout!({
            sessionId,
            messageId: claimedMessage.id,
            role: closeout.role,
            occurredAt: this.input.nowIso(),
          }));
      }
      return { kind: "continue" };
    }
    if (controlAction.kind === "route-without-primary-agent") {
      let route: { kind: string; reason?: string };
      try {
        route = await this.input.routeWithoutPrimary({
          message: claimedMessage,
          sessionId,
          timeline,
          availableAgentNames: agentNames,
          runId,
          runDir: null,
        });
      } catch (error) {
        await this.input.recordTerminalFailure(
          claimedMessage,
          sessionId,
          runId,
          null,
          this.input.formatError(error),
        );
        onRelease();
        throw error;
      }
      const routeResult = decidePrimaryRouteResult(route.kind);
      if (routeResult.kind === "stop") {
        const reason = `local-route-retry:${String(route.reason)}`;
        this.input.setError(reason);
        await this.input.recordTerminalFailure(claimedMessage, sessionId, runId, null, reason);
        return { kind: "stop" };
      }
      return { kind: "continue" };
    }
    if (controlAction.kind === "fail-missing-agent") {
      await this.input.recordTerminalFailure(claimedMessage, sessionId, runId, null, `Agent not found: ${controlAction.role}`);
      return { kind: "stop" };
    }
    const role = controlAction.role;
    const selectedAgent = agentFiles.find((agent) => agent.name === role)!;
    if (controlAction.kind === "schedule-worker") {
      await this.input.storeCall("local-console-store-detached-worker-source-processed", () =>
        this.input.store.recordMessageProcessed({
          userMessageId: claimedMessage.id,
          sessionId,
          runId,
          runDir: null,
          now: this.input.nowIso(),
        }));
      onRelease();
      this.input.scheduleWorker({
        origin: "primary-redirect",
        sessionId,
        runId,
        sourceMessage: claimedMessage,
        role,
        selectedAgent,
        agentFiles,
        timeline,
        timelineMessages,
        workspaceSource,
      });
      return { kind: "continue" };
    }
    return {
      kind: "run",
      run: {
        sessionId,
        runId,
        sourceMessage: claimedMessage,
        role,
        primaryAgent,
        selectedAgent,
        agentFiles,
        timeline,
        timelineMessages,
        workspaceSource,
        analysisGateEnabled,
        proposalVersion: planPrimaryProposalVersion(policySession.proposalVersion),
      },
    };
  }
}
