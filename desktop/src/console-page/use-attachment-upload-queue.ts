import { useCallback } from "react";

import { createBoundedPngPreview } from "./attachment-preview.js";
import type {
  ManagedAttachmentDraftInput,
  ManagedAttachmentRuntime,
  PendingAttachmentHandle,
} from "./managed-attachment-contract.js";
import {
  decideAttachmentHandleCurrent,
  decideAttachmentService,
  ManagedAttachmentFailure,
  planAttachmentPreviewItems,
  planAttachmentPreviewTransition,
  planAttachmentStatusItems,
  planReadyAttachmentItems,
} from "./managed-attachment-model.js";

export function useAttachmentUploadQueue(
  input: ManagedAttachmentDraftInput,
  runtime: ManagedAttachmentRuntime,
) {
  const runUpload = useCallback(async (clientId: string, handle: PendingAttachmentHandle) => {
    const service = decideAttachmentService(input);
    if (service.kind === "unavailable") {
      runtime.updateDraft(handle.draftKey, (items) =>
        planAttachmentStatusItems(
          items,
          clientId,
          "failed",
          runtime.resolveError(new ManagedAttachmentFailure("attachment-service-unavailable")),
        ));
      return;
    }
    const controller = new AbortController();
    handle.controller = controller;
    runtime.handlesRef.current.set(clientId, handle);
    runtime.updateDraft(handle.draftKey, (items) =>
      planAttachmentStatusItems(items, clientId, "pending"));
    try {
      const preview = await createBoundedPngPreview(handle.file);
      const previewCommit = decideAttachmentHandleCurrent({
        aborted: controller.signal.aborted,
        current: runtime.handlesRef.current.get(clientId),
        expected: handle,
      });
      if (previewCommit === "stale") return;
      const transition = planAttachmentPreviewTransition({
        preview,
        previousUrl: handle.previewUrl,
        visible: handle.draftKey === runtime.currentDraftKeyRef.current,
      });
      if (transition.revokeUrl !== null) URL.revokeObjectURL(transition.revokeUrl);
      handle.previewUrl = transition.kind === "image" && transition.visible
        ? URL.createObjectURL(transition.preview)
        : null;
      const previewItems = transition.kind === "image"
        ? { kind: "image" as const, previewUrl: handle.previewUrl }
        : { kind: "file" as const };
      runtime.updateDraft(handle.draftKey, (items) =>
        planAttachmentPreviewItems(items, clientId, previewItems));
      const attachment = await input.client.upload({
        apiBase: service.apiBase,
        capability: service.capability,
        draftKey: handle.draftKey,
        file: handle.file,
        preview,
        signal: controller.signal,
      });
      const uploadCommit = decideAttachmentHandleCurrent({
        aborted: controller.signal.aborted,
        current: runtime.handlesRef.current.get(clientId),
        expected: handle,
      });
      if (uploadCommit === "stale") {
        await input.client.removeDraft({
          apiBase: service.apiBase,
          capability: service.capability,
          draftKey: handle.draftKey,
          attachmentId: attachment.attachmentId,
        }).catch(() => undefined);
        return;
      }
      runtime.updateDraft(handle.draftKey, (items) =>
        planReadyAttachmentItems(items, clientId, attachment, handle.previewUrl));
      runtime.commitPresence(handle.draftKey, handle.presenceGeneration, "present");
      handle.controller = null;
    } catch (error) {
      const failureCommit = decideAttachmentHandleCurrent({
        aborted: controller.signal.aborted,
        current: runtime.handlesRef.current.get(clientId),
        expected: handle,
      });
      if (failureCommit === "stale") return;
      runtime.updateDraft(handle.draftKey, (items) =>
        planAttachmentStatusItems(items, clientId, "failed", runtime.resolveError(error)));
      handle.controller = null;
    }
  }, [input.apiBase, input.capability, input.client, runtime]);

  const enqueueUpload = useCallback((clientId: string, handle: PendingAttachmentHandle) => {
    const queued = runtime.uploadQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const decision = decideAttachmentHandleCurrent({
          aborted: false,
          current: runtime.handlesRef.current.get(clientId),
          expected: handle,
        });
        if (decision === "current") await runUpload(clientId, handle);
      });
    runtime.uploadQueueRef.current = queued;
  }, [runUpload, runtime]);

  return { enqueueUpload };
}
