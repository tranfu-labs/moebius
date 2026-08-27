import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { LOCAL_LONG_RUN_REPORT_MS } from "../config.js";
import { loadCeoScripts } from "../ceo-scripts.js";
import {
  executionInterruptionCauseForResult,
  executionTimeoutKind,
  isInterruptedCodexRunResult,
} from "../codex.js";
import { log } from "../log.js";
import type { LocalConsoleAgentFile } from "./agent-file.js";
import { listLocalChildSessionSummaries } from "./child-session-summary-reader.js";
import { readLocalCodexRecoveryFacts } from "./codex-resume.js";
import { resolveCodexRollout } from "./codex-rollout.js";
import { readCodexThreadLinks } from "./codex-thread-link-reader.js";
import {
  readExecutionSessionLinks,
  readRunExecutionContexts,
} from "./execution-context-reader.js";
import {
  listLocalWorkspaceFiles,
  readLocalFileReference,
  readLocalWorkspaceTextFile,
} from "./file-read.js";
import { readLocalAgentImageSource } from "./agent-image-source.js";
import { localProcessFactReader } from "./process-fact-reader.js";
import { localProcessTraceReader } from "./process-trace-reader.js";
import { readLocalConsoleOutputTail } from "./output-tail.js";
import {
  defaultLocalRouteJudgment,
  validateLocalRouteAppend,
} from "./local-route-adapter.js";
import { readLocalRunRecoverySnapshot } from "./run-recovery-reader.js";
import type { LocalConsoleRuntimeOptions } from "./runtime-contracts.js";
import {
  planRuntimeFallback,
  requireAgentFilePath,
} from "./runtime-domain.js";
import {
  directoryAvailable,
  fileAvailable,
  readOptionalTextFile,
} from "./runtime-file-support.js";
import type { LocalConsoleStorePorts } from "./runtime-store-ports.js";
import {
  readLocalConversationBaselineCommit,
  readLocalConversationDiffFile,
  readLocalConversationWorkspaceDiff,
  readLocalConversationWorkspaceDiffDetail,
} from "./workspace-diff.js";
import {
  generateLocalWorkspaceDiff,
  invalidateLocalWorkspaceFacts,
  localSessionWorktreePath,
  readCachedLocalWorkspaceFacts,
  readLocalGitStatus,
  resolveExistingLocalWorkspaceBinding,
  resolveLocalWorkspaceSource,
  resolveLocalWorkspaceTarget,
} from "./workspace-source.js";

export function createLocalRuntimeAdapters(input: {
  options: LocalConsoleRuntimeOptions;
  storePorts: LocalConsoleStorePorts;
  storeTimeoutMs: number;
}) {
  const { options } = input;
  const readWorkspaceFacts = async (folderPath: string) => await readCachedLocalWorkspaceFacts({
    folderPath,
    gitTimeoutMs: options.workspaceGitTimeoutMs,
  });
  return {
    randomId: () => crypto.randomUUID(),
    report: (event: { event: string; [key: string]: unknown }) => log(event),
    worktreePath: localSessionWorktreePath,
    readWorkspaceDiff: readLocalConversationWorkspaceDiff,
    readGitStatus: readLocalGitStatus,
    generateWorkspaceDiff: generateLocalWorkspaceDiff,
    resolveWorkspaceSource: resolveLocalWorkspaceSource,
    directoryAvailable,
    fileAvailable,
    readWorkspaceFacts,
    readRecoveryFacts: readLocalCodexRecoveryFacts,
    readOutputTail: readLocalConsoleOutputTail,
    longRunReportMs: LOCAL_LONG_RUN_REPORT_MS,
    timeoutKind: executionTimeoutKind,
    interrupted: isInterruptedCodexRunResult,
    interruptionCause: executionInterruptionCauseForResult,
    defaultLocalRouteJudgment,
    validateLocalRouteAppend,
    readAgentFile: async (agent: LocalConsoleAgentFile) =>
      await fs.readFile(requireAgentFilePath(agent), "utf8"),
    loadRecoverySnapshot: async (sessionId: string) => await readLocalRunRecoverySnapshot({
      factLogPath: planRuntimeFallback(
        input.storePorts.recoveryFacts()?.getSessionFactLogPath(sessionId),
        null as string | null,
      ),
      sessionId,
    }),
    isCodexThreadAvailable: planRuntimeFallback(
      options.isCodexThreadAvailable,
      async (threadId: string) => (await resolveCodexRollout(threadId)).status === "available",
    ),
    invalidateWorkspace: invalidateLocalWorkspaceFacts,
    resolveWorkspaceTarget: resolveLocalWorkspaceTarget,
    resolveExistingWorkspaceBinding: resolveExistingLocalWorkspaceBinding,
    readExecutionSessionLinks,
    readCodexThreadLinks,
    readRunExecutionContexts,
    readBaselineCommit: async (folderPath: string) => await readLocalConversationBaselineCommit({
      folderPath,
      gitTimeoutMs: options.workspaceGitTimeoutMs,
    }),
    listChildSessions: async (parentSessionId: string) => await listLocalChildSessionSummaries({
      sqlitePath: options.store.sqlitePath,
      timeoutMs: input.storeTimeoutMs,
    }, parentSessionId),
    readOptionalTextFile,
    factReader: localProcessFactReader,
    traceReader: localProcessTraceReader,
    readDiff: async (context: { workspacePath: string; baselineCommit: string | null }) =>
      await readLocalConversationWorkspaceDiffDetail({
        workspacePath: context.workspacePath,
        baselineCommit: context.baselineCommit,
        gitTimeoutMs: options.workspaceGitTimeoutMs,
      }),
    listFiles: listLocalWorkspaceFiles,
    readDiffFile: async (
      context: { workspacePath: string; baselineCommit: string | null },
      filePath: string,
    ) => await readLocalConversationDiffFile({
      workspacePath: context.workspacePath,
      baselineCommit: context.baselineCommit,
      filePath,
      gitTimeoutMs: options.workspaceGitTimeoutMs,
    }),
    readWorkspaceFile: async (workspacePath: string, filePath: string) =>
      await readLocalWorkspaceTextFile({ workspacePath, filePath }),
    readFileReference: readLocalFileReference,
    readAgentImageSource: readLocalAgentImageSource,
    loadCeoScripts: async () => await loadCeoScripts({
      agentsDir: path.join(options.projectRoot, "agents"),
      required: false,
    }),
  };
}

export type LocalRuntimeAdapters = ReturnType<typeof createLocalRuntimeAdapters>;
