import type { ComposerAttachment } from "@moebius/console-ui";
import { useCallback, useMemo, useRef, useState } from "react";

import type {
  ManagedAttachmentDraftInput,
  ManagedAttachmentRuntime,
} from "./managed-attachment-contract.js";
import {
  decideAttachmentPresenceCommit,
  planDraftAttachments,
  planHasDraftAttachments,
  planNextAttachmentGeneration,
} from "./managed-attachment-model.js";
import { useAttachmentDraftActions } from "./use-attachment-draft-actions.js";
import { useAttachmentDraftRestoration } from "./use-attachment-draft-restoration.js";
import { useAttachmentPreviewLifecycle } from "./use-attachment-preview-lifecycle.js";
import { useAttachmentReplacement } from "./use-attachment-replacement.js";
import { useAttachmentUploadQueue } from "./use-attachment-upload-queue.js";

export function useManagedAttachmentDrafts(input: ManagedAttachmentDraftInput) {
  const [drafts, setDrafts] = useState<Record<string, ComposerAttachment[]>>({});
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const handlesRef = useRef(new Map());
  const draftRevisionRef = useRef(new Map<string, number>());
  const presenceGenerationRef = useRef(new Map<string, number>());
  const presenceCallbackRef = useRef(input.onDraftAttachmentPresenceChange);
  presenceCallbackRef.current = input.onDraftAttachmentPresenceChange;
  const uploadQueueRef = useRef<Promise<void>>(Promise.resolve());
  const currentDraftKeyRef = useRef(input.currentDraftKey);
  currentDraftKeyRef.current = input.currentDraftKey;

  const updateDraft = useCallback((
    draftKey: string,
    update: (items: ComposerAttachment[]) => ComposerAttachment[],
  ) => {
    setDrafts((current) => ({
      ...current,
      [draftKey]: update(planDraftAttachments(current, draftKey)),
    }));
  }, []);
  const setDraft = useCallback((draftKey: string, items: ComposerAttachment[]) => {
    setDrafts((current) => ({ ...current, [draftKey]: items }));
  }, []);
  const beginPresenceMutation = useCallback((draftKey: string): number => {
    const generation = planNextAttachmentGeneration(presenceGenerationRef.current.get(draftKey));
    presenceGenerationRef.current.set(draftKey, generation);
    presenceCallbackRef.current?.(draftKey, "unknown");
    return generation;
  }, []);
  const commitPresence = useCallback<ManagedAttachmentRuntime["commitPresence"]>((
    draftKey,
    generation,
    presence,
  ) => {
    const decision = decideAttachmentPresenceCommit({
      currentGeneration: presenceGenerationRef.current.get(draftKey),
      expectedGeneration: generation,
    });
    if (decision === "commit") presenceCallbackRef.current?.(draftKey, presence);
  }, []);

  const runtime = useMemo<ManagedAttachmentRuntime>(() => ({
    draftsRef,
    handlesRef,
    draftRevisionRef,
    presenceGenerationRef,
    currentDraftKeyRef,
    uploadQueueRef,
    updateDraft,
    setDraft,
    beginPresenceMutation,
    commitPresence,
  }), [beginPresenceMutation, commitPresence, setDraft, updateDraft]);

  const uploadQueueBundle = useAttachmentUploadQueue(input, runtime);
  const actionsBundle = useAttachmentDraftActions(input, runtime, uploadQueueBundle);
  const replacementBundle = useAttachmentReplacement(input, runtime);
  useAttachmentDraftRestoration(input, runtime);
  useAttachmentPreviewLifecycle(input.currentDraftKey, runtime);

  const hasDraftAttachments = useCallback(
    (draftKey: string) => planHasDraftAttachments(draftsRef.current, draftKey),
    [],
  );

  return {
    attachments: planDraftAttachments(drafts, input.currentDraftKey),
    hasDraftAttachments,
    ...actionsBundle,
    ...replacementBundle,
  };
}
