import { useCallback } from "react";

import type {
  ManagedAttachmentDraftInput,
  ManagedAttachmentRuntime,
} from "./managed-attachment-contract.js";
import {
  decideAttachmentFileBatch,
  decideAttachmentRetry,
  decideAttachmentService,
  decideImageFile,
  planAttachmentRemoval,
  planDraftAttachments,
  planDraftCleanup,
  planPendingAttachment,
  planRetriedAttachmentItems,
} from "./managed-attachment-model.js";

export function useAttachmentDraftActions(
  input: ManagedAttachmentDraftInput,
  runtime: ManagedAttachmentRuntime,
  uploadQueue: { enqueueUpload(clientId: string, handle: import("./managed-attachment-contract.js").PendingAttachmentHandle): void },
) {
  const addFiles = useCallback((files: File[]) => {
    const batch = decideAttachmentFileBatch(files);
    if (batch === "skip") return;
    const generation = runtime.beginPresenceMutation(input.currentDraftKey);
    for (const file of files) {
      const clientId = crypto.randomUUID();
      const fileKind = decideImageFile(file);
      const pending = planPendingAttachment({
        clientId,
        draftKey: input.currentDraftKey,
        file,
        previewUrl: fileKind === "image" ? URL.createObjectURL(file) : null,
        presenceGeneration: generation,
      });
      runtime.handlesRef.current.set(clientId, pending.handle);
      runtime.updateDraft(pending.handle.draftKey, (items) => [...items, pending.item]);
      uploadQueue.enqueueUpload(clientId, pending.handle);
    }
  }, [input.currentDraftKey, runtime, uploadQueue]);

  const remove = useCallback((clientId: string) => {
    const removal = planAttachmentRemoval({
      clientId,
      currentDraftKey: input.currentDraftKey,
      drafts: runtime.draftsRef.current,
      handles: runtime.handlesRef.current,
      service: decideAttachmentService(input),
    });
    if (removal.presence === "mutate") runtime.beginPresenceMutation(removal.draftKey);
    removal.handle?.controller?.abort("attachment-removed");
    runtime.handlesRef.current.delete(clientId);
    for (const url of removal.previewUrls) URL.revokeObjectURL(url);
    runtime.updateDraft(removal.draftKey, (items) =>
      items.filter((candidate) => candidate.clientId !== clientId));
    if (removal.remote !== null) {
      void input.client.removeDraft(removal.remote)
        .catch((error: unknown) => runtime.reportError(error));
    }
  }, [input, runtime]);

  const retry = useCallback((clientId: string) => {
    const retryDecision = decideAttachmentRetry(runtime.handlesRef.current.get(clientId));
    if (retryDecision.kind === "skip") return;
    retryDecision.handle.presenceGeneration = runtime.beginPresenceMutation(retryDecision.handle.draftKey);
    runtime.updateDraft(retryDecision.handle.draftKey, (items) =>
      planRetriedAttachmentItems(items, clientId));
    uploadQueue.enqueueUpload(clientId, retryDecision.handle);
  }, [runtime, uploadQueue]);

  const clearDraft = useCallback((draftKey: string) => {
    const cleanup = planDraftCleanup(
      planDraftAttachments(runtime.draftsRef.current, draftKey),
      runtime.handlesRef.current,
    );
    for (const handle of cleanup.handles) handle.controller?.abort("draft-cleared");
    for (const clientId of cleanup.clientIds) runtime.handlesRef.current.delete(clientId);
    for (const url of cleanup.previewUrls) URL.revokeObjectURL(url);
    runtime.setDraft(draftKey, []);
  }, [runtime]);

  return { addFiles, remove, retry, clearDraft };
}
