import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { LOCAL_CONSOLE_SQLITE_BUSY_TIMEOUT_MS, LOCAL_CONSOLE_STORE_TIMEOUT_MS } from "./config.js";
import type { LocalConsoleAgentTeamSnapshot } from "./local-console/types.js";
import type { ProviderOperation, ProviderProfile } from "./provider-profile.js";

export type SqliteStateCommand =
  | { kind: "local-init" }
  | { kind: "provider-list-profiles" }
  | { kind: "provider-get-profile"; profileId: string }
  | { kind: "provider-put-profile"; profile: ProviderProfile; expectedRevision: number | null }
  | {
      kind: "provider-commit-profile-operation";
      profile: ProviderProfile;
      expectedRevision: number | null;
      operation: ProviderOperation;
    }
  | { kind: "provider-delete-profile"; profileId: string; expectedRevision: number }
  | { kind: "provider-list-operations"; profileId?: string }
  | { kind: "provider-put-operation"; operation: ProviderOperation }
  | { kind: "provider-list-session-references"; profileId: string }
  | { kind: "local-session-fact-migration-status" }
  | { kind: "local-complete-session-fact-migration"; now: string }
  | { kind: "local-list-session-message-indexes" }
  | { kind: "local-rebuild-session-message-index"; sessionId: string; messages: unknown[] }
  | {
      kind: "local-rebuild-execution-index";
      sessionId: string;
      contexts: unknown[];
      links: unknown[];
    }
  | { kind: "local-index-run-execution-context"; sessionId: string; runId: string; context: unknown }
  | { kind: "local-index-execution-session-link"; sessionId: string; runId: string; link: unknown }
  | { kind: "local-find-message-session"; messageId: number }
  | {
      kind: "local-commit-session-fact-write";
      factCommand: unknown;
      facts: Array<{
        sessionId: string;
        logPath: string;
        eventId: string;
        type: string;
        recordedAt: string;
        payload: unknown;
        beforeMessages: unknown[];
      }>;
    }
  | { kind: "local-create-project"; folderPath: string; worktreeMode: boolean; now: string }
  | { kind: "local-update-project"; projectId: string; worktreeMode: boolean; now: string }
  | { kind: "local-rename-project"; projectId: string; title: string; now: string }
  | { kind: "local-repair-project-folder"; projectId: string; folderPath: string; now: string }
  | { kind: "local-remove-project"; projectId: string; force: boolean; now: string }
  | { kind: "local-reorder-projects"; projectIds: string[] }
  | { kind: "local-list-projects" }
  | { kind: "local-get-project"; projectId: string }
  | { kind: "local-get-session-workspace"; sessionId: string }
  | { kind: "local-switch-session-workspace"; sessionId: string; workspaceMode: "direct" | "worktree"; now: string }
  | {
      kind: "local-switch-session-team";
      sessionId: string;
      agentTeamOwnership: "system" | "user";
      agentTeamId: string;
      agentTeamSnapshot?: LocalConsoleAgentTeamSnapshot;
      now: string;
    }
  | {
      kind: "local-update-session-member-execution";
      sessionId: string;
      memberName: string;
      action: "migrate" | "end";
      executionProfile?: import("./local-console/types.js").LocalConsoleExecutionProfile;
      now: string;
    }
  | { kind: "local-apply-pending-session-context"; sessionId: string; now: string }
  | { kind: "local-list-session-agent-team-snapshot"; sessionId: string }
  | { kind: "local-write-session-team-candidate"; sessionId: string; snapshot: LocalConsoleAgentTeamSnapshot | null }
  | { kind: "local-read-session-team-update-record"; sessionId: string }
  | { kind: "local-begin-session-team-update"; sessionId: string; expectedUpdateToken?: string | null; now: string }
  | { kind: "local-retry-session-team-update"; sessionId: string; expectedUpdateToken?: string | null; now: string }
  | { kind: "local-cancel-session-team-update"; sessionId: string; expectedUpdateToken?: string | null; now: string }
  | { kind: "local-mark-session-team-update-failed"; sessionId: string; code: string; summary: string }
  | {
      kind: "local-record-project-workspace-status";
      projectId: string;
      cwd: string;
      mode: "direct" | "worktree";
      worktreePath: string | null;
      worktreeUnavailableReason: string | null;
      now: string;
    }
  | {
      kind: "local-create-session";
      sessionId: string;
      projectId: string;
      title: string;
      agentTeamOwnership?: "system" | "user";
      agentTeamId?: string;
      agentTeamSnapshot?: LocalConsoleAgentTeamSnapshot;
      workspaceMode?: "direct" | "worktree";
      initialMessage?: string;
      initialDispatch?: {
        lane: "primary" | "worker";
        role: string;
        reason: "single-valid-mention" | "no-valid-mention" | "multiple-valid-mentions";
      };
      initialAttachmentIds?: string[];
      attachmentDraftKey?: string;
      baselineCommit?: string | null;
      originSessionId?: string | null;
      analysisParentSessionId?: string | null;
      entryTemplate?: "session-analysis" | null;
      writePolicy?: "normal" | "confirm-current-plan-before-write";
      initialTextFragments?: Array<{ id: string; label: string; text: string }>;
      now: string;
    }
  | { kind: "local-move-empty-session"; sessionId: string; projectId: string; now: string }
  | { kind: "local-archive-session"; sessionId: string; now: string }
  | { kind: "local-restore-session"; sessionId: string; now: string }
  | {
      kind: "local-create-child-session";
      parentSessionId: string;
      childSessionId: string;
      projectId: string;
      title: string;
      relation: string;
      hiddenKey: string;
      initialBody: string;
      initialRole: string | null;
      now: string;
    }
  | { kind: "local-list-child-session-summary-sources"; parentSessionId: string }
  | {
      kind: "local-record-child-session-card";
      parentSessionId: string;
      sourceId: string;
      body: string;
      runId: string;
      runDir: string;
      now: string;
    }
  | { kind: "local-list-sessions" }
  | { kind: "local-search-sessions"; query: string; includeArchived: boolean }
  | {
      kind: "local-update-session-analysis-gate";
      sessionId: string;
      proposalVersion: string | null;
      writeLeaseVersion: string | null;
      now: string;
    }
  | { kind: "local-mark-session-result-read"; sessionId: string; unreadSince: string; now: string }
  | {
      kind: "local-update-session-read-state";
      sessionId: string;
      action: "mark-read-attention" | "mark-read-unread" | "mark-unread";
      expectedAttentionRevision: number;
      expectedReadStateRevision: number;
      expectedTitleRevision: number;
      isCurrent: boolean;
      now: string;
    }
  | { kind: "local-arm-session-manual-unread"; sessionId: string; now: string }
  | { kind: "local-mark-session-viewed"; sessionId: string; now: string }
  | {
      kind: "local-set-session-pinned";
      sessionId: string;
      pinned: boolean;
      expectedPinnedAt: string | null;
      now: string;
    }
  | {
      kind: "local-rename-session";
      sessionId: string;
      title: string;
      expectedTitleRevision: number;
      now: string;
    }
  | {
      kind: "local-sync-session-continuation-attention";
      sessionId: string;
      attentionKind: "project-unavailable" | "team-deleted" | "team-needs-repair" | null;
      now: string;
    }
  | {
      kind: "local-append-user";
      sessionId: string;
      body: string;
      attachmentIds?: string[];
      attachmentDraftKey?: string;
      textFragments?: Array<{ id: string; label: string; text: string }>;
      dispatch?: {
        lane: "primary" | "worker" | "awaiting-team";
        role: string | null;
        reason: "single-valid-mention" | "no-valid-mention" | "multiple-valid-mentions";
      };
      now: string;
    }
  | {
      kind: "local-mark-pending-reference-error";
      sessionId: string;
      messageId: number;
      error: string | null;
      now: string;
    }
  | {
      kind: "local-update-pending-user";
      sessionId: string;
      messageId: number;
      body: string;
      now: string;
    }
  | {
      kind: "local-remove-pending-user";
      sessionId: string;
      messageId: number;
      now: string;
    }
  | {
      kind: "local-add-draft-attachment";
      blobId: string;
      attachmentId: string;
      draftKey: string;
      attachmentKind: "image" | "file";
      displayName: string;
      mediaType: string;
      byteSize: number;
      sha256: string;
      storageKey: string;
      now: string;
    }
  | { kind: "local-list-draft-attachments"; draftKey: string }
  | { kind: "local-remove-draft-attachment"; attachmentId: string; draftKey: string }
  | {
      kind: "local-clone-message-attachments";
      sessionId: string;
      sourceMessageId: number;
      targetDraftKey: string;
      now: string;
    }
  | {
      kind: "local-get-attachment-content-record";
      attachmentId: string;
      draftKey?: string;
      sessionId?: string;
    }
  | { kind: "local-list-message-attachment-content-records"; messageIds: number[] }
  | { kind: "local-list-attachment-storage-keys" }
  | { kind: "local-prune-orphan-attachment-blobs" }
  | { kind: "local-list"; sessionId: string }
  | { kind: "local-has-running"; sessionId: string }
  | {
      kind: "local-claim-next";
      sessionId: string;
      runId: string;
      gracefulResumeTargets?: Array<{
        sourceMessageId: number;
        targetRunId: string;
      }>;
      now: string;
    }
  | { kind: "local-claim-next-worker"; sessionId: string; role: string; runId: string; now: string }
  | {
      kind: "local-resolve-awaiting-user-dispatches";
      sessionId: string;
      dispatches: Array<{
        messageId: number;
        lane: "primary" | "worker";
        role: string;
        reason: "single-valid-mention" | "no-valid-mention" | "multiple-valid-mentions";
      }>;
      now: string;
    }
  | { kind: "local-set-run-dir"; id: number; runDir: string; now: string }
  | { kind: "local-record-message-processed"; userMessageId: number; sessionId: string; runId: string; runDir: string | null; now: string }
  | { kind: "local-find-route-decision"; sessionId: string; routeKey: string }
  | {
      kind: "local-record-route-append";
      userMessageId: number;
      sessionId: string;
      routeKey: string;
      body: string;
      targetRole: string;
      runId: string;
      runDir: string | null;
      now: string;
    }
  | {
      kind: "local-record-route-no-action";
      userMessageId: number;
      sessionId: string;
      routeKey: string;
      outcome: "no_action" | "fail_open" | "dead_letter";
      reason: string;
      runId: string;
      runDir: string | null;
      now: string;
    }
  | { kind: "local-release-message-for-retry"; userMessageId: number; sessionId: string; now: string }
  | {
      kind: "local-release-message-for-resume";
      userMessageId: number;
      sessionId: string;
      sourceDisposition: "primary" | "user-direct" | "agent-handoff";
      targetRunId: string;
      role: string;
      now: string;
    }
  | {
      kind: "local-repair-agent-handoff-resume-source";
      sessionId: string;
      intentId: string;
      targetRunId: string;
      sourceMessageId: number;
      role: string;
      now: string;
    }
  | {
      kind: "local-record-agent-response";
      userMessageId: number;
      sessionId: string;
      role: string;
      body: string;
      runId: string;
      runDir: string;
      processSteps: readonly import("./local-console/run-activity.js").LocalRunActivity[];
      now: string;
    }
  | {
      kind: "local-record-detached-agent-response";
      sessionId: string;
      role: string;
      body: string;
      runId: string;
      runDir: string;
      processSteps: readonly import("./local-console/run-activity.js").LocalRunActivity[];
      now: string;
    }
  | {
      kind: "local-record-detached-run-started";
      sessionId: string;
      role: string;
      runId: string;
      runDir: string;
      now: string;
    }
  | {
      kind: "local-record-detached-run-terminal";
      sessionId: string;
      body: string;
      systemEventKind: import("./local-console/types.js").LocalConsoleSystemEventKind;
      runId: string;
      runDir: string | null;
      error: string;
      status: "failed" | "interrupted" | "stuck";
      role: string | null;
      processSteps: readonly import("./local-console/run-activity.js").LocalRunActivity[];
      terminal?: import("./local-console/types.js").LocalConsoleTerminal | null;
      now: string;
    }
  | {
      kind: "local-record-system-and-complete";
      userMessageId: number;
      sessionId: string;
      body: string;
      systemEventKind: import("./local-console/types.js").LocalConsoleSystemEventKind;
      runId: string;
      runDir: string | null;
      now: string;
    }
  | {
      kind: "local-record-system";
      sessionId: string;
      body: string;
      runId: string | null;
      runDir: string | null;
      error: string | null;
      status?: "displayed" | "failed" | "interrupted" | "stuck";
      systemEventKind: import("./local-console/types.js").LocalConsoleSystemEventKind;
      role: string | null;
      processSteps: readonly import("./local-console/run-activity.js").LocalRunActivity[];
      terminal?: import("./local-console/types.js").LocalConsoleTerminal | null;
      now: string;
    }
  | {
      kind: "local-record-failure";
      userMessageId: number;
      sessionId: string;
      error: string;
      runId: string | null;
      runDir: string | null;
      now: string;
      body?: string;
      systemEventKind?: import("./local-console/types.js").LocalConsoleSystemEventKind;
      role: string | null;
      processSteps: readonly import("./local-console/run-activity.js").LocalRunActivity[];
      terminal?: import("./local-console/types.js").LocalConsoleTerminal | null;
      sourceKind?: string | null;
      sourceId?: string | null;
    }
  | {
      kind: "local-record-retryable-failure";
      userMessageId: number;
      sessionId: string;
      error: string;
      runId: string | null;
      runDir: string | null;
      now: string;
    }
  | {
      kind: "local-record-dead-letter-and-complete";
      userMessageId: number;
      sessionId: string;
      error: string;
      runId: string | null;
      runDir: string | null;
      failureCount: number;
      now: string;
      role: string | null;
      processSteps: readonly import("./local-console/run-activity.js").LocalRunActivity[];
    }
  | {
      kind: "local-record-interrupted";
      userMessageId: number;
      sessionId: string;
      reason: string;
      interruptionKind?: "user" | "redirect" | "context-unavailable" | "system";
      runId: string | null;
      runDir: string | null;
      now: string;
      role: string | null;
      processSteps: readonly import("./local-console/run-activity.js").LocalRunActivity[];
      terminal?: import("./local-console/types.js").LocalConsoleTerminal | null;
    }
  | {
      kind: "local-record-stuck";
      userMessageId: number;
      sessionId: string;
      reason: string;
      runId: string | null;
      runDir: string | null;
      now: string;
      role: string | null;
      processSteps: readonly import("./local-console/run-activity.js").LocalRunActivity[];
      terminal?: import("./local-console/types.js").LocalConsoleTerminal | null;
    }
  | {
      kind: "local-record-route-decision";
      sessionId: string;
      messageId: number;
      routeKey: string;
      outcome: "append" | "no_action" | "fail_open" | "dead_letter";
      targetRole: string | null;
      reason: string;
      now: string;
    }
  | {
      kind: "local-record-dead-letter";
      sessionId: string;
      sourceMessageId: number;
      failureCount: number;
      reason: string;
      recovered: boolean;
      now: string;
    }
  | {
      kind: "local-record-workspace-diff";
      sessionId: string;
      runId: string;
      originalRepoRoot: string | null;
      baseRef: string;
      branchName: string;
      worktreePath: string;
      patchPath: string;
      affectedFilesJson: string;
      status: "generated" | "applied" | "failed" | "abandoned" | "rolled_back";
      error: string | null;
      now: string;
    }
  | { kind: "local-list-t5-facts"; sessionId: string | null }
  | {
      kind: "local-mark-stale-running";
      sessionId: string;
      cutoffIso: string;
      now: string;
      reason: string;
      /** 每个候选消息的归属由 domain 预先决定（messageId → role），adapter 只查表。 */
      roles: Record<number, string | null>;
    }
  | {
      kind: "agent-revision-create";
      revisionId: string;
      teamStableId: string;
      memberSlug: string;
      content: string;
      authorKind: "user" | "official" | "agent";
      authorLabel: string | null;
      blockOwnershipJson: string | null;
      summaryStatus: "pending" | "unavailable";
      batchId: string | null;
      now: string;
    }
  | { kind: "agent-revision-list"; teamStableId: string; memberSlug: string }
  | { kind: "agent-revision-get"; revisionId: string }
  | {
      kind: "agent-revision-update-summary";
      revisionId: string;
      summary: string | null;
      summaryStatus: "ready" | "unavailable";
      now: string;
    };

