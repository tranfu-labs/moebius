import { useCallback, useEffect, useRef } from "react";

import type { ManagedAttachmentRuntime } from "./managed-attachment-contract.js";
import {
  decideAttachmentDraftChanged,
  planAttachmentRuntimeCleanup,
  planDraftAttachments,
  planReleasedDraftPreviews,
} from "./managed-attachment-model.js";

export function useAttachmentPreviewLifecycle(
  currentDraftKey: string,
  runtime: ManagedAttachmentRuntime,
): void {
  const releaseDraftPreviewUrls = useCallback((draftKey: string) => {
    const release = planReleasedDraftPreviews({
      items: planDraftAttachments(runtime.draftsRef.current, draftKey),
      handles: runtime.handlesRef.current,
      draftKey,
    });
    for (const url of release.previewUrls) URL.revokeObjectURL(url);
    for (const handle of release.handles) handle.previewUrl = null;
    runtime.setDraft(draftKey, release.items);
  }, [runtime]);

  const previousDraftKeyRef = useRef(currentDraftKey);
  useEffect(() => {
    const previousDraftKey = previousDraftKeyRef.current;
    previousDraftKeyRef.current = currentDraftKey;
    const decision = decideAttachmentDraftChanged(previousDraftKey, currentDraftKey);
    if (decision === "changed") releaseDraftPreviewUrls(previousDraftKey);
  }, [currentDraftKey, releaseDraftPreviewUrls]);

  useEffect(() => () => {
    const cleanup = planAttachmentRuntimeCleanup({
      drafts: runtime.draftsRef.current,
      handles: runtime.handlesRef.current,
    });
    for (const handle of cleanup.handles) handle.controller?.abort("renderer-unmounted");
    for (const url of cleanup.previewUrls) URL.revokeObjectURL(url);
  }, [runtime]);
}
