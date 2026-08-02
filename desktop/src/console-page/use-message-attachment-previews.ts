import type { OperatorMessage } from "@moebius/console-ui";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ManagedAttachmentClient } from "./managed-attachment-port.js";
import {
  decideAsyncAttachmentCommit,
  decideAttachmentService,
  decidePreviewLoad,
  planMessageImageSources,
  planMessagesWithAttachmentPreviews,
  planPreviewUrlCommit,
  planRemovedPreviewIds,
} from "./managed-attachment-model.js";

export function useMessagesWithAttachmentPreviews(input: {
  client: ManagedAttachmentClient;
  messages: OperatorMessage[];
  apiBase: string | null;
  capability: string | null;
}): OperatorMessage[] {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const urlsRef = useRef(urls);
  urlsRef.current = urls;

  useEffect(() => {
    const service = decideAttachmentService(input);
    if (service.kind === "unavailable") return;
    const controller = new AbortController();
    const images = planMessageImageSources(input.messages);
    const liveIds = new Set(images.map(({ attachment }) => attachment.attachmentId));
    setUrls((current) => {
      const next = { ...current };
      for (const attachmentId of planRemovedPreviewIds(current, liveIds)) {
        URL.revokeObjectURL(current[attachmentId]!);
        delete next[attachmentId];
      }
      return next;
    });
    for (const { attachment, sessionId } of images) {
      const loadDecision = decidePreviewLoad(urlsRef.current[attachment.attachmentId]);
      if (loadDecision === "skip") continue;
      void input.client.loadPreview({
        apiBase: service.apiBase,
        capability: service.capability,
        sessionId,
        attachmentId: attachment.attachmentId,
        signal: controller.signal,
      }).then((blob) => {
        const commitDecision = decideAsyncAttachmentCommit(controller.signal.aborted);
        if (commitDecision === "ignore") return;
        const url = URL.createObjectURL(blob);
        setUrls((current) => {
          const commit = planPreviewUrlCommit(current, attachment.attachmentId, url);
          if (commit.kind === "commit") return commit.urls;
          URL.revokeObjectURL(url);
          return current;
        });
      }).catch(() => undefined);
    }
    return () => controller.abort("messages-changed");
  }, [input.apiBase, input.capability, input.messages]);

  useEffect(() => () => {
    for (const url of Object.values(urlsRef.current)) URL.revokeObjectURL(url);
  }, []);

  return useMemo(
    () => planMessagesWithAttachmentPreviews(input.messages, urls),
    [input.messages, urls],
  );
}