export interface SqliteStateCommandOptions {
  sqlitePath: string;
  command: SqliteStateCommand;
  timeoutMs?: number;
  busyTimeoutMs?: number;
  readOnly?: boolean;
}

export interface SqliteStateWorkerConfiguration {
  sqlitePath: string;
  busyTimeoutMs: number;
  readOnly: boolean;
}

export type SqliteStateWorkerRequest =
  | { type: "command"; requestId: number; command: SqliteStateCommand }
  | { type: "close" };

export type SqliteStateWorkerResponse =
  | { type: "ready" }
  | { type: "result"; requestId: number; ok: true; result: unknown }
  | { type: "result"; requestId: number; ok: false; error: { message: string; stack?: string } }
  | { type: "initialization-error"; error: { message: string; stack?: string } }
  | { type: "closed" };

export interface SqliteStateWorkerDiagnostics {
  readonly laneCount: number;
  readonly workerCount: number;
  readonly queuedRequestCount: number;
  readonly activeRequestCount: number;
  readonly createdWorkerCount: number;
}

export class SqliteStateTimeoutError extends Error {
  constructor(
    readonly commandKind: string,
    readonly timeoutMs: number,
  ) {
    super(`sqlite-state-${commandKind}-timeout:${timeoutMs}ms`);
    this.name = "SqliteStateTimeoutError";
  }
}

