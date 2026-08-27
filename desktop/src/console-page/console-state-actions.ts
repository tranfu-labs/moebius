import type { ConsoleSelection } from "./console-state-coordinator.js";
import type {
  ConsoleNavigationScene,
  ConsoleStateActionsOptions,
  CreatedSession,
} from "./console-state-action-contract.js";
import { conversationActions } from "./conversation-actions.js";
import { projectOpeningActions } from "./project-opening-actions.js";
import { projectSessionActions } from "./project-session-actions.js";
import { sessionCreationActions } from "./session-creation-actions.js";

export type { ConsoleStateActionsOptions } from "./console-state-action-contract.js";

export class ConsoleStateActions {
  constructor(private readonly options: ConsoleStateActionsOptions) {}

  readonly createSessionWithFirstMessage = async (
    projectId: string,
    initialMessage: string,
    agentTeam?: { ownership: "system" | "user"; id: string },
    workspaceMode?: "direct" | "worktree",
    attachmentIds: readonly string[] = [],
  ): Promise<CreatedSession | null> => await sessionCreationActions.createSessionWithFirstMessage(
    this.options,
    projectId,
    initialMessage,
    agentTeam,
    workspaceMode,
    attachmentIds,
  );

  readonly addProject = async (
    existingProjectIds: readonly string[],
  ): Promise<{ projectId: string } | null> => await projectOpeningActions.addProject(
    this.options,
    existingProjectIds,
  );

  readonly openProject = async (): Promise<void> => await projectOpeningActions.openProject(this.options);

  readonly selectSession = (
    nextSelection: ConsoleSelection,
    navigationScene?: ConsoleNavigationScene,
  ): void => projectSessionActions.selectSession(this.options, nextSelection, navigationScene);

  readonly captureNavigationScene = (): ConsoleNavigationScene | undefined =>
    this.options.getNavigationScene?.();

  readonly rebindSessionProject = async (sessionId: string, projectId: string): Promise<void> =>
    await projectSessionActions.rebindSessionProject(this.options, sessionId, projectId);

  readonly changeSessionWorkspace = async (
    sessionId: string,
    workspaceMode: "direct" | "worktree",
  ): Promise<void> => await projectSessionActions.changeSessionWorkspace(
    this.options,
    sessionId,
    workspaceMode,
  );

  readonly changeSessionTeam = async (
    sessionId: string,
    team: { ownership: "system" | "user"; id: string },
  ): Promise<void> => await projectSessionActions.changeSessionTeam(this.options, sessionId, team);

  readonly reorderProjects = async (projectIds: string[]): Promise<boolean> =>
    await projectSessionActions.reorderProjects(this.options, projectIds);

  readonly archiveSession = async (sessionId: string, projectId: string): Promise<string[] | null> =>
    await projectSessionActions.archiveSession(this.options, sessionId, projectId);

  readonly updateSessionReadState = async (
    session: {
      id: string;
      titleRevision?: number;
      attentionRevision?: number;
      readStateRevision?: number;
    },
    action: "mark-read-attention" | "mark-read-unread" | "mark-unread",
  ): Promise<void> => await conversationActions.updateSessionReadState(this.options, session, action);

  readonly setSessionPinned = async (
    session: { id: string; pinnedAt?: string | null },
    pinned: boolean,
  ): Promise<void> => await conversationActions.setSessionPinned(this.options, session, pinned);

  readonly renameSession = async (
    session: { id: string; titleRevision?: number },
    title: string,
  ): Promise<void> => await conversationActions.renameSession(this.options, session, title);

  readonly transitionSessionView = async (
    previousSessionId: string,
    nextSessionId: string,
  ): Promise<string | null> => await conversationActions.transitionSessionView(
    this.options,
    previousSessionId,
    nextSessionId,
  );

  readonly sendMessage = async (body?: string): Promise<boolean> => await conversationActions.sendMessage(this.options, body);
}
