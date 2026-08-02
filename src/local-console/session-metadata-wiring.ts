import type { CeoScript } from "../ceo-scripts.js";
import type { LocalActiveRunRegistry } from "./active-run-registry.js";
import type { LocalConsoleRuntimeOptions } from "./runtime-contracts.js";
import { decideRuntimeCapability } from "./runtime-domain.js";
import type { LocalRuntimeWiringContext } from "./runtime-wiring-context.js";
import type { LocalSessionFactWritingStore } from "./runtime-store-ports.js";
import { decideSessionInterrupt } from "./session-metadata-plan.js";
import type { LocalConsoleSessionMetadataRuntime } from "./session-metadata-runtime.js";
import type { LocalSessionContinuationRuntime } from "./session-continuation-runtime.js";

type MetadataPorts = ConstructorParameters<typeof LocalConsoleSessionMetadataRuntime>[0];

export function createLocalSessionMetadataWiring(input: {
  context: LocalRuntimeWiringContext;
  options: LocalConsoleRuntimeOptions;
  activeRuns: LocalActiveRunRegistry;
  continuation: LocalSessionContinuationRuntime;
  loadCeoScripts(): Promise<readonly CeoScript[]>;
  processPending(sessionId: string): void;
  reportError(event: string, error: string, originalError: string): void;
}): MetadataPorts {
  const { context, options } = input;
  return {
    now: context.now,
    nowIso: context.nowIso,
    storeCall: (label, operation) => context.storePorts.call(label, operation),
    assertProjectDirectoryAvailable: (projectId) => input.continuation.assertProjectDirectoryAvailable(projectId),
    createChildSession: (childInput) => context.storePorts.sessionFacts().createChildSession(childInput),
    recordSystemMessage: (messageInput) => options.store.recordSystemMessage(messageInput),
    getSessionWorkspace: (sessionId) => options.store.getSessionWorkspace(sessionId),
    loadCeoScripts: input.loadCeoScripts,
    processPending: input.processPending,
    reportError: input.reportError,
    setLastError: context.setError,
    sessionFactLogPath: (sessionId) => {
      const store = options.store as Partial<Pick<LocalSessionFactWritingStore, "getSessionFactLogPath">>;
      const capability = decideRuntimeCapability(store.getSessionFactLogPath);
      if (capability.kind === "unavailable") {
        throw new Error("local console store does not provide the session fact log path");
      }
      return capability.capability.call(options.store, sessionId);
    },
    interruptRun: ({ sessionId, runId }) => {
      const active = input.activeRuns.get(runId);
      const decision = decideSessionInterrupt(active?.sessionId, sessionId);
      if (decision.kind === "reject") return false;
      active!.controller.abort("user-interrupted");
      return true;
    },
    markSessionResultRead: (readInput) => options.store.markSessionResultRead(readInput),
    updateSessionReadState: (readInput) => {
      const capability = decideRuntimeCapability(options.store.updateSessionReadState);
      if (capability.kind === "unavailable") throw new Error("local console session read state unavailable");
      return capability.capability.call(options.store, readInput);
    },
    armSessionManualUnread: (readInput) => {
      const capability = decideRuntimeCapability(options.store.armSessionManualUnread);
      if (capability.kind === "unavailable") throw new Error("local console manual unread unavailable");
      return capability.capability.call(options.store, readInput);
    },
    markSessionViewed: (readInput) => {
      const capability = decideRuntimeCapability(options.store.markSessionViewed);
      if (capability.kind === "unavailable") throw new Error("local console session view state unavailable");
      return capability.capability.call(options.store, readInput);
    },
    setSessionPinned: (pinInput) => {
      const capability = decideRuntimeCapability(options.store.setSessionPinned);
      if (capability.kind === "unavailable") throw new Error("local console session pin unavailable");
      return capability.capability.call(options.store, pinInput);
    },
    renameSession: (renameInput) => {
      const capability = decideRuntimeCapability(options.store.renameSession);
      if (capability.kind === "unavailable") throw new Error("local console session rename unavailable");
      return capability.capability.call(options.store, renameInput);
    },
  };
}