export class SqliteStateWorkerError extends Error {
  constructor(
    message: string,
    readonly commandKind: string,
    readonly workerStack?: string,
  ) {
    super(message);
    this.name = "SqliteStateWorkerError";
  }
}

export async function runSqliteStateCommand<T>(options: SqliteStateCommandOptions): Promise<T> {
  const timeoutMs = options.timeoutMs ?? LOCAL_CONSOLE_STORE_TIMEOUT_MS;
  const busyTimeoutMs = options.busyTimeoutMs ?? LOCAL_CONSOLE_SQLITE_BUSY_TIMEOUT_MS;
  const sqlitePath = path.resolve(options.sqlitePath);
  const canonicalSqlitePath = canonicalizeSqlitePath(sqlitePath);
  const readOnly = options.readOnly ?? false;
  const key = laneKey(canonicalSqlitePath, readOnly, busyTimeoutMs);
  let lane = workerLanes.get(key);
  if (lane === undefined) {
    lane = new SqliteStateWorkerLane({ sqlitePath, readOnly, busyTimeoutMs }, canonicalSqlitePath);
    workerLanes.set(key, lane);
  }
  return lane.enqueue<T>(options.command, timeoutMs);
}

export async function closeSqliteStateWorkers(options: { sqlitePath?: string } = {}): Promise<void> {
  const canonicalPath = options.sqlitePath === undefined ? null : canonicalizeSqlitePath(options.sqlitePath);
  const matching = [...workerLanes.entries()].filter(([, lane]) =>
    canonicalPath === null || lane.canonicalSqlitePath === canonicalPath);
  await Promise.all(matching.map(async ([key, lane]) => {
    try {
      await lane.close();
    } finally {
      if (workerLanes.get(key) === lane) {
        workerLanes.delete(key);
      }
    }
  }));
}

