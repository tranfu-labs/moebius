import { runSqliteStateCommand } from "../sqlite-state.js";
import { planRuntimeFallback } from "./runtime-domain.js";

export interface LocalT5CommandOptions {
  sqlitePath: string;
  busyTimeoutMs?: number;
  timeoutMs?: number;
}

export interface LocalT5Facts {
  routeDecisions: unknown[];
  acceptanceFacts: unknown[];
  integrationEvents: unknown[];
  deadLetters: unknown[];
  workspaceDiffs: unknown[];
  sessionEdges: unknown[];
}

export async function recordLocalRouteDecision(
  options: LocalT5CommandOptions,
  input: {
    sessionId: string;
    messageId: number;
    routeKey: string;
    outcome: "append" | "no_action" | "fail_open" | "dead_letter";
    targetRole?: string | null;
    reason: string;
    now: string;
  },
): Promise<void> {
  await runLocalT5Command(options, {
    kind: "local-record-route-decision",
    ...input,
    targetRole: planRuntimeFallback(input.targetRole, null as string | null),
  });
}

export async function recordLocalDeadLetter(
  options: LocalT5CommandOptions,
  input: {
    sessionId: string;
    sourceMessageId: number;
    failureCount: number;
    reason: string;
    recovered: boolean;
    now: string;
  },
): Promise<void> {
  await runLocalT5Command(options, {
    kind: "local-record-dead-letter",
    ...input,
  });
}

export async function recordLocalWorkspaceDiff(
  options: LocalT5CommandOptions,
  input: {
    sessionId: string;
    runId: string;
    originalRepoRoot?: string | null;
    baseRef: string;
    branchName: string;
    worktreePath: string;
    patchPath: string;
    affectedFiles?: string[];
    status: "generated" | "applied" | "failed" | "abandoned" | "rolled_back";
    error?: string | null;
    now: string;
  },
): Promise<void> {
  await runLocalT5Command(options, {
    kind: "local-record-workspace-diff",
    sessionId: input.sessionId,
    runId: input.runId,
    originalRepoRoot: input.originalRepoRoot ?? null,
    baseRef: input.baseRef,
    branchName: input.branchName,
    worktreePath: input.worktreePath,
    patchPath: input.patchPath,
    affectedFilesJson: JSON.stringify(input.affectedFiles ?? []),
    status: input.status,
    error: input.error ?? null,
    now: input.now,
  });
}

export async function listLocalT5Facts(
  options: LocalT5CommandOptions,
  sessionId: string | null = null,
): Promise<LocalT5Facts> {
  return await runLocalT5Command<LocalT5Facts>(options, {
    kind: "local-list-t5-facts",
    sessionId,
  });
}

async function runLocalT5Command<T = void>(
  options: LocalT5CommandOptions,
  command: Parameters<typeof runSqliteStateCommand>[0]["command"],
): Promise<T> {
  return await runSqliteStateCommand<T>({
    sqlitePath: options.sqlitePath,
    command,
    ...(options.busyTimeoutMs === undefined ? {} : { busyTimeoutMs: options.busyTimeoutMs }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
}
