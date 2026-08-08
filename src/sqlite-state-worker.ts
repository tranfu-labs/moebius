import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";
import { parseIssueKey } from "./session-key.js";
import { parseAgentMentions } from "./conversation.js";
import {
  LOCAL_CONSOLE_DEFAULT_SESSION_ID,
  LOCAL_CONSOLE_PROJECT_ID,
  LOCAL_CONSOLE_PROJECT_SOURCE_TYPE,
  type LocalConsoleAgentTeamSnapshot,
  type LocalConsoleSessionSummary,
  type LocalConsoleSystemEventKind,
  type LocalConsoleTerminal,
  type MoveEmptySessionResult,
} from "./local-console/types.js";
import type {
  SqliteStateCommand,
  SqliteStateWorkerConfiguration,
  SqliteStateWorkerRequest,
  SqliteStateWorkerResponse,
} from "./sqlite-state.js";
import { serializeTextFragmentReferences } from "./local-console/session-reference-text.js";
import { appendSessionFactLogLineSync, canonicalJson } from "./local-console/session-fact-log.js";
import {
  normalizeProviderModel,
  normalizeProviderProfile,
  type ProviderOperation,
  type ProviderProfile,
  type ProviderReference,
  formatProviderSessionReferenceOwner,
} from "./provider-profile.js";
import {
  assertCompleteProjectOrder,
  assertProjectRemovalIdle,
  decideDefaultProjectIdentity,
  decideDefaultSessionIdentity,
  planPersistedProjectTitle,
} from "./local-console/project-command-plan.js";
import {
  assertSessionArchiveIdle,
  assertSessionWorkspaceMutable,
  planArchivedSessionSelection,
  planPendingTeamPromotion,
  planSessionTeamWrite,
} from "./local-console/session-settings-plan.js";
import { planPersistedSessionTeamPromotion } from "./local-console/session-team-update-plan.js";
import {
  assertAnalysisParent,
  assertChildProject,
  planChildAgentTeam,
  planInitialDispatchRole,
} from "./local-console/session-creation-plan.js";
import {
  decidePendingAttentionState,
  planPendingAttentionRunningCount,
  planSessionSearchMatch,
} from "./local-console/state-query-plan.js";
import {
  planFallbackSessionTitle,
  planPersistedSessionTitle,
} from "./local-console/session-presentation-plan.js";
import {
  assertAttachmentCloneTarget,
  planAttachmentContentScopeValue,
  planAttachmentDraftKey,
} from "./local-console/attachment-plan.js";
import { assertUserDirectResumeIdentity } from "./local-console/startup-recovery-plan.js";
import {
  decidePendingControlWorkInspection,
  planHasPendingControlWork,
} from "./local-console/pending-processing-plan.js";

interface SqliteRunResult {
  changes?: number | bigint;
  lastInsertRowid?: number | bigint;
}