export function readSqliteStateWorkerDiagnostics(): SqliteStateWorkerDiagnostics {
  let workerCount = 0;
  let queuedRequestCount = 0;
  let activeRequestCount = 0;
  for (const lane of workerLanes.values()) {
    workerCount += lane.hasWorker ? 1 : 0;
    queuedRequestCount += lane.queueLength;
    activeRequestCount += lane.hasActiveRequest ? 1 : 0;
  }
  return Object.freeze({
    laneCount: workerLanes.size,
    workerCount,
    queuedRequestCount,
    activeRequestCount,
    createdWorkerCount,
  });
}

function resolveWorkerUrl(): URL {
  return new URL(import.meta.url.endsWith(".ts") ? "./sqlite-state-worker.ts" : "./sqlite-state-worker.js", import.meta.url);
}

interface PendingSqliteStateCommand {
  readonly requestId: number;
  readonly command: SqliteStateCommand;
  readonly timeoutMs: number;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
  timeout: NodeJS.Timeout;
  settled: boolean;
}

const workerLanes = new Map<string, SqliteStateWorkerLane>();
let nextRequestId = 0;
let createdWorkerCount = 0;

class SqliteStateWorkerLane {
  readonly sqlitePath: string;
  readonly canonicalSqlitePath: string;
  private readonly readOnly: boolean;
  private readonly busyTimeoutMs: number;
  private readonly queue: PendingSqliteStateCommand[] = [];
  private worker: Worker | undefined;
  private generation = 0;
  private ready = false;
  private active: PendingSqliteStateCommand | undefined;
  private restartPromise: Promise<void> | undefined;
  private closing = false;
  private closePromise: Promise<void> | undefined;
  private closeResolve: (() => void) | undefined;
  private closeRequested = false;
  private closeTimeout: NodeJS.Timeout | undefined;

