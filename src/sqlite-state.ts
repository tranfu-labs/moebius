import path from "node:path";
import { Worker } from "node:worker_threads";
import { LOCAL_CONSOLE_SQLITE_BUSY_TIMEOUT_MS, LOCAL_CONSOLE_STORE_TIMEOUT_MS } from "./config.js";

export type SqliteStateSource = "role-threads" | "agent-contexts" | "github-intake" | "goal-ledger";

export type SqliteStateCommand =
  | { kind: "get-migration-status"; source: SqliteStateSource }
  | { kind: "import-role-threads"; store: unknown; legacyDigest: string | null }
  | { kind: "load-role-threads" }
  | { kind: "save-role-threads"; store: unknown }
  | { kind: "save-role-thread-entry"; issueKey: string; role: string; state: unknown }
  | { kind: "import-agent-contexts"; store: unknown; legacyDigest: string | null }
  | { kind: "load-agent-contexts" }
  | { kind: "save-agent-contexts"; store: unknown }
  | { kind: "save-agent-context-entry"; issueKey: string; role: string; state: unknown }
  | { kind: "import-github-intake"; state: unknown; legacyDigest: string | null }
  | { kind: "load-github-intake" }
  | { kind: "save-github-intake"; state: unknown }
  | { kind: "import-goal-ledger"; state: unknown; legacyDigest: string | null }
  | { kind: "load-goal-ledger" }
  | { kind: "save-goal-ledger"; state: unknown }
  | { kind: "local-init" }
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
      agentTeamSnapshot?: {
        members: Array<{
          name: string;
          agentMarkdown: string;
          executionProfile?: { cli: "codex" | "kimi"; model: string; effort: string } | null;
        }>;
      };
      now: string;
    }
  | { kind: "local-apply-pending-session-context"; sessionId: string; now: string }
  | { kind: "local-list-session-agent-team-snapshot"; sessionId: string }
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
      agentTeamSnapshot?: {
        members: Array<{
          name: string;
          agentMarkdown: string;
          executionProfile?: { cli: "codex" | "kimi"; model: string; effort: string } | null;
        }>;
      };
      workspaceMode?: "direct" | "worktree";
      initialMessage?: string;
      initialAttachmentIds?: string[];
      attachmentDraftKey?: string;
      baselineCommit?: string | null;
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
  | { kind: "local-mark-session-result-read"; sessionId: string; unreadSince: string; now: string }
  | {
      kind: "local-append-user";
      sessionId: string;
      body: string;
      attachmentIds?: string[];
      attachmentDraftKey?: string;
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
  | { kind: "local-claim-next"; sessionId: string; runId: string; now: string }
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
  | { kind: "local-release-message-for-resume"; userMessageId: number; sessionId: string; now: string }
  | {
      kind: "local-record-agent-response";
      userMessageId: number;
      sessionId: string;
      role: string;
      body: string;
      runId: string;
      runDir: string;
      now: string;
    }
  | {
      kind: "local-record-detached-agent-response";
      sessionId: string;
      role: string;
      body: string;
      runId: string;
      runDir: string;
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
    }
  | {
      kind: "local-record-interrupted";
      userMessageId: number;
      sessionId: string;
      reason: string;
      interruptionKind?: "user" | "redirect" | "context-unavailable";
      runId: string | null;
      runDir: string | null;
      now: string;
    }
  | {
      kind: "local-record-stuck";
      userMessageId: number;
      sessionId: string;
      reason: string;
      runId: string | null;
      runDir: string | null;
      now: string;
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
  | { kind: "local-mark-stale-running"; sessionId: string; cutoffIso: string; now: string; reason: string };

export interface SqliteStateCommandOptions {
  sqlitePath: string;
  command: SqliteStateCommand;
  timeoutMs?: number;
  busyTimeoutMs?: number;
  readOnly?: boolean;
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
  const workerUrl = resolveWorkerUrl();
  const worker = new Worker(workerUrl, {
    ...(workerUrl.pathname.endsWith(".ts") ? { execArgv: ["--import", "tsx"] } : {}),
    workerData: {
      sqlitePath: path.resolve(options.sqlitePath),
      busyTimeoutMs,
      command: options.command,
      readOnly: options.readOnly ?? false,
    },
  });

  let timeout: NodeJS.Timeout | undefined;
  let settled = false;

  try {
    return await new Promise<T>((resolve, reject) => {
      timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        void worker.terminate();
        reject(new SqliteStateTimeoutError(options.command.kind, timeoutMs));
      }, timeoutMs);

      worker.once("message", (message: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        if (isWorkerSuccess(message)) {
          resolve(message.result as T);
          return;
        }
        if (isWorkerFailure(message)) {
          reject(new SqliteStateWorkerError(message.error.message, options.command.kind, message.error.stack));
          return;
        }
        reject(new SqliteStateWorkerError("Invalid sqlite state worker response", options.command.kind));
      });

      worker.once("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      });

      worker.once("exit", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(new SqliteStateWorkerError(`sqlite state worker exited before response: ${String(code)}`, options.command.kind));
      });
    });
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    if (!settled) {
      void worker.terminate();
    }
  }
}

function resolveWorkerUrl(): URL {
  return new URL(import.meta.url.endsWith(".ts") ? "./sqlite-state-worker.ts" : "./sqlite-state-worker.js", import.meta.url);
}

function isWorkerSuccess(value: unknown): value is { ok: true; result: unknown } {
  return typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === true;
}

function isWorkerFailure(value: unknown): value is { ok: false; error: { message: string; stack?: string } } {
  if (typeof value !== "object" || value === null || (value as { ok?: unknown }).ok !== false) {
    return false;
  }
  const error = (value as { error?: unknown }).error;
  return typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string";
}
