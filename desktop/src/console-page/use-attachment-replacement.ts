import { useCallback } from "react";

import type {
  ManagedAttachmentDraftInput,
  ManagedAttachmentRuntime,
} from "./managed-attachment-contract.js";
import {
  decideAttachmentDraftOwner,
  decideAttachmentKind,
  decideAttachmentRevision,
  decideAttachmentService,
  ManagedAttachmentFailure,
  planAttachmentIds,
  planAttachmentPreviewUrls,
  planDraftAttachmentPresence,
  planDraftAttachments,
  planNextAttachmentGeneration,
  planRestoredAttachment,
  planVisibleRestoredAttachments,
} from "./managed-attachment-model.js";

export function useAttachmentReplacement(
  input: ManagedAttachmentDraftInput,
  runtime: ManagedAttachmentRuntime,
) {
  const replaceWithMessageAttachments = useCallback(async (source: {
    sessionId: string;
    sourceMessageId: number;
  }): Promise<void> => {
    try {
      const service = decideAttachmentService(input);
      if (service.kind === "unavailable") {
        throw new ManagedAttachmentFailure("attachment-service-unavailable");
      }
      const draftKey = input.currentDraftKey;
      const owner = decideAttachmentDraftOwner(draftKey, source.sessionId);
      if (owner === "mismatch") {
        throw new ManagedAttachmentFailure("attachment-draft-owner-mismatch");
      }

      const revision = planNextAttachmentGeneration(runtime.draftRevisionRef.current.get(draftKey));
      runtime.draftRevisionRef.current.set(draftKey, revision);
      const presenceGeneration = runtime.beginPresenceMutation(draftKey);
      const currentItems = planDraftAttachments(runtime.draftsRef.current, draftKey);
      for (const item of currentItems) {
        runtime.handlesRef.current.get(item.clientId)?.controller?.abort("draft-replaced");
        runtime.handlesRef.current.delete(item.clientId);
      }
      await Promise.all(planAttachmentIds(currentItems).map((attachmentId) => input.client.removeDraft({
        apiBase: service.apiBase,
        capability: service.capability,
        draftKey,
        attachmentId,
      })));

      const cloned = await input.client.cloneMessage({
        apiBase: service.apiBase,
        capability: service.capability,
        sessionId: source.sessionId,
        sourceMessageId: source.sourceMessageId,
        targetDraftKey: draftKey,
      });
      const restored = await Promise.all(cloned.map(async (attachment) => {
        const kind = decideAttachmentKind(attachment.kind);
        let previewUrl: string | undefined;
        if (kind === "image") {
          const preview = await input.client.loadPreview({
            apiBase: service.apiBase,
            capability: service.capability,
            draftKey,
            attachmentId: attachment.attachmentId,
          });
          previewUrl = URL.createObjectURL(preview);
        }
        return planRestoredAttachment(attachment, previewUrl);
      }));
      for (const url of planAttachmentPreviewUrls(currentItems)) URL.revokeObjectURL(url);
      const revisionDecision = decideAttachmentRevision({
        current: runtime.draftRevisionRef.current.get(draftKey),
        expected: revision,
      });
      if (revisionDecision === "stale") {
        for (const url of planAttachmentPreviewUrls(restored)) URL.revokeObjectURL(url);
        return;
      }
      const visible = planVisibleRestoredAttachments(
        restored,
        runtime.currentDraftKeyRef.current === draftKey,
      );
      for (const url of visible.revokeUrls) URL.revokeObjectURL(url);
      runtime.setDraft(draftKey, visible.items);
      runtime.commitPresence(
        draftKey,
        presenceGeneration,
        planDraftAttachmentPresence(cloned.length),
      );
    } catch (error) {
      throw new Error(runtime.resolveError(error));
    }
  }, [input, runtime]);

  return { replaceWithMessageAttachments };
}