  constructor(configuration: SqliteStateWorkerConfiguration, canonicalSqlitePath: string) {
    this.sqlitePath = configuration.sqlitePath;
    this.canonicalSqlitePath = canonicalSqlitePath;
    this.readOnly = configuration.readOnly;
    this.busyTimeoutMs = configuration.busyTimeoutMs;
  }

  get hasWorker(): boolean {
    return this.worker !== undefined;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  get hasActiveRequest(): boolean {
    return this.active !== undefined;
  }

  enqueue<T>(command: SqliteStateCommand, timeoutMs: number): Promise<T> {
    if (this.closing) {
      return Promise.reject(new SqliteStateWorkerError("sqlite state worker lane is closing", command.kind));
    }
    return new Promise<T>((resolve, reject) => {
      const request: PendingSqliteStateCommand = {
        requestId: ++nextRequestId,
        command,
        timeoutMs,
        resolve: (value) => resolve(value as T),
        reject,
        timeout: setTimeout(() => this.onRequestTimeout(request), timeoutMs),
        settled: false,
      };
      this.queue.push(request);
      this.pump();
    });
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) {
      return this.closePromise;
    }
    this.closing = true;
    this.closePromise = new Promise<void>((resolve) => {
      this.closeResolve = resolve;
    });
    this.pump();
    return this.closePromise;
  }

