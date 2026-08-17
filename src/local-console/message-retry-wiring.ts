import type { LocalConsoleMessageCommandRuntime } from "./message-command-runtime.js";
import {
  decideMessageAgentSource,
  decideMessageRecoveryStore,
  planHasAnyMessages,
  planMessagePrimaryAgent,
  planMessageResumeLink,
  planPersistedPrimaryRun,
} from "./message-command-plan.js";
import type { LocalRunLifecycleRuntime } from "./run-lifecycle-runtime.js";
import type { LocalConsoleRunRetryRuntime } from "./run-retry-runtime.js";
import {
  decideRetryRecoveryStore,
  emptyRetryRecoveryBundle,
} from "./run-retry-plan.js";
import type { LocalConsoleRuntimeOptions } from "./runtime-contracts.js";
import type { LocalRuntimeWiringContext } from "./runtime-wiring-context.js";
import { decideRuntimeCapability } from "./runtime-domain.js";
import type { LocalSessionContinuationRuntime } from "./session-continuation-runtime.js";
import { resolveLocalUserMessageDispatch } from "./user-message-routing.js";

type MessagePorts = ConstructorParameters<typeof LocalConsoleMessageCommandRuntime>[0];
type RetryPorts = ConstructorParameters<typeof LocalConsoleRunRetryRuntime>[0];

