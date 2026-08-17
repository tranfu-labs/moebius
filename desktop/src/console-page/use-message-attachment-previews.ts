import type { OperatorMessage } from "@moebius/console-ui";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ManagedAttachmentClient } from "./managed-attachment-port.js";
import {
  decideAsyncAttachmentCommit,
  decideAttachmentService,
  decidePreviewLoad,
  planMessageImageSources,
  planMessagePreviewRetention,
  planMessagePreviewRevokeAll,
  planMessagesWithAttachmentPreviews,
  planPreviewUrlCommit,
  previewCacheKey,
  type MessagePreviewState,
} from "./managed-attachment-model.js";

export function useMessagesWithAttachmentPreviews(input: {
  client: ManagedAttachmentClient;
  messages: OperatorMessage[];
  apiBase: string | null;
  capability: string | null;
}): OperatorMessage[] {
  const [states, setStates] = useState<Record<string, MessagePreviewState>>({});
  const statesRef = useRef(states);
  statesRef.current = states;

  useEffect(() => {
    const service = decideAttachmentService(input);
    if (service.kind === "unavailable") return;
    const controller = new AbortController();
    const images = planMessageImageSources(input.messages);
    const liveIds = new Set(images.map(({ attachment, sessionId }) => previewCacheKey(sessionId, attachment.attachmentId)));
    const retention = planMessagePreviewRetention(statesRef.current, liveIds);
    for (const url of retention.revokeUrls) URL.revokeObjectURL(url);
    setStates(retention.states);
    for (const { attachment, sessionId } of images) {
      const cacheKey = previewCacheKey(sessionId, attachment.attachmentId);
      const loadDecision = decidePreviewLoad(statesRef.current[cacheKey]?.status);
      if (loadDecision === "skip") continue;
      setStates((current) => ({ ...current, [cacheKey]: { status: "loading" } }));
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
        setStates((current) => {
          const commit = planPreviewUrlCommit(current, cacheKey, url);
          if (commit.kind === "commit") return commit.states;
          URL.revokeObjectURL(url);
          return current;
        });
      }).catch(() => {
        const commitDecision = decideAsyncAttachmentCommit(controller.signal.aborted);
        if (commitDecision === "ignore") return;
        setStates((current) => ({ ...current, [cacheKey]: { status: "failed" } }));
      });
    }
    return () => controller.abort("messages-changed");
  }, [input.apiBase, input.capability, input.messages]);

  useEffect(() => () => {
    for (const url of planMessagePreviewRevokeAll(statesRef.current)) URL.revokeObjectURL(url);
  }, []);

  return useMemo(
    () => planMessagesWithAttachmentPreviews(input.messages, states),
    [input.messages, states],
  );
}