  private pump(): void {
    if (this.restartPromise !== undefined || this.active !== undefined || this.closeRequested) {
      return;
    }
    while (this.queue[0]?.settled === true) {
      this.queue.shift();
    }
    if (this.queue.length === 0) {
      if (this.closing) {
        this.beginClose();
      } else {
        this.worker?.unref();
      }
      return;
    }
    if (this.worker === undefined) {
      this.startWorker();
      return;
    }
    if (!this.ready) {
      return;
    }
    const request = this.queue.shift();
    if (request === undefined) {
      return;
    }
    this.active = request;
    this.worker.ref();
    try {
      this.worker.postMessage({
        type: "command",
        requestId: request.requestId,
        command: request.command,
      } satisfies SqliteStateWorkerRequest);
    } catch (error) {
      this.failCurrentWorker(error, false);
    }
  }

  private startWorker(): void {
    if (this.worker !== undefined || this.restartPromise !== undefined || this.queue.length === 0) {
      return;
    }
    const workerUrl = resolveWorkerUrl();
    const worker = new Worker(workerUrl, {
      ...(workerUrl.pathname.endsWith(".ts") ? { execArgv: ["--import", "tsx"] } : {}),
      workerData: {
        sqlitePath: this.sqlitePath,
        busyTimeoutMs: this.busyTimeoutMs,
        readOnly: this.readOnly,
      } satisfies SqliteStateWorkerConfiguration,
    });
    const generation = ++this.generation;
    createdWorkerCount += 1;
    this.worker = worker;
    this.ready = false;
    worker.ref();
    worker.on("message", (message: unknown) => this.onWorkerMessage(worker, generation, message));
    worker.on("error", (error) => this.onWorkerError(worker, generation, error));
    worker.on("exit", (code) => this.onWorkerExit(worker, generation, code));
  }