export function createLocalMessageRetryWiring(input: {
  context: LocalRuntimeWiringContext;
  options: LocalConsoleRuntimeOptions;
  defaultSessionId: string;
  lifecycle: LocalRunLifecycleRuntime;
  continuation: LocalSessionContinuationRuntime;
  randomId(): string;
  scheduleWorkerWake(sessionId: string): void;
  processPending(sessionId: string): void;
  schedulePendingProcessing(sessionId: string): void;
  runRetryAfterCurrent(sessionId: string, action: () => Promise<void>): Promise<boolean>;
  generateSessionTitle: MessagePorts["generateSessionTitle"];
  readExecutionSessionLinks: typeof import("./execution-context-reader.js").readExecutionSessionLinks;
  readCodexThreadLinks: typeof import("./codex-thread-link-reader.js").readCodexThreadLinks;
  readRunExecutionContexts: typeof import("./execution-context-reader.js").readRunExecutionContexts;
  readRecoveryFacts: typeof import("./codex-resume.js").readLocalCodexRecoveryFacts;
}): {
  message: MessagePorts;
  retry: RetryPorts;
  hasPersistedPrimary(sessionId: string): Promise<boolean>;
  hasAnyMessages(sessionId: string): Promise<boolean>;
} {
  const { context, options } = input;
  const hasPersistedPrimary = async (sessionId: string): Promise<boolean> => {
    const messages = await context.storePorts.call("local-console-store-list-primary-running", () =>
      options.store.listMessages(sessionId));
    return planPersistedPrimaryRun(messages);
  };
  const hasAnyMessages = async (sessionId: string): Promise<boolean> => {
    const messages = await context.storePorts.call("local-console-store-list-any-messages", () =>
      options.store.listMessages(sessionId));
    return planHasAnyMessages(messages);
  };
  return {
    hasPersistedPrimary,
    hasAnyMessages,
    message: {
      defaultSessionId: input.defaultSessionId,
      nowIso: context.nowIso,
      assertSessionCanContinue: (sessionId) => input.continuation.assertSessionCanContinue(sessionId),
      hasActivePrimary: (sessionId) => input.lifecycle.runForLane(sessionId, "primary") !== undefined,
      hasPersistedPrimary,
      hasAnyMessages,
      sessionSummary: (sessionId) => input.continuation.sessionSummary(sessionId),
      resolveDispatch: async (sessionId, body) => {
        const source = decideMessageAgentSource(
          await options.store.listSessionAgentTeamSnapshot?.(sessionId),
        );
        const agentNames = source.kind === "files"
          ? (await options.listAgentFiles(sessionId)).map((agent) => agent.name)
          : source.snapshot.members.map((member) => member.name);
        const primary = planMessagePrimaryAgent(agentNames);
        if (primary.kind === "missing") throw new Error("Local console session has no primary Agent");
        return resolveLocalUserMessageDispatch({
          body,
          availableAgentNames: agentNames,
          primaryAgent: primary.primaryAgent,
        });
      },
      appendUserMessage: (messageInput) => options.store.appendUserMessage({
        ...messageInput,
        textFragments: [],
      }),
      resolveResumeLink: async (sessionId, runId) => {
        const recovery = decideMessageRecoveryStore(context.storePorts.recoveryFacts());
        if (recovery.kind === "unavailable") return undefined;
        const factLogPath = recovery.store.getSessionFactLogPath(sessionId);
        const [executionLinks, codexLinks] = await Promise.all([
          input.readExecutionSessionLinks(factLogPath, sessionId),
          input.readCodexThreadLinks(factLogPath, sessionId),
        ]);
        return planMessageResumeLink(executionLinks, codexLinks, runId);
      },
      recordEditResume: (resumeInput) => context.storePorts.requireRecoveryFacts().recordCodexResumeIntent({
        ...resumeInput,
        intentId: input.randomId(),
        reason: "edit-resend",
      }),
      scheduleWorkerWake: input.scheduleWorkerWake,
      processPending: input.processPending,
      generateSessionTitle: input.generateSessionTitle,
      markPendingReferenceError: (pendingInput) => {
        const capability = decideRuntimeCapability(options.store.markPendingReferenceError);
        if (capability.kind === "unavailable") throw new Error("pending message retry unavailable");
        return capability.capability.call(options.store, pendingInput);
      },
      updatePendingUserMessage: (pendingInput) => {
        const capability = decideRuntimeCapability(options.store.updatePendingUserMessage);
        if (capability.kind === "unavailable") throw new Error("pending message editing unavailable");
        return capability.capability.call(options.store, pendingInput);
      },
      removePendingUserMessage: (pendingInput) => {
        const capability = decideRuntimeCapability(options.store.removePendingUserMessage);
        if (capability.kind === "unavailable") throw new Error("pending message removal unavailable");
        return capability.capability.call(options.store, pendingInput);
      },
      storeCall: (label, operation) => context.storePorts.call(label, operation),
      setLastError: context.setError,
      schedulePendingProcessing: input.schedulePendingProcessing,
    },
    retry: {
      nowIso: context.nowIso,
      randomId: input.randomId,
      assertSessionCanContinue: (sessionId) => input.continuation.assertSessionCanContinue(sessionId),
      listMessages: (sessionId) => context.storePorts.call("local-console-store-list-retry-source", () =>
        options.store.listMessages(sessionId)),
      loadRecoveryBundle: async (sessionId) => {
        const recovery = decideRetryRecoveryStore(context.storePorts.recoveryFacts());
        if (recovery.kind === "unavailable") return emptyRetryRecoveryBundle();
        const factLogPath = recovery.store.getSessionFactLogPath(sessionId);
        const [executionLinks, codexLinks, runContexts, recoveryFacts] = await Promise.all([
          input.readExecutionSessionLinks(factLogPath, sessionId),
          input.readCodexThreadLinks(factLogPath, sessionId),
          input.readRunExecutionContexts(factLogPath, sessionId),
          input.readRecoveryFacts(factLogPath, sessionId),
        ]);
        return { available: true, executionLinks, codexLinks, runContexts, recoveryFacts };
      },
      activeRunForRole: (sessionId, role) => input.lifecycle.runForRole(sessionId, role) !== undefined,
      recordRetryIntent: (retryInput) =>
        context.storePorts.requireRecoveryFacts().recordCodexResumeIntent(retryInput),
      releaseMessageForRetry: (retryInput) => options.store.releaseMessageForRetry(retryInput),
      runRetryAfterCurrent: input.runRetryAfterCurrent,
      storeCall: (label, operation) => context.storePorts.call(label, operation),
    },
  };
}
