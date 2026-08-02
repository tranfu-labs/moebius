import { useCallback, useMemo, useState, type MutableRefObject } from "react";
import type { OperatorSession, TranslationKey } from "@moebius/console-ui";

import type { DesktopApi } from "./desktop-api-contract.js";
import type { LocalConsoleState } from "./console-state-contract.js";
import { ConsoleStateActions } from "./console-state-actions.js";
import type {
  ConsoleCommandPort,
  ConsoleNavigationScene,
} from "./console-state-action-contract.js";
import type {
  ConsoleSelection,
  ConsoleStateCoordinator,
  SelectionMutationKind,
} from "./console-state-coordinator.js";
import type { ConversationDraftStore } from "./draft-store.js";
import { sessionDraftKey } from "./conversation-draft-model.js";
import {
  decideProjectFolderSelectionAvailability,
  planComposerTargetSessionId,
  planSessionMetadataState,
} from "./console-state-plan.js";
import { planReadyAttachmentIds } from "./managed-attachment-model.js";
import type { useManagedAttachmentDrafts } from "./use-managed-attachments.js";
import type { ConsoleErrorController } from "./use-console-error-state.js";
import type { ConsolePresentationRoute } from "./presentation-route.js";

export function useConsoleStateActions(
  apiBase: string | null,
  commands: ConsoleCommandPort,
  coordinator: ConsoleStateCoordinator,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string,
  selectionRef: MutableRefObject<ConsoleSelection>,
  commitSelection: (selection: ConsoleSelection) => void,
  presentationRouteRef: MutableRefObject<ConsolePresentationRoute | null>,
  commitPresentationRoute: (route: ConsolePresentationRoute) => void,
  refresh: (selection: ConsoleSelection) => Promise<boolean>,
  composerValue: string,
  clearComposer: (sessionId: string) => void,
  attachments: ReturnType<typeof useManagedAttachmentDrafts>,
  draftStore: ConversationDraftStore,
  stateRef: MutableRefObject<LocalConsoleState | null>,
  replaceState: (state: LocalConsoleState) => void,
  errors: ConsoleErrorController,
  api: DesktopApi | undefined,
  getNavigationScene?: () => ConsoleNavigationScene,
  restoreNavigationScene?: (scene: ConsoleNavigationScene) => void,
) {
  const [isSending, setIsSending] = useState(false);
  const [selectionMutationKind, setSelectionMutationKind] = useState<SelectionMutationKind | null>(null);
  const commitSessionMetadata = useCallback((updated: OperatorSession) => {
    const next = planSessionMetadataState(stateRef.current, updated);
    if (next === null) return;
    replaceState(next);
  }, [replaceState, stateRef]);
  const actions = useMemo(() => new ConsoleStateActions({
    apiBase,
    commands,
    coordinator,
    t,
    getSelection: () => selectionRef.current,
    commitSelection,
    getPresentationRoute: () => presentationRouteRef.current,
    commitPresentationRoute,
    getNavigationScene,
    restoreNavigationScene,
    refresh,
    composerValue,
    clearComposer: (sessionId) => clearComposer(planComposerTargetSessionId(
      sessionId,
      selectionRef.current.sessionId,
    )),
    getAttachmentIds: () => planReadyAttachmentIds(attachments.attachments),
    getResumeRunId: (sessionId) => draftStore.readResumeRunId(sessionDraftKey(sessionId)),
    clearAttachments: (sessionId) => attachments.clearDraft(sessionDraftKey(sessionId)),
    clearResumeRunId: (sessionId) => draftStore.clearResumeRunId(sessionDraftKey(sessionId)),
    setMutationKind: setSelectionMutationKind,
    setSending: setIsSending,
    errors,
    commitSessionMetadata,
    selectProjectFolder: decideProjectFolderSelectionAvailability(
      api?.selectProjectFolder !== undefined,
    ) === "unavailable" ? undefined : () => api!.selectProjectFolder!(),
  }), [
    api, apiBase, attachments, clearComposer, commands, commitPresentationRoute,
    commitSelection, commitSessionMetadata, composerValue, coordinator, draftStore,
    errors, getNavigationScene, presentationRouteRef, refresh, restoreNavigationScene, selectionRef, t,
  ]);
  return useMemo(
    () => ({ actions, isSending, selectionMutationKind }),
    [actions, isSending, selectionMutationKind],
  );
}