  private onWorkerMessage(worker: Worker, generation: number, message: unknown): void {
    if (this.worker !== worker || this.generation !== generation || !isWorkerResponse(message)) {
      if (this.worker === worker && this.generation === generation) {
        this.failCurrentWorker(new Error("Invalid sqlite state worker response"), false);
      }
      return;
    }
    if (message.type === "ready") {
      if (this.ready) {
        this.failCurrentWorker(new Error("Duplicate sqlite state worker ready response"), false);
        return;
      }
      this.ready = true;
      this.pump();
      return;
    }
    if (message.type === "initialization-error") {
      this.failCurrentWorker(
        new SqliteStateWorkerError(message.error.message, this.queue[0]?.command.kind ?? "initialize", message.error.stack),
        true,
      );
      return;
    }
    if (message.type === "closed") {
      if (!this.closeRequested) {
        this.failCurrentWorker(new Error("Unexpected sqlite state worker close response"), false);
      }
      return;
    }
    const request = this.active;
    if (request === undefined || request.requestId !== message.requestId) {
      this.failCurrentWorker(new Error("Mismatched sqlite state worker response"), false);
      return;
    }
    this.active = undefined;
    if (message.ok) {
      this.resolveRequest(request, message.result);
      this.pump();
      return;
    }
    const error = new SqliteStateWorkerError(
      message.error.message,
      request.command.kind,
      message.error.stack,
    );
    this.rejectRequest(request, error);
    this.failCurrentWorker(error, false);
  }

  private onWorkerError(worker: Worker, generation: number, error: Error): void {
    if (this.worker !== worker || this.generation !== generation) {
      return;
    }
    this.failCurrentWorker(error, false);
  }

  private onWorkerExit(worker: Worker, generation: number, code: number): void {
    if (this.worker !== worker || this.generation !== generation) {
      return;
    }
    if (this.closeRequested) {
      this.worker = undefined;
      this.ready = false;
      this.finishClose();
      return;
    }
    this.failCurrentWorker(
      new SqliteStateWorkerError(
        `sqlite state worker exited before response: ${String(code)}`,
        this.active?.command.kind ?? this.queue[0]?.command.kind ?? "idle",
      ),
      false,
      true,
    );
  }

  private onRequestTimeout(request: PendingSqliteStateCommand): void {
    if (request.settled) {
      return;
    }
    const error = new SqliteStateTimeoutError(request.command.kind, request.timeoutMs);
    if (this.active === request) {
      this.active = undefined;
      this.rejectRequest(request, error);
      this.failCurrentWorker(error, false);
      return;
    }
    const index = this.queue.indexOf(request);
    if (index >= 0) {
      this.queue.splice(index, 1);
      this.rejectRequest(request, error);
      this.pump();
    }
  }

  private failCurrentWorker(error: unknown, rejectQueued: boolean, alreadyExited = false): void {
    const worker = this.worker;
    if (worker === undefined) {
      return;
    }
    this.worker = undefined;
    this.ready = false;
    this.closeRequested = false;
    if (this.active !== undefined) {
      const active = this.active;
      this.active = undefined;
      this.rejectRequest(active, asWorkerError(error, active.command.kind));
    }
    if (rejectQueued) {
      for (const request of this.queue.splice(0)) {
        this.rejectRequest(request, asWorkerError(error, request.command.kind));
      }
    }
    this.restartPromise = alreadyExited
      ? Promise.resolve()
      : worker.terminate().then(() => undefined, () => undefined);
    void this.restartPromise.finally(() => {
      this.restartPromise = undefined;
      this.pump();
    });
  }