interface SqliteStatement {
  run(...params: unknown[]): SqliteRunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SqliteDatabase {
  readonly isTransaction: boolean;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface WorkerInput extends SqliteStateWorkerConfiguration {
  command: SqliteStateCommand;
}

interface WorkerLocalMessage {
  id: number;
  sessionId: string;
  speaker: string;
  role: string | null;
  body: string;
  status: string;
  runId: string | null;
  runDir: string | null;
  error: string | null;
  systemEventKind: LocalConsoleSystemEventKind;
  terminal?: LocalConsoleTerminal | null;
  failureCount: number;
  lastFailureReason: string | null;
  sourceKind: string | null;
  sourceId: string | null;
  attachments?: unknown[];
  textFragments?: unknown[];
  activatedAt: string | null;
  dispatchLane: "primary" | "worker" | "awaiting-team" | null;
  dispatchRole: string | null;
  dispatchReason: "single-valid-mention" | "no-valid-mention" | "multiple-valid-mentions" | null;
  createdAt: string;
  updatedAt: string;
}

const SESSION_FACT_MIGRATION_VERSION = "session-jsonl-fact-log-v1";

const configuration = workerData as SqliteStateWorkerConfiguration;
if (parentPort === null) {
  throw new Error("sqlite state worker requires a parent port");
}
const port = parentPort;

let database: DatabaseSync | undefined;
try {
  if (!configuration.readOnly) {
    fs.mkdirSync(path.dirname(configuration.sqlitePath), { recursive: true });
  }
  database = new DatabaseSync(configuration.sqlitePath, { readOnly: configuration.readOnly });
  database.exec(`PRAGMA busy_timeout = ${String(configuration.busyTimeoutMs)}`);
  database.exec("PRAGMA foreign_keys = ON");
  if (!configuration.readOnly) {
    ensureSchema(database, configuration.sqlitePath);
    // Some legacy table-rebuild migrations intentionally preserve only the columns
    // known at that migration boundary. A second idempotent pass reaches the same
    // fixed point that consecutive one-shot workers previously guaranteed.
    ensureSchema(database, configuration.sqlitePath);
    migrateLocalMessages(database);
  }
  port.on("message", (message: unknown) => handleWorkerRequest(message));
  postResponse({ type: "ready" });
} catch (error) {
  database?.close();
  database = undefined;
  postResponse({ type: "initialization-error", error: serializeError(error) });
  port.close();
}

function handleWorkerRequest(message: unknown): void {
  if (!isWorkerRequest(message)) {
    postResponse({
      type: "result",
      requestId: readRequestId(message),
      ok: false,
      error: serializeError(new Error("Invalid sqlite state worker request")),
    });
    return;
  }
  if (message.type === "close") {
    database?.close();
    database = undefined;
    postResponse({ type: "closed" });
    port.close();
    return;
  }
  if (database === undefined) {
    postResponse({
      type: "result",
      requestId: message.requestId,
      ok: false,
      error: serializeError(new Error("sqlite state worker database is not initialized")),
    });
    return;
  }
  try {
    const result = runCommand(database, { ...configuration, command: message.command });
    postResponse({ type: "result", requestId: message.requestId, ok: true, result });
  } catch (error) {
    postResponse({ type: "result", requestId: message.requestId, ok: false, error: serializeError(error) });
  }
}

function postResponse(response: SqliteStateWorkerResponse): void {
  port.postMessage(response);
}

function serializeError(error: unknown): { message: string; stack?: string } {
  return {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
}

function isWorkerRequest(value: unknown): value is SqliteStateWorkerRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if ((value as { type?: unknown }).type === "close") {
    return true;
  }
  return (value as { type?: unknown }).type === "command"
    && typeof (value as { requestId?: unknown }).requestId === "number"
    && typeof (value as { command?: { kind?: unknown } }).command?.kind === "string";
}

function readRequestId(value: unknown): number {
  return typeof value === "object"
    && value !== null
    && typeof (value as { requestId?: unknown }).requestId === "number"
    ? (value as { requestId: number }).requestId
    : -1;
}

function runCommand(database: SqliteDatabase, input: WorkerInput): unknown {
    switch (input.command.kind) {
      case "local-init":
        return initLocalConsole(database);
      case "provider-list-profiles":
        return listProviderProfiles(database);
      case "provider-get-profile":
        return getProviderProfile(database, input.command.profileId);
      case "provider-put-profile":
        return putProviderProfile(database, input.command.profile, input.command.expectedRevision);
      case "provider-commit-profile-operation":
        return commitProviderProfileOperation(
          database,
          input.command.profile,
          input.command.expectedRevision,
          input.command.operation,
        );
      case "provider-delete-profile":
        return deleteProviderProfile(database, input.command.profileId, input.command.expectedRevision);
      case "provider-list-operations":
        return listProviderOperations(database, input.command.profileId);
      case "provider-put-operation":
        return putProviderOperation(database, input.command.operation);
      case "provider-list-session-references":
        return listProviderSessionReferences(database, input.command.profileId);
      case "local-session-fact-migration-status":
        return sessionFactMigrationStatus(database);
      case "local-complete-session-fact-migration":
        return completeSessionFactMigration(database, input.command.now);
      case "local-list-session-message-indexes":
        return listSessionMessageIndexes(database);
      case "local-rebuild-session-message-index":
        return rebuildSessionMessageIndex(database, input.command.sessionId, input.command.messages);
      case "local-rebuild-execution-index":
        return rebuildExecutionIndex(
          database,
          input.command.sessionId,
          input.command.contexts,
          input.command.links,
        );
      case "local-index-run-execution-context":
        return indexRunExecutionContext(
          database,
          input.command.sessionId,
          input.command.runId,
          input.command.context,
        );
      case "local-index-execution-session-link":
        return indexExecutionSessionLink(
          database,
          input.command.sessionId,
          input.command.runId,
          input.command.link,
        );
      case "local-find-message-session":
        return findMessageSession(database, input.command.messageId);
      case "local-create-session":
      case "local-create-child-session":
      case "local-record-child-session-card":
      case "local-append-user":
      case "local-update-session-analysis-gate":
      case "local-claim-next":
      case "local-claim-next-worker":
      case "local-resolve-awaiting-user-dispatches":
      case "local-set-run-dir":
      case "local-record-message-processed":
      case "local-record-route-append":
      case "local-record-route-no-action":
      case "local-release-message-for-retry":
      case "local-release-message-for-resume":
      case "local-repair-agent-handoff-resume-source":
      case "local-record-agent-response":
      case "local-record-detached-run-started":
      case "local-record-detached-agent-response":
      case "local-record-detached-run-terminal":
      case "local-record-system-and-complete":
      case "local-record-system":
      case "local-record-failure":
      case "local-record-retryable-failure":
      case "local-record-dead-letter-and-complete":
      case "local-record-interrupted":
      case "local-record-stuck":
      case "local-mark-stale-running":
      case "local-mark-pending-reference-error":
      case "local-update-pending-user":
      case "local-remove-pending-user":
      case "local-update-session-member-execution":
        return rejectDirectSessionMessageWrite(input.command);
      case "local-commit-session-fact-write":
        return commitSessionFactWrite(database, input.command.factCommand, input.command.facts);
      case "local-create-project":
        return createLocalProject(database, input.command);
      case "local-update-project":
        return updateLocalProject(database, input.command);
      case "local-rename-project":
        return renameLocalProject(database, input.command);
      case "local-repair-project-folder":
        return repairLocalProjectFolder(database, input.command);
      case "local-remove-project":
        return removeLocalProject(database, input.command);
      case "local-reorder-projects":
        return reorderLocalProjects(database, input.command.projectIds, defaultLocalProjectFolderPath(input.sqlitePath));
      case "local-list-projects":
        return listLocalProjects(database, defaultLocalProjectFolderPath(input.sqlitePath));
      case "local-get-project":
        return getLocalProject(database, input.command.projectId);
      case "local-get-session-workspace":
        return getLocalSessionWorkspace(database, input.command.sessionId);
      case "local-switch-session-workspace":
        return switchLocalSessionWorkspace(database, input.command);
      case "local-switch-session-team":
        return switchLocalSessionTeam(database, input.command);
      case "local-apply-pending-session-context":
        return applyPendingLocalSessionContext(database, input.command);
      case "local-list-session-agent-team-snapshot":
        return listLocalSessionAgentTeamSnapshot(database, input.command.sessionId);
      case "local-write-session-team-candidate":
        return writeLocalSessionTeamCandidate(database, input.command);
      case "local-read-session-team-update-record":
        return readLocalSessionTeamUpdateRecord(database, input.command.sessionId);
      case "local-begin-session-team-update":
        return beginLocalSessionTeamUpdate(database, input.command);
      case "local-retry-session-team-update":
        return retryLocalSessionTeamUpdate(database, input.command);
      case "local-cancel-session-team-update":
        return cancelLocalSessionTeamUpdate(database, input.command);
      case "local-mark-session-team-update-failed":
        return markLocalSessionTeamUpdateFailed(database, input.command);
      case "local-record-project-workspace-status":
        return recordLocalProjectWorkspaceStatus(database, input.command);
      case "local-move-empty-session":
        return moveEmptyLocalSession(database, input.command);
      case "local-archive-session":
        return archiveLocalSession(database, input.command);
      case "local-restore-session":
        return restoreLocalSession(database, input.command);
      case "local-list-child-session-summary-sources":
        return listChildSessionSummarySources(database, input.command.parentSessionId);
      case "local-list-sessions":
        return listLocalSessions(database);
      case "local-search-sessions":
        return searchLocalSessions(database, input.command);
      case "local-mark-session-result-read":
        return markSessionResultRead(database, input.command);
      case "local-update-session-read-state":
        return updateSessionReadState(database, input.command);
      case "local-arm-session-manual-unread":
        return armSessionManualUnread(database, input.command);
      case "local-mark-session-viewed":
        return markSessionViewed(database, input.command);
      case "local-set-session-pinned":
        return setSessionPinned(database, input.command);
      case "local-rename-session":
        return renameSession(database, input.command);
      case "local-sync-session-continuation-attention":
        return syncSessionContinuationAttention(database, input.command);
      case "local-add-draft-attachment":
        return addDraftAttachment(database, input.command);
      case "local-list-draft-attachments":
        return listDraftAttachments(database, input.command.draftKey);
      case "local-remove-draft-attachment":
        return removeDraftAttachment(database, input.command);
      case "local-clone-message-attachments":
        return cloneMessageAttachments(database, input.command);
      case "local-get-attachment-content-record":
        return getAttachmentContentRecord(database, input.command);
      case "local-list-message-attachment-content-records":
        return listMessageAttachmentContentRecords(database, input.command.messageIds);
      case "local-list-attachment-storage-keys":
        return database.prepare("SELECT storage_key FROM local_attachment_blobs ORDER BY storage_key ASC").all()
          .map((row) => readString((row as Record<string, unknown>).storage_key, "storage_key"));
      case "local-prune-orphan-attachment-blobs":
        return pruneOrphanAttachmentBlobs(database);
      case "local-list":
        return listLocalMessages(database, input.command.sessionId);
      case "local-has-running":
        return hasRunningMessage(database, input.command.sessionId);
      case "local-find-route-decision":
        return findLocalRouteDecision(database, input.command);
      case "local-record-route-decision":
        return recordLocalRouteDecision(database, input.command);
      case "local-record-dead-letter":
        return recordLocalDeadLetter(database, input.command);
      case "local-record-workspace-diff":
        return recordLocalWorkspaceDiff(database, input.command);
      case "local-list-t5-facts":
        return listLocalT5Facts(database, input.command.sessionId);
      default:
        assertNever(input.command);
    }
}

function rejectDirectSessionMessageWrite(command: SqliteStateCommand): never {
  throw new Error(
    `Direct session message write is forbidden by ADR-0004; use local-commit-session-fact-write: ${command.kind}`,
  );
}

function ensureSchema(database: SqliteDatabase, sqlitePath: string): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS legacy_migration_sources (
      source TEXT PRIMARY KEY,
      legacy_digest TEXT,
      status TEXT NOT NULL,
      imported_at TEXT,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS projects (
      project_id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      title TEXT NOT NULL,
      folder_path TEXT NOT NULL UNIQUE,
      worktree_mode INTEGER NOT NULL DEFAULT 0,
      workspace_cwd TEXT,
      workspace_mode TEXT CHECK (workspace_mode IS NULL OR workspace_mode IN ('direct', 'worktree')),
      worktree_path TEXT,
      worktree_unavailable_reason TEXT,
      workspace_updated_at TEXT,
      original_folder_path TEXT,
      removed_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(project_id) ON UPDATE CASCADE ON DELETE RESTRICT,
      source_type TEXT NOT NULL,
      source_owner TEXT,
      source_repo TEXT,
      source_issue_number INTEGER,
      parent_session_id TEXT,
      analysis_parent_session_id TEXT,
      origin_session_id TEXT,
      entry_template TEXT CHECK (entry_template IS NULL OR entry_template = 'session-analysis'),
      write_policy TEXT NOT NULL DEFAULT 'normal' CHECK (write_policy IN ('normal', 'confirm-current-plan-before-write')),
      proposal_version TEXT,
      write_lease_version TEXT,
      agent_team_ownership TEXT CHECK (agent_team_ownership IS NULL OR agent_team_ownership IN ('system', 'user')),
      agent_team_id TEXT,
      agent_team_pending_ownership TEXT CHECK (agent_team_pending_ownership IS NULL OR agent_team_pending_ownership IN ('system', 'user')),
      agent_team_pending_id TEXT,
      workspace_mode TEXT CHECK (workspace_mode IS NULL OR workspace_mode IN ('direct', 'worktree')),
      workspace_pending_mode TEXT CHECK (workspace_pending_mode IS NULL OR workspace_pending_mode IN ('direct', 'worktree')),
      title TEXT,
      status TEXT NOT NULL,
      archived_at TEXT,
      awaits_human_reason TEXT CHECK (
        awaits_human_reason IS NULL OR awaits_human_reason IN ('answer', 'confirmation', 'acceptance', 'exception')
      ),
      unread_since TEXT,
      manual_unread_at TEXT,
      manual_unread_requires_leave INTEGER NOT NULL DEFAULT 0,
      read_state_revision INTEGER NOT NULL DEFAULT 0,
      attention_revision INTEGER NOT NULL DEFAULT 0,
      attention_acknowledged_revision INTEGER NOT NULL DEFAULT 0,
      attention_kind TEXT CHECK (
        attention_kind IS NULL OR attention_kind IN ('project-unavailable', 'team-deleted', 'team-needs-repair')
      ),
      pinned_at TEXT,
      title_revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (source_type <> 'local' OR project_id IS NOT NULL)
    );
    CREATE TABLE IF NOT EXISTS session_edges (
      parent_session_id TEXT NOT NULL,
      child_session_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      hidden_key TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY(parent_session_id, child_session_id, relation)
    );
    CREATE TABLE IF NOT EXISTS session_agent_team_members (
      session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      slot TEXT NOT NULL CHECK (slot IN ('effective', 'pending')),
      member_name TEXT NOT NULL,
      agent_markdown TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      PRIMARY KEY(session_id, slot, member_name)
    );
    CREATE TABLE IF NOT EXISTS session_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      speaker TEXT NOT NULL,
      role TEXT,
      body TEXT NOT NULL,
      status TEXT NOT NULL,
      run_id TEXT,
      run_dir TEXT,
      error TEXT,
      system_event_kind TEXT NOT NULL DEFAULT 'other' CHECK (
        system_event_kind IN ('run-not-started', 'run-stuck', 'user-stopped', 'resume-unavailable', 'retry-exhausted', 'other')
      ),
      terminal_json TEXT,
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_failure_reason TEXT,
      source_kind TEXT,
      source_id TEXT,
      text_fragments_json TEXT NOT NULL DEFAULT '[]',
      activated_at TEXT,
      dispatch_lane TEXT CHECK (dispatch_lane IS NULL OR dispatch_lane IN ('primary', 'worker', 'awaiting-team')),
      dispatch_role TEXT,
      dispatch_reason TEXT CHECK (
        dispatch_reason IS NULL OR dispatch_reason IN (
          'single-valid-mention',
          'no-valid-mention',
          'multiple-valid-mentions'
        )
      ),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_messages_session_id_id ON session_messages(session_id, id);
    CREATE INDEX IF NOT EXISTS idx_session_messages_session_status_id ON session_messages(session_id, status, id);
    CREATE TABLE IF NOT EXISTS local_run_execution_contexts (
      session_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      context_json TEXT NOT NULL,
      PRIMARY KEY(session_id, run_id)
    );
    CREATE TABLE IF NOT EXISTS local_execution_session_links (
      session_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      link_json TEXT NOT NULL,
      PRIMARY KEY(session_id, run_id)
    );
    CREATE TABLE IF NOT EXISTS local_attachment_blobs (
      blob_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('image', 'file')),
      display_name TEXT NOT NULL,
      media_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
      sha256 TEXT NOT NULL,
      storage_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS local_attachment_refs (
      attachment_id TEXT PRIMARY KEY,
      blob_id TEXT NOT NULL REFERENCES local_attachment_blobs(blob_id) ON DELETE CASCADE,
      draft_key TEXT,
      message_id INTEGER REFERENCES session_messages(id) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK (position >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK ((draft_key IS NOT NULL AND message_id IS NULL) OR (draft_key IS NULL AND message_id IS NOT NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_local_attachment_refs_draft_position
      ON local_attachment_refs(draft_key, position) WHERE draft_key IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_local_attachment_refs_message_position
      ON local_attachment_refs(message_id, position) WHERE message_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_local_attachment_refs_blob_id ON local_attachment_refs(blob_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_parent_session_id ON sessions(parent_session_id) WHERE parent_session_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS local_message_cursors (
      session_id TEXT PRIMARY KEY,
      processed_through_message_id INTEGER NOT NULL DEFAULT 0,
      active_message_id INTEGER,
      active_run_id TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS local_route_decisions (
      session_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      route_key TEXT NOT NULL,
      outcome TEXT NOT NULL,
      target_role TEXT,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(session_id, route_key)
    );
    CREATE TABLE IF NOT EXISTS local_acceptance_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      role TEXT NOT NULL,
      verdict TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      source_message_id INTEGER,
      superseded_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_local_acceptance_facts_latest
      ON local_acceptance_facts(session_id, task_id, role, created_at);
    CREATE TABLE IF NOT EXISTS local_integration_events (
      session_id TEXT NOT NULL,
      event_key TEXT NOT NULL,
      status TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(session_id, event_key)
    );
    CREATE TABLE IF NOT EXISTS local_dead_letters (
      session_id TEXT NOT NULL,
      source_message_id INTEGER NOT NULL,
      failure_count INTEGER NOT NULL,
      reason TEXT NOT NULL,
      recovered INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      recovered_at TEXT,
      PRIMARY KEY(session_id, source_message_id)
    );
    CREATE TABLE IF NOT EXISTS local_workspace_diffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      original_repo_root TEXT,
      base_ref TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      patch_path TEXT NOT NULL,
      affected_files_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(session_id, run_id)
    );
    CREATE TABLE IF NOT EXISTS provider_profiles (
      profile_id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL CHECK (provider_id = 'deepseek'),
      display_name TEXT NOT NULL,
      credential_ref TEXT NOT NULL,
      key_suffix TEXT NOT NULL,
      default_model TEXT,
      verified_models_json TEXT NOT NULL,
      readiness TEXT NOT NULL CHECK (readiness IN ('ready', 'needs-attention', 'disabled')),
      safe_reason TEXT,
      catalog_revision INTEGER NOT NULL CHECK (catalog_revision >= 1),
      revision INTEGER NOT NULL CHECK (revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS provider_operations (
      operation_id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('create', 'rotate-key', 'enable', 'add-model', 'set-default-model', 'remove-model', 'migrate', 'delete')),
      status TEXT NOT NULL CHECK (status IN ('validating', 'saving', 'migrating', 'deleting', 'completed', 'failed', 'cancelled')),
      base_revision INTEGER,
      target_models_json TEXT NOT NULL,
      completed_targets_json TEXT NOT NULL,
      target_profile_id TEXT,
      target_owner_ids_json TEXT NOT NULL DEFAULT '[]',
      safe_reason TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_provider_operations_profile_updated
      ON provider_operations(profile_id, updated_at DESC);
  `);
  ensureProviderOperationColumns(database);
  migrateSessionEdgesHiddenKey(database);
  migrateLocalAcceptanceFactsHistory(database);
  migrateLocalMessageFailureMetadata(database);
  migrateLocalMessageActivation(database);
  migrateLocalUserMessageDispatch(database);
  migrateLocalWorkspaceDiffMetadata(database);
  migrateSidebarChatSessionAnalysis(database);
  const now = new Date().toISOString();
  ensureLocalProjectSortOrderColumn(database);
  migrateMainSidebarProjectRemoval(database);
  ensureDefaultLocalProject(database, defaultLocalProjectFolderPath(sqlitePath), now);
  migrateLocalProjectSortOrder(database);
  migrateSessionsCreatedAt(database, now);
  migrateSessionsProjectId(database, now);
  ensureSessionAgentTeamColumns(database);
  ensureSessionAgentTeamProfileColumns(database);
  migrateAgentTeamSnapshotTraceability(database);
  preserveLegacyLocalSessionTeamBindings(database);
  migrateSessionWorkspaceContext(database);
  migrateSessionAttentionState(database);
  migrateSessionSidebarMetadata(database);
  migrateSystemEventKinds(database);
  migrateLocalTerminalFacts(database);
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_sessions_local_project_created_at ON sessions(project_id, created_at DESC, session_id ASC) WHERE source_type = 'local'",
  );
  markSchemaMigration(database, "t3-unified-sqlite-state");
  markSchemaMigration(database, "t46-local-project-workspace-source");
  markSchemaMigration(database, "t5-local-console-facts");
  markSchemaMigration(database, "main-sidebar-t2-session-created-at");
  markSchemaMigration(database, "main-sidebar-t8-project-removal");
  markSchemaMigration(database, "main-sidebar-t11-session-archive");
  markSchemaMigration(database, "main-sidebar-t3-session-attention-state");
  markSchemaMigration(database, "local-console-managed-attachments");
  markSchemaMigration(database, "sidebar-chat-session-analysis");
  markSchemaMigration(database, "byok-provider-profiles-v1");
}

function listProviderProfiles(database: SqliteDatabase): ProviderProfile[] {
  return database.prepare(
    "SELECT * FROM provider_profiles ORDER BY created_at ASC, profile_id ASC",
  ).all().map((row) => readProviderProfile(row as Record<string, unknown>));
}

function getProviderProfile(database: SqliteDatabase, profileId: string): ProviderProfile | null {
  const row = database.prepare("SELECT * FROM provider_profiles WHERE profile_id = ?").get(profileId);
  return row === undefined ? null : readProviderProfile(row as Record<string, unknown>);
}

function putProviderProfile(
  database: SqliteDatabase,
  value: ProviderProfile,
  expectedRevision: number | null,
): ProviderProfile {
  const profile = normalizeProviderProfile(value);
  return transaction(database, () => writeProviderProfile(database, profile, expectedRevision));
}

function commitProviderProfileOperation(
  database: SqliteDatabase,
  value: ProviderProfile,
  expectedRevision: number | null,
  operation: ProviderOperation,
): ProviderProfile {
  const profile = normalizeProviderProfile(value);
  return transaction(database, () => {
    const saved = writeProviderProfile(database, profile, expectedRevision);
    putProviderOperation(database, operation);
    return saved;
  });
}

function writeProviderProfile(
  database: SqliteDatabase,
  profile: ProviderProfile,
  expectedRevision: number | null,
): ProviderProfile {
    const current = getProviderProfile(database, profile.id);
    if (expectedRevision === null) {
      if (current !== null) {
        throw new Error("Provider profile already exists");
      }
    } else if (current?.revision !== expectedRevision) {
      throw new Error("Provider profile revision conflict");
    }
    database.prepare(
      `INSERT INTO provider_profiles (
        profile_id, provider_id, display_name, credential_ref, key_suffix, default_model,
        verified_models_json, readiness, safe_reason, catalog_revision, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET
        provider_id = excluded.provider_id,
        display_name = excluded.display_name,
        credential_ref = excluded.credential_ref,
        key_suffix = excluded.key_suffix,
        default_model = excluded.default_model,
        verified_models_json = excluded.verified_models_json,
        readiness = excluded.readiness,
        safe_reason = excluded.safe_reason,
        catalog_revision = excluded.catalog_revision,
        revision = excluded.revision,
        updated_at = excluded.updated_at`,
    ).run(
      profile.id,
      profile.providerId,
      profile.displayName,
      profile.credentialRef,
      profile.keySuffix,
      profile.defaultModel,
      JSON.stringify(profile.verifiedModels),
      profile.readiness,
      profile.reason,
      profile.catalogRevision,
      profile.revision,
      profile.createdAt,
      profile.updatedAt,
    );
  return getProviderProfile(database, profile.id)!;
}

function deleteProviderProfile(
  database: SqliteDatabase,
  profileId: string,
  expectedRevision: number,
): boolean {
  return transaction(database, () => {
    const current = getProviderProfile(database, profileId);
    if (current === null) {
      return false;
    }
    if (current.revision !== expectedRevision) {
      throw new Error("Provider profile revision conflict");
    }
    const result = database.prepare("DELETE FROM provider_profiles WHERE profile_id = ?").run(profileId);
    return Number(result.changes ?? 0) === 1;
  });
}

function putProviderOperation(database: SqliteDatabase, operation: ProviderOperation): ProviderOperation {
  assertProviderOperation(operation);
  database.prepare(
    `INSERT INTO provider_operations (
      operation_id, profile_id, kind, status, base_revision, target_models_json,
      completed_targets_json, target_profile_id, target_owner_ids_json, safe_reason, started_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(operation_id) DO UPDATE SET
      status = excluded.status,
      completed_targets_json = excluded.completed_targets_json,
      target_profile_id = excluded.target_profile_id,
      target_owner_ids_json = excluded.target_owner_ids_json,
      safe_reason = excluded.safe_reason,
      updated_at = excluded.updated_at`,
  ).run(
    operation.id,
    operation.profileId,
    operation.kind,
    operation.status,
    operation.baseRevision,
    JSON.stringify(operation.targetModels),
    JSON.stringify(operation.completedTargets),
    operation.targetProfileId ?? null,
    JSON.stringify(operation.targetOwnerIds ?? []),
    operation.safeReason,
    operation.startedAt,
    operation.updatedAt,
  );
  return operation;
}

function listProviderOperations(database: SqliteDatabase, profileId?: string): ProviderOperation[] {
  const rows = profileId === undefined
    ? database.prepare("SELECT * FROM provider_operations ORDER BY updated_at DESC, operation_id ASC").all()
    : database.prepare(
      "SELECT * FROM provider_operations WHERE profile_id = ? ORDER BY updated_at DESC, operation_id ASC",
    ).all(profileId);
  return rows.map((row) => readProviderOperation(row as Record<string, unknown>));
}

function listProviderSessionReferences(database: SqliteDatabase, profileId: string): ProviderReference[] {
  return database.prepare(
    `SELECT session_id, slot, member_name, execution_model
     FROM session_agent_team_members
     WHERE execution_cli = 'pi'
       AND provider_profile_id = ?
       AND continuation_ended = 0
       AND slot IN ('effective', 'pending')
     ORDER BY session_id, slot, sort_order, member_name`,
  ).all(profileId).map((row) => {
    if (!isRecord(row)) throw new Error("Invalid Provider session reference row");
    const sessionId = readString(row.session_id, "session_id");
    const slot = readString(row.slot, "slot");
    if (slot !== "effective" && slot !== "pending") {
      throw new Error("Invalid Provider session reference slot");
    }
    const memberName = readString(row.member_name, "member_name");
    return {
      kind: slot === "effective" ? "resumable-session" : "queued-task",
      ownerId: formatProviderSessionReferenceOwner({ sessionId, slot, memberName }),
      label: `${sessionId} · ${memberName}`,
      profileId,
      model: normalizeProviderModel("deepseek", readString(row.execution_model, "execution_model")),
    };
  });
}

function readProviderProfile(row: Record<string, unknown>): ProviderProfile {
  return normalizeProviderProfile({
    id: row.profile_id,
    providerId: row.provider_id,
    displayName: row.display_name,
    credentialRef: row.credential_ref,
    keySuffix: row.key_suffix,
    defaultModel: row.default_model,
    verifiedModels: parseJsonArray(row.verified_models_json, "verified_models_json"),
    readiness: row.readiness,
    reason: row.safe_reason,
    catalogRevision: readNumber(row.catalog_revision, "catalog_revision"),
    revision: readNumber(row.revision, "revision"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function readProviderOperation(row: Record<string, unknown>): ProviderOperation {
  const targetOwnerIds = parseJsonArray(row.target_owner_ids_json ?? "[]", "target_owner_ids_json") as string[];
  const targetProfileId = typeof row.target_profile_id === "string" && row.target_profile_id.length > 0
    ? row.target_profile_id
    : undefined;
  const operation: ProviderOperation = {
    id: readString(row.operation_id, "operation_id"),
    profileId: readString(row.profile_id, "profile_id"),
    kind: row.kind as ProviderOperation["kind"],
    status: row.status as ProviderOperation["status"],
    baseRevision: row.base_revision === null ? null : readNumber(row.base_revision, "base_revision"),
    targetModels: parseJsonArray(row.target_models_json, "target_models_json") as ProviderOperation["targetModels"],
    completedTargets: parseJsonArray(row.completed_targets_json, "completed_targets_json") as string[],
    ...(targetProfileId === undefined ? {} : { targetProfileId }),
    ...(targetOwnerIds.length === 0 ? {} : { targetOwnerIds }),
    safeReason: row.safe_reason as ProviderOperation["safeReason"],
    startedAt: readString(row.started_at, "started_at"),
    updatedAt: readString(row.updated_at, "updated_at"),
  };
  assertProviderOperation(operation);
  return operation;
}

function ensureProviderOperationColumns(database: SqliteDatabase): void {
  if (!tableHasColumn(database, "provider_operations", "target_profile_id")) {
    database.exec("ALTER TABLE provider_operations ADD COLUMN target_profile_id TEXT");
  }
  if (!tableHasColumn(database, "provider_operations", "target_owner_ids_json")) {
    database.exec("ALTER TABLE provider_operations ADD COLUMN target_owner_ids_json TEXT NOT NULL DEFAULT '[]'");
  }
  markSchemaMigration(database, "byok-provider-reference-operation-recovery-v2");
}

function assertProviderOperation(operation: ProviderOperation): void {
  const kinds: readonly ProviderOperation["kind"][] = ["create", "rotate-key", "enable", "add-model", "set-default-model", "remove-model", "migrate", "delete"];
  const statuses: readonly ProviderOperation["status"][] = [
    "validating", "saving", "migrating", "deleting", "completed", "failed", "cancelled",
  ];
  if (
    operation.id.length === 0
    || operation.profileId.length === 0
    || !kinds.includes(operation.kind)
    || !statuses.includes(operation.status)
    || !Array.isArray(operation.targetModels)
    || !Array.isArray(operation.completedTargets)
    || (operation.targetOwnerIds !== undefined && !Array.isArray(operation.targetOwnerIds))
    || !Number.isFinite(Date.parse(operation.startedAt))
    || !Number.isFinite(Date.parse(operation.updatedAt))
  ) {
    throw new Error("Invalid provider operation");
  }
}

function parseJsonArray(value: unknown, field: string): unknown[] {
  if (typeof value !== "string") {
    throw new Error(`Invalid SQLite row ${field}`);
  }
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid SQLite row ${field}`);
  }
  return parsed;
}

function migrateLocalTerminalFacts(database: SqliteDatabase): void {
  if (!tableHasColumn(database, "session_messages", "terminal_json")) {
    database.exec("ALTER TABLE session_messages ADD COLUMN terminal_json TEXT");
  }
  markSchemaMigration(database, "local-runtime-structured-terminal-v1");
}

function migrateSidebarChatSessionAnalysis(database: SqliteDatabase): void {
  if (!tableHasColumn(database, "sessions", "analysis_parent_session_id")) {
    database.exec("ALTER TABLE sessions ADD COLUMN analysis_parent_session_id TEXT");
  }
  if (!tableHasColumn(database, "sessions", "origin_session_id")) {
    database.exec("ALTER TABLE sessions ADD COLUMN origin_session_id TEXT");
  }
  if (!tableHasColumn(database, "sessions", "entry_template")) {
    database.exec("ALTER TABLE sessions ADD COLUMN entry_template TEXT CHECK (entry_template IS NULL OR entry_template = 'session-analysis')");
  }
  if (!tableHasColumn(database, "sessions", "write_policy")) {
    database.exec("ALTER TABLE sessions ADD COLUMN write_policy TEXT NOT NULL DEFAULT 'normal' CHECK (write_policy IN ('normal', 'confirm-current-plan-before-write'))");
  }
  if (!tableHasColumn(database, "sessions", "proposal_version")) {
    database.exec("ALTER TABLE sessions ADD COLUMN proposal_version TEXT");
  }
  if (!tableHasColumn(database, "sessions", "write_lease_version")) {
    database.exec("ALTER TABLE sessions ADD COLUMN write_lease_version TEXT");
  }
  if (!tableHasColumn(database, "session_messages", "text_fragments_json")) {
    database.exec("ALTER TABLE session_messages ADD COLUMN text_fragments_json TEXT NOT NULL DEFAULT '[]'");
  }
  database.exec(
    `UPDATE sessions
     SET analysis_parent_session_id = origin_session_id
     WHERE source_type = 'local'
       AND entry_template = 'session-analysis'
       AND analysis_parent_session_id IS NULL
       AND origin_session_id IS NOT NULL
       AND origin_session_id <> session_id
       AND EXISTS (
         SELECT 1 FROM sessions parent
         WHERE parent.session_id = sessions.origin_session_id
           AND parent.source_type = 'local'
       )`,
  );
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_sessions_analysis_parent_session_id ON sessions(analysis_parent_session_id) WHERE analysis_parent_session_id IS NOT NULL",
  );
}

function preserveLegacyLocalSessionTeamBindings(database: SqliteDatabase): void {
  markSchemaMigration(database, "main-conversation-timeline-team-binding");
}

function migrateSystemEventKinds(database: SqliteDatabase): void {
  if (!tableHasColumn(database, "session_messages", "system_event_kind")) {
    database.exec(
      "ALTER TABLE session_messages ADD COLUMN system_event_kind TEXT NOT NULL DEFAULT 'other' CHECK (system_event_kind IN ('run-not-started', 'run-stuck', 'user-stopped', 'resume-unavailable', 'retry-exhausted', 'other'))",
    );
  }
  migrateResumeUnavailableSystemEventKind(database);
  database.exec("UPDATE session_messages SET system_event_kind = 'other' WHERE system_event_kind IS NULL");
  database.exec("UPDATE sessions SET awaits_human_reason = NULL WHERE source_type = 'local'");
  markSchemaMigration(database, "main-conversation-timeline-system-events");
}

function migrateResumeUnavailableSystemEventKind(database: SqliteDatabase): void {
  const migrationVersion = "local-console-system-event-resume-unavailable";
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'session_messages'")
    .get();
  if (!isRecord(row)) {
    throw new Error("Missing session_messages schema during system event migration");
  }
  const tableSql = readString(row.sql, "session_messages.sql");
  if (tableSql.includes("'resume-unavailable'")) {
    markSchemaMigration(database, migrationVersion);
    return;
  }

  database.exec("PRAGMA foreign_keys = OFF");
  try {
    transaction(database, () => {
      if (tableExists(database, "session_messages_resume_unavailable_migration")) {
        throw new Error("Unexpected leftover system event migration table");
      }
      database.exec(`
        CREATE TABLE session_messages_resume_unavailable_migration (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          speaker TEXT NOT NULL,
          role TEXT,
          body TEXT NOT NULL,
          status TEXT NOT NULL,
          run_id TEXT,
          run_dir TEXT,
          error TEXT,
          system_event_kind TEXT NOT NULL DEFAULT 'other' CHECK (
            system_event_kind IN ('run-not-started', 'run-stuck', 'user-stopped', 'resume-unavailable', 'retry-exhausted', 'other')
          ),
          failure_count INTEGER NOT NULL DEFAULT 0,
          last_failure_reason TEXT,
          source_kind TEXT,
          source_id TEXT,
          activated_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO session_messages_resume_unavailable_migration (
          id,
          session_id,
          speaker,
          role,
          body,
          status,
          run_id,
          run_dir,
          error,
          system_event_kind,
          failure_count,
          last_failure_reason,
          source_kind,
          source_id,
          activated_at,
          created_at,
          updated_at
        )
        SELECT
          id,
          session_id,
          speaker,
          role,
          body,
          status,
          run_id,
          run_dir,
          error,
          system_event_kind,
          failure_count,
          last_failure_reason,
          source_kind,
          source_id,
          activated_at,
          created_at,
          updated_at
        FROM session_messages;
        DROP TABLE session_messages;
        ALTER TABLE session_messages_resume_unavailable_migration RENAME TO session_messages;
        CREATE INDEX idx_session_messages_session_id_id ON session_messages(session_id, id);
        CREATE INDEX idx_session_messages_session_status_id ON session_messages(session_id, status, id);
      `);
      const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all();
      if (foreignKeyViolations.length > 0) {
        throw new Error("Foreign key check failed during system event migration");
      }
      markSchemaMigration(database, migrationVersion);
      return null;
    });
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}

function ensureSessionAgentTeamColumns(database: SqliteDatabase): void {
  if (!tableHasColumn(database, "sessions", "agent_team_ownership")) {
    database.exec("ALTER TABLE sessions ADD COLUMN agent_team_ownership TEXT CHECK (agent_team_ownership IS NULL OR agent_team_ownership IN ('system', 'user'))");
  }
  if (!tableHasColumn(database, "sessions", "agent_team_id")) {
    database.exec("ALTER TABLE sessions ADD COLUMN agent_team_id TEXT");
  }
  if (!tableHasColumn(database, "sessions", "agent_team_pending_ownership")) {
    database.exec("ALTER TABLE sessions ADD COLUMN agent_team_pending_ownership TEXT CHECK (agent_team_pending_ownership IS NULL OR agent_team_pending_ownership IN ('system', 'user'))");
  }
  if (!tableHasColumn(database, "sessions", "agent_team_pending_id")) {
    database.exec("ALTER TABLE sessions ADD COLUMN agent_team_pending_id TEXT");
  }
}

function ensureSessionAgentTeamProfileColumns(database: SqliteDatabase): void {
  if (!tableHasColumn(database, "session_agent_team_members", "execution_cli")) {
    database.exec(
      "ALTER TABLE session_agent_team_members ADD COLUMN execution_cli TEXT CHECK (execution_cli IS NULL OR execution_cli IN ('codex', 'claude', 'kimi'))",
    );
  }
  if (!tableHasColumn(database, "session_agent_team_members", "execution_model")) {
    database.exec("ALTER TABLE session_agent_team_members ADD COLUMN execution_model TEXT");
  }
  if (!tableHasColumn(database, "session_agent_team_members", "execution_effort")) {
    database.exec("ALTER TABLE session_agent_team_members ADD COLUMN execution_effort TEXT");
  }
  if (!tableHasColumn(database, "session_agent_team_members", "provider_id")) {
    database.exec("ALTER TABLE session_agent_team_members ADD COLUMN provider_id TEXT");
  }
  if (!tableHasColumn(database, "session_agent_team_members", "provider_profile_id")) {
    database.exec("ALTER TABLE session_agent_team_members ADD COLUMN provider_profile_id TEXT");
  }
  migrateSessionAgentTeamProfileCliConstraint(database);
  if (!tableHasColumn(database, "session_agent_team_members", "continuation_ended")) {
    database.exec("ALTER TABLE session_agent_team_members ADD COLUMN continuation_ended INTEGER NOT NULL DEFAULT 0");
  }
  markSchemaMigration(database, "agent-runtime-profiles-session-snapshot");
}

function migrateAgentTeamSnapshotTraceability(database: SqliteDatabase): void {
  const migrationVersion = "agent-team-snapshot-traceability-and-apply";
  if (database.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(migrationVersion) !== undefined) {
    return;
  }
  const beforeCount = readTableRowCount(database, "session_agent_team_members");
  database.exec("PRAGMA foreign_keys = OFF");
  try {
    transaction(database, () => {
      const sourceHasPiColumns = tableHasColumn(database, "session_agent_team_members", "provider_profile_id");
      database.exec(`
        CREATE TABLE session_agent_team_members_snapshot_migration (
          session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
          slot TEXT NOT NULL CHECK (slot IN ('effective', 'candidate', 'pending')),
          member_name TEXT NOT NULL,
          display_name TEXT,
          member_description TEXT,
          agent_markdown TEXT NOT NULL,
          sort_order INTEGER NOT NULL,
          execution_cli TEXT CHECK (
            execution_cli IS NULL OR execution_cli IN ('codex', 'claude', 'kimi', 'pi')
          ),
          execution_model TEXT,
          execution_effort TEXT,
          provider_id TEXT CHECK (provider_id IS NULL OR provider_id = 'deepseek'),
          provider_profile_id TEXT,
          continuation_ended INTEGER NOT NULL DEFAULT 0,
          snapshot_key TEXT,
          PRIMARY KEY(session_id, slot, member_name)
        );
        INSERT INTO session_agent_team_members_snapshot_migration
          (session_id, slot, member_name, agent_markdown, sort_order,
           execution_cli, execution_model, execution_effort${sourceHasPiColumns ? ", provider_id, provider_profile_id, continuation_ended" : ""})
        SELECT session_id, slot, member_name, agent_markdown, sort_order,
               execution_cli, execution_model, execution_effort${sourceHasPiColumns ? ", provider_id, provider_profile_id, continuation_ended" : ""}
        FROM session_agent_team_members
        ORDER BY session_id, slot, sort_order, member_name;
        DROP TABLE session_agent_team_members;
        ALTER TABLE session_agent_team_members_snapshot_migration RENAME TO session_agent_team_members;
        CREATE TABLE session_agent_team_snapshot_meta (
          session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
          slot TEXT NOT NULL CHECK (slot IN ('effective', 'candidate', 'pending')),
          team_ownership TEXT CHECK (team_ownership IS NULL OR team_ownership IN ('system', 'user')),
          team_id TEXT,
          team_name TEXT,
          team_description TEXT,
          primary_agent_slug TEXT,
          official_source_name TEXT,
          team_created_at TEXT,
          captured_at TEXT,
          loaded_at TEXT,
          snapshot_key TEXT,
          agent_definition_digest TEXT,
          execution_profile_digest TEXT,
          team_information_digest TEXT,
          PRIMARY KEY(session_id, slot)
        );
        CREATE TABLE session_team_update_intents (
          session_id TEXT PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE,
          from_snapshot_key TEXT,
          target_snapshot_key TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('waiting', 'failed')),
          requested_at TEXT NOT NULL,
          failure_code TEXT,
          failure_summary TEXT
        );
      `);
      if (!tableHasColumn(database, "session_messages", "dispatch_snapshot_key")) {
        database.exec("ALTER TABLE session_messages ADD COLUMN dispatch_snapshot_key TEXT");
      }
      const afterCount = readTableRowCount(database, "session_agent_team_members");
      if (afterCount !== beforeCount) {
        throw new Error("Row count changed during Agent team snapshot migration");
      }
      const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all();
      if (foreignKeyViolations.length > 0) {
        throw new Error("Foreign key check failed during Agent team snapshot migration");
      }
      markSchemaMigration(database, migrationVersion);
      return null;
    });
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}

function migrateSessionAgentTeamProfileCliConstraint(database: SqliteDatabase): void {
  const migrationVersion = "support-pi-api-session-profile-v2";
  if (
    database.prepare("SELECT 1 FROM schema_migrations WHERE version = ?")
      .get(migrationVersion) !== undefined
  ) {
    return;
  }
  const tableSql = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'session_agent_team_members'",
  ).get();
  if (
    isRecord(tableSql)
    && typeof tableSql.sql === "string"
    && tableSql.sql.includes("'pi'")
    && tableSql.sql.includes("provider_profile_id")
  ) {
    markSchemaMigration(database, migrationVersion);
    return;
  }
  const beforeCount = readTableRowCount(database, "session_agent_team_members");
  const sourceHasSnapshotTraceabilityColumns = tableHasColumn(database, "session_agent_team_members", "snapshot_key");
  const traceabilityColumns = sourceHasSnapshotTraceabilityColumns
    ? ", display_name, member_description, snapshot_key"
    : "";
  database.exec("PRAGMA foreign_keys = OFF");
  try {
    transaction(database, () => {
      database.exec(`
        CREATE TABLE session_agent_team_members_pi_migration (
          session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
          slot TEXT NOT NULL CHECK (slot IN ('effective', 'candidate', 'pending')),
          member_name TEXT NOT NULL,
          display_name TEXT,
          member_description TEXT,
          agent_markdown TEXT NOT NULL,
          sort_order INTEGER NOT NULL,
          execution_cli TEXT CHECK (
            execution_cli IS NULL OR execution_cli IN ('codex', 'claude', 'kimi', 'pi')
          ),
          execution_model TEXT,
          execution_effort TEXT,
          provider_id TEXT CHECK (provider_id IS NULL OR provider_id = 'deepseek'),
          provider_profile_id TEXT,
          snapshot_key TEXT,
          PRIMARY KEY(session_id, slot, member_name)
        );
        INSERT INTO session_agent_team_members_pi_migration
          (session_id, slot, member_name, agent_markdown, sort_order,
           execution_cli, execution_model, execution_effort, provider_id, provider_profile_id${traceabilityColumns})
        SELECT session_id, slot, member_name, agent_markdown, sort_order,
               execution_cli, execution_model, execution_effort, provider_id, provider_profile_id${traceabilityColumns}
        FROM session_agent_team_members
        ORDER BY session_id, slot, sort_order, member_name;
        DROP TABLE session_agent_team_members;
        ALTER TABLE session_agent_team_members_pi_migration
          RENAME TO session_agent_team_members;
      `);
      const afterCount = readTableRowCount(database, "session_agent_team_members");
      if (afterCount !== beforeCount) {
        throw new Error("Row count changed during Pi execution profile migration");
      }
      const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all();
      if (foreignKeyViolations.length > 0) {
        throw new Error("Foreign key check failed during Pi execution profile migration");
      }
      markSchemaMigration(database, migrationVersion);
      return null;
    });
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}

function readTableRowCount(database: SqliteDatabase, tableName: string): number {
  if (tableName !== "session_agent_team_members") {
    throw new Error("Unsupported row-count table");
  }
  const row = database.prepare(
    "SELECT COUNT(*) AS row_count FROM session_agent_team_members",
  ).get();
  if (!isRecord(row) || typeof row.row_count !== "number") {
    throw new Error("Unable to read session Agent team member row count");
  }
  return row.row_count;
}

function migrateSessionWorkspaceContext(database: SqliteDatabase): void {
  if (!tableHasColumn(database, "sessions", "workspace_mode")) {
    database.exec("ALTER TABLE sessions ADD COLUMN workspace_mode TEXT CHECK (workspace_mode IS NULL OR workspace_mode IN ('direct', 'worktree'))");
  }
  if (!tableHasColumn(database, "sessions", "workspace_pending_mode")) {
    database.exec("ALTER TABLE sessions ADD COLUMN workspace_pending_mode TEXT CHECK (workspace_pending_mode IS NULL OR workspace_pending_mode IN ('direct', 'worktree'))");
  }
  database.exec(`
    UPDATE sessions
    SET workspace_mode = COALESCE(
      (
        SELECT CASE WHEN projects.worktree_mode = 1 THEN 'worktree' ELSE 'direct' END
        FROM projects
        WHERE projects.project_id = sessions.project_id
      ),
      'direct'
    )
    WHERE source_type = 'local' AND workspace_mode IS NULL
  `);
  markSchemaMigration(database, "main-conversation-session-context-workspace");
}

function migrateMainSidebarProjectRemoval(database: SqliteDatabase): void {
  if (!tableHasColumn(database, "projects", "original_folder_path")) {
    database.exec("ALTER TABLE projects ADD COLUMN original_folder_path TEXT");
  }
  if (!tableHasColumn(database, "projects", "removed_at")) {
    database.exec("ALTER TABLE projects ADD COLUMN removed_at TEXT");
  }
  if (!tableHasColumn(database, "sessions", "archived_at")) {
    database.exec("ALTER TABLE sessions ADD COLUMN archived_at TEXT");
  }
}

function migrateSessionAttentionState(database: SqliteDatabase): void {
  const shouldBackfillAwaitReason = !tableHasColumn(database, "sessions", "awaits_human_reason");
  if (shouldBackfillAwaitReason) {
    database.exec(
      "ALTER TABLE sessions ADD COLUMN awaits_human_reason TEXT CHECK (awaits_human_reason IS NULL OR awaits_human_reason IN ('answer', 'confirmation', 'acceptance', 'exception'))",
    );
  }
  if (!tableHasColumn(database, "sessions", "unread_since")) {
    database.exec("ALTER TABLE sessions ADD COLUMN unread_since TEXT");
  }

  if (shouldBackfillAwaitReason) {
    database.exec(`
      UPDATE sessions
      SET awaits_human_reason = 'answer'
      WHERE source_type = 'local'
        AND awaits_human_reason IS NULL
        AND (
          SELECT speaker
          FROM session_messages
          WHERE session_messages.session_id = sessions.session_id
          ORDER BY id DESC
          LIMIT 1
        ) = 'agent'
        AND INSTR((
          SELECT body
          FROM session_messages
          WHERE session_messages.session_id = sessions.session_id
          ORDER BY id DESC
          LIMIT 1
        ), '等待真人：') > 0
    `);
  }
}

function migrateSessionSidebarMetadata(database: SqliteDatabase): void {
  if (!tableHasColumn(database, "sessions", "manual_unread_at")) {
    database.exec("ALTER TABLE sessions ADD COLUMN manual_unread_at TEXT");
  }
  if (!tableHasColumn(database, "sessions", "manual_unread_requires_leave")) {
    database.exec("ALTER TABLE sessions ADD COLUMN manual_unread_requires_leave INTEGER NOT NULL DEFAULT 0");
  }
  if (!tableHasColumn(database, "sessions", "read_state_revision")) {
    database.exec("ALTER TABLE sessions ADD COLUMN read_state_revision INTEGER NOT NULL DEFAULT 0");
  }
  if (!tableHasColumn(database, "sessions", "attention_revision")) {
    database.exec("ALTER TABLE sessions ADD COLUMN attention_revision INTEGER NOT NULL DEFAULT 0");
  }
  if (!tableHasColumn(database, "sessions", "attention_acknowledged_revision")) {
    database.exec("ALTER TABLE sessions ADD COLUMN attention_acknowledged_revision INTEGER NOT NULL DEFAULT 0");
  }
  if (!tableHasColumn(database, "sessions", "attention_kind")) {
    database.exec(
      "ALTER TABLE sessions ADD COLUMN attention_kind TEXT CHECK (attention_kind IS NULL OR attention_kind IN ('project-unavailable', 'team-deleted', 'team-needs-repair'))",
    );
  }
  if (!tableHasColumn(database, "sessions", "pinned_at")) {
    database.exec("ALTER TABLE sessions ADD COLUMN pinned_at TEXT");
  }
  if (!tableHasColumn(database, "sessions", "title_revision")) {
    database.exec("ALTER TABLE sessions ADD COLUMN title_revision INTEGER NOT NULL DEFAULT 0");
  }
  markSchemaMigration(database, "sidebar-conversation-management-metadata");
}

function migrateSessionsCreatedAt(database: SqliteDatabase, now: string): void {
  if (!tableHasColumn(database, "sessions", "created_at")) {
    database.exec("ALTER TABLE sessions ADD COLUMN created_at TEXT");
  }

  const legacyMessageCreatedAt = tableExists(database, "local_messages")
    ? `(
        SELECT NULLIF(TRIM(local_messages.created_at), '')
        FROM local_messages
        WHERE local_messages.session_id = sessions.session_id
        ORDER BY local_messages.id ASC
        LIMIT 1
      )`
    : "NULL";
  database
    .prepare(
      `UPDATE sessions
       SET created_at = COALESCE(
         NULLIF(TRIM(created_at), ''),
         (
           SELECT NULLIF(TRIM(session_messages.created_at), '')
           FROM session_messages
           WHERE session_messages.session_id = sessions.session_id
           ORDER BY session_messages.id ASC
           LIMIT 1
         ),
         ${legacyMessageCreatedAt},
         NULLIF(TRIM(updated_at), ''),
         ?
       )
       WHERE created_at IS NULL OR TRIM(created_at) = ''`,
    )
    .run(now);
}

function migrateSessionEdgesHiddenKey(database: SqliteDatabase): void {
  if (!tableHasColumn(database, "session_edges", "hidden_key")) {
    database.exec("ALTER TABLE session_edges ADD COLUMN hidden_key TEXT");
  }
  database.exec("DROP INDEX IF EXISTS idx_session_edges_hidden_key");
  database.exec("CREATE INDEX IF NOT EXISTS idx_session_edges_parent_hidden_key ON session_edges(parent_session_id, hidden_key) WHERE hidden_key IS NOT NULL");
}

function migrateLocalAcceptanceFactsHistory(database: SqliteDatabase): void {
  if (!tableHasColumn(database, "local_acceptance_facts", "id")) {
    database.exec("ALTER TABLE local_acceptance_facts RENAME TO local_acceptance_facts_legacy_history");
    database.exec(`
      CREATE TABLE local_acceptance_facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        role TEXT NOT NULL,
        verdict TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        source_message_id INTEGER,
        superseded_at TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO local_acceptance_facts
        (session_id, task_id, role, verdict, evidence_json, source_message_id, superseded_at, created_at)
      SELECT session_id, task_id, role, verdict, evidence_json, NULL, NULL, created_at
      FROM local_acceptance_facts_legacy_history
      ORDER BY created_at ASC;
      DROP TABLE local_acceptance_facts_legacy_history;
    `);
  }
  if (!tableHasColumn(database, "local_acceptance_facts", "source_message_id")) {
    database.exec("ALTER TABLE local_acceptance_facts ADD COLUMN source_message_id INTEGER");
  }
  if (!tableHasColumn(database, "local_acceptance_facts", "superseded_at")) {
    database.exec("ALTER TABLE local_acceptance_facts ADD COLUMN superseded_at TEXT");
  }
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_local_acceptance_facts_latest ON local_acceptance_facts(session_id, task_id, role, created_at)",
  );
}

function migrateLocalMessageFailureMetadata(database: SqliteDatabase): void {
  if (!tableHasColumn(database, "session_messages", "failure_count")) {
    database.exec("ALTER TABLE session_messages ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0");
  }
  if (!tableHasColumn(database, "session_messages", "last_failure_reason")) {
    database.exec("ALTER TABLE session_messages ADD COLUMN last_failure_reason TEXT");
  }
}

function migrateLocalMessageActivation(database: SqliteDatabase): void {
  if (!tableHasColumn(database, "session_messages", "activated_at")) {
    database.exec("ALTER TABLE session_messages ADD COLUMN activated_at TEXT");
  }
  markSchemaMigration(database, "multi-agent-primary-control-lanes-message-activation");
}

function migrateLocalUserMessageDispatch(database: SqliteDatabase): void {
  if (!tableHasColumn(database, "session_messages", "dispatch_lane")) {
    database.exec("ALTER TABLE session_messages ADD COLUMN dispatch_lane TEXT");
  }
  if (!tableHasColumn(database, "session_messages", "dispatch_role")) {
    database.exec("ALTER TABLE session_messages ADD COLUMN dispatch_role TEXT");
  }
  if (!tableHasColumn(database, "session_messages", "dispatch_reason")) {
    database.exec("ALTER TABLE session_messages ADD COLUMN dispatch_reason TEXT");
  }
  database.exec(`
    UPDATE session_messages
    SET dispatch_lane = 'primary',
        dispatch_role = (
          SELECT member_name
          FROM session_agent_team_members
          WHERE session_agent_team_members.session_id = session_messages.session_id
            AND slot = 'effective'
          ORDER BY sort_order ASC
          LIMIT 1
        ),
        dispatch_reason = 'no-valid-mention'
    WHERE speaker = 'user' AND dispatch_lane IS NULL;
    CREATE INDEX IF NOT EXISTS idx_session_messages_dispatch
      ON session_messages(session_id, dispatch_lane, dispatch_role, status, id);
  `);
  markSchemaMigration(database, "local-console-direct-member-mention-dispatch");
}

function migrateLocalWorkspaceDiffMetadata(database: SqliteDatabase): void {
  if (!tableHasColumn(database, "local_workspace_diffs", "original_repo_root")) {
    database.exec("ALTER TABLE local_workspace_diffs ADD COLUMN original_repo_root TEXT");
  }
  if (!tableHasColumn(database, "local_workspace_diffs", "affected_files_json")) {
    database.exec("ALTER TABLE local_workspace_diffs ADD COLUMN affected_files_json TEXT NOT NULL DEFAULT '[]'");
  }
}

function migrateSessionsProjectId(database: SqliteDatabase, now: string): void {
  if (tableHasColumn(database, "sessions", "project_id")) {
    return;
  }
  transaction(database, () => {
    database.exec("ALTER TABLE sessions RENAME TO sessions_legacy_project_migration");
    database.exec(`
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(project_id) ON UPDATE CASCADE ON DELETE RESTRICT,
        source_type TEXT NOT NULL,
        source_owner TEXT,
        source_repo TEXT,
        source_issue_number INTEGER,
        parent_session_id TEXT,
        title TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (source_type <> 'local' OR project_id IS NOT NULL)
      );
      INSERT INTO sessions
        (session_id, project_id, source_type, source_owner, source_repo, source_issue_number, parent_session_id, title, status, created_at, updated_at)
      SELECT
        session_id,
        CASE WHEN source_type = 'local' THEN '${LOCAL_CONSOLE_PROJECT_ID}' ELSE NULL END,
        source_type,
        source_owner,
        source_repo,
        source_issue_number,
        parent_session_id,
        title,
        status,
        created_at,
        updated_at
      FROM sessions_legacy_project_migration;
      DROP TABLE sessions_legacy_project_migration;
    `);
    markSchemaMigration(database, "t46-sessions-project-id");
    database
      .prepare("UPDATE projects SET updated_at = ? WHERE project_id = ?")
      .run(now, LOCAL_CONSOLE_PROJECT_ID);
    return null;
  });
}

function tableHasColumn(database: SqliteDatabase, tableName: string, columnName: string): boolean {
  const rows = database.prepare(`PRAGMA table_info(${tableName})`).all();
  return rows.some((row) => isRecord(row) && row.name === columnName);
}

function migrateLocalProjectSortOrder(database: SqliteDatabase): void {
  const alreadyApplied = database
    .prepare("SELECT 1 AS found FROM schema_migrations WHERE version = ?")
    .get("main-sidebar-t9-project-sort-order");
  if (alreadyApplied !== undefined) {
    return;
  }
  transaction(database, () => {
    const rows = database
      .prepare(
        "SELECT project_id FROM projects WHERE removed_at IS NULL ORDER BY created_at DESC, project_id ASC",
      )
      .all();
    const update = database.prepare("UPDATE projects SET sort_order = ? WHERE project_id = ?");
    rows.forEach((row, index) => {
      if (!isRecord(row)) {
        throw new Error("Invalid local console project row during sort order migration");
      }
      update.run(index, readString(row.project_id, "project_id"));
    });
    markSchemaMigration(database, "main-sidebar-t9-project-sort-order");
    return null;
  });
}

function ensureLocalProjectSortOrderColumn(database: SqliteDatabase): void {
  if (!tableHasColumn(database, "projects", "sort_order")) {
    database.exec("ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
  }
}

function tableExists(database: SqliteDatabase, tableName: string): boolean {
  return database
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) !== undefined;
}

function defaultLocalProjectFolderPath(sqlitePath: string): string {
  const stateDir = path.dirname(sqlitePath);
  return path.basename(stateDir) === ".state" ? path.dirname(stateDir) : stateDir;
}

function ensureDefaultLocalProject(database: SqliteDatabase, folderPath: string, now: string): void {
  const normalizedFolderPath = path.resolve(folderPath);
  const title = projectTitleFromFolder(normalizedFolderPath);
  database
    .prepare(
      `INSERT OR IGNORE INTO projects
        (project_id, source_type, title, folder_path, worktree_mode, workspace_cwd, workspace_mode, worktree_path, worktree_unavailable_reason, workspace_updated_at, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, 'direct', NULL, NULL, ?, 0, ?, ?)`,
    )
    .run(LOCAL_CONSOLE_PROJECT_ID, LOCAL_CONSOLE_PROJECT_SOURCE_TYPE, title, normalizedFolderPath, normalizedFolderPath, now, now, now);
}

function migrateLocalMessages(database: SqliteDatabase): void {
  const legacyTable = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'local_messages'")
    .get();
  if (legacyTable === undefined) {
    return;
  }
  transaction(database, () => {
    const now = new Date().toISOString();
    const existingDefaultSession = database
      .prepare("SELECT 1 AS found FROM sessions WHERE session_id = ?")
      .get(LOCAL_CONSOLE_DEFAULT_SESSION_ID);
    ensureSession(database, LOCAL_CONSOLE_DEFAULT_SESSION_ID, now, "默认会话", LOCAL_CONSOLE_PROJECT_ID);
    database.exec(`
      INSERT OR IGNORE INTO session_messages
        (id, session_id, speaker, role, body, status, run_id, run_dir, error, source_kind, source_id, created_at, updated_at)
      SELECT id, session_id, speaker, role, body, status, run_id, run_dir, error, 'local-message', CAST(id AS TEXT), created_at, updated_at
      FROM local_messages
    `);
    if (existingDefaultSession === undefined) {
      database
        .prepare(
          `UPDATE sessions
           SET created_at = COALESCE(
             (
               SELECT NULLIF(TRIM(created_at), '')
               FROM session_messages
               WHERE session_id = ?
               ORDER BY id ASC
               LIMIT 1
             ),
             created_at
           )
           WHERE session_id = ?`,
        )
        .run(LOCAL_CONSOLE_DEFAULT_SESSION_ID, LOCAL_CONSOLE_DEFAULT_SESSION_ID);
    }
    markMigrationImported(database, "local-messages", null);
  });
}

function initLocalConsole(database: SqliteDatabase): null {
  const now = new Date().toISOString();
  ensureSession(database, LOCAL_CONSOLE_DEFAULT_SESSION_ID, now, "默认会话", LOCAL_CONSOLE_PROJECT_ID);
  ensureLocalCursor(database, LOCAL_CONSOLE_DEFAULT_SESSION_ID, now);
  return null;
}

function sessionFactMigrationStatus(database: SqliteDatabase): { complete: boolean } {
  return {
    complete: database
      .prepare("SELECT 1 AS found FROM schema_migrations WHERE version = ?")
      .get(SESSION_FACT_MIGRATION_VERSION) !== undefined,
  };
}

function completeSessionFactMigration(database: SqliteDatabase, now: string): null {
  database
    .prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)")
    .run(SESSION_FACT_MIGRATION_VERSION, now);
  return null;
}

function listSessionMessageIndexes(database: SqliteDatabase): Array<{ sessionId: string; parentSessionId: string | null; messages: WorkerLocalMessage[] }> {
  return database
    .prepare("SELECT session_id, parent_session_id FROM sessions WHERE source_type = 'local' ORDER BY created_at ASC, session_id ASC")
    .all()
    .map((row) => {
      if (!isRecord(row)) {
        throw new Error("Invalid local session migration row");
      }
      const sessionId = readString(row.session_id, "session_id");
      return {
        sessionId,
        parentSessionId: readNullableString(row.parent_session_id, "parent_session_id"),
        messages: listLocalMessages(database, sessionId) as WorkerLocalMessage[],
      };
    });
}

function rebuildSessionMessageIndex(database: SqliteDatabase, sessionId: string, values: unknown[]): null {
  const messages = values.map(readSessionFactMessage);
  for (const message of messages) {
    if (message.sessionId !== sessionId) {
      throw new Error(`session fact message belongs to ${message.sessionId}, expected ${sessionId}`);
    }
    const existing = database.prepare("SELECT session_id FROM session_messages WHERE id = ?").get(message.id);
    if (isRecord(existing) && readString(existing.session_id, "session_id") !== sessionId) {
      throw new Error(`session fact message id ${String(message.id)} belongs to another session`);
    }
  }
  transaction(database, () => {
    const insert = database.prepare(
      `INSERT INTO session_messages
        (id, session_id, speaker, role, body, status, run_id, run_dir, error, system_event_kind, terminal_json,
         failure_count, last_failure_reason, source_kind, source_id, text_fragments_json, activated_at,
         dispatch_lane, dispatch_role, dispatch_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         speaker = excluded.speaker,
         role = excluded.role,
         body = excluded.body,
         status = excluded.status,
         run_id = excluded.run_id,
         run_dir = excluded.run_dir,
         error = excluded.error,
         system_event_kind = excluded.system_event_kind,
         terminal_json = excluded.terminal_json,
         failure_count = excluded.failure_count,
         last_failure_reason = excluded.last_failure_reason,
         source_kind = excluded.source_kind,
         source_id = excluded.source_id,
         text_fragments_json = excluded.text_fragments_json,
         activated_at = excluded.activated_at,
         dispatch_lane = excluded.dispatch_lane,
         dispatch_role = excluded.dispatch_role,
         dispatch_reason = excluded.dispatch_reason,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at`,
    );
    for (const message of messages) {
      insert.run(
        message.id,
        message.sessionId,
        message.speaker,
        message.role,
        message.body,
        message.status,
        message.runId,
        message.runDir,
        message.error,
        message.systemEventKind,
        message.terminal == null ? null : JSON.stringify(message.terminal),
        message.failureCount,
        message.lastFailureReason,
        message.sourceKind,
        message.sourceId,
        JSON.stringify(message.textFragments ?? []),
        message.activatedAt,
        message.dispatchLane,
        message.dispatchRole,
        message.dispatchReason,
        message.createdAt,
        message.updatedAt,
      );
    }
    if (messages.length === 0) {
      database.prepare("DELETE FROM session_messages WHERE session_id = ?").run(sessionId);
    } else {
      const placeholders = messages.map(() => "?").join(", ");
      database
        .prepare(`DELETE FROM session_messages WHERE session_id = ? AND id NOT IN (${placeholders})`)
        .run(sessionId, ...messages.map((message) => message.id));
    }
    return null;
  });
  return null;
}

function rebuildExecutionIndex(
  database: SqliteDatabase,
  sessionId: string,
  contexts: unknown[],
  links: unknown[],
): null {
  transaction(database, () => {
    database.prepare("DELETE FROM local_run_execution_contexts WHERE session_id = ?").run(sessionId);
    database.prepare("DELETE FROM local_execution_session_links WHERE session_id = ?").run(sessionId);
    for (const context of contexts) {
      const runId = readExecutionIndexIdentity(context, sessionId);
      indexRunExecutionContext(database, sessionId, runId, context);
    }
    for (const link of links) {
      const runId = readExecutionIndexIdentity(link, sessionId);
      indexExecutionSessionLink(database, sessionId, runId, link);
    }
    return null;
  });
  return null;
}

function indexRunExecutionContext(
  database: SqliteDatabase,
  sessionId: string,
  runId: string,
  context: unknown,
): null {
  assertExecutionIndexIdentity(context, sessionId, runId);
  database.prepare(
    `INSERT INTO local_run_execution_contexts (session_id, run_id, context_json)
     VALUES (?, ?, ?)
     ON CONFLICT(session_id, run_id) DO UPDATE SET context_json = excluded.context_json`,
  ).run(sessionId, runId, JSON.stringify(context));
  return null;
}

function indexExecutionSessionLink(
  database: SqliteDatabase,
  sessionId: string,
  runId: string,
  link: unknown,
): null {
  assertExecutionIndexIdentity(link, sessionId, runId);
  database.prepare(
    `INSERT INTO local_execution_session_links (session_id, run_id, link_json)
     VALUES (?, ?, ?)
     ON CONFLICT(session_id, run_id) DO UPDATE SET link_json = excluded.link_json`,
  ).run(sessionId, runId, JSON.stringify(link));
  return null;
}

function readExecutionIndexIdentity(value: unknown, sessionId: string): string {
  if (!isRecord(value) || readString(value.sessionId, "sessionId") !== sessionId) {
    throw new Error(`execution fact belongs to another session: ${sessionId}`);
  }
  return readString(value.runId, "runId");
}

function assertExecutionIndexIdentity(
  value: unknown,
  sessionId: string,
  runId: string,
): void {
  if (readExecutionIndexIdentity(value, sessionId) !== runId) {
    throw new Error(`execution fact run id mismatch: ${runId}`);
  }
}

function findMessageSession(database: SqliteDatabase, messageId: number): { sessionId: string } | null {
  const row = database.prepare("SELECT session_id FROM session_messages WHERE id = ?").get(messageId);
  if (!isRecord(row)) {
    return null;
  }
  return { sessionId: readString(row.session_id, "session_id") };
}

function commitSessionFactWrite(
  database: SqliteDatabase,
  value: unknown,
  facts: Array<{
    sessionId: string;
    logPath: string;
    eventId: string;
    type: string;
    recordedAt: string;
    payload: unknown;
    beforeMessages: unknown[];
  }>,
): unknown {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new Error("Invalid session fact write command");
  }
  const command = value as SqliteStateCommand;
  return transaction(database, () => {
    const result = executeSessionFactWrite(database, command);
    const sessions = facts.map((fact) => {
      const messages = listLocalMessages(database, fact.sessionId) as WorkerLocalMessage[];
      const before = fact.beforeMessages.map(readSessionFactMessage);
      appendSessionFactEvent(fact.logPath, {
        version: 1,
        eventId: fact.eventId,
        sessionId: fact.sessionId,
        type: fact.type,
        recordedAt: fact.recordedAt,
        payload: fact.payload,
        messageUpserts: changedSessionFactMessages(before, messages),
      });
      return { sessionId: fact.sessionId, messages };
    });
    return { result, sessions };
  });
}

function changedSessionFactMessages(before: WorkerLocalMessage[], after: WorkerLocalMessage[]): WorkerLocalMessage[] {
  // 必须用键序无关的比较：前后两侧由不同构造函数产出，键序不同但语义相同，
  // 用 JSON.stringify 直接比会把全部消息判成变更，让日志按平方级膨胀。
  const existing = new Map(before.map((message) => [message.id, canonicalJson(message)]));
  return after.filter((message) => existing.get(message.id) !== canonicalJson(message));
}

function appendSessionFactEvent(logPath: string, event: unknown): void {
  appendSessionFactLogLineSync(logPath, JSON.stringify(event));
}

function executeSessionFactWrite(database: SqliteDatabase, command: SqliteStateCommand): unknown {
  switch (command.kind) {
    case "local-create-session": return createLocalSession(database, command);
    case "local-create-child-session": return createLocalChildSession(database, command);
    case "local-record-child-session-card": return recordChildSessionCard(database, command);
    case "local-append-user": return appendUserMessage(database, command);
    case "local-mark-pending-reference-error": return markPendingReferenceError(database, command);
    case "local-update-pending-user": return updatePendingUserMessage(database, command);
    case "local-remove-pending-user": return removePendingUserMessage(database, command);
    case "local-update-session-analysis-gate": return updateLocalSessionAnalysisGate(database, command);
    case "local-claim-next": return claimNextPendingMessage(database, command);
    case "local-claim-next-worker": return claimNextPendingWorkerMessage(database, command);
    case "local-resolve-awaiting-user-dispatches": return resolveAwaitingUserMessageDispatches(database, command);
    case "local-set-run-dir": return setRunDir(database, command);
    case "local-record-message-processed": return recordMessageProcessed(database, command);
    case "local-record-route-append": return recordLocalRouteAppend(database, command);
    case "local-record-route-no-action": return recordLocalRouteNoAction(database, command);
    case "local-release-message-for-retry": return releaseMessageForRetry(database, command);
    case "local-release-message-for-resume": return releaseMessageForResume(database, command);
    case "local-repair-agent-handoff-resume-source": return repairAgentHandoffResumeSource(database, command);
    case "local-record-agent-response": return recordAgentResponse(database, command);
    case "local-record-detached-run-started": return recordDetachedRunStarted(database, command);
    case "local-record-detached-agent-response": return recordDetachedAgentResponse(database, command);
    case "local-record-detached-run-terminal": return recordDetachedRunTerminal(database, command);
    case "local-record-system-and-complete": return recordSystemAndComplete(database, command);
    case "local-record-system": return recordSystemMessage(database, command);
    case "local-record-failure": return recordFailure(database, command);
    case "local-record-retryable-failure": return recordRetryableFailure(database, command);
    case "local-record-dead-letter-and-complete": return recordDeadLetterAndComplete(database, command);
    case "local-record-interrupted": return recordInterrupted(database, command);
    case "local-record-stuck": return recordStuck(database, command);
    case "local-record-route-decision": return recordLocalRouteDecision(database, command);
    case "local-record-dead-letter": return recordLocalDeadLetter(database, command);
    case "local-record-workspace-diff": return recordLocalWorkspaceDiff(database, command);
    case "local-mark-stale-running": return markStaleRunning(database, command);
    case "local-update-session-member-execution": return updateLocalSessionMemberExecution(database, command);
    default:
      throw new Error(`Unsupported session fact write command: ${command.kind}`);
  }
}

function readSessionFactMessage(value: unknown): WorkerLocalMessage {
  if (!isRecord(value)) {
    throw new Error("Invalid session fact message");
  }
  return {
    id: readNumber(value.id, "id"),
    sessionId: readString(value.sessionId, "sessionId"),
    speaker: readString(value.speaker, "speaker"),
    role: readNullableString(value.role, "role"),
    body: readString(value.body, "body"),
    status: readString(value.status, "status"),
    runId: readNullableString(value.runId, "runId"),
    runDir: readNullableString(value.runDir, "runDir"),
    error: readNullableString(value.error, "error"),
    systemEventKind: readSystemEventKind(value.systemEventKind),
    terminal: "terminal" in value ? readLocalTerminal(value.terminal) : null,
    failureCount: readNumber(value.failureCount, "failureCount"),
    lastFailureReason: readNullableString(value.lastFailureReason, "lastFailureReason"),
    sourceKind: readNullableString(value.sourceKind, "sourceKind"),
    sourceId: readNullableString(value.sourceId, "sourceId"),
    attachments: Array.isArray(value.attachments) ? value.attachments : [],
    textFragments: Array.isArray(value.textFragments) ? readTextFragments(value.textFragments) : [],
    activatedAt: "activatedAt" in value ? readNullableString(value.activatedAt, "activatedAt") : null,
    dispatchLane: "dispatchLane" in value
      ? readDispatchLane(value.dispatchLane)
      : value.speaker === "user" ? "primary" : null,
    dispatchRole: "dispatchRole" in value ? readNullableString(value.dispatchRole, "dispatchRole") : null,
    dispatchReason: "dispatchReason" in value
      ? readDispatchReason(value.dispatchReason)
      : value.speaker === "user" ? "no-valid-mention" : null,
    createdAt: readString(value.createdAt, "createdAt"),
    updatedAt: readString(value.updatedAt, "updatedAt"),
  };
}

function createLocalProject(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-create-project" }>,
): unknown {
  return transaction(database, () => {
    const folderPath = path.resolve(input.folderPath);
    const activeProject = database
      .prepare("SELECT project_id FROM projects WHERE folder_path = ? AND removed_at IS NULL")
      .get(folderPath);
    if (isRecord(activeProject)) {
      database
        .prepare("UPDATE projects SET worktree_mode = ?, updated_at = ? WHERE project_id = ?")
        .run(input.worktreeMode ? 1 : 0, input.now, readString(activeProject.project_id, "project_id"));
      return requireLocalProject(database, readString(activeProject.project_id, "project_id"));
    }
    const projectId = nextProjectIdForFolder(database, folderPath, input.now);
    database
      .prepare(
        `INSERT INTO projects
          (project_id, source_type, title, folder_path, worktree_mode, workspace_cwd, workspace_mode, worktree_path, worktree_unavailable_reason, workspace_updated_at, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL,
           (SELECT COALESCE(MIN(sort_order), 1) - 1 FROM projects WHERE removed_at IS NULL), ?, ?)`,
      )
      .run(
        projectId,
        LOCAL_CONSOLE_PROJECT_SOURCE_TYPE,
        projectTitleFromFolder(folderPath),
        folderPath,
        input.worktreeMode ? 1 : 0,
        input.now,
        input.now,
      );
    return requireLocalProjectByFolderPath(database, folderPath);
  });
}

function renameLocalProject(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-rename-project" }>,
): unknown {
  return transaction(database, () => {
    const project = database
      .prepare("SELECT folder_path FROM projects WHERE project_id = ? AND removed_at IS NULL")
      .get(input.projectId);
    if (!isRecord(project)) {
      throw new Error(`local console project not found: ${input.projectId}`);
    }
    const title = planPersistedProjectTitle(
      input.title,
      projectTitleFromFolder(readString(project.folder_path, "folder_path")),
    );
    database
      .prepare("UPDATE projects SET title = ?, updated_at = ? WHERE project_id = ?")
      .run(title, input.now, input.projectId);
    return requireLocalProject(database, input.projectId);
  });
}

function repairLocalProjectFolder(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-repair-project-folder" }>,
): unknown {
  return transaction(database, () => {
    const project = database
      .prepare("SELECT project_id FROM projects WHERE project_id = ? AND removed_at IS NULL")
      .get(input.projectId);
    if (!isRecord(project)) {
      throw new Error("LOCAL_PROJECT_NOT_FOUND");
    }
    const folderPath = path.resolve(input.folderPath);
    const conflict = database
      .prepare("SELECT project_id FROM projects WHERE folder_path = ? AND removed_at IS NULL AND project_id <> ?")
      .get(folderPath, input.projectId);
    if (isRecord(conflict)) {
      throw new Error(`PROJECT_FOLDER_ALREADY_BOUND:${readString(conflict.project_id, "project_id")}`);
    }
    database
      .prepare(
        `UPDATE projects
         SET folder_path = ?,
             original_folder_path = NULL,
             workspace_cwd = NULL,
             workspace_mode = NULL,
             worktree_path = NULL,
             worktree_unavailable_reason = NULL,
             workspace_updated_at = NULL,
             updated_at = ?
         WHERE project_id = ?`,
      )
      .run(folderPath, input.now, input.projectId);
    return requireLocalProject(database, input.projectId);
  });
}

function removeLocalProject(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-remove-project" }>,
): unknown {
  return transaction(database, () => {
    const project = database
      .prepare("SELECT folder_path FROM projects WHERE project_id = ? AND removed_at IS NULL")
      .get(input.projectId);
    if (!isRecord(project)) {
      throw new Error(`local console project not found: ${input.projectId}`);
    }
    const activeSessionRows = database
      .prepare("SELECT session_id FROM sessions WHERE project_id = ? AND source_type = 'local' AND archived_at IS NULL")
      .all(input.projectId);
    const projectSessionIds = activeSessionRows.map((row) => {
      if (!isRecord(row)) {
        throw new Error("Invalid local console session row");
      }
      return readString(row.session_id, "session_id");
    });
    const archivedSessionIds = listActiveAnalysisSubtreeIds(database, projectSessionIds);
    const hasPendingControlWorkInProject = archivedSessionIds.some((sessionId) =>
      hasPendingLocalControlWork(database, sessionId));
    assertProjectRemovalIdle({ hasPendingControlWork: hasPendingControlWorkInProject, force: input.force });
    const originalFolderPath = readString(project.folder_path, "folder_path");
    const releasedFolderPath = `${originalFolderPath}#removed:${input.projectId}:${input.now}`;
    database
      .prepare(
        `UPDATE projects
         SET original_folder_path = ?, folder_path = ?, removed_at = ?, updated_at = ?
         WHERE project_id = ?`,
      )
      .run(originalFolderPath, releasedFolderPath, input.now, input.now, input.projectId);
    updateSessionsArchivedAt(database, archivedSessionIds, input.now, input.now);
    for (const sessionId of archivedSessionIds) {
      clearLocalCursorActive(database, sessionId, input.now);
    }
    return { projectId: input.projectId, archivedSessionIds };
  });
}

function updateLocalProject(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-update-project" }>,
): unknown {
  return transaction(database, () => {
    const result = database
      .prepare("UPDATE projects SET worktree_mode = ?, updated_at = ? WHERE project_id = ?")
      .run(input.worktreeMode ? 1 : 0, input.now, input.projectId);
    if (Number(result.changes ?? 0) !== 1) {
      throw new Error(`local console project not found: ${input.projectId}`);
    }
    return requireLocalProject(database, input.projectId);
  });
}

function listLocalProjects(database: SqliteDatabase, defaultProjectFolderPath: string): unknown[] {
  const rows = database
    .prepare(
      "SELECT * FROM projects WHERE removed_at IS NULL ORDER BY sort_order ASC, created_at DESC, project_id ASC",
    )
    .all();
  return rows
    .filter((row) => !isUnusedDefaultLocalProject(database, row, defaultProjectFolderPath))
    .map((row) => readLocalProjectRow(database, row));
}

function reorderLocalProjects(
  database: SqliteDatabase,
  projectIds: string[],
  defaultProjectFolderPath: string,
): unknown[] {
  return transaction(database, () => {
    const rows = database
      .prepare("SELECT * FROM projects WHERE removed_at IS NULL")
      .all()
      .filter((row) => !isUnusedDefaultLocalProject(database, row, defaultProjectFolderPath));
    const storedIds = rows.map((row) => {
      if (!isRecord(row)) {
        throw new Error("Invalid local console project row during reorder");
      }
      return readString(row.project_id, "project_id");
    });
    assertCompleteProjectOrder(projectIds, storedIds);
    const update = database.prepare("UPDATE projects SET sort_order = ? WHERE project_id = ?");
    projectIds.forEach((projectId, index) => update.run(index, projectId));
    return listLocalProjects(database, defaultProjectFolderPath);
  });
}

function getLocalProject(database: SqliteDatabase, projectId: string): unknown {
  const row = database
    .prepare("SELECT * FROM projects WHERE project_id = ? AND removed_at IS NULL")
    .get(projectId);
  return row === undefined ? null : readLocalProjectRow(database, row);
}

function isUnusedDefaultLocalProject(
  database: SqliteDatabase,
  row: unknown,
  defaultProjectFolderPath: string,
): boolean {
  if (!isRecord(row)) {
    throw new Error("Invalid local console project row");
  }
  const normalizedDefaultFolderPath = path.resolve(defaultProjectFolderPath);
  if (
    readNullableString(row.original_folder_path, "original_folder_path") !== null
    || readNullableString(row.removed_at, "removed_at") !== null
  ) {
    return false;
  }
  const projectIdentity = decideDefaultProjectIdentity({
    projectId: readString(row.project_id, "project_id"),
    sourceType: readString(row.source_type, "source_type"),
    title: readString(row.title, "title"),
    folderPath: path.resolve(readString(row.folder_path, "folder_path")),
    worktreeMode: readBooleanNumber(row.worktree_mode, "worktree_mode"),
    expectedProjectId: LOCAL_CONSOLE_PROJECT_ID,
    expectedSourceType: LOCAL_CONSOLE_PROJECT_SOURCE_TYPE,
    expectedTitle: projectTitleFromFolder(normalizedDefaultFolderPath),
    expectedFolderPath: normalizedDefaultFolderPath,
  });
  const inspectProject = {
    used: () => false,
    "inspect-session": () => readUnusedDefaultLocalProjectSession(database),
  } satisfies Record<typeof projectIdentity, () => boolean>;
  return inspectProject[projectIdentity]();
}

function readUnusedDefaultLocalProjectSession(database: SqliteDatabase): boolean {
  const sessionRows = database
    .prepare("SELECT * FROM sessions WHERE project_id = ?")
    .all(LOCAL_CONSOLE_PROJECT_ID);
  if (sessionRows.length !== 1 || !isRecord(sessionRows[0])) {
    return false;
  }
  const session = sessionRows[0];
  const sessionIdentity = decideDefaultSessionIdentity({
    sessionId: readString(session.session_id, "session_id"),
    sourceType: readString(session.source_type, "source_type"),
    expectedSessionId: LOCAL_CONSOLE_DEFAULT_SESSION_ID,
  });
  const inspectSession = {
    used: () => false,
    "inspect-facts": () => readUnusedDefaultLocalSessionFacts(database, session),
  } satisfies Record<typeof sessionIdentity, () => boolean>;
  return inspectSession[sessionIdentity]();
}

function readUnusedDefaultLocalSessionFacts(
  database: SqliteDatabase,
  session: Record<string, unknown>,
): boolean {
  if (
    readNullableString(session.source_owner, "source_owner") !== null
    || readNullableString(session.source_repo, "source_repo") !== null
    || session.source_issue_number !== null
    || readNullableString(session.parent_session_id, "parent_session_id") !== null
    || readNullableString(session.analysis_parent_session_id, "analysis_parent_session_id") !== null
    || readNullableString(session.agent_team_ownership, "agent_team_ownership") !== null
    || readNullableString(session.agent_team_id, "agent_team_id") !== null
    || readNullableString(session.agent_team_pending_ownership, "agent_team_pending_ownership") !== null
    || readNullableString(session.agent_team_pending_id, "agent_team_pending_id") !== null
    || readNullableString(session.workspace_mode, "workspace_mode") !== "direct"
    || readNullableString(session.workspace_pending_mode, "workspace_pending_mode") !== null
    || readNullableString(session.title, "title") !== "默认会话"
    || readString(session.status, "status") !== "active"
    || readNullableString(session.archived_at, "archived_at") !== null
    || readNullableString(session.awaits_human_reason, "awaits_human_reason") !== null
    || readNullableString(session.unread_since, "unread_since") !== null
  ) {
    return false;
  }

  const cursor = database
    .prepare("SELECT * FROM local_message_cursors WHERE session_id = ?")
    .get(LOCAL_CONSOLE_DEFAULT_SESSION_ID);
  if (
    !isRecord(cursor)
    || readNumber(cursor.processed_through_message_id, "processed_through_message_id") !== 0
    || cursor.active_message_id !== null
    || readNullableString(cursor.active_run_id, "active_run_id") !== null
  ) {
    return false;
  }

  const relationshipExists = database
    .prepare(
      `SELECT 1 AS found
       WHERE EXISTS (
         SELECT 1 FROM sessions
         WHERE parent_session_id = ?
       )
       OR EXISTS (
         SELECT 1 FROM sessions
         WHERE analysis_parent_session_id = ?
       )
       OR EXISTS (
         SELECT 1 FROM session_edges
         WHERE parent_session_id = ? OR child_session_id = ?
       )`,
    )
    .get(
      LOCAL_CONSOLE_DEFAULT_SESSION_ID,
      LOCAL_CONSOLE_DEFAULT_SESSION_ID,
      LOCAL_CONSOLE_DEFAULT_SESSION_ID,
      LOCAL_CONSOLE_DEFAULT_SESSION_ID,
    );
  if (relationshipExists !== undefined) {
    return false;
  }

  const factQueries = [
    "SELECT 1 AS found FROM session_agent_team_members WHERE session_id = ? LIMIT 1",
    "SELECT 1 AS found FROM session_messages WHERE session_id = ? LIMIT 1",
    "SELECT 1 AS found FROM local_route_decisions WHERE session_id = ? LIMIT 1",
    "SELECT 1 AS found FROM local_acceptance_facts WHERE session_id = ? LIMIT 1",
    "SELECT 1 AS found FROM local_integration_events WHERE session_id = ? LIMIT 1",
    "SELECT 1 AS found FROM local_dead_letters WHERE session_id = ? LIMIT 1",
    "SELECT 1 AS found FROM local_workspace_diffs WHERE session_id = ? LIMIT 1",
  ];
  return factQueries.every((sql) =>
    database.prepare(sql).get(LOCAL_CONSOLE_DEFAULT_SESSION_ID) === undefined
  );
}

function getLocalSessionWorkspace(database: SqliteDatabase, sessionId: string): unknown {
  const row = database
    .prepare(
      `SELECT p.project_id, p.title, p.folder_path, s.workspace_mode
       FROM sessions s
       JOIN projects p ON p.project_id = s.project_id
       WHERE s.session_id = ? AND s.source_type = 'local'`,
    )
    .get(sessionId);
  if (!isRecord(row)) {
    throw new Error(`local console session workspace not found: ${sessionId}`);
  }
  return {
    projectId: readString(row.project_id, "project_id"),
    title: readString(row.title, "title"),
    folderPath: readString(row.folder_path, "folder_path"),
    workspaceMode: readLocalWorkspaceMode(row.workspace_mode, "workspace_mode"),
    workspacePendingMode: null,
    session: requireLocalSession(database, sessionId),
  };
}

function switchLocalSessionWorkspace(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-switch-session-workspace" }>,
): unknown {
  return transaction(database, () => {
    requireLocalSession(database, input.sessionId);
    assertSessionWorkspaceMutable(hasSessionMessage(database, input.sessionId));
    database.prepare(
      "UPDATE sessions SET workspace_mode = ?, updated_at = ? WHERE session_id = ? AND source_type = 'local'",
    ).run(input.workspaceMode, input.now, input.sessionId);
    return requireLocalSession(database, input.sessionId);
  });
}

function switchLocalSessionTeam(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-switch-session-team" }>,
): unknown {
  return transaction(database, () => {
    requireLocalSession(database, input.sessionId);
    const hasQueuedWorker = database
      .prepare(
        `SELECT 1 AS found
         FROM session_messages
         WHERE session_id = ?
           AND speaker = 'user'
           AND status = 'pending'
           AND dispatch_lane = 'worker'
           AND COALESCE(error, '') <> 'TARGET_CONTINUATION_ENDED'
         LIMIT 1`,
      )
      .get(input.sessionId) !== undefined;
    const writePending = () => {
      database.prepare(
        `UPDATE sessions
         SET agent_team_pending_ownership = ?, agent_team_pending_id = ?, updated_at = ?
         WHERE session_id = ? AND source_type = 'local'`,
      ).run(input.agentTeamOwnership, input.agentTeamId, input.now, input.sessionId);
      replaceLocalSessionAgentTeamSnapshot(database, input.sessionId, "pending", input.agentTeamSnapshot);
    };
    const writeEffective = () => {
      database.prepare(
        `UPDATE sessions
         SET agent_team_ownership = ?, agent_team_id = ?,
             agent_team_pending_ownership = NULL, agent_team_pending_id = NULL, updated_at = ?
         WHERE session_id = ? AND source_type = 'local'`,
      ).run(input.agentTeamOwnership, input.agentTeamId, input.now, input.sessionId);
      replaceLocalSessionAgentTeamSnapshot(database, input.sessionId, "effective", input.agentTeamSnapshot);
      replaceLocalSessionAgentTeamSnapshot(database, input.sessionId, "pending", undefined);
    };
    const teamWrite = planSessionTeamWrite({
      hasRunningMessage: hasRunningMessage(database, input.sessionId),
      hasQueuedWorker,
    });
    ({ pending: writePending, effective: writeEffective })[teamWrite]();
    return requireLocalSession(database, input.sessionId);
  });
}

function updateLocalSessionMemberExecution(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-update-session-member-execution" }>,
): unknown {
  return transaction(database, () => {
    requireLocalSession(database, input.sessionId);
    if (hasRunningMessage(database, input.sessionId)) {
      throw new Error("SESSION_EXECUTION_MIGRATION_BUSY");
    }
    const existing = database.prepare(
      `SELECT 1 AS found
       FROM session_agent_team_members
       WHERE session_id = ? AND slot = 'effective' AND member_name = ?`,
    ).get(input.sessionId, input.memberName);
    if (existing === undefined) {
      throw new Error("SESSION_MEMBER_NOT_FOUND");
    }
    if (input.action === "migrate") {
      const profile = input.executionProfile;
      if (profile === undefined) throw new Error("SESSION_EXECUTION_PROFILE_REQUIRED");
      database.prepare(
        `UPDATE session_agent_team_members
         SET execution_cli = ?, execution_model = ?, execution_effort = ?,
             provider_id = ?, provider_profile_id = ?, continuation_ended = 0
         WHERE session_id = ? AND slot = 'effective' AND member_name = ?`,
      ).run(
        profile.cli,
        profile.model,
        profile.effort,
        profile.cli === "pi" ? profile.providerId : null,
        profile.cli === "pi" ? profile.providerProfileId : null,
        input.sessionId,
        input.memberName,
      );
    } else {
      database.prepare(
        `UPDATE session_agent_team_members
         SET continuation_ended = 1
         WHERE session_id = ? AND slot = 'effective' AND member_name = ?`,
      ).run(input.sessionId, input.memberName);
      database.prepare(
        `UPDATE session_messages
         SET error = 'TARGET_CONTINUATION_ENDED', updated_at = ?
         WHERE session_id = ?
           AND speaker = 'user'
           AND status = 'pending'
           AND dispatch_lane IN ('primary', 'worker')
           AND dispatch_role = ?`,
      ).run(input.now, input.sessionId, input.memberName);
    }
    database.prepare(
      "UPDATE sessions SET updated_at = ? WHERE session_id = ? AND source_type = 'local'",
    ).run(input.now, input.sessionId);
    return listLocalSessionAgentTeamSnapshot(database, input.sessionId);
  });
}

function applyPendingLocalSessionContext(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-apply-pending-session-context" }>,
): unknown {
  return transaction(database, () => {
    const intent = database.prepare(
      `SELECT from_snapshot_key, status, requested_at
       FROM session_team_update_intents
       WHERE session_id = ?`,
    ).get(input.sessionId);
    const fromSnapshotKey = isRecord(intent)
      ? readNullableString(intent.from_snapshot_key, "from_snapshot_key")
      : null;
    const intentStatus = isRecord(intent)
      ? readString(intent.status, "status") as "waiting" | "failed"
      : null;
    const oldTeamWork = database
      .prepare(
        `SELECT 1 AS found
         FROM session_messages
         WHERE session_id = ?
           AND status IN ('pending', 'running')
           AND dispatch_lane != 'awaiting-team'
           AND (? IS NULL OR dispatch_snapshot_key = ? OR dispatch_snapshot_key IS NULL)
           AND (status != 'pending' OR COALESCE(error, '') <> 'TARGET_CONTINUATION_ENDED')
         LIMIT 1`,
      )
      .get(input.sessionId, fromSnapshotKey, fromSnapshotKey);
    if (oldTeamWork !== undefined) {
      return requireLocalSession(database, input.sessionId);
    }
    const unrecoverableOldWork = intentStatus === "waiting" && isRecord(intent)
      ? database.prepare(
          `SELECT 1 AS found
           FROM session_messages
           WHERE session_id = ?
             AND status = 'stuck'
             AND dispatch_lane != 'awaiting-team'
             AND (? IS NULL OR dispatch_snapshot_key = ? OR dispatch_snapshot_key IS NULL)
             AND updated_at >= ?
           LIMIT 1`,
        ).get(
          input.sessionId,
          fromSnapshotKey,
          fromSnapshotKey,
          readString(intent.requested_at, "requested_at"),
        ) !== undefined
      : false;
    const hasPendingTeam = database
      .prepare("SELECT 1 AS found FROM sessions WHERE session_id = ? AND agent_team_pending_id IS NOT NULL")
      .get(input.sessionId) !== undefined;
    const teamPromotion = planPersistedSessionTeamPromotion({
      intentStatus,
      hasPendingTeam,
      hasUnrecoverableOldWork: unrecoverableOldWork,
    });
    const failTeamPromotion = () => {
      database.prepare(
        `UPDATE session_team_update_intents
         SET status = 'failed',
             failure_code = 'TEAM_UPDATE_OLD_WORK_UNRECOVERABLE',
             failure_summary = '旧工作在恢复时无法继续；团队更新仍未应用。'
         WHERE session_id = ?`,
      ).run(input.sessionId);
      return requireLocalSession(database, input.sessionId);
    };
    const applyReadyContext = () => {
      database.prepare(
        `UPDATE sessions
         SET agent_team_ownership = COALESCE(agent_team_pending_ownership, agent_team_ownership),
             agent_team_id = COALESCE(agent_team_pending_id, agent_team_id),
             agent_team_pending_ownership = NULL,
             agent_team_pending_id = NULL,
             updated_at = CASE
               WHEN agent_team_pending_id IS NOT NULL THEN ?
               ELSE updated_at
             END
         WHERE session_id = ? AND source_type = 'local'`,
      ).run(input.now, input.sessionId);
      const promotePendingTeam = () => {
        database.prepare(
          "DELETE FROM session_agent_team_members WHERE session_id = ? AND slot = 'effective'",
        ).run(input.sessionId);
        database.prepare(
          "DELETE FROM session_agent_team_snapshot_meta WHERE session_id = ? AND slot = 'effective'",
        ).run(input.sessionId);
        database.prepare(
          "UPDATE session_agent_team_members SET slot = 'effective' WHERE session_id = ? AND slot = 'pending'",
        ).run(input.sessionId);
        database.prepare(
          `UPDATE session_agent_team_snapshot_meta
           SET slot = 'effective', loaded_at = ?
           WHERE session_id = ? AND slot = 'pending'`,
        ).run(input.now, input.sessionId);
        database.prepare(
          "DELETE FROM session_agent_team_members WHERE session_id = ? AND slot = 'candidate'",
        ).run(input.sessionId);
        database.prepare(
          "DELETE FROM session_agent_team_snapshot_meta WHERE session_id = ? AND slot = 'candidate'",
        ).run(input.sessionId);
        database.prepare("DELETE FROM session_team_update_intents WHERE session_id = ?").run(input.sessionId);
      };
      ({ promote: promotePendingTeam, skip: () => undefined })[planPendingTeamPromotion(hasPendingTeam)]();
      return requireLocalSession(database, input.sessionId);
    };
    return ({
      fail: failTeamPromotion,
      wait: () => requireLocalSession(database, input.sessionId),
      promote: applyReadyContext,
      skip: applyReadyContext,
    })[teamPromotion]();
  });
}

function replaceLocalSessionAgentTeamSnapshot(
  database: SqliteDatabase,
  sessionId: string,
  slot: "effective" | "candidate" | "pending",
  snapshot: LocalConsoleAgentTeamSnapshot | undefined,
): void {
  database.prepare(
    "DELETE FROM session_agent_team_members WHERE session_id = ? AND slot = ?",
  ).run(sessionId, slot);
  database.prepare(
    "DELETE FROM session_agent_team_snapshot_meta WHERE session_id = ? AND slot = ?",
  ).run(sessionId, slot);
  if (snapshot === undefined) {
    return;
  }
  const team = snapshot.team;
  const digests = snapshot.digests;
  database.prepare(
    `INSERT INTO session_agent_team_snapshot_meta
      (session_id, slot, team_ownership, team_id, team_name, team_description,
       primary_agent_slug, official_source_name, team_created_at, captured_at, loaded_at,
       snapshot_key, agent_definition_digest, execution_profile_digest, team_information_digest)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    slot,
    team?.ownership ?? null,
    team?.id ?? null,
    team?.name ?? null,
    team?.description ?? null,
    team?.primaryAgentSlug ?? null,
    team?.officialSourceName ?? null,
    team?.createdAt ?? null,
    snapshot.capturedAt ?? null,
    snapshot.loadedAt ?? null,
    snapshot.snapshotKey ?? null,
    digests?.agentDefinition ?? null,
    digests?.executionProfile ?? null,
    digests?.teamInformation ?? null,
  );
  const insert = database.prepare(
    `INSERT INTO session_agent_team_members
      (session_id, slot, member_name, display_name, member_description, agent_markdown,
       execution_cli, execution_model, execution_effort, provider_id, provider_profile_id,
       continuation_ended, sort_order, snapshot_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  snapshot.members.forEach((member, index) => {
    const profile = member.executionProfile;
    insert.run(
      sessionId,
      slot,
      member.name,
      member.displayName ?? null,
      member.description ?? null,
      member.agentMarkdown,
      profile?.cli ?? null,
      profile?.model ?? null,
      profile?.effort ?? null,
      profile?.cli === "pi" ? profile.providerId : null,
      profile?.cli === "pi" ? profile.providerProfileId : null,
      member.continuationEnded === true ? 1 : 0,
      index,
      snapshot.snapshotKey ?? null,
    );
  });
}

function primaryAgentForSession(database: SqliteDatabase, sessionId: string): string | null {
  const row = database
    .prepare(
      `SELECT member_name
       FROM session_agent_team_members
       WHERE session_id = ? AND slot = 'effective'
       ORDER BY sort_order ASC
       LIMIT 1`,
    )
    .get(sessionId);
  return isRecord(row) ? readString(row.member_name, "member_name") : null;
}

function listLocalSessionAgentTeamSnapshot(
  database: SqliteDatabase,
  sessionId: string,
): LocalConsoleAgentTeamSnapshot | null {
  return readLocalSessionAgentTeamSnapshotSlot(database, sessionId, "effective");
}

function readLocalSessionAgentTeamSnapshotSlot(
  database: SqliteDatabase,
  sessionId: string,
  slot: "effective" | "candidate" | "pending",
): LocalConsoleAgentTeamSnapshot | null {
  const rows = database.prepare(
    `SELECT member_name, display_name, member_description, agent_markdown,
            execution_cli, execution_model, execution_effort,
            provider_id, provider_profile_id, continuation_ended
     FROM session_agent_team_members
     WHERE session_id = ? AND slot = ?
     ORDER BY sort_order ASC, member_name ASC`,
  ).all(sessionId, slot);
  if (rows.length === 0) {
    return null;
  }
  const meta = database.prepare(
    "SELECT * FROM session_agent_team_snapshot_meta WHERE session_id = ? AND slot = ?",
  ).get(sessionId, slot);
  const metadata = isRecord(meta) ? meta : null;
  return {
    ...(metadata === null || metadata.team_ownership === null || metadata.team_id === null
      ? {}
      : {
          team: {
            ownership: readNullableAgentTeamOwnership(metadata.team_ownership)!,
            id: readString(metadata.team_id, "team_id"),
            name: readNullableString(metadata.team_name, "team_name"),
            description: readNullableString(metadata.team_description, "team_description"),
            primaryAgentSlug: readNullableString(metadata.primary_agent_slug, "primary_agent_slug"),
            officialSourceName: readNullableString(metadata.official_source_name, "official_source_name"),
            createdAt: readNullableString(metadata.team_created_at, "team_created_at"),
          },
          capturedAt: readNullableString(metadata.captured_at, "captured_at"),
          loadedAt: readNullableString(metadata.loaded_at, "loaded_at"),
          snapshotKey: readNullableString(metadata.snapshot_key, "snapshot_key"),
          digests: metadata.agent_definition_digest === null
            || metadata.execution_profile_digest === null
            || metadata.team_information_digest === null
            ? undefined
            : {
                agentDefinition: readString(metadata.agent_definition_digest, "agent_definition_digest"),
                executionProfile: readString(metadata.execution_profile_digest, "execution_profile_digest"),
                teamInformation: readString(metadata.team_information_digest, "team_information_digest"),
              },
        }),
    members: rows.map((row) => {
      if (!isRecord(row)) {
        throw new Error("Invalid local session Agent team snapshot row");
      }
      return {
        name: readString(row.member_name, "member_name"),
        displayName: readNullableString(row.display_name, "display_name"),
        description: readNullableString(row.member_description, "member_description"),
        agentMarkdown: readString(row.agent_markdown, "agent_markdown"),
        executionProfile: readExecutionProfile(row),
        continuationEnded: row.continuation_ended === 1,
      };
    }),
  };
}

function writeLocalSessionTeamCandidate(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-write-session-team-candidate" }>,
): null {
  return transaction(database, () => {
    requireLocalSession(database, input.sessionId);
    replaceLocalSessionAgentTeamSnapshot(database, input.sessionId, "candidate", input.snapshot ?? undefined);
    return null;
  });
}

function readLocalSessionTeamUpdateRecord(
  database: SqliteDatabase,
  sessionId: string,
): import("./local-console/types.js").LocalConsoleSessionTeamUpdateRecord {
  requireLocalSession(database, sessionId);
  const row = database.prepare(
    "SELECT * FROM session_team_update_intents WHERE session_id = ?",
  ).get(sessionId);
  const intent = isRecord(row)
    ? {
        status: readString(row.status, "status") as "waiting" | "failed",
        targetSnapshotKey: readString(row.target_snapshot_key, "target_snapshot_key"),
        failureCode: readNullableString(row.failure_code, "failure_code"),
        failureSummary: readNullableString(row.failure_summary, "failure_summary"),
      }
    : null;
  if (intent !== null && intent.status !== "waiting" && intent.status !== "failed") {
    throw new Error("Invalid session team update intent status");
  }
  return {
    candidate: readLocalSessionAgentTeamSnapshotSlot(database, sessionId, "candidate"),
    pending: readLocalSessionAgentTeamSnapshotSlot(database, sessionId, "pending"),
    intent,
  };
}

function beginLocalSessionTeamUpdate(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-begin-session-team-update" }>,
): null {
  return transaction(database, () => {
    requireLocalSession(database, input.sessionId);
    const candidate = readLocalSessionAgentTeamSnapshotSlot(database, input.sessionId, "candidate");
    if (candidate?.snapshotKey == null || candidate.team == null) {
      throw new Error("SESSION_TEAM_UPDATE_CANDIDATE_MISSING");
    }
    if (input.expectedUpdateToken != null && candidate.snapshotKey !== input.expectedUpdateToken) {
      throw new Error("SESSION_TEAM_UPDATE_STALE");
    }
    const effective = readLocalSessionAgentTeamSnapshotSlot(database, input.sessionId, "effective");
    if (effective?.snapshotKey != null) {
      database.prepare(
        `UPDATE session_messages
         SET dispatch_snapshot_key = ?
         WHERE session_id = ?
           AND dispatch_snapshot_key IS NULL
           AND status IN ('pending', 'running')
           AND dispatch_lane != 'awaiting-team'`,
      ).run(effective.snapshotKey, input.sessionId);
    }
    database.prepare("DELETE FROM session_agent_team_members WHERE session_id = ? AND slot = 'pending'").run(input.sessionId);
    database.prepare("DELETE FROM session_agent_team_snapshot_meta WHERE session_id = ? AND slot = 'pending'").run(input.sessionId);
    database.prepare(
      `INSERT INTO session_agent_team_members
        (session_id, slot, member_name, display_name, member_description, agent_markdown,
         execution_cli, execution_model, execution_effort, provider_id, provider_profile_id,
         continuation_ended, sort_order, snapshot_key)
       SELECT session_id, 'pending', member_name, display_name, member_description, agent_markdown,
              execution_cli, execution_model, execution_effort, provider_id, provider_profile_id,
              continuation_ended, sort_order, snapshot_key
       FROM session_agent_team_members
       WHERE session_id = ? AND slot = 'candidate'`,
    ).run(input.sessionId);
    database.prepare(
      `INSERT INTO session_agent_team_snapshot_meta
        (session_id, slot, team_ownership, team_id, team_name, team_description,
         primary_agent_slug, official_source_name, team_created_at, captured_at, loaded_at,
         snapshot_key, agent_definition_digest, execution_profile_digest, team_information_digest)
       SELECT session_id, 'pending', team_ownership, team_id, team_name, team_description,
              primary_agent_slug, official_source_name, team_created_at, captured_at, NULL,
              snapshot_key, agent_definition_digest, execution_profile_digest, team_information_digest
       FROM session_agent_team_snapshot_meta
       WHERE session_id = ? AND slot = 'candidate'`,
    ).run(input.sessionId);
    database.prepare(
      `UPDATE sessions
       SET agent_team_pending_ownership = ?, agent_team_pending_id = ?, updated_at = ?
       WHERE session_id = ?`,
    ).run(candidate.team.ownership, candidate.team.id, input.now, input.sessionId);
    database.prepare(
      `INSERT INTO session_team_update_intents
        (session_id, from_snapshot_key, target_snapshot_key, status, requested_at, failure_code, failure_summary)
       VALUES (?, ?, ?, 'waiting', ?, NULL, NULL)
       ON CONFLICT(session_id) DO UPDATE SET
         from_snapshot_key = excluded.from_snapshot_key,
         target_snapshot_key = excluded.target_snapshot_key,
         status = 'waiting', requested_at = excluded.requested_at,
         failure_code = NULL, failure_summary = NULL`,
    ).run(input.sessionId, effective?.snapshotKey ?? null, candidate.snapshotKey, input.now);
    return null;
  });
}

function cancelLocalSessionTeamUpdate(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-cancel-session-team-update" }>,
): null {
  return transaction(database, () => {
    requireLocalSession(database, input.sessionId);
    if (input.expectedUpdateToken != null) {
      const intent = database.prepare(
        "SELECT target_snapshot_key FROM session_team_update_intents WHERE session_id = ?",
      ).get(input.sessionId);
      const candidate = readLocalSessionAgentTeamSnapshotSlot(database, input.sessionId, "candidate");
      const pending = readLocalSessionAgentTeamSnapshotSlot(database, input.sessionId, "pending");
      const targetMatches = isRecord(intent)
        ? readString(intent.target_snapshot_key, "target_snapshot_key") === input.expectedUpdateToken
        : candidate?.snapshotKey === input.expectedUpdateToken || pending?.snapshotKey === input.expectedUpdateToken;
      if (!targetMatches) {
        throw new Error("SESSION_TEAM_UPDATE_STALE");
      }
    }
    database.prepare(
      `UPDATE sessions
       SET agent_team_pending_ownership = NULL, agent_team_pending_id = NULL, updated_at = ?
       WHERE session_id = ?`,
    ).run(input.now, input.sessionId);
    database.prepare("DELETE FROM session_agent_team_members WHERE session_id = ? AND slot = 'pending'").run(input.sessionId);
    database.prepare("DELETE FROM session_agent_team_snapshot_meta WHERE session_id = ? AND slot = 'pending'").run(input.sessionId);
    database.prepare("DELETE FROM session_team_update_intents WHERE session_id = ?").run(input.sessionId);
    return null;
  });
}

function retryLocalSessionTeamUpdate(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-retry-session-team-update" }>,
): null {
  requireLocalSession(database, input.sessionId);
  const currentIntent = database.prepare(
    "SELECT target_snapshot_key, status FROM session_team_update_intents WHERE session_id = ?",
  ).get(input.sessionId);
  if (!isRecord(currentIntent)) {
    if (input.expectedUpdateToken == null) {
      throw new Error("SESSION_TEAM_UPDATE_INTENT_MISSING");
    }
    return beginLocalSessionTeamUpdate(database, {
      kind: "local-begin-session-team-update",
      sessionId: input.sessionId,
      expectedUpdateToken: input.expectedUpdateToken,
      now: input.now,
    });
  }
  return transaction(database, () => {
    const targetSnapshotKey = readString(currentIntent.target_snapshot_key, "target_snapshot_key");
    if (input.expectedUpdateToken != null && targetSnapshotKey !== input.expectedUpdateToken) {
      throw new Error("SESSION_TEAM_UPDATE_STALE");
    }
    const pending = readLocalSessionAgentTeamSnapshotSlot(database, input.sessionId, "pending");
    if (pending?.snapshotKey !== targetSnapshotKey) {
      throw new Error("SESSION_TEAM_UPDATE_PENDING_MISSING");
    }
    database.prepare(
      `UPDATE session_team_update_intents
       SET status = 'waiting', requested_at = ?, failure_code = NULL, failure_summary = NULL
       WHERE session_id = ?`,
    ).run(input.now, input.sessionId);
    return null;
  });
}

function markLocalSessionTeamUpdateFailed(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-mark-session-team-update-failed" }>,
): null {
  const result = database.prepare(
    `UPDATE session_team_update_intents
     SET status = 'failed', failure_code = ?, failure_summary = ?
     WHERE session_id = ?`,
  ).run(input.code, input.summary, input.sessionId);
  if (Number(result.changes ?? 0) !== 1) {
    throw new Error("SESSION_TEAM_UPDATE_INTENT_MISSING");
  }
  return null;
}

function recordLocalProjectWorkspaceStatus(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-record-project-workspace-status" }>,
): null {
  const result = database
    .prepare(
      `UPDATE projects
       SET workspace_cwd = ?,
           workspace_mode = ?,
           worktree_path = ?,
           worktree_unavailable_reason = ?,
           workspace_updated_at = ?,
           updated_at = ?
       WHERE project_id = ?`,
    )
    .run(input.cwd, input.mode, input.worktreePath, input.worktreeUnavailableReason, input.now, input.now, input.projectId);
  if (Number(result.changes ?? 0) !== 1) {
    throw new Error(`local console project not found: ${input.projectId}`);
  }
  return null;
}

function createLocalSession(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-create-session" }>,
): unknown {
  return transaction(database, () => {
    if ((input.agentTeamOwnership === undefined) !== (input.agentTeamId === undefined)) {
      throw new Error("agent team ownership and id must be provided together");
    }
    const project = database
      .prepare("SELECT 1 AS found FROM projects WHERE project_id = ? AND removed_at IS NULL")
      .get(input.projectId);
    if (project === undefined) {
      throw new Error(`local console project not found: ${input.projectId}`);
    }
    ensureSession(database, input.sessionId, input.now, input.title, input.projectId, {
      ownership: input.agentTeamOwnership,
      id: input.agentTeamId,
    });
    if (input.originSessionId !== undefined && input.originSessionId !== null) {
      const origin = database
        .prepare("SELECT 1 AS found FROM sessions WHERE session_id = ? AND source_type = 'local'")
        .get(input.originSessionId);
      if (origin === undefined) {
        throw new Error(`local console origin session not found: ${input.originSessionId}`);
      }
    }
    if (input.analysisParentSessionId !== undefined && input.analysisParentSessionId !== null) {
      if (input.entryTemplate !== "session-analysis") {
        throw new Error("analysis parent requires session-analysis entry template");
      }
      assertAnalysisParent({ sessionId: input.sessionId, analysisParentSessionId: input.analysisParentSessionId });
      const parent = database
        .prepare(
          "SELECT 1 AS found FROM sessions WHERE session_id = ? AND source_type = 'local' AND archived_at IS NULL",
        )
        .get(input.analysisParentSessionId);
      if (parent === undefined) {
        throw new Error(`local console analysis parent session not found: ${input.analysisParentSessionId}`);
      }
    }
    database
      .prepare(
        `UPDATE sessions
         SET origin_session_id = ?, analysis_parent_session_id = ?, entry_template = ?, write_policy = ?, updated_at = ?
         WHERE session_id = ? AND source_type = 'local'`,
      )
      .run(
        input.originSessionId ?? null,
        input.analysisParentSessionId ?? null,
        input.entryTemplate ?? null,
        input.writePolicy ?? "normal",
        input.now,
        input.sessionId,
      );
    if (input.workspaceMode !== undefined) {
      database.prepare(
        "UPDATE sessions SET workspace_mode = ? WHERE session_id = ? AND source_type = 'local'",
      ).run(input.workspaceMode, input.sessionId);
    }
    replaceLocalSessionAgentTeamSnapshot(
      database,
      input.sessionId,
      "effective",
      input.agentTeamSnapshot,
    );
    ensureLocalCursor(database, input.sessionId, input.now);
    const attachmentIds = input.initialAttachmentIds ?? [];
    const textFragments = readTextFragments(input.initialTextFragments ?? []);
    if (input.initialMessage !== undefined || attachmentIds.length > 0 || textFragments.length > 0) {
      const initialBody = input.initialMessage ?? "";
      const persistedBody = serializeTextFragmentReferences(initialBody, textFragments);
      if (initialBody.trim() === "" && attachmentIds.length === 0) {
        throw new Error("Message body or attachment must be provided");
      }
      const result = database
        .prepare(
          `INSERT INTO session_messages
            (session_id, speaker, role, body, status, run_id, run_dir, error, source_kind, source_id,
             text_fragments_json, dispatch_lane, dispatch_role, dispatch_reason, dispatch_snapshot_key,
             created_at, updated_at)
          VALUES (?, 'user', NULL, ?, 'pending', NULL, NULL, NULL, 'local-message', NULL, ?, ?, ?, ?,
            (SELECT snapshot_key FROM session_agent_team_snapshot_meta WHERE session_id = ? AND slot = 'effective'),
            ?, ?)`,
        )
        .run(
          input.sessionId,
          persistedBody,
          "[]",
          input.initialDispatch?.lane ?? "primary",
          planInitialDispatchRole({
            requestedRole: input.initialDispatch?.role,
            firstTeamMemberName: input.agentTeamSnapshot?.members[0]?.name,
          }),
          input.initialDispatch?.reason ?? "no-valid-mention",
          input.sessionId,
          input.now,
          input.now,
        );
      claimAttachmentRefs(
        database,
        input.attachmentDraftKey ?? "draft:new",
        attachmentIds,
        toNumberId(result.lastInsertRowid),
        input.now,
      );
    }
    return requireLocalSession(database, input.sessionId);
  });
}

function moveEmptyLocalSession(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-move-empty-session" }>,
): MoveEmptySessionResult {
  return transaction(database, () => {
    const session = database
      .prepare(
        "SELECT session_id, parent_session_id, analysis_parent_session_id FROM sessions WHERE session_id = ? AND source_type = 'local'",
      )
      .get(input.sessionId);
    if (!isRecord(session)) {
      return { ok: false, code: "LOCAL_SESSION_NOT_FOUND" };
    }

    const project = database.prepare("SELECT project_id FROM projects WHERE project_id = ? AND removed_at IS NULL").get(input.projectId);
    if (!isRecord(project)) {
      return { ok: false, code: "LOCAL_PROJECT_NOT_FOUND" };
    }

    const hasMessages = database
      .prepare("SELECT 1 AS found FROM session_messages WHERE session_id = ? LIMIT 1")
      .get(input.sessionId);
    const hasChild = database
      .prepare(
        "SELECT 1 AS found FROM sessions WHERE parent_session_id = ? OR analysis_parent_session_id = ? LIMIT 1",
      )
      .get(input.sessionId, input.sessionId);
    const hasEdge = database
      .prepare("SELECT 1 AS found FROM session_edges WHERE parent_session_id = ? OR child_session_id = ? LIMIT 1")
      .get(input.sessionId, input.sessionId);
    if (
      session.parent_session_id !== null
      || session.analysis_parent_session_id !== null
      || hasMessages !== undefined
      || hasChild !== undefined
      || hasEdge !== undefined
    ) {
      return { ok: false, code: "SESSION_PROJECT_LOCKED" };
    }

    database
      .prepare("UPDATE sessions SET project_id = ?, updated_at = ? WHERE session_id = ?")
      .run(input.projectId, input.now, input.sessionId);
    return { ok: true, session: requireLocalSession(database, input.sessionId) as LocalConsoleSessionSummary };
  });
}

function archiveLocalSession(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-archive-session" }>,
): unknown {
  return transaction(database, () => {
    const row = database
      .prepare("SELECT session_id, project_id, archived_at FROM sessions WHERE session_id = ? AND source_type = 'local'")
      .get(input.sessionId);
    if (!isRecord(row)) {
      throw new Error(`local console session not found: ${input.sessionId}`);
    }
    if (row.archived_at !== null) {
      throw new Error(`local console session already archived: ${input.sessionId}`);
    }
    const archivedSessionIds = listActiveAnalysisSubtreeIds(database, [input.sessionId]);
    assertSessionArchiveIdle(archivedSessionIds.some((sessionId) => hasPendingLocalControlWork(database, sessionId)));

    const projectId = readString(row.project_id, "project_id");
    const visibleSessionIds = database
      .prepare(
        `SELECT session_id FROM sessions
         WHERE source_type = 'local' AND project_id = ? AND archived_at IS NULL
           AND parent_session_id IS NULL AND analysis_parent_session_id IS NULL
         ORDER BY created_at DESC, session_id ASC`,
      )
      .all(projectId)
      .map((visibleRow) => {
        if (!isRecord(visibleRow)) {
          throw new Error("Invalid local console session row during archive");
        }
        return readString(visibleRow.session_id, "session_id");
      });
    const archivedIndex = visibleSessionIds.indexOf(input.sessionId);
    if (archivedIndex < 0) {
      throw new Error(`local console session is not visible: ${input.sessionId}`);
    }
    const selectedSessionId = planArchivedSessionSelection(visibleSessionIds, archivedIndex);

    updateSessionsArchivedAt(database, archivedSessionIds, input.now, input.now);
    for (const sessionId of archivedSessionIds) {
      clearLocalCursorActive(database, sessionId, input.now);
    }
    return { sessionId: input.sessionId, projectId, selectedSessionId, archivedSessionIds };
  });
}

function restoreLocalSession(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-restore-session" }>,
): unknown {
  return transaction(database, () => {
    const row = database
      .prepare(
        `SELECT s.session_id
         FROM sessions s
         JOIN projects p ON p.project_id = s.project_id
         WHERE s.session_id = ? AND s.source_type = 'local' AND s.archived_at IS NOT NULL AND p.removed_at IS NULL`,
      )
      .get(input.sessionId);
    if (!isRecord(row)) {
      throw new Error(`local console archived session not found: ${input.sessionId}`);
    }
    const restoredSessionIds = listAnalysisSubtreeIds(database, [input.sessionId], false);
    if (restoredSessionIds.length > 0) {
      const placeholders = restoredSessionIds.map(() => "?").join(", ");
      database
        .prepare(`UPDATE sessions SET archived_at = NULL, updated_at = ? WHERE session_id IN (${placeholders})`)
        .run(input.now, ...restoredSessionIds);
    }
    for (const sessionId of restoredSessionIds) {
      ensureLocalCursor(database, sessionId, input.now);
    }
    return requireLocalSession(database, input.sessionId);
  });
}

function listActiveAnalysisSubtreeIds(
  database: SqliteDatabase,
  rootSessionIds: readonly string[],
): string[] {
  return listAnalysisSubtreeIds(database, rootSessionIds, true);
}

function listAnalysisSubtreeIds(
  database: SqliteDatabase,
  rootSessionIds: readonly string[],
  activeOnly: boolean,
): string[] {
  const seen = new Set<string>();
  const queue = [...rootSessionIds];
  const rootExists = database.prepare(
    `SELECT 1 AS found FROM sessions
     WHERE session_id = ? AND source_type = 'local'${activeOnly ? " AND archived_at IS NULL" : ""}`,
  );
  const children = database.prepare(
    `SELECT session_id FROM sessions
     WHERE analysis_parent_session_id = ? AND source_type = 'local'${activeOnly ? " AND archived_at IS NULL" : ""}
     ORDER BY created_at ASC, session_id ASC`,
  );
  while (queue.length > 0) {
    const sessionId = queue.shift()!;
    if (seen.has(sessionId) || rootExists.get(sessionId) === undefined) continue;
    seen.add(sessionId);
    for (const child of children.all(sessionId)) {
      if (!isRecord(child)) throw new Error("Invalid analysis child session row");
      queue.push(readString(child.session_id, "session_id"));
    }
  }
  return [...seen];
}

function updateSessionsArchivedAt(
  database: SqliteDatabase,
  sessionIds: readonly string[],
  archivedAt: string,
  updatedAt: string,
): void {
  if (sessionIds.length === 0) return;
  const placeholders = sessionIds.map(() => "?").join(", ");
  database
    .prepare(
      `UPDATE sessions
       SET archived_at = ?, pinned_at = NULL, updated_at = ?
       WHERE session_id IN (${placeholders}) AND archived_at IS NULL`,
    )
    .run(archivedAt, updatedAt, ...sessionIds);
}

function createLocalChildSession(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-create-child-session" }>,
): unknown {
  return transaction(database, () => {
    const parent = database.prepare("SELECT * FROM sessions WHERE session_id = ? AND source_type = 'local'").get(input.parentSessionId);
    if (!isRecord(parent)) {
      throw new Error(`local parent session not found: ${input.parentSessionId}`);
    }
    const parentProjectId = readString(parent.project_id, "project_id");
    assertChildProject({ requestedProjectId: input.projectId, parentProjectId });

    const existing = database
      .prepare(
        `SELECT child_session_id FROM session_edges
         WHERE parent_session_id = ? AND hidden_key = ?
         ORDER BY created_at ASC, child_session_id ASC`,
      )
      .all(input.parentSessionId, input.hiddenKey);
    if (existing.length > 1) {
      throw new Error(`local child hidden key collision: ${input.hiddenKey}`);
    }
    const existingEdge = existing[0];
    if (isRecord(existingEdge)) {
      return requireLocalSession(database, readString(existingEdge.child_session_id, "child_session_id"));
    }

    const parentAgentTeamOwnership = readNullableAgentTeamOwnership(parent.agent_team_ownership);
    const parentAgentTeamId = readNullableString(parent.agent_team_id, "agent_team_id");
    ensureSession(
      database,
      input.childSessionId,
      input.now,
      input.title,
      parentProjectId,
      planChildAgentTeam({ ownership: parentAgentTeamOwnership, id: parentAgentTeamId }),
    );
    database.prepare(
      `INSERT INTO session_agent_team_members
        (session_id, slot, member_name, display_name, member_description, agent_markdown,
         execution_cli, execution_model, execution_effort, provider_id, provider_profile_id,
         continuation_ended, sort_order, snapshot_key)
       SELECT ?, 'effective', member_name, display_name, member_description, agent_markdown,
              execution_cli, execution_model, execution_effort, provider_id, provider_profile_id,
              continuation_ended, sort_order, snapshot_key
       FROM session_agent_team_members
       WHERE session_id = ? AND slot = 'effective'
       ON CONFLICT(session_id, slot, member_name) DO NOTHING`,
    ).run(input.childSessionId, input.parentSessionId);
    database.prepare(
      `INSERT INTO session_agent_team_snapshot_meta
        (session_id, slot, team_ownership, team_id, team_name, team_description,
         primary_agent_slug, official_source_name, team_created_at, captured_at, loaded_at,
         snapshot_key, agent_definition_digest, execution_profile_digest, team_information_digest)
       SELECT ?, 'effective', team_ownership, team_id, team_name, team_description,
              primary_agent_slug, official_source_name, team_created_at, captured_at, loaded_at,
              snapshot_key, agent_definition_digest, execution_profile_digest, team_information_digest
       FROM session_agent_team_snapshot_meta
       WHERE session_id = ? AND slot = 'effective'
       ON CONFLICT(session_id, slot) DO NOTHING`,
    ).run(input.childSessionId, input.parentSessionId);
    database
      .prepare(
        `UPDATE sessions
         SET parent_session_id = ?, project_id = ?, title = COALESCE(title, ?), updated_at = ?
         WHERE session_id = ?`,
      )
      .run(input.parentSessionId, parentProjectId, input.title, input.now, input.childSessionId);
    database
      .prepare(
        `INSERT INTO session_edges (parent_session_id, child_session_id, relation, hidden_key, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(parent_session_id, child_session_id, relation)
         DO UPDATE SET hidden_key = COALESCE(session_edges.hidden_key, excluded.hidden_key)`,
      )
      .run(input.parentSessionId, input.childSessionId, input.relation, input.hiddenKey, input.now);
    database
      .prepare(
        `INSERT INTO session_messages
          (session_id, speaker, role, body, status, run_id, run_dir, error, source_kind, source_id, created_at, updated_at)
        VALUES (?, 'user', NULL, ?, 'pending', NULL, NULL, NULL, 'local-child-session', ?, ?, ?)`,
      )
      .run(input.childSessionId, input.initialBody, input.hiddenKey, input.now, input.now);
    ensureLocalCursor(database, input.childSessionId, input.now);
    return requireLocalSession(database, input.childSessionId);
  });
}

function listChildSessionSummarySources(database: SqliteDatabase, parentSessionId: string): unknown[] {
  const rows = database
    .prepare(
      `SELECT e.child_session_id AS candidate_session_id,
              s.session_id,
              s.parent_session_id,
              s.title,
              e.created_at AS relation_created_at
       FROM session_edges e
       LEFT JOIN sessions s ON s.session_id = e.child_session_id AND s.archived_at IS NULL
       WHERE e.parent_session_id = ?
       UNION ALL
       SELECT s.session_id AS candidate_session_id,
              s.session_id,
              s.parent_session_id,
              s.title,
              s.created_at AS relation_created_at
       FROM sessions s
       WHERE s.parent_session_id = ?
         AND s.archived_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM session_edges e
           WHERE e.parent_session_id = ? AND e.child_session_id = s.session_id
         )
       ORDER BY relation_created_at ASC, candidate_session_id ASC`,
    )
    .all(parentSessionId, parentSessionId, parentSessionId);

  return rows.map((row) => {
    if (!isRecord(row)) {
      throw new Error("Invalid child session summary row");
    }
    const candidateSessionId = readString(row.candidate_session_id, "candidate_session_id");
    const sessionId = readNullableString(row.session_id, "session_id");
    if (sessionId === null) {
      return {
        sessionId: candidateSessionId,
        title: null,
        parentSessionId: null,
        status: null,
        unresolvedSystemEventKind: null,
        latestAgentRole: null,
        initialBody: null,
        agentTeamSnapshot: null,
        chainValid: false,
      };
    }
    const sessionRow = database.prepare("SELECT * FROM sessions WHERE session_id = ?").get(sessionId);
    const session = readLocalSessionRow(database, sessionRow) as LocalConsoleSessionSummary;
    const latestAgent = database
      .prepare(
        `SELECT role FROM session_messages
         WHERE session_id = ? AND speaker = 'agent' AND role IS NOT NULL
         ORDER BY id DESC LIMIT 1`,
      )
      .get(sessionId);
    const initialMessage = database
      .prepare("SELECT body FROM session_messages WHERE session_id = ? ORDER BY id ASC LIMIT 1")
      .get(sessionId);
    return {
      sessionId,
      title: session.title,
      parentSessionId: session.parentSessionId ?? null,
      status: session.status,
      unresolvedSystemEventKind: session.unresolvedSystemEventKind ?? null,
      latestAgentRole: isRecord(latestAgent) ? readNullableString(latestAgent.role, "role") : null,
      initialBody: isRecord(initialMessage) ? readString(initialMessage.body, "body") : null,
      agentTeamSnapshot: listLocalSessionAgentTeamSnapshot(database, sessionId),
      chainValid: session.parentSessionId === parentSessionId,
    };
  });
}

function recordChildSessionCard(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-record-child-session-card" }>,
): null {
  return transaction(database, () => {
    const existing = database
      .prepare(
        `SELECT 1 AS found FROM session_messages
         WHERE session_id = ? AND source_kind = 'local-child-session-card' AND source_id = ?
         LIMIT 1`,
      )
      .get(input.parentSessionId, input.sourceId);
    if (existing !== undefined) {
      return null;
    }
    database
      .prepare(
        `INSERT INTO session_messages
          (session_id, speaker, role, body, status, run_id, run_dir, error, system_event_kind, source_kind, source_id, created_at, updated_at)
         VALUES (?, 'system', NULL, ?, 'displayed', ?, ?, NULL, 'other', 'local-child-session-card', ?, ?, ?)`,
      )
      .run(input.parentSessionId, input.body, input.runId, input.runDir, input.sourceId, input.now, input.now);
    return null;
  });
}

function listLocalSessions(database: SqliteDatabase): unknown[] {
  const rows = database
    .prepare("SELECT * FROM sessions WHERE source_type = 'local' AND archived_at IS NULL ORDER BY created_at DESC, session_id ASC")
    .all();
  return rows.map((row) => readLocalSessionRow(database, row));
}

function searchLocalSessions(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-search-sessions" }>,
): unknown[] {
  const normalizedQuery = normalizeSessionSearchText(input.query);
  if (normalizedQuery === "") {
    return [];
  }
  const rows = database
    .prepare(
      `SELECT s.*, p.title AS project_title,
              CASE WHEN s.archived_at IS NULL THEN 0 ELSE 1 END AS is_archived,
              CASE WHEN origin.session_id IS NULL OR origin.archived_at IS NOT NULL OR origin_project.removed_at IS NOT NULL
                THEN 0 ELSE 1 END AS origin_available
       FROM sessions s
       JOIN projects p ON p.project_id = s.project_id AND p.removed_at IS NULL
       LEFT JOIN sessions origin ON origin.session_id = s.origin_session_id AND origin.source_type = 'local'
       LEFT JOIN projects origin_project ON origin_project.project_id = origin.project_id
       WHERE s.source_type = 'local'
         AND s.parent_session_id IS NULL
         AND s.analysis_parent_session_id IS NULL
         AND (? = 1 OR s.archived_at IS NULL)
       ORDER BY s.updated_at DESC, s.session_id ASC`,
    )
    .all(input.includeArchived ? 1 : 0);
  return rows
    .filter(isRecord)
    .filter((row) => planSessionSearchMatch(readNullableString(row.title, "title"), normalizedQuery))
    .map((row) => {
      if (!isRecord(row)) {
        throw new Error("Invalid local session search row");
      }
      return {
        session: readLocalSessionRow(database, row),
        project: {
          projectId: readString(row.project_id, "project_id"),
          title: readString(row.project_title, "project_title"),
        },
        archived: readBooleanNumber(row.is_archived, "is_archived"),
        originAvailable: row.origin_session_id === null
          ? true
          : readBooleanNumber(row.origin_available, "origin_available"),
      };
    });
}

function updateLocalSessionAnalysisGate(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-update-session-analysis-gate" }>,
): unknown {
  const result = database
    .prepare(
      `UPDATE sessions
       SET proposal_version = ?, write_lease_version = ?, updated_at = ?
       WHERE session_id = ? AND source_type = 'local'
         AND write_policy = 'confirm-current-plan-before-write'`,
    )
    .run(input.proposalVersion, input.writeLeaseVersion, input.now, input.sessionId);
  if (Number(result.changes ?? 0) !== 1) {
    throw new Error(`local console analysis session not found: ${input.sessionId}`);
  }
  return requireLocalSession(database, input.sessionId);
}

function markSessionResultRead(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-mark-session-result-read" }>,
): boolean {
  const result = database
    .prepare(
      `UPDATE sessions
       SET unread_since = NULL,
           read_state_revision = read_state_revision + 1,
           updated_at = ?
       WHERE session_id = ? AND source_type = 'local' AND unread_since = ?`,
    )
    .run(input.now, input.sessionId, input.unreadSince);
  return Number(result.changes ?? 0) === 1;
}

function updateSessionReadState(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-update-session-read-state" }>,
): unknown {
  return transaction(database, () => {
    const row = database
      .prepare("SELECT * FROM sessions WHERE session_id = ? AND source_type = 'local' AND archived_at IS NULL")
      .get(input.sessionId);
    if (!isRecord(row)) {
      throw new Error(`local console session not found: ${input.sessionId}`);
    }
    const attentionRevision = readNumber(row.attention_revision, "attention_revision");
    const readStateRevision = readNumber(row.read_state_revision, "read_state_revision");
    const titleRevision = readNumber(row.title_revision, "title_revision");
    if (
      attentionRevision !== input.expectedAttentionRevision
      || readStateRevision !== input.expectedReadStateRevision
      || titleRevision !== input.expectedTitleRevision
    ) {
      throw new Error("SESSION_SIDEBAR_STATE_STALE");
    }
    const visible = localSessionVisibleAttentionState(database, row);
    if (
      (input.action === "mark-read-attention" && visible !== "red")
      || (input.action === "mark-read-unread" && visible !== "blue")
      || (input.action === "mark-unread" && visible !== "none")
    ) {
      throw new Error("SESSION_SIDEBAR_STATE_STALE");
    }
    if (input.action === "mark-read-attention") {
      database
        .prepare(
          `UPDATE sessions
           SET attention_acknowledged_revision = attention_revision,
               read_state_revision = read_state_revision + 1,
               updated_at = ?
           WHERE session_id = ?`,
        )
        .run(input.now, input.sessionId);
    } else if (input.action === "mark-read-unread") {
      database
        .prepare(
          `UPDATE sessions
           SET unread_since = NULL, manual_unread_at = NULL,
               manual_unread_requires_leave = 0,
               read_state_revision = read_state_revision + 1,
               updated_at = ?
           WHERE session_id = ?`,
        )
        .run(input.now, input.sessionId);
    } else {
      database
        .prepare(
          `UPDATE sessions
           SET manual_unread_at = ?, manual_unread_requires_leave = ?,
               read_state_revision = read_state_revision + 1,
               updated_at = ?
           WHERE session_id = ?`,
        )
        .run(input.now, input.isCurrent ? 1 : 0, input.now, input.sessionId);
    }
    return requireLocalSession(database, input.sessionId);
  });
}

function armSessionManualUnread(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-arm-session-manual-unread" }>,
): unknown {
  database
    .prepare(
      `UPDATE sessions
       SET manual_unread_requires_leave = 0,
           read_state_revision = read_state_revision + 1,
           updated_at = ?
       WHERE session_id = ? AND source_type = 'local'
         AND manual_unread_at IS NOT NULL AND manual_unread_requires_leave <> 0`,
    )
    .run(input.now, input.sessionId);
  return requireLocalSession(database, input.sessionId);
}

function markSessionViewed(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-mark-session-viewed" }>,
): unknown {
  database
    .prepare(
      `UPDATE sessions
       SET manual_unread_at = NULL, manual_unread_requires_leave = 0,
           read_state_revision = read_state_revision + 1,
           updated_at = ?
       WHERE session_id = ? AND source_type = 'local'
         AND manual_unread_at IS NOT NULL AND manual_unread_requires_leave = 0`,
    )
    .run(input.now, input.sessionId);
  return requireLocalSession(database, input.sessionId);
}

function setSessionPinned(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-set-session-pinned" }>,
): unknown {
  return transaction(database, () => {
    const row = database
      .prepare("SELECT pinned_at FROM sessions WHERE session_id = ? AND source_type = 'local' AND archived_at IS NULL")
      .get(input.sessionId);
    if (!isRecord(row)) {
      throw new Error(`local console session not found: ${input.sessionId}`);
    }
    const pinnedAt = readNullableString(row.pinned_at, "pinned_at");
    if (pinnedAt !== input.expectedPinnedAt || input.pinned === (pinnedAt !== null)) {
      throw new Error("SESSION_SIDEBAR_STATE_STALE");
    }
    database
      .prepare("UPDATE sessions SET pinned_at = ?, updated_at = ? WHERE session_id = ?")
      .run(input.pinned ? input.now : null, input.now, input.sessionId);
    return requireLocalSession(database, input.sessionId);
  });
}

function renameSession(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-rename-session" }>,
): unknown {
  const title = input.title.trim();
  if (title === "") {
    throw new Error("SESSION_TITLE_EMPTY");
  }
  const result = database
    .prepare(
      `UPDATE sessions
       SET title = ?, title_revision = title_revision + 1, updated_at = ?
       WHERE session_id = ? AND source_type = 'local' AND archived_at IS NULL
         AND title_revision = ?`,
    )
    .run(title, input.now, input.sessionId, input.expectedTitleRevision);
  if (Number(result.changes ?? 0) !== 1) {
    throw new Error("SESSION_SIDEBAR_STATE_STALE");
  }
  return requireLocalSession(database, input.sessionId);
}

function syncSessionContinuationAttention(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-sync-session-continuation-attention" }>,
): unknown {
  return transaction(database, () => {
    const row = database
      .prepare("SELECT attention_kind FROM sessions WHERE session_id = ? AND source_type = 'local'")
      .get(input.sessionId);
    if (!isRecord(row)) {
      throw new Error(`local console session not found: ${input.sessionId}`);
    }
    const currentKind = readNullableString(row.attention_kind, "attention_kind");
    if (currentKind !== input.attentionKind) {
      database
        .prepare(
          `UPDATE sessions
           SET attention_kind = ?,
               attention_revision = attention_revision + CASE WHEN ? IS NULL THEN 0 ELSE 1 END,
               updated_at = ?
           WHERE session_id = ?`,
        )
        .run(input.attentionKind, input.attentionKind, input.now, input.sessionId);
    }
    return requireLocalSession(database, input.sessionId);
  });
}

function localSessionVisibleAttentionState(
  database: SqliteDatabase,
  row: Record<string, unknown>,
): "red" | "blue" | "blink" | "none" {
  const sessionId = readString(row.session_id, "session_id");
  const attentionRevision = readNumber(row.attention_revision, "attention_revision");
  const acknowledgedRevision = readNumber(
    row.attention_acknowledged_revision,
    "attention_acknowledged_revision",
  );
  const hasCurrentAttention = readUnresolvedSystemEventKind(database, sessionId) !== null
    || readNullableString(row.attention_kind, "attention_kind") !== null;
  if (hasCurrentAttention && attentionRevision > acknowledgedRevision) {
    return "red";
  }
  const inspectUnread = (): "blue" | "none" => {
    if (
      readNullableString(row.unread_since, "unread_since") !== null
      || readNullableString(row.manual_unread_at, "manual_unread_at") !== null
    ) {
      return "blue";
    }
    return "none";
  };
  const pendingAttention = decidePendingAttentionState(hasPendingLocalControlWork(database, sessionId));
  return ({ blink: () => "blink" as const, "inspect-unread": inspectUnread })[pendingAttention]();
}

function appendUserMessage(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-append-user" }>,
): unknown {
  return transaction(database, () => {
    const attachmentIds = input.attachmentIds ?? [];
    const textFragments = readTextFragments(input.textFragments ?? []);
    const persistedBody = serializeTextFragmentReferences(input.body, textFragments);
    if (input.body.trim() === "" && attachmentIds.length === 0) {
      throw new Error("Message body or attachment must be provided");
    }
    ensureSession(database, input.sessionId, input.now, titleFromMessage(input.body), LOCAL_CONSOLE_PROJECT_ID);
    ensureLocalCursor(database, input.sessionId, input.now);
    database
      .prepare("UPDATE sessions SET awaits_human_reason = NULL, updated_at = ? WHERE session_id = ?")
      .run(input.now, input.sessionId);
    const result = database
      .prepare(
        `INSERT INTO session_messages
          (session_id, speaker, role, body, status, run_id, run_dir, error, source_kind, source_id,
           text_fragments_json, dispatch_lane, dispatch_role, dispatch_reason, dispatch_snapshot_key,
           created_at, updated_at)
        VALUES (?, 'user', NULL, ?, 'pending', NULL, NULL, NULL, 'local-message', NULL, ?, ?, ?, ?,
          CASE WHEN ? = 'awaiting-team' THEN NULL ELSE (
            SELECT snapshot_key FROM session_agent_team_snapshot_meta
            WHERE session_id = ? AND slot = 'effective'
          ) END, ?, ?)`,
      )
      .run(
        input.sessionId,
        persistedBody,
        "[]",
        input.dispatch?.lane ?? "primary",
        input.dispatch === undefined
          ? primaryAgentForSession(database, input.sessionId)
          : input.dispatch.role,
        input.dispatch?.reason ?? "no-valid-mention",
        input.dispatch?.lane ?? "primary",
        input.sessionId,
        input.now,
        input.now,
      );
    const messageId = toNumberId(result.lastInsertRowid);
    claimAttachmentRefs(
      database,
      planAttachmentDraftKey({ requestedDraftKey: input.attachmentDraftKey, sessionId: input.sessionId }),
      attachmentIds,
      messageId,
      input.now,
    );
    return requireLocalMessage(database, messageId, input.sessionId);
  });
}

function requireEditablePendingUserMessage(
  database: SqliteDatabase,
  sessionId: string,
  messageId: number,
): WorkerLocalMessage {
  const message = database
    .prepare(
      `SELECT * FROM session_messages
       WHERE id = ? AND session_id = ? AND speaker = 'user' AND status = 'pending' AND run_id IS NULL`,
    )
    .get(messageId, sessionId);
  if (!isRecord(message)) {
    throw new Error("PENDING_MESSAGE_NOT_EDITABLE");
  }
  const active = database
    .prepare(
      `SELECT 1 AS found FROM local_message_cursors
       WHERE session_id = ? AND active_message_id = ?`,
    )
    .get(sessionId, messageId);
  if (active !== undefined) {
    throw new Error("PENDING_MESSAGE_NOT_EDITABLE");
  }
  return readLocalMessageRow(message);
}

function markPendingReferenceError(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-mark-pending-reference-error" }>,
): unknown {
  return transaction(database, () => {
    requireEditablePendingUserMessage(database, input.sessionId, input.messageId);
    database
      .prepare("UPDATE session_messages SET error = ?, updated_at = ? WHERE id = ? AND session_id = ?")
      .run(input.error, input.now, input.messageId, input.sessionId);
    return requireLocalMessage(database, input.messageId, input.sessionId);
  });
}

function updatePendingUserMessage(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-update-pending-user" }>,
): unknown {
  return transaction(database, () => {
    requireEditablePendingUserMessage(database, input.sessionId, input.messageId);
    const body = input.body.trim();
    const hasAttachment = database
      .prepare("SELECT 1 AS found FROM local_attachment_refs WHERE message_id = ? LIMIT 1")
      .get(input.messageId);
    if (body === "" && hasAttachment === undefined) {
      throw new Error("Message body or attachment must be provided");
    }
    database
      .prepare(
        "UPDATE session_messages SET body = ?, error = NULL, updated_at = ? WHERE id = ? AND session_id = ?",
      )
      .run(body, input.now, input.messageId, input.sessionId);
    return requireLocalMessage(database, input.messageId, input.sessionId);
  });
}

function removePendingUserMessage(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-remove-pending-user" }>,
): void {
  transaction(database, () => {
    requireEditablePendingUserMessage(database, input.sessionId, input.messageId);
    database
      .prepare(
        `UPDATE session_messages
         SET status = 'completed',
             source_kind = 'pending-removed',
             error = NULL,
             updated_at = ?
         WHERE id = ? AND session_id = ?`,
      )
      .run(input.now, input.messageId, input.sessionId);
    advanceLocalCursor(database, input.sessionId, input.messageId, input.now);
    database
      .prepare("UPDATE sessions SET updated_at = ? WHERE session_id = ?")
      .run(input.now, input.sessionId);
  });
}

function listLocalMessages(database: SqliteDatabase, sessionId: string): unknown[] {
  return database
    .prepare(
      `SELECT *
       FROM session_messages
       WHERE session_id = ?
       ORDER BY
         CASE
           WHEN speaker = 'user' THEN COALESCE(activated_at, created_at)
           ELSE created_at
         END ASC,
         id ASC`,
    )
    .all(sessionId)
    .map((row) => withMessageAttachments(database, readLocalMessageRow(row)));
}

function addDraftAttachment(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-add-draft-attachment" }>,
): unknown {
  return transaction(database, () => {
    if (input.draftKey.trim() === "") {
      throw new Error("Attachment draft key must not be empty");
    }
    database.prepare(
      `INSERT INTO local_attachment_blobs
        (blob_id, kind, display_name, media_type, byte_size, sha256, storage_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.blobId,
      input.attachmentKind,
      input.displayName,
      input.mediaType,
      input.byteSize,
      input.sha256,
      input.storageKey,
      input.now,
    );
    const positionRow = database.prepare(
      "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM local_attachment_refs WHERE draft_key = ?",
    ).get(input.draftKey);
    const position = isRecord(positionRow) ? readNumber(positionRow.position, "position") : 0;
    database.prepare(
      `INSERT INTO local_attachment_refs
        (attachment_id, blob_id, draft_key, message_id, position, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?)`,
    ).run(input.attachmentId, input.blobId, input.draftKey, position, input.now, input.now);
    return requireAttachmentDto(database, input.attachmentId);
  });
}

function listDraftAttachments(database: SqliteDatabase, draftKey: string): unknown[] {
  return database.prepare(
    `${attachmentSelectSql()}
     WHERE r.draft_key = ?
     ORDER BY r.position ASC`,
  ).all(draftKey).map(readAttachmentDtoRow);
}

function removeDraftAttachment(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-remove-draft-attachment" }>,
): { removed: boolean; orphanedStorageKey: string | null } {
  return transaction(database, () => {
    const row = database.prepare(
      `SELECT r.blob_id, b.storage_key
       FROM local_attachment_refs r
       JOIN local_attachment_blobs b ON b.blob_id = r.blob_id
       WHERE r.attachment_id = ? AND r.draft_key = ? AND r.message_id IS NULL`,
    ).get(input.attachmentId, input.draftKey);
    if (!isRecord(row)) {
      return { removed: false, orphanedStorageKey: null };
    }
    const blobId = readString(row.blob_id, "blob_id");
    const storageKey = readString(row.storage_key, "storage_key");
    database.prepare("DELETE FROM local_attachment_refs WHERE attachment_id = ? AND draft_key = ?")
      .run(input.attachmentId, input.draftKey);
    const remaining = database.prepare("SELECT 1 AS found FROM local_attachment_refs WHERE blob_id = ? LIMIT 1").get(blobId);
    if (remaining !== undefined) {
      return { removed: true, orphanedStorageKey: null };
    }
    database.prepare("DELETE FROM local_attachment_blobs WHERE blob_id = ?").run(blobId);
    return { removed: true, orphanedStorageKey: storageKey };
  });
}

function cloneMessageAttachments(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-clone-message-attachments" }>,
): unknown[] {
  return transaction(database, () => {
    assertAttachmentCloneTarget({ targetDraftKey: input.targetDraftKey, sessionId: input.sessionId });
    const source = database.prepare(
      "SELECT speaker FROM session_messages WHERE id = ? AND session_id = ?",
    ).get(input.sourceMessageId, input.sessionId);
    if (!isRecord(source) || source.speaker !== "user") {
      throw new Error("Attachment source must be a user message in the same session");
    }
    const occupied = database.prepare(
      "SELECT 1 AS found FROM local_attachment_refs WHERE draft_key = ? LIMIT 1",
    ).get(input.targetDraftKey);
    if (occupied !== undefined) {
      throw new Error("Attachment target draft is not empty");
    }
    const rows = database.prepare(
      `SELECT blob_id, position
       FROM local_attachment_refs
       WHERE message_id = ?
       ORDER BY position ASC`,
    ).all(input.sourceMessageId);
    const attachmentIds: string[] = [];
    for (const row of rows) {
      if (!isRecord(row)) {
        throw new Error("Invalid attachment source ref");
      }
      const attachmentId = randomOpaqueId();
      attachmentIds.push(attachmentId);
      database.prepare(
        `INSERT INTO local_attachment_refs
          (attachment_id, blob_id, draft_key, message_id, position, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?)`,
      ).run(
        attachmentId,
        readString(row.blob_id, "blob_id"),
        input.targetDraftKey,
        readNumber(row.position, "position"),
        input.now,
        input.now,
      );
    }
    return attachmentIds.map((attachmentId) => requireAttachmentDto(database, attachmentId));
  });
}

function getAttachmentContentRecord(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-get-attachment-content-record" }>,
): unknown | null {
  if ((input.draftKey === undefined) === (input.sessionId === undefined)) {
    throw new Error("Exactly one attachment scope must be provided");
  }
  const scopeSql = input.draftKey !== undefined
    ? "r.draft_key = ?"
    : "r.message_id IN (SELECT id FROM session_messages WHERE session_id = ?)";
  const scopeValue = planAttachmentContentScopeValue(input);
  const row = database.prepare(
    `${attachmentContentSelectSql()}
     WHERE r.attachment_id = ? AND ${scopeSql}`,
  ).get(input.attachmentId, scopeValue);
  return row === undefined ? null : readAttachmentContentRow(row);
}

function listMessageAttachmentContentRecords(database: SqliteDatabase, messageIds: number[]): unknown[] {
  if (messageIds.length === 0) {
    return [];
  }
  const placeholders = messageIds.map(() => "?").join(", ");
  return database.prepare(
    `${attachmentContentSelectSql()}
     WHERE r.message_id IN (${placeholders})
     ORDER BY r.message_id ASC, r.position ASC`,
  ).all(...messageIds).map(readAttachmentContentRow);
}

function pruneOrphanAttachmentBlobs(database: SqliteDatabase): {
  liveStorageKeys: string[];
  orphanedStorageKeys: string[];
} {
  return transaction(database, () => {
    const rows = database.prepare(
      `SELECT b.storage_key
       FROM local_attachment_blobs b
       WHERE NOT EXISTS (
         SELECT 1 FROM local_attachment_refs r WHERE r.blob_id = b.blob_id
       )
       ORDER BY b.storage_key ASC`,
    ).all();
    const orphanedStorageKeys = rows.map((row) => {
      if (!isRecord(row)) {
        throw new Error("Invalid orphan attachment blob row");
      }
      return readString(row.storage_key, "storage_key");
    });
    database.prepare(
      `DELETE FROM local_attachment_blobs
       WHERE NOT EXISTS (
         SELECT 1 FROM local_attachment_refs r WHERE r.blob_id = local_attachment_blobs.blob_id
       )`,
    ).run();
    const liveStorageKeys = database.prepare(
      "SELECT storage_key FROM local_attachment_blobs ORDER BY storage_key ASC",
    ).all().map((row) => readString((row as Record<string, unknown>).storage_key, "storage_key"));
    return { liveStorageKeys, orphanedStorageKeys };
  });
}

function claimAttachmentRefs(
  database: SqliteDatabase,
  draftKey: string,
  attachmentIds: string[],
  messageId: number,
  now: string,
): void {
  if (new Set(attachmentIds).size !== attachmentIds.length) {
    throw new Error("Attachment ids must be unique");
  }
  for (const [position, attachmentId] of attachmentIds.entries()) {
    const row = database.prepare(
      `SELECT r.attachment_id
       FROM local_attachment_refs r
       JOIN local_attachment_blobs b ON b.blob_id = r.blob_id
       WHERE r.attachment_id = ? AND r.draft_key = ? AND r.message_id IS NULL`,
    ).get(attachmentId, draftKey);
    if (!isRecord(row)) {
      throw new Error("Attachment is missing, not ready, or belongs to another draft");
    }
    const result = database.prepare(
      `UPDATE local_attachment_refs
       SET draft_key = NULL, message_id = ?, position = ?, updated_at = ?
       WHERE attachment_id = ? AND draft_key = ? AND message_id IS NULL`,
    ).run(messageId, position, now, attachmentId, draftKey);
    if (Number(result.changes ?? 0) !== 1) {
      throw new Error("Attachment claim failed");
    }
  }
}

function attachmentSelectSql(): string {
  return `SELECT r.attachment_id, b.kind, b.display_name, b.media_type, b.byte_size
          FROM local_attachment_refs r
          JOIN local_attachment_blobs b ON b.blob_id = r.blob_id`;
}

function attachmentContentSelectSql(): string {
  return `SELECT r.attachment_id, r.draft_key, r.message_id, r.position,
                 b.blob_id, b.kind, b.display_name, b.media_type, b.byte_size, b.sha256, b.storage_key
          FROM local_attachment_refs r
          JOIN local_attachment_blobs b ON b.blob_id = r.blob_id`;
}

function readAttachmentDtoRow(row: unknown): unknown {
  if (!isRecord(row)) {
    throw new Error("Invalid attachment row");
  }
  return {
    attachmentId: readString(row.attachment_id, "attachment_id"),
    kind: readString(row.kind, "kind"),
    displayName: readString(row.display_name, "display_name"),
    mediaType: readString(row.media_type, "media_type"),
    byteSize: readNumber(row.byte_size, "byte_size"),
  };
}

function readAttachmentContentRow(row: unknown): unknown {
  if (!isRecord(row)) {
    throw new Error("Invalid attachment content row");
  }
  return {
    ...readAttachmentDtoRow(row) as Record<string, unknown>,
    blobId: readString(row.blob_id, "blob_id"),
    sha256: readString(row.sha256, "sha256"),
    storageKey: readString(row.storage_key, "storage_key"),
    draftKey: readNullableString(row.draft_key, "draft_key"),
    messageId: row.message_id === null ? null : readNumber(row.message_id, "message_id"),
    position: readNumber(row.position, "position"),
  };
}

function requireAttachmentDto(database: SqliteDatabase, attachmentId: string): unknown {
  const row = database.prepare(`${attachmentSelectSql()} WHERE r.attachment_id = ?`).get(attachmentId);
  if (row === undefined) {
    throw new Error("Attachment ref was not created");
  }
  return readAttachmentDtoRow(row);
}

function listMessageAttachmentDtos(database: SqliteDatabase, messageId: number): unknown[] {
  return database.prepare(
    `${attachmentSelectSql()} WHERE r.message_id = ? ORDER BY r.position ASC`,
  ).all(messageId).map(readAttachmentDtoRow);
}

function withMessageAttachments(database: SqliteDatabase, message: WorkerLocalMessage): WorkerLocalMessage {
  return { ...message, attachments: listMessageAttachmentDtos(database, message.id) };
}

function randomOpaqueId(): string {
  return randomUUID();
}

function hasRunningMessage(database: SqliteDatabase, sessionId: string): boolean {
  return (
    database
      .prepare("SELECT id FROM session_messages WHERE session_id = ? AND status = 'running' ORDER BY id ASC LIMIT 1")
      .get(sessionId) !== undefined
  );
}

function hasPendingLocalControlWork(database: SqliteDatabase, sessionId: string): boolean {
  const hasQueuedControlMessage = database
    .prepare(
      `SELECT 1 AS found
       FROM session_messages
       WHERE session_id = ?
         AND speaker = 'user'
         AND status = 'pending'
         AND dispatch_lane IN ('worker', 'awaiting-team')
         AND COALESCE(error, '') <> 'TARGET_CONTINUATION_ENDED'
       LIMIT 1`,
    )
    .get(sessionId) !== undefined;
  const inspectCursor = (): boolean => {
    const cursor = database
      .prepare(
        `SELECT processed_through_message_id, active_message_id
         FROM local_message_cursors
         WHERE session_id = ?`,
      )
      .get(sessionId);
    if (!isRecord(cursor)) return false;
    const processedThroughMessageId = readNumber(
      cursor.processed_through_message_id,
      "processed_through_message_id",
    );
    const hasMessageAfterCursor = database
      .prepare(
        `SELECT 1 AS found
         FROM session_messages
         WHERE session_id = ?
           AND id > ?
           AND (
             (speaker = 'user' AND status IN ('pending', 'running'))
             OR (speaker = 'agent' AND status = 'displayed')
           )
           AND COALESCE(error, '') <> 'TARGET_CONTINUATION_ENDED'
         LIMIT 1`,
      )
      .get(sessionId, processedThroughMessageId) !== undefined;
    return planHasPendingControlWork({
      activeMessage: cursor.active_message_id !== null,
      hasMessageAfterCursor,
    });
  };
  const inspection = decidePendingControlWorkInspection({
    hasRunningMessage: hasRunningMessage(database, sessionId),
    hasQueuedControlMessage,
  });
  return ({ pending: () => true, "inspect-cursor": inspectCursor })[inspection]();
}

function hasSessionMessage(database: SqliteDatabase, sessionId: string): boolean {
  return database
    .prepare("SELECT 1 AS found FROM session_messages WHERE session_id = ? LIMIT 1")
    .get(sessionId) !== undefined;
}

function claimNextPendingMessage(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-claim-next" }>,
): unknown | null {
  return transaction(database, () => {
    const session = database
      .prepare("SELECT archived_at FROM sessions WHERE session_id = ? AND source_type = 'local'")
      .get(input.sessionId);
    if (!isRecord(session) || session.archived_at !== null) {
      return null;
    }
    ensureLocalCursor(database, input.sessionId, input.now);
    const active = database
      .prepare("SELECT active_message_id FROM local_message_cursors WHERE session_id = ? AND active_message_id IS NOT NULL")
      .get(input.sessionId);
    if (active !== undefined) {
      return null;
    }
    skipUnprocessableLocalMessages(database, input.sessionId, input.now);
    const cursor = requireLocalCursor(database, input.sessionId);
    const row = database
      .prepare(
        `SELECT * FROM session_messages
         WHERE session_id = ?
           AND id > ?
           AND speaker IN ('user', 'agent')
         ORDER BY id ASC
         LIMIT 1`,
      )
      .get(input.sessionId, cursor.processedThroughMessageId);
    if (row === undefined) {
      return null;
    }
    const message = readLocalMessageRow(row);
    if (message.speaker === "user" && message.dispatchLane === "awaiting-team") {
      return null;
    }
    if (message.speaker === "user" && message.error === "TARGET_CONTINUATION_ENDED") {
      return null;
    }
    if (message.speaker === "user" && message.dispatchLane === "worker") {
      advanceLocalCursor(database, input.sessionId, message.id, input.now);
      return claimNextPendingMessage(database, input);
    }
    if (message.speaker === "user" && message.status === "running") {
      return null;
    }
    if (message.speaker === "user" && message.status !== "pending") {
      advanceLocalCursor(database, input.sessionId, message.id, input.now);
      return null;
    }
    if (message.speaker === "agent" && message.status !== "displayed") {
      advanceLocalCursor(database, input.sessionId, message.id, input.now);
      return null;
    }
    if (message.speaker === "user") {
      const result = database
        .prepare(
          `UPDATE session_messages
           SET status = 'running',
               run_id = ?,
               error = NULL,
               dispatch_snapshot_key = COALESCE(dispatch_snapshot_key, (
                 SELECT snapshot_key FROM session_agent_team_snapshot_meta
                 WHERE session_id = ? AND slot = 'effective'
               )),
               activated_at = COALESCE(activated_at, ?),
               updated_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(claimRunId(input, message.id), input.sessionId, input.now, input.now, message.id);
      if (Number(result.changes ?? 0) !== 1) {
        return null;
      }
    }
    setLocalCursorActive(database, input.sessionId, message.id, claimRunId(input, message.id), input.now);
    return requireLocalMessage(database, message.id, input.sessionId);
  });
}

function claimRunId(
  input: Extract<SqliteStateCommand, { kind: "local-claim-next" }>,
  sourceMessageId: number,
): string {
  const matching = (input.gracefulResumeTargets ?? [])
    .filter((target) => target.sourceMessageId === sourceMessageId);
  if (matching.length === 0) {
    return input.runId;
  }
  const targetRunIds = new Set(matching.map((target) => target.targetRunId));
  if (targetRunIds.size !== 1) {
    throw new Error(`Conflicting graceful resume targets for source ${String(sourceMessageId)}`);
  }
  return matching[0]!.targetRunId;
}

function claimNextPendingWorkerMessage(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-claim-next-worker" }>,
): unknown | null {
  return transaction(database, () => {
    const session = database
      .prepare("SELECT archived_at FROM sessions WHERE session_id = ? AND source_type = 'local'")
      .get(input.sessionId);
    if (!isRecord(session) || session.archived_at !== null) {
      return null;
    }
    const active = database
      .prepare(
        `SELECT 1 AS found
         FROM session_messages
         WHERE session_id = ?
           AND status = 'running'
           AND (
             (dispatch_lane = 'worker' AND dispatch_role = ?)
             OR (source_kind = 'local-worker-run' AND role = ?)
           )
         LIMIT 1`,
      )
      .get(input.sessionId, input.role, input.role);
    if (active !== undefined) {
      return null;
    }
    const row = database
      .prepare(
        `SELECT id
         FROM session_messages
         WHERE session_id = ?
           AND speaker = 'user'
           AND status = 'pending'
           AND dispatch_lane = 'worker'
           AND dispatch_role = ?
           AND COALESCE(error, '') <> 'TARGET_CONTINUATION_ENDED'
         ORDER BY id ASC
         LIMIT 1`,
      )
      .get(input.sessionId, input.role);
    if (!isRecord(row)) {
      return null;
    }
    const messageId = readNumber(row.id, "id");
    const result = database
      .prepare(
        `UPDATE session_messages
         SET status = 'running',
             run_id = ?,
             error = NULL,
             dispatch_snapshot_key = COALESCE(dispatch_snapshot_key, (
               SELECT snapshot_key FROM session_agent_team_snapshot_meta
               WHERE session_id = ? AND slot = 'effective'
             )),
             activated_at = COALESCE(activated_at, ?),
             updated_at = ?
         WHERE id = ?
           AND status = 'pending'
           AND dispatch_lane = 'worker'
           AND dispatch_role = ?`,
      )
      .run(input.runId, input.sessionId, input.now, input.now, messageId, input.role);
    return Number(result.changes ?? 0) === 1
      ? requireLocalMessage(database, messageId, input.sessionId)
      : null;
  });
}

function resolveAwaitingUserMessageDispatches(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-resolve-awaiting-user-dispatches" }>,
): null {
  return transaction(database, () => {
    for (const dispatch of input.dispatches) {
      database
        .prepare(
          `UPDATE session_messages
           SET dispatch_lane = ?,
               dispatch_role = ?,
               dispatch_reason = ?,
               dispatch_snapshot_key = (
                 SELECT snapshot_key FROM session_agent_team_snapshot_meta
                 WHERE session_id = ? AND slot = 'effective'
               ),
               updated_at = ?
           WHERE id = ?
             AND session_id = ?
             AND speaker = 'user'
             AND status = 'pending'
             AND dispatch_lane = 'awaiting-team'`,
        )
        .run(
          dispatch.lane,
          dispatch.role,
          dispatch.reason,
          input.sessionId,
          input.now,
          dispatch.messageId,
          input.sessionId,
        );
    }
    return null;
  });
}

function setRunDir(database: SqliteDatabase, input: Extract<SqliteStateCommand, { kind: "local-set-run-dir" }>): null {
  database
    .prepare("UPDATE session_messages SET run_dir = ?, updated_at = ? WHERE id = ?")
    .run(input.runDir, input.now, input.id);
  return null;
}

function recordAgentResponse(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-record-agent-response" }>,
): null {
  return transaction(database, () => {
    ensureSession(database, input.sessionId, input.now, undefined, LOCAL_CONSOLE_PROJECT_ID);
    ensureLocalCursor(database, input.sessionId, input.now);
    const source = requireLocalMessage(database, input.userMessageId, input.sessionId);
    database
      .prepare(
        `INSERT INTO session_messages
          (session_id, speaker, role, body, status, run_id, run_dir, error, source_kind, source_id, created_at, updated_at)
        VALUES (?, 'agent', ?, ?, 'displayed', ?, ?, NULL, 'local-message', NULL, ?, ?)`,
      )
      .run(input.sessionId, input.role, input.body, input.runId, input.runDir, input.now, input.now);
    updateSessionAttentionAfterAgentResponse(database, input.sessionId, input.body, input.now);
    completeSourceMessage(database, source, "completed", null, input.runId, input.runDir, input.now);
    return null;
  });
}

function recordDetachedAgentResponse(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-record-detached-agent-response" }>,
): null {
  return transaction(database, () => {
    ensureSession(database, input.sessionId, input.now, undefined, LOCAL_CONSOLE_PROJECT_ID);
    completeDetachedRunPlaceholder(database, input.sessionId, input.runId, "completed", null, input.now);
    database
      .prepare(
        `INSERT INTO session_messages
          (session_id, speaker, role, body, status, run_id, run_dir, error, source_kind, source_id, created_at, updated_at)
        VALUES (?, 'agent', ?, ?, 'displayed', ?, ?, NULL, 'local-message', NULL, ?, ?)`,
      )
      .run(input.sessionId, input.role, input.body, input.runId, input.runDir, input.now, input.now);
    updateSessionAttentionAfterAgentResponse(database, input.sessionId, input.body, input.now);
    return null;
  });
}

function recordDetachedRunStarted(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-record-detached-run-started" }>,
): null {
  return transaction(database, () => {
    ensureSession(database, input.sessionId, input.now, undefined, LOCAL_CONSOLE_PROJECT_ID);
    database
      .prepare(
        `INSERT INTO session_messages
          (session_id, speaker, role, body, status, run_id, run_dir, error, system_event_kind,
           source_kind, source_id, created_at, updated_at)
         VALUES (?, 'system', ?, '', 'running', ?, ?, NULL, 'other',
           'local-worker-run', NULL, ?, ?)`,
      )
      .run(input.sessionId, input.role, input.runId, input.runDir, input.now, input.now);
    return null;
  });
}

function recordDetachedRunTerminal(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-record-detached-run-terminal" }>,
): null {
  return transaction(database, () => {
    ensureSession(database, input.sessionId, input.now, undefined, LOCAL_CONSOLE_PROJECT_ID);
    completeDetachedRunPlaceholder(
      database,
      input.sessionId,
      input.runId,
      input.status,
      input.error,
      input.now,
    );
    insertSystemMessage(
      database,
      input.sessionId,
      input.body,
      input.runId,
      input.runDir,
      input.error,
      input.now,
      input.status,
      input.systemEventKind,
      "local-message",
      null,
      input.terminal ?? null,
    );
    return null;
  });
}

function completeDetachedRunPlaceholder(
  database: SqliteDatabase,
  sessionId: string,
  runId: string,
  status: "completed" | "failed" | "interrupted" | "stuck",
  error: string | null,
  now: string,
): void {
  database
    .prepare(
      `UPDATE session_messages
       SET status = ?, error = ?, updated_at = ?
       WHERE session_id = ?
         AND run_id = ?
         AND source_kind = 'local-worker-run'
         AND status = 'running'`,
    )
    .run(status, error, now, sessionId, runId);
}

function recordMessageProcessed(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-record-message-processed" }>,
): null {
  return transaction(database, () => {
    ensureLocalCursor(database, input.sessionId, input.now);
    const source = requireLocalMessage(database, input.userMessageId, input.sessionId);
    completeSourceMessage(database, source, "completed", null, input.runId, input.runDir, input.now);
    return null;
  });
}

function findLocalRouteDecision(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-find-route-decision" }>,
): unknown | null {
  const row = database
    .prepare(
      `SELECT
         session_id AS sessionId,
         message_id AS messageId,
         route_key AS routeKey,
         outcome,
         target_role AS targetRole,
         reason,
         created_at AS createdAt
       FROM local_route_decisions
       WHERE session_id = ? AND route_key = ?`,
    )
    .get(input.sessionId, input.routeKey);
  return row ?? null;
}

function recordLocalRouteAppend(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-record-route-append" }>,
): null {
  return transaction(database, () => {
    ensureLocalCursor(database, input.sessionId, input.now);
    const source = requireLocalMessage(database, input.userMessageId, input.sessionId);
    database
      .prepare(
        `INSERT INTO session_messages
          (session_id, speaker, role, body, status, run_id, run_dir, error, source_kind, source_id, created_at, updated_at)
        VALUES (?, 'agent', 'ceo', ?, 'displayed', ?, ?, NULL, 'local-route', ?, ?, ?)`,
      )
      .run(input.sessionId, input.body, input.runId, input.runDir, input.routeKey, input.now, input.now);
    updateSessionAttentionAfterAgentResponse(database, input.sessionId, input.body, input.now);
    insertLocalRouteDecision(database, {
      sessionId: input.sessionId,
      messageId: input.userMessageId,
      routeKey: input.routeKey,
      outcome: "append",
      targetRole: input.targetRole,
      reason: "appended",
      now: input.now,
    });
    completeSourceMessage(database, source, "completed", null, input.runId, input.runDir, input.now);
    return null;
  });
}

function recordLocalRouteNoAction(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-record-route-no-action" }>,
): null {
  return transaction(database, () => {
    ensureLocalCursor(database, input.sessionId, input.now);
    const source = requireLocalMessage(database, input.userMessageId, input.sessionId);
    insertLocalRouteDecision(database, {
      sessionId: input.sessionId,
      messageId: input.userMessageId,
      routeKey: input.routeKey,
      outcome: input.outcome,
      targetRole: null,
      reason: input.reason,
      now: input.now,
    });
    completeSourceMessage(database, source, "completed", null, input.runId, input.runDir, input.now);
    return null;
  });
}

function releaseMessageForRetry(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-release-message-for-retry" }>,
): null {
  return transaction(database, () => {
    ensureLocalCursor(database, input.sessionId, input.now);
    const source = requireLocalMessage(database, input.userMessageId, input.sessionId);
    if (source.sourceKind === "local-worker-run") {
      if (
        source.status === "running"
        || source.status === "stuck"
        || source.status === "failed"
        || source.status === "interrupted"
      ) {
        database
          .prepare("UPDATE session_messages SET status = 'interrupted', error = NULL, updated_at = ? WHERE id = ?")
          .run(input.now, source.id);
      }
      return null;
    }
    if (
      source.speaker !== "system"
      && (
        source.status === "running"
        || source.status === "stuck"
        || source.status === "failed"
        || source.status === "interrupted"
      )
    ) {
      database
        .prepare(
          `UPDATE session_messages
           SET status = 'pending', run_id = NULL, run_dir = NULL, error = NULL, updated_at = ?
           WHERE id = ?`,
        )
        .run(input.now, source.id);
    }
    rewindLocalCursorForRetry(database, input.sessionId, source.id, input.now);
    return null;
  });
}

function releaseMessageForResume(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-release-message-for-resume" }>,
): null {
  return transaction(database, () => {
    ensureLocalCursor(database, input.sessionId, input.now);
    const source = requireLocalMessage(database, input.userMessageId, input.sessionId);
    if (input.sourceDisposition === "agent-handoff") {
      if (source.speaker !== "agent" || source.sourceKind !== "local-message") {
        throw new Error("Agent handoff resume source must be an Agent message");
      }
      if (source.status !== "displayed" && source.status !== "pending") {
        throw new Error(`Agent handoff resume source has invalid status: ${source.status}`);
      }
      if (source.status === "pending") {
        database
          .prepare("UPDATE session_messages SET status = 'displayed', error = NULL, updated_at = ? WHERE id = ?")
          .run(input.now, source.id);
      }
      rewindLocalCursorForRetry(database, input.sessionId, source.id, input.now);
      return null;
    }
    if (source.speaker !== "user") {
      throw new Error(`${input.sourceDisposition} resume source must be a user message`);
    }
    assertUserDirectResumeIdentity({
      sourceDisposition: input.sourceDisposition,
      dispatchLane: source.dispatchLane,
      dispatchRole: source.dispatchRole,
      requestedRole: input.role,
    });
    if (input.sourceDisposition === "primary" && source.dispatchLane === "worker") {
      throw new Error("Primary resume source cannot use the worker dispatch lane");
    }
    database
      .prepare(
        `UPDATE session_messages
         SET status = 'pending', run_id = NULL, run_dir = NULL, error = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(input.now, source.id);
    rewindLocalCursorForRetry(database, input.sessionId, source.id, input.now);
    return null;
  });
}

function repairAgentHandoffResumeSource(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-repair-agent-handoff-resume-source" }>,
): "repaired" | "already-repaired" {
  return transaction(database, () => {
    ensureLocalCursor(database, input.sessionId, input.now);
    const source = requireLocalMessage(database, input.sourceMessageId, input.sessionId);
    if (source.speaker !== "agent" || source.sourceKind !== "local-message") {
      throw new Error("Agent handoff compatibility repair requires the exact Agent source");
    }
    if (source.status !== "pending" && source.status !== "displayed") {
      throw new Error(`Agent handoff compatibility repair rejected source status: ${source.status}`);
    }

    const cursor = database
      .prepare("SELECT * FROM local_message_cursors WHERE session_id = ?")
      .get(input.sessionId);
    if (!isRecord(cursor)) {
      throw new Error(`local console cursor not found: ${input.sessionId}`);
    }
    if (cursor.active_message_id !== null || cursor.active_run_id !== null) {
      throw new Error("Agent handoff compatibility repair rejected an active cursor");
    }

    const runningOwner = database
      .prepare(
        `SELECT id FROM session_messages
         WHERE session_id = ? AND run_id = ? AND status = 'running'
         LIMIT 1`,
      )
      .get(input.sessionId, input.targetRunId);
    if (runningOwner !== undefined) {
      throw new Error("Agent handoff compatibility repair rejected a running owner");
    }

    const placeholders = database
      .prepare(
        `SELECT * FROM session_messages
         WHERE session_id = ?
           AND run_id = ?
           AND source_kind = 'local-worker-run'
           AND role = ?
         ORDER BY id ASC`,
      )
      .all(input.sessionId, input.targetRunId, input.role)
      .map(readLocalMessageRow);
    if (placeholders.length > 1) {
      throw new Error("Agent handoff compatibility repair found multiple placeholders");
    }
    if (placeholders[0]?.status === "running") {
      throw new Error("Agent handoff compatibility repair rejected a running placeholder");
    }

    const processedThrough = readNumber(
      cursor.processed_through_message_id,
      "processed_through_message_id",
    );
    const needsStatusRepair = source.status === "pending";
    const needsCursorRepair = processedThrough >= source.id;
    if (!needsStatusRepair && !needsCursorRepair) {
      return "already-repaired";
    }
    if (needsStatusRepair) {
      database
        .prepare("UPDATE session_messages SET status = 'displayed', error = NULL, updated_at = ? WHERE id = ?")
        .run(input.now, source.id);
    }
    rewindLocalCursorForRetry(database, input.sessionId, source.id, input.now);
    return "repaired";
  });
}

function recordSystemAndComplete(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-record-system-and-complete" }>,
): null {
  return transaction(database, () => {
    ensureLocalCursor(database, input.sessionId, input.now);
    const source = requireLocalMessage(database, input.userMessageId, input.sessionId);
    insertSystemMessage(database, input.sessionId, input.body, input.runId, input.runDir, null, input.now, "displayed", input.systemEventKind);
    completeSourceMessage(database, source, "completed", null, input.runId, input.runDir, input.now);
    return null;
  });
}

function recordSystemMessage(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-record-system" }>,
): null {
  return transaction(database, () => {
    insertSystemMessage(
      database,
      input.sessionId,
      input.body,
      input.runId,
      input.runDir,
      input.error,
      input.now,
      input.status ?? "displayed",
      input.systemEventKind,
      "local-message",
      null,
      input.terminal ?? null,
    );
    return null;
  });
}

function recordFailure(database: SqliteDatabase, input: Extract<SqliteStateCommand, { kind: "local-record-failure" }>): null {
  return transaction(database, () => {
    ensureLocalCursor(database, input.sessionId, input.now);
    const source = requireLocalMessage(database, input.userMessageId, input.sessionId);
    insertSystemMessage(
      database,
      input.sessionId,
      input.body ?? "这一步没跑起来。你可以重试，或直接说话、换一个成员接手。",
      input.runId,
      input.runDir,
      input.error,
      input.now,
      source.speaker === "agent" ? "failed" : "displayed",
      input.systemEventKind ?? "run-not-started",
      input.sourceKind ?? "local-message",
      input.sourceId ?? null,
      input.terminal ?? null,
    );
    completeSourceMessage(database, source, "failed", input.error, input.runId, input.runDir, input.now);
    return null;
  });
}

function recordRetryableFailure(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-record-retryable-failure" }>,
): unknown {
  return transaction(database, () => {
    ensureLocalCursor(database, input.sessionId, input.now);
    const source = requireLocalMessage(database, input.userMessageId, input.sessionId);
    const nextFailureCount = source.failureCount + 1;
    const nextStatus = source.speaker === "user" ? "pending" : source.status;
    // 自动重试静默进行：不往对话里插系统消息，失败事实记在源消息的
    // failure_count / last_failure_reason 上；反复失败由死信路径终局呈现。
    database
      .prepare(
        `UPDATE session_messages
         SET status = ?,
             run_id = ?,
             run_dir = ?,
             error = ?,
             failure_count = ?,
             last_failure_reason = ?,
             updated_at = ?
         WHERE id = ? AND session_id = ?`,
      )
      .run(nextStatus, input.runId, input.runDir, input.error, nextFailureCount, input.error, input.now, source.id, input.sessionId);
    clearLocalCursorActive(database, input.sessionId, input.now);
    return requireLocalMessage(database, source.id, input.sessionId);
  });
}

function recordDeadLetterAndComplete(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-record-dead-letter-and-complete" }>,
): null {
  return transaction(database, () => {
    ensureLocalCursor(database, input.sessionId, input.now);
    const source = requireLocalMessage(database, input.userMessageId, input.sessionId);
    const failureCount = Math.max(source.failureCount + 1, input.failureCount);
    const body = "这一步反复没跑起来，已经不再重试。你可以说点什么，或换一个成员接手。";
    insertSystemMessage(
      database,
      input.sessionId,
      body,
      input.runId,
      input.runDir,
      input.error,
      input.now,
      "displayed",
      "retry-exhausted",
    );
    database
      .prepare(
        `INSERT INTO local_dead_letters
          (session_id, source_message_id, failure_count, reason, recovered, created_at, recovered_at)
         VALUES (?, ?, ?, ?, 0, ?, NULL)
         ON CONFLICT(session_id, source_message_id)
         DO UPDATE SET
           failure_count = excluded.failure_count,
           reason = excluded.reason,
           recovered = 0,
           recovered_at = NULL`,
      )
      .run(input.sessionId, source.id, failureCount, input.error, input.now);
    if (source.speaker !== "user") {
      database
        .prepare(
          `UPDATE session_messages
           SET error = ?,
               failure_count = ?,
               last_failure_reason = ?,
               updated_at = ?
           WHERE id = ? AND session_id = ?`,
        )
        .run(input.error, failureCount, input.error, input.now, source.id, input.sessionId);
    }
    completeSourceMessage(database, source, "failed", input.error, input.runId, input.runDir, input.now, failureCount, input.error);
    return null;
  });
}

function recordInterrupted(database: SqliteDatabase, input: Extract<SqliteStateCommand, { kind: "local-record-interrupted" }>): null {
  return transaction(database, () => {
    ensureLocalCursor(database, input.sessionId, input.now);
    const source = requireLocalMessage(database, input.userMessageId, input.sessionId);
    insertSystemMessage(
      database,
      input.sessionId,
      input.interruptionKind === "context-unavailable"
        ? "这一步依赖的项目或团队内容已经不可用，因此已停止。已经产生的文件改动会保留。"
        : input.interruptionKind === "redirect"
          ? "新的指令到了，当前这一步已经停下；这个成员会带着新指令重新开始。"
        : input.interruptionKind === "system"
          ? "这一步被系统停止了。已经产生的文件改动会保留。"
        : "你让这一步停下了。已经产生的文件改动会保留。",
      input.runId,
      input.runDir,
      input.reason,
      input.now,
      source.speaker === "agent" ? "interrupted" : "displayed",
      input.interruptionKind === "user" || input.interruptionKind === undefined ? "user-stopped" : "other",
      "local-message",
      null,
      input.terminal ?? null,
    );
    completeSourceMessage(database, source, "interrupted", input.reason, input.runId, input.runDir, input.now);
    return null;
  });
}

function recordStuck(database: SqliteDatabase, input: Extract<SqliteStateCommand, { kind: "local-record-stuck" }>): null {
  return transaction(database, () => {
    ensureLocalCursor(database, input.sessionId, input.now);
    const source = requireLocalMessage(database, input.userMessageId, input.sessionId);
    const body = input.terminal?.kind === "timeout" && input.terminal.subkind === "tool"
      ? "这一步的工具调用运行过久，已经停下。你可以重试，或换一个执行配置。"
      : "这一步卡住了。你可以重试，或直接说话、换一个成员接手。";
    if (source.sourceKind === "local-worker-run") {
      completeDetachedRunPlaceholder(database, input.sessionId, input.runId ?? source.runId ?? "", "stuck", input.reason, input.now);
      insertSystemMessage(
        database,
        input.sessionId,
        body,
        input.runId,
        input.runDir,
        input.reason,
        input.now,
        "stuck",
        "run-stuck",
        "local-message",
        null,
        input.terminal ?? null,
      );
      return null;
    }
    insertSystemMessage(
      database,
      input.sessionId,
      body,
      input.runId,
      input.runDir,
      input.reason,
      input.now,
      source.speaker === "agent" ? "stuck" : "displayed",
      "run-stuck",
      "local-message",
      null,
      input.terminal ?? null,
    );
    completeSourceMessage(database, source, "stuck", input.reason, input.runId, input.runDir, input.now);
    return null;
  });
}

function recordLocalRouteDecision(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-record-route-decision" }>,
): null {
  return transaction(database, () => {
    ensureSession(database, input.sessionId, input.now, undefined, LOCAL_CONSOLE_PROJECT_ID);
    insertLocalRouteDecision(database, input);
    return null;
  });
}

function insertLocalRouteDecision(
  database: SqliteDatabase,
  input: {
    sessionId: string;
    messageId: number;
    routeKey: string;
    outcome: "append" | "no_action" | "fail_open" | "dead_letter";
    targetRole: string | null;
    reason: string;
    now: string;
  },
): void {
  database
    .prepare(
      `INSERT INTO local_route_decisions
        (session_id, message_id, route_key, outcome, target_role, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, route_key) DO NOTHING`,
    )
    .run(input.sessionId, input.messageId, input.routeKey, input.outcome, input.targetRole, input.reason, input.now);
}

function recordLocalDeadLetter(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-record-dead-letter" }>,
): null {
  return transaction(database, () => {
    ensureSession(database, input.sessionId, input.now, undefined, LOCAL_CONSOLE_PROJECT_ID);
    database
      .prepare(
        `INSERT INTO local_dead_letters
          (session_id, source_message_id, failure_count, reason, recovered, created_at, recovered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, source_message_id)
         DO UPDATE SET
           failure_count = excluded.failure_count,
           reason = excluded.reason,
           recovered = excluded.recovered,
           recovered_at = excluded.recovered_at`,
      )
      .run(input.sessionId, input.sourceMessageId, input.failureCount, input.reason, input.recovered ? 1 : 0, input.now, input.recovered ? input.now : null);
    return null;
  });
}

function recordLocalWorkspaceDiff(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-record-workspace-diff" }>,
): null {
  return transaction(database, () => {
    ensureSession(database, input.sessionId, input.now, undefined, LOCAL_CONSOLE_PROJECT_ID);
    database
      .prepare(
        `INSERT INTO local_workspace_diffs
          (session_id, run_id, original_repo_root, base_ref, branch_name, worktree_path, patch_path, affected_files_json, status, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, run_id)
         DO UPDATE SET
           original_repo_root = excluded.original_repo_root,
           base_ref = excluded.base_ref,
           branch_name = excluded.branch_name,
           worktree_path = excluded.worktree_path,
           patch_path = excluded.patch_path,
           affected_files_json = excluded.affected_files_json,
           status = excluded.status,
           error = excluded.error,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.sessionId,
        input.runId,
        input.originalRepoRoot,
        input.baseRef,
        input.branchName,
        input.worktreePath,
        input.patchPath,
        input.affectedFilesJson,
        input.status,
        input.error,
        input.now,
        input.now,
      );
    return null;
  });
}

function listLocalT5Facts(database: SqliteDatabase, sessionId: string | null): unknown {
  const sessionFilter = sessionId === null ? "" : " WHERE session_id = ?";
  const params = sessionId === null ? [] : [sessionId];
  return {
    routeDecisions: database.prepare(`SELECT * FROM local_route_decisions${sessionFilter} ORDER BY created_at ASC`).all(...params),
    acceptanceFacts: database.prepare(`SELECT * FROM local_acceptance_facts${sessionFilter} ORDER BY created_at ASC`).all(...params),
    integrationEvents: database.prepare(`SELECT * FROM local_integration_events${sessionFilter} ORDER BY created_at ASC`).all(...params),
    deadLetters: database.prepare(`SELECT * FROM local_dead_letters${sessionFilter} ORDER BY created_at ASC`).all(...params),
    workspaceDiffs: database.prepare(`SELECT * FROM local_workspace_diffs${sessionFilter} ORDER BY created_at ASC`).all(...params),
    sessionEdges: sessionId === null
      ? database.prepare("SELECT * FROM session_edges ORDER BY created_at ASC").all()
      : database
          .prepare("SELECT * FROM session_edges WHERE parent_session_id = ? OR child_session_id = ? ORDER BY created_at ASC")
          .all(sessionId, sessionId),
  };
}

function markStaleRunning(
  database: SqliteDatabase,
  input: Extract<SqliteStateCommand, { kind: "local-mark-stale-running" }>,
): number {
  return transaction(database, () => {
    ensureLocalCursor(database, input.sessionId, input.now);
    let count = 0;
    const rows = database
      .prepare("SELECT * FROM session_messages WHERE session_id = ? AND status = 'running' AND updated_at < ? ORDER BY id ASC")
      .all(input.sessionId, input.cutoffIso)
      .map(readLocalMessageRow);

    for (const row of rows) {
      if (row.sourceKind === "local-worker-run") {
        completeDetachedRunPlaceholder(
          database,
          input.sessionId,
          row.runId ?? "",
          "stuck",
          input.reason,
          input.now,
        );
        insertSystemMessage(
          database,
          input.sessionId,
          "这一步卡住了。你可以重试，或直接说话、换一个成员接手。",
          row.runId,
          row.runDir,
          input.reason,
          input.now,
          "stuck",
          "run-stuck",
        );
        count += 1;
        continue;
      }
      insertSystemMessage(
        database,
        input.sessionId,
        "这一步卡住了。你可以重试，或直接说话、换一个成员接手。",
        row.runId,
        row.runDir,
        input.reason,
        input.now,
        "stuck",
        "run-stuck",
      );
      completeSourceMessage(database, row, "stuck", input.reason, row.runId, row.runDir, input.now);
      count += 1;
    }

    const activeRows = database
      .prepare(
        `SELECT * FROM local_message_cursors
         WHERE session_id = ?
           AND active_message_id IS NOT NULL
           AND updated_at < ?`,
      )
      .all(input.sessionId, input.cutoffIso);
    for (const activeRow of activeRows) {
      if (!isRecord(activeRow)) {
        continue;
      }
      const activeMessageId = readNumber(activeRow.active_message_id, "active_message_id");
      const activeRunId = readNullableString(activeRow.active_run_id, "active_run_id");
      const sourceRow = database.prepare("SELECT * FROM session_messages WHERE id = ? AND session_id = ?").get(activeMessageId, input.sessionId);
      if (sourceRow === undefined) {
        clearLocalCursorActive(database, input.sessionId, input.now);
        count += 1;
        continue;
      }
      const source = readLocalMessageRow(sourceRow);
      if (source.status === "running") {
        continue;
      }
      insertSystemMessage(
        database,
        input.sessionId,
        "这一步卡住了。你可以重试，或直接说话、换一个成员接手。",
        activeRunId,
        source.runDir,
        input.reason,
        input.now,
        "stuck",
        "run-stuck",
      );
      completeSourceMessage(database, source, "stuck", input.reason, activeRunId, source.runDir, input.now);
      count += 1;
    }

    return count;
  });
}

function ensureLocalCursor(database: SqliteDatabase, sessionId: string, now: string): void {
  const existing = database.prepare("SELECT session_id FROM local_message_cursors WHERE session_id = ?").get(sessionId);
  if (existing !== undefined) {
    return;
  }
  const processedThrough = computeInitialProcessedThrough(database, sessionId);
  database
    .prepare(
      `INSERT INTO local_message_cursors
        (session_id, processed_through_message_id, active_message_id, active_run_id, updated_at)
       VALUES (?, ?, NULL, NULL, ?)`,
    )
    .run(sessionId, processedThrough, now);
}

function computeInitialProcessedThrough(database: SqliteDatabase, sessionId: string): number {
  const rows = database
    .prepare("SELECT * FROM session_messages WHERE session_id = ? ORDER BY id ASC")
    .all(sessionId)
    .map(readLocalMessageRow);
  let processedThrough = 0;
  for (const row of rows) {
    if (
      row.speaker === "user"
      && (row.status === "pending" || row.status === "running")
      && row.dispatchLane !== "worker"
    ) {
      break;
    }
    processedThrough = row.id;
  }
  return processedThrough;
}

function requireLocalCursor(database: SqliteDatabase, sessionId: string): { processedThroughMessageId: number } {
  const row = database.prepare("SELECT * FROM local_message_cursors WHERE session_id = ?").get(sessionId);
  if (!isRecord(row)) {
    throw new Error(`local console cursor not found: ${sessionId}`);
  }
  return {
    processedThroughMessageId: readNumber(row.processed_through_message_id, "processed_through_message_id"),
  };
}

function skipUnprocessableLocalMessages(database: SqliteDatabase, sessionId: string, now: string): void {
  while (true) {
    const cursor = requireLocalCursor(database, sessionId);
    const row = database
      .prepare(
        `SELECT * FROM session_messages
         WHERE session_id = ?
           AND id > ?
         ORDER BY id ASC
         LIMIT 1`,
      )
      .get(sessionId, cursor.processedThroughMessageId);
    if (row === undefined) {
      return;
    }
    const message = readLocalMessageRow(row);
    if (
      message.speaker === "user"
      && message.dispatchLane === "worker"
      && (message.status === "pending" || message.status === "running")
    ) {
      advanceLocalCursor(database, sessionId, message.id, now);
      continue;
    }
    if (message.speaker === "user" && (message.status === "pending" || message.status === "running")) {
      return;
    }
    if (message.speaker === "agent" && message.status === "displayed") {
      return;
    }
    advanceLocalCursor(database, sessionId, message.id, now);
  }
}

function setLocalCursorActive(database: SqliteDatabase, sessionId: string, messageId: number, runId: string, now: string): void {
  database
    .prepare(
      `UPDATE local_message_cursors
       SET active_message_id = ?, active_run_id = ?, updated_at = ?
       WHERE session_id = ?`,
    )
    .run(messageId, runId, now, sessionId);
}

function advanceLocalCursor(database: SqliteDatabase, sessionId: string, messageId: number, now: string): void {
  database
    .prepare(
      `UPDATE local_message_cursors
       SET processed_through_message_id =
             CASE
               WHEN processed_through_message_id > ? THEN processed_through_message_id
               ELSE ?
             END,
           active_message_id = NULL,
           active_run_id = NULL,
           updated_at = ?
       WHERE session_id = ?`,
    )
    .run(messageId, messageId, now, sessionId);
}

function clearLocalCursorActive(database: SqliteDatabase, sessionId: string, now: string): void {
  database
    .prepare(
      `UPDATE local_message_cursors
       SET active_message_id = NULL, active_run_id = NULL, updated_at = ?
       WHERE session_id = ?`,
    )
    .run(now, sessionId);
}

function rewindLocalCursorForRetry(
  database: SqliteDatabase,
  sessionId: string,
  messageId: number,
  now: string,
): void {
  database
    .prepare(
      `UPDATE local_message_cursors
       SET processed_through_message_id =
             CASE
               WHEN processed_through_message_id >= ? THEN ?
               ELSE processed_through_message_id
             END,
           active_message_id = NULL,
           active_run_id = NULL,
           updated_at = ?
       WHERE session_id = ?`,
    )
    .run(messageId, Math.max(0, messageId - 1), now, sessionId);
}

function completeSourceMessage(
  database: SqliteDatabase,
  source: WorkerLocalMessage,
  status: "completed" | "failed" | "interrupted" | "stuck",
  error: string | null,
  runId: string | null,
  runDir: string | null,
  now: string,
  failureCount = status === "completed" ? 0 : source.failureCount,
  lastFailureReason: string | null = status === "completed" ? null : source.lastFailureReason,
): void {
  if (source.speaker === "user") {
    database
      .prepare(
        `UPDATE session_messages
         SET status = ?,
             run_id = ?,
             run_dir = ?,
             error = ?,
             failure_count = ?,
             last_failure_reason = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(status, runId, runDir, error, failureCount, lastFailureReason, now, source.id);
  }
  advanceLocalCursor(database, source.sessionId, source.id, now);
}

function insertSystemMessage(
  database: SqliteDatabase,
  sessionId: string,
  body: string,
  runId: string | null,
  runDir: string | null,
  error: string | null,
  now: string,
  status = "displayed",
  systemEventKind: LocalConsoleSystemEventKind = "other",
  sourceKind = "local-message",
  sourceId: string | null = null,
  terminal: LocalConsoleTerminal | null = null,
): void {
  ensureSession(database, sessionId, now, undefined, LOCAL_CONSOLE_PROJECT_ID);
  database
    .prepare(
      `INSERT INTO session_messages
        (session_id, speaker, role, body, status, run_id, run_dir, error, system_event_kind, source_kind, source_id, terminal_json, created_at, updated_at)
      VALUES (?, 'system', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionId,
      body,
      status,
      runId,
      runDir,
      error,
      systemEventKind,
      sourceKind,
      sourceId,
      terminal === null ? null : JSON.stringify(terminal),
      now,
      now,
    );
  if (
    systemEventKind === "run-not-started"
    || systemEventKind === "run-stuck"
    || systemEventKind === "retry-exhausted"
  ) {
    database
      .prepare("UPDATE sessions SET attention_revision = attention_revision + 1 WHERE session_id = ?")
      .run(sessionId);
  }
}

function requireLocalMessage(database: SqliteDatabase, id: number, sessionId: string): WorkerLocalMessage {
  const row = database.prepare("SELECT * FROM session_messages WHERE id = ? AND session_id = ?").get(id, sessionId);
  if (row === undefined) {
    throw new Error(`local console message not found: ${String(id)}`);
  }
  return withMessageAttachments(database, readLocalMessageRow(row));
}

function requireLocalSession(database: SqliteDatabase, sessionId: string): unknown {
  const row = database.prepare("SELECT * FROM sessions WHERE session_id = ?").get(sessionId);
  if (row === undefined) {
    throw new Error(`local console session not found: ${sessionId}`);
  }
  return readLocalSessionRow(database, row);
}

function requireLocalProject(database: SqliteDatabase, projectId: string): unknown {
  const row = database.prepare("SELECT * FROM projects WHERE project_id = ?").get(projectId);
  if (row === undefined) {
    throw new Error(`local console project not found: ${projectId}`);
  }
  return readLocalProjectRow(database, row);
}

function requireLocalProjectByFolderPath(database: SqliteDatabase, folderPath: string): unknown {
  const row = database.prepare("SELECT * FROM projects WHERE folder_path = ? AND removed_at IS NULL").get(folderPath);
  if (row === undefined) {
    throw new Error(`local console project not found for folder: ${folderPath}`);
  }
  return readLocalProjectRow(database, row);
}

function readLocalProjectRow(database: SqliteDatabase, row: unknown): unknown {
  if (!isRecord(row)) {
    throw new Error("Invalid local console project row");
  }
  const projectId = readString(row.project_id, "project_id");
  const sessions = database
    .prepare("SELECT * FROM sessions WHERE source_type = 'local' AND project_id = ? AND archived_at IS NULL ORDER BY created_at DESC, session_id ASC")
    .all(projectId)
    .map((sessionRow) => readLocalSessionRow(database, sessionRow));
  const counts = { running: 0, waiting: 0, stuck: 0, failed: 0 };
  for (const session of sessions) {
    if (!isRecord(session)) {
      continue;
    }
    counts.running += readNumber(session.runningCount, "runningCount");
    counts.waiting += readNumber(session.waitingCount, "waitingCount");
    counts.stuck += readNumber(session.stuckCount, "stuckCount");
    counts.failed += readNumber(session.errorCount, "errorCount");
  }
  return {
    projectId,
    sourceType: readString(row.source_type, "source_type"),
    title: readString(row.title, "title"),
    folderPath: readNullableString(row.original_folder_path, "original_folder_path") ?? readString(row.folder_path, "folder_path"),
    worktreeMode: readBooleanNumber(row.worktree_mode, "worktree_mode"),
    workspaceCwd: readNullableString(row.workspace_cwd, "workspace_cwd"),
    workspaceMode: readNullableString(row.workspace_mode, "workspace_mode"),
    worktreePath: readNullableString(row.worktree_path, "worktree_path"),
    worktreeUnavailableReason: readNullableString(row.worktree_unavailable_reason, "worktree_unavailable_reason"),
    workspaceUpdatedAt: readNullableString(row.workspace_updated_at, "workspace_updated_at"),
    sessions,
    runningCount: counts.running,
    waitingCount: counts.waiting,
    stuckCount: counts.stuck,
    errorCount: counts.failed,
  };
}

function readLocalSessionRow(database: SqliteDatabase, row: unknown): unknown {
  if (!isRecord(row)) {
    throw new Error("Invalid local console session row");
  }
  const sessionId = readString(row.session_id, "session_id");
  const counts = readSessionCounts(database, sessionId);
  const hasPendingControlWork = hasPendingLocalControlWork(database, sessionId);
  const effectiveCounts = {
    ...counts,
    running: planPendingAttentionRunningCount({
      persistedRunningCount: counts.running,
      hasPendingControlWork,
    }),
  };
  const awaitsHumanReason = null;
  counts.waiting = 0;
  const unresolvedSystemEventKind = readUnresolvedSystemEventKind(database, sessionId);
  const lastMessageMentionsAgent = readLastMessageMentionsAgent(database, sessionId);
  const childCountRow = database
    .prepare("SELECT COUNT(*) AS count FROM sessions WHERE parent_session_id = ?")
    .get(sessionId);
  const effectiveTeamSnapshot = summarizeAgentTeamSnapshot(
    readLocalSessionAgentTeamSnapshotSlot(database, sessionId, "effective"),
  );
  const pendingTeamSnapshot = summarizeAgentTeamSnapshot(
    readLocalSessionAgentTeamSnapshotSlot(database, sessionId, "pending"),
  );
  return {
    sessionId,
    projectId: readString(row.project_id, "project_id"),
    parentSessionId: readNullableString(row.parent_session_id, "parent_session_id"),
    analysisParentSessionId: "analysis_parent_session_id" in row
      ? readNullableString(row.analysis_parent_session_id, "analysis_parent_session_id")
      : null,
    originSessionId: "origin_session_id" in row ? readNullableString(row.origin_session_id, "origin_session_id") : null,
    entryTemplate: readLocalEntryTemplate("entry_template" in row ? row.entry_template : null),
    writePolicy: readLocalWritePolicy("write_policy" in row ? row.write_policy : "normal"),
    proposalVersion: "proposal_version" in row ? readNullableString(row.proposal_version, "proposal_version") : null,
    writeLeaseVersion: "write_lease_version" in row ? readNullableString(row.write_lease_version, "write_lease_version") : null,
    agentTeamOwnership: readNullableAgentTeamOwnership(row.agent_team_ownership),
    agentTeamId: readNullableString(row.agent_team_id, "agent_team_id"),
    agentTeamPendingOwnership: readNullableAgentTeamOwnership(row.agent_team_pending_ownership),
    agentTeamPendingId: readNullableString(row.agent_team_pending_id, "agent_team_pending_id"),
    agentTeamSnapshot: effectiveTeamSnapshot,
    agentTeamPendingSnapshot: pendingTeamSnapshot,
    workspaceMode: readLocalWorkspaceMode(row.workspace_mode, "workspace_mode"),
    workspacePendingMode: null,
    title: planPersistedSessionTitle(
      readNullableString(row.title, "title"),
      fallbackSessionTitle(sessionId),
    ),
    titleRevision: readNumber(row.title_revision, "title_revision"),
    pinnedAt: readNullableString(row.pinned_at, "pinned_at"),
    status: sessionStatusFromCounts(effectiveCounts),
    awaitsHumanReason,
    unreadSince: readNullableString(row.unread_since, "unread_since"),
    manualUnreadAt: readNullableString(row.manual_unread_at, "manual_unread_at"),
    manualUnreadRequiresLeave: readBooleanNumber(
      row.manual_unread_requires_leave,
      "manual_unread_requires_leave",
    ),
    readStateRevision: readNumber(row.read_state_revision, "read_state_revision"),
    attentionRevision: readNumber(row.attention_revision, "attention_revision"),
    attentionAcknowledgedRevision: readNumber(
      row.attention_acknowledged_revision,
      "attention_acknowledged_revision",
    ),
    attentionKind: readNullableString(row.attention_kind, "attention_kind") as
      | "project-unavailable"
      | "team-deleted"
      | "team-needs-repair"
      | null,
    hasUnacknowledgedAttention: (
      unresolvedSystemEventKind !== null
      || readNullableString(row.attention_kind, "attention_kind") !== null
    ) && readNumber(row.attention_revision, "attention_revision")
      > readNumber(row.attention_acknowledged_revision, "attention_acknowledged_revision"),
    unresolvedSystemEventKind,
    lastMessageMentionsAgent,
    hasPendingControlWork,
    runningCount: effectiveCounts.running,
    waitingCount: counts.waiting,
    stuckCount: counts.stuck,
    errorCount: counts.failed,
    interruptedCount: counts.interrupted,
    childCount: isRecord(childCountRow) ? readNumber(childCountRow.count, "count") : 0,
    createdAt: readString(row.created_at, "created_at"),
    updatedAt: readString(row.updated_at, "updated_at"),
  };
}

function summarizeAgentTeamSnapshot(
  snapshot: LocalConsoleAgentTeamSnapshot | null,
): import("./local-console/types.js").LocalConsoleAgentTeamSnapshotSummary | null {
  if (snapshot?.team === undefined) return null;
  return {
    team: snapshot.team,
    members: snapshot.members.map((member) => ({
      name: member.name,
      displayName: member.displayName ?? null,
      description: member.description ?? null,
    })),
    loadedAt: snapshot.loadedAt ?? null,
  };
}

function readUnresolvedSystemEventKind(
  database: SqliteDatabase,
  sessionId: string,
): LocalConsoleSystemEventKind | null {
  const row = database
    .prepare(
      `SELECT speaker, system_event_kind
       FROM session_messages
       WHERE session_id = ?
         AND (
           speaker IN ('user', 'agent')
           OR system_event_kind IN ('run-not-started', 'run-stuck', 'user-stopped', 'retry-exhausted')
         )
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(sessionId);
  if (!isRecord(row) || row.speaker !== "system") {
    return null;
  }
  const kind = readSystemEventKind(row.system_event_kind);
  return kind === "run-not-started" || kind === "run-stuck" || kind === "retry-exhausted" ? kind : null;
}

function readLastMessageMentionsAgent(database: SqliteDatabase, sessionId: string): boolean {
  const row = database
    .prepare("SELECT body FROM session_messages WHERE session_id = ? ORDER BY id DESC LIMIT 1")
    .get(sessionId);
  return isRecord(row) && parseAgentMentions(readString(row.body, "body")).length > 0;
}

function readSessionCounts(database: SqliteDatabase, sessionId: string): {
  running: number;
  waiting: number;
  stuck: number;
  failed: number;
  interrupted: number;
} {
  const rows = database
    .prepare("SELECT status, COUNT(*) AS count FROM session_messages WHERE session_id = ? GROUP BY status")
    .all(sessionId);
  const counts = { running: 0, waiting: 0, stuck: 0, failed: 0, interrupted: 0 };
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const status = readString(row.status, "status");
    const count = readNumber(row.count, "count");
    if (status === "running") {
      counts.running += count;
    } else if (status === "stuck") {
      counts.stuck += count;
    } else if (status === "failed") {
      counts.failed += count;
    } else if (status === "interrupted") {
      counts.interrupted += count;
    }
  }
  return counts;
}

function updateSessionAttentionAfterAgentResponse(
  database: SqliteDatabase,
  sessionId: string,
  body: string,
  now: string,
): void {
  database
    .prepare(
      `UPDATE sessions
       SET awaits_human_reason = NULL, unread_since = ?,
           read_state_revision = read_state_revision + 1,
           updated_at = ?
       WHERE session_id = ?`,
    )
    .run(now, now, sessionId);
}

function sessionStatusFromCounts(counts: {
  running: number;
  waiting: number;
  stuck: number;
  failed: number;
  interrupted: number;
}): string {
  if (counts.running > 0) {
    return "running";
  }
  if (counts.stuck > 0) {
    return "stuck";
  }
  if (counts.failed > 0) {
    return "failed";
  }
  if (counts.interrupted > 0) {
    return "interrupted";
  }
  if (counts.waiting > 0) {
    return "waiting";
  }
  return "idle";
}

function readLocalMessageRow(row: unknown): WorkerLocalMessage {
  if (!isRecord(row)) {
    throw new Error("Invalid local console message row");
  }
  return {
    id: readNumber(row.id, "id"),
    sessionId: readString(row.session_id, "session_id"),
    speaker: readString(row.speaker, "speaker"),
    role: readNullableString(row.role, "role"),
    body: readString(row.body, "body"),
    status: readString(row.status, "status"),
    runId: readNullableString(row.run_id, "run_id"),
    runDir: readNullableString(row.run_dir, "run_dir"),
    error: readNullableString(row.error, "error"),
    systemEventKind: readSystemEventKind(row.system_event_kind),
    terminal: "terminal_json" in row ? readTerminalJson(row.terminal_json) : null,
    failureCount: "failure_count" in row ? readNumber(row.failure_count, "failure_count") : 0,
    lastFailureReason: "last_failure_reason" in row ? readNullableString(row.last_failure_reason, "last_failure_reason") : null,
    sourceKind: "source_kind" in row ? readNullableString(row.source_kind, "source_kind") : null,
    sourceId: "source_id" in row ? readNullableString(row.source_id, "source_id") : null,
    textFragments: "text_fragments_json" in row
      ? readTextFragmentsJson(row.text_fragments_json)
      : [],
    activatedAt: "activated_at" in row ? readNullableString(row.activated_at, "activated_at") : null,
    dispatchLane: readDispatchLane("dispatch_lane" in row ? row.dispatch_lane : null),
    dispatchRole: "dispatch_role" in row ? readNullableString(row.dispatch_role, "dispatch_role") : null,
    dispatchReason: readDispatchReason("dispatch_reason" in row ? row.dispatch_reason : null),
    createdAt: readString(row.created_at, "created_at"),
    updatedAt: readString(row.updated_at, "updated_at"),
  };
}

function readDispatchLane(value: unknown): WorkerLocalMessage["dispatchLane"] {
  const lane = readNullableString(value, "dispatch_lane");
  if (lane === null || lane === "primary" || lane === "worker" || lane === "awaiting-team") {
    return lane;
  }
  throw new Error("Invalid dispatch_lane");
}

function readDispatchReason(value: unknown): WorkerLocalMessage["dispatchReason"] {
  const reason = readNullableString(value, "dispatch_reason");
  if (
    reason === null
    || reason === "single-valid-mention"
    || reason === "no-valid-mention"
    || reason === "multiple-valid-mentions"
  ) {
    return reason;
  }
  throw new Error("Invalid dispatch_reason");
}

function readLocalEntryTemplate(value: unknown): "session-analysis" | null {
  const template = readNullableString(value, "entry_template");
  if (template === null || template === "session-analysis") {
    return template;
  }
  throw new Error("Invalid entry_template");
}

function readLocalWritePolicy(value: unknown): "normal" | "confirm-current-plan-before-write" {
  const policy = readString(value, "write_policy");
  if (policy === "normal" || policy === "confirm-current-plan-before-write") {
    return policy;
  }
  throw new Error("Invalid write_policy");
}

function readTextFragmentsJson(value: unknown): Array<{ id: string; label: string; text: string }> {
  if (typeof value !== "string") {
    throw new Error("Invalid text_fragments_json");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Invalid text_fragments_json");
  }
  return readTextFragments(parsed);
}

function readTextFragments(value: unknown): Array<{ id: string; label: string; text: string }> {
  if (!Array.isArray(value)) {
    throw new Error("Text fragments must be an array");
  }
  const ids = new Set<string>();
  return value.map((fragment) => {
    if (
      !isRecord(fragment)
      || typeof fragment.id !== "string"
      || fragment.id.trim() === ""
      || typeof fragment.label !== "string"
      || fragment.label.trim() === ""
      || typeof fragment.text !== "string"
      || fragment.text.trim() === ""
    ) {
      throw new Error("Invalid text fragment");
    }
    if (ids.has(fragment.id)) {
      throw new Error("Text fragment ids must be unique");
    }
    ids.add(fragment.id);
    return {
      id: fragment.id,
      label: fragment.label,
      text: fragment.text,
    };
  });
}

function normalizeSessionSearchText(value: string): string {
  return value.trim().normalize("NFKC").toLowerCase();
}

function readSystemEventKind(value: unknown): LocalConsoleSystemEventKind {
  if (
    value === "run-not-started" ||
    value === "run-stuck" ||
    value === "user-stopped" ||
    value === "resume-unavailable" ||
    value === "retry-exhausted" ||
    value === "other"
  ) {
    return value;
  }
  throw new Error(`Invalid system_event_kind: ${String(value)}`);
}

function readTerminalJson(value: unknown): LocalConsoleTerminal | null {
  const serialized = readNullableString(value, "terminal_json");
  if (serialized === null) return null;
  try {
    return readLocalTerminal(JSON.parse(serialized) as unknown);
  } catch {
    throw new Error("Invalid terminal_json");
  }
}

function readLocalTerminal(value: unknown): LocalConsoleTerminal | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new Error("Invalid local terminal");
  const kind = readString(value.kind, "terminal.kind");
  if (
    kind !== "interrupted"
    && kind !== "timeout"
    && kind !== "quota-exhausted"
    && kind !== "rate-limited"
    && kind !== "auth"
    && kind !== "crashed"
  ) {
    throw new Error(`Invalid local terminal kind: ${kind}`);
  }
  if (value.contentIncomplete !== true) {
    throw new Error("Invalid local terminal completeness");
  }
  return {
    kind,
    subkind: readNullableString(value.subkind, "terminal.subkind"),
    safeCode: readNullableString(value.safeCode, "terminal.safeCode"),
    retryable: value.retryable === null
      ? null
      : typeof value.retryable === "boolean"
        ? value.retryable
        : (() => { throw new Error("Invalid terminal.retryable"); })(),
    partialMarkdown: readString(value.partialMarkdown, "terminal.partialMarkdown"),
    contentIncomplete: true,
    actualProfile: readLocalExecutionProfile(value.actualProfile),
  };
}

function readLocalExecutionProfile(
  value: unknown,
): import("./local-console/types.js").LocalConsoleExecutionProfile | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new Error("Invalid terminal.actualProfile");
  const cli = readString(value.cli, "terminal.actualProfile.cli");
  if (cli !== "codex" && cli !== "claude" && cli !== "kimi" && cli !== "pi") {
    throw new Error("Invalid terminal.actualProfile.cli");
  }
  const model = readString(value.model, "terminal.actualProfile.model");
  const effort = readString(value.effort, "terminal.actualProfile.effort");
  if (cli === "pi") {
    if (value.providerId !== "deepseek") throw new Error("Invalid terminal.actualProfile.providerId");
    return {
      cli,
      providerId: "deepseek",
      providerProfileId: readString(value.providerProfileId, "terminal.actualProfile.providerProfileId"),
      model,
      effort,
    };
  }
  return { cli, model, effort };
}

function ensureSession(
  database: SqliteDatabase,
  sessionId: string,
  now: string,
  title?: string,
  projectId?: string,
  agentTeam?: { ownership?: "system" | "user"; id?: string },
): void {
  const parsed = sessionId.startsWith("github:") ? parseIssueKey(sessionId.slice("github:".length)) : null;
  const sourceType = parsed === null ? "local" : "github";
  const resolvedProjectId = sourceType === "local" ? (projectId ?? LOCAL_CONSOLE_PROJECT_ID) : null;
  const resolvedTeamOwnership = sourceType === "local" ? (agentTeam?.ownership ?? null) : null;
  const resolvedTeamId = sourceType === "local" ? (agentTeam?.id ?? null) : null;
  database
    .prepare(
      `INSERT INTO sessions
        (session_id, project_id, source_type, source_owner, source_repo, source_issue_number, parent_session_id, agent_team_ownership, agent_team_id, workspace_mode, title, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, CASE WHEN ? = 'local' THEN COALESCE((SELECT CASE WHEN worktree_mode = 1 THEN 'worktree' ELSE 'direct' END FROM projects WHERE project_id = ?), 'direct') ELSE NULL END, ?, 'active', ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        title = COALESCE(sessions.title, excluded.title),
        agent_team_ownership = COALESCE(sessions.agent_team_ownership, excluded.agent_team_ownership),
        agent_team_id = COALESCE(sessions.agent_team_id, excluded.agent_team_id),
        project_id = CASE
          WHEN sessions.source_type = 'local' THEN COALESCE(sessions.project_id, excluded.project_id)
          ELSE sessions.project_id
        END,
        updated_at = excluded.updated_at`,
    )
    .run(
      sessionId,
      resolvedProjectId,
      sourceType,
      parsed?.owner ?? null,
      parsed?.repo ?? null,
      parsed?.issueNumber ?? null,
      resolvedTeamOwnership,
      resolvedTeamId,
      sourceType,
      resolvedProjectId,
      title ?? null,
      now,
      now,
    );
}

function readNullableAgentTeamOwnership(value: unknown): "system" | "user" | null {
  const ownership = readNullableString(value, "agent_team_ownership");
  if (ownership === null || ownership === "system" || ownership === "user") {
    return ownership;
  }
  throw new Error("Invalid agent_team_ownership");
}

function readExecutionProfile(row: Record<string, unknown>): {
  cli: "codex" | "claude" | "kimi";
  model: string;
  effort: string;
} | {
  cli: "pi";
  providerId: "deepseek";
  providerProfileId: string;
  model: string;
  effort: string;
} | null {
  const cli = row.execution_cli;
  const model = row.execution_model;
  const effort = row.execution_effort;
  if (cli == null && model == null && effort == null) {
    return null;
  }
  if (
    (cli !== "codex" && cli !== "claude" && cli !== "kimi" && cli !== "pi")
    || typeof model !== "string"
    || model.length === 0
    || typeof effort !== "string"
    || effort.length === 0
  ) {
    throw new Error("Invalid local session execution profile");
  }
  if (cli === "pi") {
    if (row.provider_id !== "deepseek" || typeof row.provider_profile_id !== "string" || row.provider_profile_id.length === 0) {
      throw new Error("Invalid Pi local session execution profile");
    }
    return { cli, providerId: "deepseek", providerProfileId: row.provider_profile_id, model, effort };
  }
  return { cli, model, effort };
}

function readLocalWorkspaceMode(value: unknown, field: string): "direct" | "worktree" {
  const mode = readString(value, field);
  if (mode === "direct" || mode === "worktree") {
    return mode;
  }
  throw new Error(`Invalid ${field}`);
}

function titleFromMessage(body: string): string {
  const collapsed = body.trim().replace(/\s+/gu, " ");
  if (collapsed.length === 0) {
    return "新会话";
  }
  return collapsed.length > 32 ? `${collapsed.slice(0, 32)}...` : collapsed;
}

function projectIdForFolder(folderPath: string): string {
  return `local-project:${createHash("sha1").update(path.resolve(folderPath)).digest("hex").slice(0, 16)}`;
}

function nextProjectIdForFolder(database: SqliteDatabase, folderPath: string, now: string): string {
  const baseId = projectIdForFolder(folderPath);
  if (database.prepare("SELECT 1 AS found FROM projects WHERE project_id = ?").get(baseId) === undefined) {
    return baseId;
  }
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const candidate = `local-project:${createHash("sha1")
      .update(`${path.resolve(folderPath)}\0${now}\0${String(attempt)}`)
      .digest("hex")
      .slice(0, 16)}`;
    if (database.prepare("SELECT 1 AS found FROM projects WHERE project_id = ?").get(candidate) === undefined) {
      return candidate;
    }
  }
  throw new Error(`Unable to allocate local project id for folder: ${folderPath}`);
}

function projectTitleFromFolder(folderPath: string): string {
  return path.basename(path.resolve(folderPath)) || path.resolve(folderPath);
}

function fallbackSessionTitle(sessionId: string): string {
  return planFallbackSessionTitle(sessionId, LOCAL_CONSOLE_DEFAULT_SESSION_ID);
}

function markSchemaMigration(database: SqliteDatabase, version: string): void {
  database
    .prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)")
    .run(version, new Date().toISOString());
}

function markMigrationImported(database: SqliteDatabase, source: "local-messages", legacyDigest: string | null): void {
  database
    .prepare(
      `INSERT INTO legacy_migration_sources (source, legacy_digest, status, imported_at, error)
       VALUES (?, ?, 'imported', ?, NULL)
       ON CONFLICT(source)
       DO UPDATE SET legacy_digest = excluded.legacy_digest, status = 'imported', imported_at = excluded.imported_at, error = NULL`,
    )
    .run(source, legacyDigest, new Date().toISOString());
}

function transaction<T>(database: SqliteDatabase, body: () => T): T {
  if (database.isTransaction) {
    database.exec("SAVEPOINT moebius_nested_transaction");
    try {
      const result = body();
      database.exec("RELEASE SAVEPOINT moebius_nested_transaction");
      return result;
    } catch (error) {
      try {
        database.exec("ROLLBACK TO SAVEPOINT moebius_nested_transaction");
        database.exec("RELEASE SAVEPOINT moebius_nested_transaction");
      } catch {
        // Keep the original error.
      }
      throw error;
    }
  }
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = body();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Keep the original error.
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid SQLite row ${field}`);
  }
  return value;
}

function readNullableString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }
  return readString(value, field);
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown, field: string): number {
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`Invalid SQLite row ${field}`);
  }
  return value;
}

function readBooleanNumber(value: unknown, field: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  const numberValue = readNumber(value, field);
  if (numberValue === 0) {
    return false;
  }
  if (numberValue === 1) {
    return true;
  }
  throw new Error(`Invalid SQLite boolean ${field}`);
}

function toNumberId(value: number | bigint | undefined): number {
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "number") {
    return value;
  }
  throw new Error("SQLite insert did not return a row id");
}

function assertNever(value: never): never {
  throw new Error(`Unhandled SQLite command: ${JSON.stringify(value)}`);
}
