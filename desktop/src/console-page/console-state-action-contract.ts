import type { OperatorSession, Translate } from "@moebius/console-ui";

import type {
  ConsoleSelection,
  ConsoleStateCoordinator,
  SelectionMutationKind,
  SelectionMutationToken,
} from "./console-state-coordinator.js";

export interface CreatedSession {
  sessionId: string;
  title?: string;
  projectId?: string;
  analysisParentSessionId?: string | null;
  originSessionId?: string | null;
  entryTemplate?: "session-analysis" | null;
  writePolicy?: "normal" | "confirm-current-plan-before-write";
  agentTeamOwnership?: "system" | "user" | null;
  agentTeamId?: string | null;
}

export interface ConsoleProjectResult {
  projectId: string;
  sessions: Array<{ sessionId: string; parentSessionId?: string | null }>;
}

export interface ArchiveSessionResult {
  sessionId?: string;
  projectId?: string;
  selectedSessionId?: string | null;
  archivedSessionIds?: string[];
  error?: string;
}

export interface ConsoleCommandPort {
  createSession(apiBase: string, payload: Record<string, unknown>): Promise<CreatedSession>;
  openProject(apiBase: string, folderPath: string): Promise<ConsoleProjectResult>;
  rebindSessionProject(apiBase: string, sessionId: string, projectId: string): Promise<CreatedSession>;
  patchSessionContext(
    apiBase: string,
    sessionId: string,
    context: "workspace" | "team",
    payload: Record<string, unknown>,
    fallbackError: string,
  ): Promise<void>;
  reorderProjects(apiBase: string, projectIds: string[]): Promise<void>;
  archiveSession(apiBase: string, sessionId: string): Promise<ArchiveSessionResult>;
  mutateSession(
    apiBase: string,
    sessionId: string,
    action: "attention" | "pin" | "title" | "arm-manual-unread" | "viewed",
    payload: Record<string, unknown> | undefined,
  ): Promise<OperatorSession>;
  sendMessage(apiBase: string, sessionId: string, payload: Record<string, unknown>): Promise<void>;
}

export interface ConsoleStateActionsOptions {
  apiBase: string | null;
  commands: ConsoleCommandPort;
  coordinator: ConsoleStateCoordinator;
  t: Translate;
  getSelection(): ConsoleSelection;
  commitSelection(selection: ConsoleSelection): void;
  refresh(selection: ConsoleSelection, mutationOwner?: SelectionMutationToken): Promise<boolean>;
  composerValue: string;
  clearComposer(sessionId?: string): void;
  getAttachmentIds(): readonly string[];
  getResumeRunId(sessionId: string): string | null;
  clearAttachments(sessionId: string): void;
  clearResumeRunId(sessionId: string): void;
  setMutationKind(kind: SelectionMutationKind | null): void;
  setSending(sending: boolean): void;
  setError(error: string): void;
  commitSessionMetadata(session: OperatorSession): void;
  selectProjectFolder?: () => Promise<string | null>;
}
