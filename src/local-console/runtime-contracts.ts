import type { CodexRunOptions, CodexRunResult } from "../codex.js";
import type {
  ClaudeRunOptions,
  ClaudeTuiNativePromptSelectionInput,
  ClaudeTuiNativePromptSelectionResult,
} from "../claude.js";
import type { LocalConsoleAgentFile } from "./agent-file.js";
import type { LocalAttachmentManager } from "./attachments.js";
import type { LocalExecutionRunner, PiExecutionRunOptions } from "./execution-driver.js";
import type { ManagedProcessMcpInvocation } from "./execution-driver.js";
import type { LocalRouteJudgment } from "./route-bus.js";
import type {
  LocalConsoleAgentTeamOwnership,
  LocalConsoleAgentTeamSnapshot,
  LocalConsoleEntryTemplate,
  LocalConsoleExecutionProfile,
  LocalConsoleSessionSummary,
  LocalConsoleStore,
  LocalConsoleTextFragment,
  LocalConsoleWorkspaceMode,
  LocalConsoleWritePolicy,
} from "./types.js";

export interface LocalConsoleRuntimeOptions {
  store: LocalConsoleStore;
  listAgentFiles(sessionId: string): Promise<LocalConsoleAgentFile[]>;
  loadAgentTeamSnapshot?(binding: {
    ownership: LocalConsoleAgentTeamOwnership;
    id: string;
  }): Promise<LocalConsoleAgentTeamSnapshot>;
  resolveAgentTeamHealth?(session: LocalConsoleSessionSummary): Promise<{
    health: "usable" | "deleted" | "needs-repair";
    reason: string | null;
  }>;
  runCodex(options: CodexRunOptions): Promise<CodexRunResult>;
  runClaude?(options: ClaudeRunOptions): Promise<CodexRunResult>;
  selectClaudeNativePrompt?(input: ClaudeTuiNativePromptSelectionInput): ClaudeTuiNativePromptSelectionResult;
  claudeOwnsManagedProcess?: boolean;
  claudeReportsProcessStart?: boolean;
  runExecution?: LocalExecutionRunner;
  runPi?: (options: PiExecutionRunOptions) => Promise<CodexRunResult>;
  /** 新会话首条消息后的自动标题生成（默认 true；测试基建可关闭以避免干扰执行 spy）。 */
  enableSessionTitleGeneration?: boolean;
  createManagedProcessMcp?(input: { sessionId: string; providerRunId: string; workspaceRoot: string }): ManagedProcessMcpInvocation | Promise<ManagedProcessMcpInvocation>;
  getManagedProcessRunningCount?(): number;
  beforeStoreClose?(): Promise<void>;
  makeRunDir(count: number, now?: Date): string;
  dataRoot?: string;
  projectRoot: string;
  workdirRoot: string;
  sessionId?: string;
  storeTimeoutMs?: number;
  codexIdleTimeoutMs?: number;
  toolInFlightTimeoutMs?: number;
  codexMaxDurationMs?: number;
  workspaceGitTimeoutMs?: number;
  staleRunningGraceMs?: number;
  routeJudgment?: LocalRouteJudgment;
  routeTimeoutMs?: number;
  failureRetryLimit?: number;
  attachmentManager?: LocalAttachmentManager;
  isCodexThreadAvailable?(threadId: string): Promise<boolean>;
  now?(): Date;
}

export interface LocalSessionCreationMetadata {
  originSessionId?: string | null;
  analysisParentSessionId?: string | null;
  entryTemplate?: LocalConsoleEntryTemplate | null;
  writePolicy?: LocalConsoleWritePolicy;
  textFragments?: LocalConsoleTextFragment[];
  attachmentDraftKey?: string;
}

export type LocalProjectCreateInput = { folderPath: string; worktreeMode: boolean };
export type LocalProjectUpdateInput = { projectId: string; worktreeMode: boolean };
export type LocalProjectRepairInput = { projectId: string; folderPath: string };
export type LocalProjectRenameInput = { projectId: string; title: string };
export type LocalProjectRemoveInput = { projectId: string; force: boolean };
export type LocalSessionMoveInput = { sessionId: string; projectId: string };
export type LocalSessionWorkspaceSwitchInput = { sessionId: string; workspaceMode: LocalConsoleWorkspaceMode };
export type LocalSessionTeamSwitchInput = {
  sessionId: string;
  agentTeamOwnership: LocalConsoleAgentTeamOwnership;
  agentTeamId: string;
};
export type LocalSessionMemberExecutionUpdateInput = {
  sessionId: string;
  memberName: string;
  action: "migrate" | "end";
  executionProfile?: import("./types.js").LocalConsoleExecutionProfile;
};
export type LocalSessionSearchInput = { query: string; includeArchived: boolean };
export type LocalSessionReferenceInput = {
  sessionId: string;
  scope: import("./types.js").LocalConsoleSessionReferenceScope;
  runId?: string | null;
  messageId?: number | null;
};
export type LocalChildSessionCreateInput = {
  parentSessionId: string;
  childSessionId: string;
  projectId: string;
  title: string;
  relation?: string;
  hiddenKey: string;
  initialBody: string;
  initialRole?: string | null;
};
export type LocalPendingMessageInput = { sessionId: string; messageId: number };
export type LocalPendingMessageUpdateInput = LocalPendingMessageInput & { body: string };
export type LocalRunRetryInput = {
  sessionId: string;
  runId: string;
  executionOverride?: {
    overrideId: string;
    profile: LocalConsoleExecutionProfile;
    scope: "single-run";
  };
};
export type LocalRunIdentityInput = { sessionId: string; runId: string };
export type LocalSessionResultReadInput = { sessionId: string; unreadSince: string };
export type LocalSessionReadStateInput = {
  sessionId: string;
  action: "mark-read-attention" | "mark-read-unread" | "mark-unread";
  expectedAttentionRevision: number;
  expectedReadStateRevision: number;
  expectedTitleRevision: number;
  isCurrent: boolean;
};
export type LocalSessionPinInput = {
  sessionId: string;
  pinned: boolean;
  expectedPinnedAt: string | null;
};
export type LocalSessionRenameInput = {
  sessionId: string;
  title: string;
  expectedTitleRevision: number;
};
export type LocalFileReferenceInput = {
  filePath: string;
  line: number;
  column: number | null;
  hasExplicitLine: boolean;
};
