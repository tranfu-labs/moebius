import type {
  OperatorChildSessionSummary,
  OperatorMemberIdentity,
  OperatorMessage,
  OperatorPendingDispatch,
  OperatorProject,
  OperatorRunSnapshot,
  OperatorSession,
  OperatorWorkspaceDiffSummary,
} from "@moebius/console-ui";

export interface LocalConsoleState {
  projects: OperatorProject[];
  project: OperatorProject;
  selectedProjectId: string;
  selectedSessionId: string;
  selectedSession: OperatorSession | null;
  messages: OperatorMessage[];
  pendingDispatchMessages?: OperatorPendingDispatch[];
  pendingPrimaryMessages: OperatorMessage[];
  childSessions: OperatorChildSessionSummary[];
  memberIdentities: OperatorMemberIdentity[];
  activeRun: OperatorRunSnapshot | null;
  activeRuns: OperatorRunSnapshot[];
  workspaceDiff: OperatorWorkspaceDiffSummary;
  sqlitePath: string;
  lastError: string | null;
}
