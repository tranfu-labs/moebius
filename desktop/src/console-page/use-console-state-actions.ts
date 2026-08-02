import { useCallback, useMemo, useState, type MutableRefObject } from "react";
import type { OperatorSession, TranslationKey } from "@moebius/console-ui";

import type { DesktopApi } from "./desktop-api-contract.js";
import type { LocalConsoleState } from "./console-state-contract.js";
import { ConsoleStateActions } from "./console-state-actions.js";
import type { ConsoleCommandPort } from "./console-state-action-contract.js";
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

export function useConsoleStateActions(
  apiBase: string | null,
  commands: ConsoleCommandPort,
  coordinator: ConsoleStateCoordinator,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string,
  selectionRef: MutableRefObject<ConsoleSelection>,
  commitSelection: (selection: ConsoleSelection) => void,
  refresh: (selection: ConsoleSelection) => Promise<boolean>,
  composerValue: string,
  clearComposer: (sessionId: string) => void,
  attachments: ReturnType<typeof useManagedAttachmentDrafts>,
  draftStore: ConversationDraftStore,
  stateRef: MutableRefObject<LocalConsoleState | null>,
  replaceState: (state: LocalConsoleState) => void,
  setError: (error: string | null) => void,
  api: DesktopApi | undefined,
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
    setError,
    commitSessionMetadata,
    selectProjectFolder: decideProjectFolderSelectionAvailability(
      api?.selectProjectFolder !== undefined,
    ) === "unavailable" ? undefined : () => api!.selectProjectFolder!(),
  }), [
    api, apiBase, attachments, clearComposer, commands, commitSelection,
    commitSessionMetadata, composerValue, coordinator, draftStore, refresh,
    selectionRef, setError, t,
  ]);
  return useMemo(
    () => ({ actions, isSending, selectionMutationKind }),
    [actions, isSending, selectionMutationKind],
  );
}
