import { useEffect } from "react";

import type {
  ManagedAttachmentDraftInput,
  ManagedAttachmentRuntime,
} from "./managed-attachment-contract.js";
import {
  decideAsyncAttachmentCommit,
  decideAttachmentKind,
  decideAttachmentRestorationCommit,
  decideAttachmentService,
  planAttachmentErrorMessage,
  planAttachmentGeneration,
  planAttachmentPreviewUrls,
  planDraftAttachmentPresence,
  planMergedDraftAttachments,
  planRestoredAttachment,
} from "./managed-attachment-model.js";

export function useAttachmentDraftRestoration(
  input: ManagedAttachmentDraftInput,
  runtime: ManagedAttachmentRuntime,
): void {
  useEffect(() => {
    const service = decideAttachmentService(input);
    if (service.kind === "unavailable") return;
    const controller = new AbortController();
    const draftKey = input.currentDraftKey;
    const draftRevision = planAttachmentGeneration(runtime.draftRevisionRef.current.get(draftKey));
    const presenceGeneration = planAttachmentGeneration(
      runtime.presenceGenerationRef.current.get(draftKey),
    );
    void input.client.listDraft({
      apiBase: service.apiBase,
      capability: service.capability,
      draftKey,
      signal: controller.signal,
    }).then(async (attachments) => {
      const initialCommit = decideAsyncAttachmentCommit(controller.signal.aborted);
      if (initialCommit === "ignore") return;
      runtime.commitPresence(
        draftKey,
        presenceGeneration,
        planDraftAttachmentPresence(attachments.length),
      );
      const restored = await Promise.all(attachments.map(async (attachment) => {
        const kind = decideAttachmentKind(attachment.kind);
        let previewUrl: string | undefined;
        if (kind === "image") {
          const preview = await input.client.loadPreview({
            apiBase: service.apiBase,
            capability: service.capability,
            draftKey,
            attachmentId: attachment.attachmentId,
            signal: controller.signal,
          });
          previewUrl = URL.createObjectURL(preview);
        }
        return planRestoredAttachment(attachment, previewUrl);
      }));
      const restoration = decideAttachmentRestorationCommit({
        aborted: controller.signal.aborted,
        currentRevision: runtime.draftRevisionRef.current.get(draftKey),
        expectedRevision: draftRevision,
      });
      if (restoration === "stale") {
        for (const url of planAttachmentPreviewUrls(restored)) URL.revokeObjectURL(url);
        return;
      }
      runtime.updateDraft(draftKey, (current) => {
        const merged = planMergedDraftAttachments({ current, restored });
        for (const url of merged.revokeUrls) URL.revokeObjectURL(url);
        return merged.items;
      });
    }).catch((error: unknown) => {
      const failure = decideAsyncAttachmentCommit(controller.signal.aborted);
      if (failure === "commit") input.onError(planAttachmentErrorMessage(error));
    });
    return () => controller.abort("draft-changed");
  }, [input.apiBase, input.capability, input.client, input.currentDraftKey, input.onError, runtime]);
}
