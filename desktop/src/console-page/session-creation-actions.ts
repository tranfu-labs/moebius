import type { ConsoleStateActionsOptions, CreatedSession } from "./console-state-action-contract.js";
import {
  decideConsoleApiBase,
  decideMutationToken,
  planConsoleErrorMessage,
  planSessionCreation,
} from "./console-state-plan.js";
import { selectionMutationLifecycle } from "./selection-mutation-lifecycle.js";

export const sessionCreationActions = {
  async createSessionWithFirstMessage(
    options: ConsoleStateActionsOptions,
    projectId: string,
    initialMessage: string,
    agentTeam?: { ownership: "system" | "user"; id: string },
    workspaceMode?: "direct" | "worktree",
    attachmentIds: readonly string[] = [],
  ): Promise<CreatedSession | null> {
    const availability = decideConsoleApiBase(
      options.apiBase,
      options.t("desktop.error.localConsoleUnavailable"),
    );
    if (availability.kind === "unavailable") {
      options.setError(availability.message);
      return null;
    }
    const creation = planSessionCreation({ initialMessage, attachmentIds, agentTeam, workspaceMode });
    if (creation.kind === "skip") return null;
    const mutation = decideMutationToken(selectionMutationLifecycle.begin(options, "create-session"));
    if (mutation.kind === "busy") return null;
    options.setSending(true);
    try {
      const session = await options.commands.createSession(availability.apiBase, {
        projectId,
        ...creation.payload,
      });
      const nextSelection = { projectId, sessionId: session.sessionId };
      options.commitSelection(nextSelection);
      await options.refresh(nextSelection, mutation.token);
      return session;
    } catch (error) {
      options.setError(planConsoleErrorMessage(error));
      return null;
    } finally {
      options.setSending(false);
      selectionMutationLifecycle.finish(options, mutation.token);
    }
  },
};