  private beginClose(): void {
    if (this.worker === undefined) {
      if (this.restartPromise === undefined) {
        this.finishClose();
      }
      return;
    }
    if (!this.ready) {
      return;
    }
    this.closeRequested = true;
    this.worker.ref();
    this.closeTimeout = setTimeout(() => {
      const worker = this.worker;
      this.worker = undefined;
      this.ready = false;
      this.closeRequested = false;
      if (worker === undefined) {
        this.finishClose();
        return;
      }
      void worker.terminate().finally(() => this.finishClose());
    }, LOCAL_CONSOLE_STORE_TIMEOUT_MS);
    try {
      this.worker.postMessage({ type: "close" } satisfies SqliteStateWorkerRequest);
    } catch {
      const worker = this.worker;
      this.worker = undefined;
      this.ready = false;
      this.closeRequested = false;
      void worker?.terminate().finally(() => this.finishClose());
    }
  }

  private finishClose(): void {
    if (this.closeTimeout !== undefined) {
      clearTimeout(this.closeTimeout);
      this.closeTimeout = undefined;
    }
    this.closeRequested = false;
    this.closeResolve?.();
    this.closeResolve = undefined;
  }

  private resolveRequest(request: PendingSqliteStateCommand, value: unknown): void {
    if (request.settled) {
      return;
    }
    request.settled = true;
    clearTimeout(request.timeout);
    request.resolve(value);
  }

  private rejectRequest(request: PendingSqliteStateCommand, error: unknown): void {
    if (request.settled) {
      return;
    }
    request.settled = true;
    clearTimeout(request.timeout);
    request.reject(error);
  }
}

function laneKey(sqlitePath: string, readOnly: boolean, busyTimeoutMs: number): string {
  return JSON.stringify([sqlitePath, readOnly, busyTimeoutMs]);
}

function canonicalizeSqlitePath(sqlitePath: string): string {
  let candidate = path.resolve(sqlitePath);
  const missingSegments: string[] = [];
  while (true) {
    try {
      const realPath = fs.realpathSync.native(candidate);
      return path.join(realPath, ...missingSegments.reverse());
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
      const parent = path.dirname(candidate);
      if (parent === candidate) {
        return path.resolve(sqlitePath);
      }
      missingSegments.push(path.basename(candidate));
      candidate = parent;
    }
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
    && "code" in error
    && ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR");
}

function asWorkerError(error: unknown, commandKind: string): SqliteStateWorkerError {
  if (error instanceof SqliteStateWorkerError) {
    return error.commandKind === commandKind
      ? error
      : new SqliteStateWorkerError(error.message, commandKind, error.workerStack);
  }
  return new SqliteStateWorkerError(
    error instanceof Error ? error.message : String(error),
    commandKind,
    error instanceof Error ? error.stack : undefined,
  );
}

function isWorkerResponse(value: unknown): value is SqliteStateWorkerResponse {
  if (typeof value !== "object" || value === null || typeof (value as { type?: unknown }).type !== "string") {
    return false;
  }
  const response = value as Partial<SqliteStateWorkerResponse>;
  if (response.type === "ready" || response.type === "closed") {
    return true;
  }
  if (response.type === "initialization-error") {
    return isSerializedWorkerError(response.error);
  }
  if (response.type !== "result" || typeof response.requestId !== "number" || typeof response.ok !== "boolean") {
    return false;
  }
  return response.ok || isSerializedWorkerError((response as { error?: unknown }).error);
}

function isSerializedWorkerError(value: unknown): value is { message: string; stack?: string } {
  return typeof value === "object"
    && value !== null
    && typeof (value as { message?: unknown }).message === "string"
    && ((value as { stack?: unknown }).stack === undefined || typeof (value as { stack?: unknown }).stack === "string");
}
