import type {
  LocalAgentSessionLinkFact,
  LocalAgentTimelineCursorFact,
  LocalExecutionSessionLinkFact,
  LocalProviderInvocationFact,
  LocalProviderProcessStartedFact,
  LocalProviderSessionObservedFact,
  LocalRunExecutionContextFact,
} from "./execution-context.js";
import type { LocalRunLifecycleFactStore } from "./run-lifecycle-runtime.js";
import { withLocalConsoleTimeout } from "./store-timeout.js";
import type {
  LocalConsoleSessionSummary,
  LocalConsoleStore,
} from "./types.js";
import type {
  LocalCodexResumeConsumedFact,
  LocalCodexResumeIntentFact,
  LocalCodexRunUsageFact,
} from "./codex-resume.js";

export interface LocalSessionFactWritingStore extends LocalConsoleStore {
  getSessionFactLogPath(sessionId: string): string;
  recordProgressEvent(input: {
    sessionId: string;
    runId: string;
    role: string;
    body: string;
    now: string;
  }): Promise<void>;
  createChildSession(input: {
    parentSessionId: string;
    childSessionId: string;
    projectId: string;
    title: string;
    relation: string;
    hiddenKey: string;
    initialBody: string;
    initialRole: string | null;
    now: string;
  }): Promise<LocalConsoleSessionSummary>;
  recordChildSessionCard(input: {
    parentSessionId: string;
    sourceId: string;
    childSessionIds: string[];
    runId: string;
    runDir: string;
    now: string;
  }): Promise<void>;
  recordWorkspaceDiff(input: {
    sessionId: string;
    runId: string;
    originalRepoRoot: string | null;
    baseRef: string;
    branchName: string;
    worktreePath: string;
    patchPath: string;
    affectedFiles: string[];
    status: "generated" | "applied" | "failed" | "abandoned" | "rolled_back";
    error: string | null;
    now: string;
  }): Promise<void>;
}

export interface LocalCodexRecoveryFactStore extends LocalConsoleStore {
  getSessionFactLogPath(sessionId: string): string;
  recordCodexResumeIntent(input: LocalCodexResumeIntentFact): Promise<void>;
  recordCodexResumeConsumed(input: LocalCodexResumeConsumedFact): Promise<void>;
  recordCodexRunUsage(input: LocalCodexRunUsageFact): Promise<void>;
  recordAgentSessionLink(input: LocalAgentSessionLinkFact): Promise<void>;
  recordProviderSessionObserved(input: LocalProviderSessionObservedFact): Promise<void>;
  recordAgentTimelineCursor(input: LocalAgentTimelineCursorFact): Promise<void>;
  recordProviderInvocation(input: LocalProviderInvocationFact): Promise<void>;
}

export class LocalConsoleStorePorts {
  constructor(
    private readonly store: LocalConsoleStore,
    private readonly timeoutMs: number,
  ) {}

  async call<T>(label: string, operation: () => Promise<T>): Promise<T> {
    return await withLocalConsoleTimeout(Promise.resolve().then(operation), this.timeoutMs, label);
  }

  async recordRunExecutionContext(input: LocalRunExecutionContextFact): Promise<void> {
    const record = this.store.recordRunExecutionContext;
    if (record === undefined) return;
    await this.call("local-console-store-record-run-execution-context", () =>
      record.call(this.store, input));
  }

  async recordProviderProcessStarted(input: LocalProviderProcessStartedFact): Promise<void> {
    const record = this.store.recordProviderProcessStarted;
    if (record === undefined) return;
    await this.call("local-console-store-record-provider-process-started", () =>
      record.call(this.store, input));
  }

  async recordExecutionSessionLink(input: LocalExecutionSessionLinkFact): Promise<void> {
    const record = this.store.recordExecutionSessionLink;
    if (record === undefined) return;
    await this.call("local-console-store-record-execution-session-link", () =>
      record.call(this.store, input));
  }

  async recordAgentSessionLink(input: LocalAgentSessionLinkFact): Promise<void> {
    const store = this.requireRecoveryFacts();
    await this.call("local-console-store-record-agent-session-link", () =>
      store.recordAgentSessionLink(input));
  }

  async recordProviderSessionObserved(input: LocalProviderSessionObservedFact): Promise<void> {
    const store = this.requireRecoveryFacts();
    await this.call("local-console-store-record-provider-session-observed", () =>
      store.recordProviderSessionObserved(input));
  }

  async recordAgentTimelineCursor(input: LocalAgentTimelineCursorFact): Promise<void> {
    const store = this.requireRecoveryFacts();
    await this.call("local-console-store-record-agent-timeline-cursor", () =>
      store.recordAgentTimelineCursor(input));
  }

  async recordProviderInvocation(input: LocalProviderInvocationFact): Promise<void> {
    const store = this.requireRecoveryFacts();
    await this.call("local-console-store-record-provider-invocation", () =>
      store.recordProviderInvocation(input));
  }

  async recordCodexThreadLink(input: {
    sessionId: string;
    runId: string;
    sourceMessageId: number;
    role: string;
    threadId: string;
    startedAt: string;
    contextFingerprint: string;
  }): Promise<void> {
    const record = this.store.recordCodexThreadLink;
    if (record === undefined) {
      throw new Error("local console store does not provide Codex thread link persistence");
    }
    await this.call("local-console-store-record-codex-thread-link", () =>
      record.call(this.store, input));
  }

  sessionFacts(): LocalSessionFactWritingStore {
    const store = this.store as Partial<LocalSessionFactWritingStore> & LocalConsoleStore;
    if (
      typeof store.createChildSession !== "function" ||
      typeof store.recordChildSessionCard !== "function" ||
      typeof store.recordWorkspaceDiff !== "function" ||
      typeof store.recordProgressEvent !== "function" ||
      typeof store.getSessionFactLogPath !== "function"
    ) {
      throw new Error("local console store does not provide the session fact write funnel");
    }
    return store as LocalSessionFactWritingStore;
  }

  lifecycleFacts(): LocalRunLifecycleFactStore | null {
    const store = this.store as Partial<LocalRunLifecycleFactStore> & LocalConsoleStore;
    if (
      typeof store.nextRunAttempt !== "function" ||
      typeof store.getRunTiming !== "function" ||
      typeof store.recordRunLifecycleEvent !== "function" ||
      typeof store.recordRunActivityEvent !== "function"
    ) {
      return null;
    }
    return store as LocalRunLifecycleFactStore;
  }

  recoveryFacts(): LocalCodexRecoveryFactStore | null {
    const store = this.store as Partial<LocalCodexRecoveryFactStore> & LocalConsoleStore;
    if (
      typeof store.getSessionFactLogPath !== "function" ||
      typeof store.recordCodexResumeIntent !== "function" ||
      typeof store.recordCodexResumeConsumed !== "function" ||
      typeof store.recordCodexRunUsage !== "function" ||
      typeof store.recordAgentSessionLink !== "function" ||
      typeof store.recordProviderSessionObserved !== "function" ||
      typeof store.recordAgentTimelineCursor !== "function" ||
      typeof store.recordProviderInvocation !== "function"
    ) {
      return null;
    }
    return store as LocalCodexRecoveryFactStore;
  }

  requireRecoveryFacts(): LocalCodexRecoveryFactStore {
    const store = this.recoveryFacts();
    if (store === null) {
      throw new Error("local console store does not provide Codex recovery fact persistence");
    }
    return store;
  }
}
