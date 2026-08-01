import type {
  ComposerAttachment,
  OperatorMessage,
  StructuredAttachment,
} from "@moebius/console-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cloneManagedMessageAttachments,
  listManagedDraftAttachments,
  loadManagedAttachmentPreview,
  managedAttachmentFetch,
  removeManagedDraftAttachment,
  uploadManagedAttachment,
} from "./attachment-client.js";
import { createBoundedPngPreview } from "./attachment-preview.js";
import type { SidebarConversationDraftAttachmentPresence } from "./sidebar-conversation-drafts.js";

interface PendingHandle {
  draftKey: string;
  file: File;
  controller: AbortController | null;
  previewUrl: string | null;
  presenceGeneration: number;
}

export function useManagedAttachmentDrafts(input: {
  apiBase: string | null;
  capability: string | null;
  currentDraftKey: string;
  onError(error: string): void;
  onDraftAttachmentPresenceChange?(
    draftKey: string,
    presence: SidebarConversationDraftAttachmentPresence,
  ): void;
}) {
  const [drafts, setDrafts] = useState<Record<string, ComposerAttachment[]>>({});
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const handlesRef = useRef(new Map<string, PendingHandle>());
  const draftRevisionRef = useRef(new Map<string, number>());
  const attachmentPresenceGenerationRef = useRef(new Map<string, number>());
  const onDraftAttachmentPresenceChangeRef = useRef(input.onDraftAttachmentPresenceChange);
  onDraftAttachmentPresenceChangeRef.current = input.onDraftAttachmentPresenceChange;
  const uploadQueueRef = useRef<Promise<void>>(Promise.resolve());
  const currentDraftKeyRef = useRef(input.currentDraftKey);
  currentDraftKeyRef.current = input.currentDraftKey;

  const updateDraft = useCallback((draftKey: string, update: (items: ComposerAttachment[]) => ComposerAttachment[]) => {
    setDrafts((current) => ({ ...current, [draftKey]: update(current[draftKey] ?? []) }));
  }, []);

  const beginAttachmentPresenceMutation = useCallback((draftKey: string): number => {
    const generation = (attachmentPresenceGenerationRef.current.get(draftKey) ?? 0) + 1;
    attachmentPresenceGenerationRef.current.set(draftKey, generation);
    onDraftAttachmentPresenceChangeRef.current?.(draftKey, "unknown");
    return generation;
  }, []);

  const commitAttachmentPresence = useCallback((
    draftKey: string,
    generation: number,
    presence: SidebarConversationDraftAttachmentPresence,
  ): void => {
    if ((attachmentPresenceGenerationRef.current.get(draftKey) ?? 0) !== generation) return;
    onDraftAttachmentPresenceChangeRef.current?.(draftKey, presence);
  }, []);

  const runUpload = useCallback(async (clientId: string, handle: PendingHandle) => {
    if (input.apiBase === null || input.capability === null) {
      updateDraft(handle.draftKey, (items) => items.map((item) => item.clientId === clientId
        ? { ...item, status: "failed", error: "本地附件服务尚未就绪" }
        : item));
      return;
    }
    const controller = new AbortController();
    handle.controller = controller;
    handlesRef.current.set(clientId, handle);
    updateDraft(handle.draftKey, (items) => items.map((item) => item.clientId === clientId
      ? { ...item, status: "pending", error: undefined }
      : item));
    try {
      const preview = await createBoundedPngPreview(handle.file);
      if (controller.signal.aborted || handlesRef.current.get(clientId) !== handle) return;
      if (preview !== null) {
        if (handle.previewUrl !== null) URL.revokeObjectURL(handle.previewUrl);
        handle.previewUrl = handle.draftKey === currentDraftKeyRef.current ? URL.createObjectURL(preview) : null;
        updateDraft(handle.draftKey, (items) => items.map((item) => item.clientId === clientId
          ? { ...item, kind: "image", previewUrl: handle.previewUrl ?? undefined }
          : item));
      } else if (handle.previewUrl !== null) {
        URL.revokeObjectURL(handle.previewUrl);
        handle.previewUrl = null;
        updateDraft(handle.draftKey, (items) => items.map((item) => item.clientId === clientId
          ? { ...item, kind: "file", previewUrl: undefined }
          : item));
      }
      const attachment = await uploadManagedAttachment({
        apiBase: input.apiBase,
        capability: input.capability,
        fetch: managedAttachmentFetch,
        draftKey: handle.draftKey,
        file: handle.file,
        preview,
        signal: controller.signal,
      });
      if (controller.signal.aborted || handlesRef.current.get(clientId) !== handle) {
        await removeManagedDraftAttachment({
          apiBase: input.apiBase,
          capability: input.capability,
          fetch: managedAttachmentFetch,
          draftKey: handle.draftKey,
          attachmentId: attachment.attachmentId,
        }).catch(() => undefined);
        return;
      }
      updateDraft(handle.draftKey, (items) => items.map((item) => item.clientId === clientId
        ? {
            clientId,
            attachmentId: attachment.attachmentId,
            kind: attachment.kind,
            displayName: attachment.displayName,
            mediaType: attachment.mediaType,
            byteSize: attachment.byteSize,
            status: "ready",
            ...(handle.previewUrl === null ? {} : { previewUrl: handle.previewUrl }),
          }
        : item));
      commitAttachmentPresence(handle.draftKey, handle.presenceGeneration, "present");
      handle.controller = null;
    } catch (error) {
      if (controller.signal.aborted || handlesRef.current.get(clientId) !== handle) return;
      updateDraft(handle.draftKey, (items) => items.map((item) => item.clientId === clientId
        ? { ...item, status: "failed", error: formatError(error) }
        : item));
      handle.controller = null;
    }
  }, [commitAttachmentPresence, input.apiBase, input.capability, updateDraft]);

  const enqueueUpload = useCallback((clientId: string, handle: PendingHandle) => {
    const queued = uploadQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (handlesRef.current.get(clientId) === handle) {
          await runUpload(clientId, handle);
        }
      });
    uploadQueueRef.current = queued;
  }, [runUpload]);

  const addFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    const presenceGeneration = beginAttachmentPresenceMutation(input.currentDraftKey);
    for (const file of files) {
      const clientId = crypto.randomUUID();
      const handle: PendingHandle = {
        draftKey: input.currentDraftKey,
        file,
        controller: null,
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
        presenceGeneration,
      };
      handlesRef.current.set(clientId, handle);
      updateDraft(handle.draftKey, (items) => [...items, {
        clientId,
        kind: file.type.startsWith("image/") ? "image" : "file",
        displayName: file.name || "clipboard-image.png",
        mediaType: file.type || "application/octet-stream",
        byteSize: file.size,
        status: "pending",
        ...(handle.previewUrl === null ? {} : { previewUrl: handle.previewUrl }),
      }]);
      enqueueUpload(clientId, handle);
    }
  }, [beginAttachmentPresenceMutation, enqueueUpload, input.currentDraftKey, updateDraft]);

  const remove = useCallback((clientId: string) => {
    const handle = handlesRef.current.get(clientId);
    const draftKey = handle?.draftKey ?? input.currentDraftKey;
    const item = (drafts[draftKey] ?? []).find((candidate) => candidate.clientId === clientId);
    if (handle !== undefined || item !== undefined) {
      beginAttachmentPresenceMutation(draftKey);
    }
    handle?.controller?.abort("attachment-removed");
    handlesRef.current.delete(clientId);
    if (handle?.previewUrl !== null && handle?.previewUrl !== undefined) URL.revokeObjectURL(handle.previewUrl);
    if (item?.previewUrl && item.previewUrl !== handle?.previewUrl) URL.revokeObjectURL(item.previewUrl);
    updateDraft(draftKey, (items) => items.filter((candidate) => candidate.clientId !== clientId));
    if (item?.attachmentId && input.apiBase !== null && input.capability !== null) {
      void removeManagedDraftAttachment({
        apiBase: input.apiBase,
        capability: input.capability,
        fetch: managedAttachmentFetch,
        draftKey,
        attachmentId: item.attachmentId,
      }).catch((error: unknown) => input.onError(formatError(error)));
    }
  }, [beginAttachmentPresenceMutation, drafts, input.apiBase, input.capability, input.currentDraftKey, input.onError, updateDraft]);

  const retry = useCallback((clientId: string) => {
    const handle = handlesRef.current.get(clientId);
    if (handle === undefined || handle.controller !== null) return;
    handle.presenceGeneration = beginAttachmentPresenceMutation(handle.draftKey);
    updateDraft(handle.draftKey, (items) => {
      const item = items.find((candidate) => candidate.clientId === clientId);
      return item === undefined
        ? items
        : [...items.filter((candidate) => candidate.clientId !== clientId), { ...item, status: "pending", error: undefined }];
    });
    enqueueUpload(clientId, handle);
  }, [beginAttachmentPresenceMutation, enqueueUpload, updateDraft]);

  const clearDraft = useCallback((draftKey: string) => {
    const items = drafts[draftKey] ?? [];
    for (const item of items) {
      const handle = handlesRef.current.get(item.clientId);
      handle?.controller?.abort("draft-cleared");
      handlesRef.current.delete(item.clientId);
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
    setDrafts((current) => ({ ...current, [draftKey]: [] }));
  }, [drafts]);

  const replaceWithMessageAttachments = useCallback(async (source: {
    sessionId: string;
    sourceMessageId: number;
  }): Promise<void> => {
    if (input.apiBase === null || input.capability === null) {
      throw new Error("本地附件服务尚未就绪");
    }
    const draftKey = input.currentDraftKey;
    if (draftKey !== `draft:${source.sessionId}`) {
      throw new Error("附件草稿与当前会话不一致");
    }

    const revision = (draftRevisionRef.current.get(draftKey) ?? 0) + 1;
    draftRevisionRef.current.set(draftKey, revision);
    const presenceGeneration = beginAttachmentPresenceMutation(draftKey);
    const currentItems = draftsRef.current[draftKey] ?? [];
    for (const item of currentItems) {
      const handle = handlesRef.current.get(item.clientId);
      handle?.controller?.abort("draft-replaced");
      handlesRef.current.delete(item.clientId);
    }
    await Promise.all(currentItems.flatMap((item) => item.attachmentId === undefined ? [] : [
      removeManagedDraftAttachment({
        apiBase: input.apiBase!,
        capability: input.capability!,
        fetch: managedAttachmentFetch,
        draftKey,
        attachmentId: item.attachmentId,
      }),
    ]));

    const cloned = await cloneManagedMessageAttachments({
      apiBase: input.apiBase,
      capability: input.capability,
      fetch: managedAttachmentFetch,
      sessionId: source.sessionId,
      sourceMessageId: source.sourceMessageId,
      targetDraftKey: draftKey,
    });
    const restored = await Promise.all(cloned.map(async (attachment): Promise<ComposerAttachment> => {
      let previewUrl: string | undefined;
      if (attachment.kind === "image") {
        const preview = await loadManagedAttachmentPreview({
          apiBase: input.apiBase!,
          capability: input.capability!,
          fetch: managedAttachmentFetch,
          draftKey,
          attachmentId: attachment.attachmentId,
        });
        previewUrl = URL.createObjectURL(preview);
      }
      return {
        clientId: attachment.attachmentId,
        ...attachment,
        status: "ready",
        ...(previewUrl === undefined ? {} : { previewUrl }),
      };
    }));
    for (const item of currentItems) {
      if (item.previewUrl !== undefined) URL.revokeObjectURL(item.previewUrl);
    }
    if (draftRevisionRef.current.get(draftKey) !== revision) {
      for (const item of restored) {
        if (item.previewUrl !== undefined) URL.revokeObjectURL(item.previewUrl);
      }
      return;
    }
    const visibleRestored = currentDraftKeyRef.current === draftKey
      ? restored
      : restored.map((item) => {
          if (item.previewUrl !== undefined) URL.revokeObjectURL(item.previewUrl);
          const { previewUrl: _previewUrl, ...withoutPreview } = item;
          return withoutPreview;
        });
    setDrafts((current) => ({ ...current, [draftKey]: visibleRestored }));
    commitAttachmentPresence(
      draftKey,
      presenceGeneration,
      cloned.length > 0 ? "present" : "absent",
    );
  }, [beginAttachmentPresenceMutation, commitAttachmentPresence, input.apiBase, input.capability, input.currentDraftKey]);

  const releaseDraftPreviewUrls = useCallback((draftKey: string) => {
    setDrafts((current) => {
      const released = new Set<string>();
      const items = current[draftKey] ?? [];
      const nextItems = items.map((item) => {
        if (item.previewUrl === undefined) return item;
        if (!released.has(item.previewUrl)) URL.revokeObjectURL(item.previewUrl);
        released.add(item.previewUrl);
        return { ...item, previewUrl: undefined };
      });
      for (const handle of handlesRef.current.values()) {
        if (handle.draftKey === draftKey && handle.previewUrl !== null) {
          if (!released.has(handle.previewUrl)) URL.revokeObjectURL(handle.previewUrl);
          released.add(handle.previewUrl);
          handle.previewUrl = null;
        }
      }
      return { ...current, [draftKey]: nextItems };
    });
  }, []);

  const previousDraftKeyRef = useRef(input.currentDraftKey);
  useEffect(() => {
    const previousDraftKey = previousDraftKeyRef.current;
    previousDraftKeyRef.current = input.currentDraftKey;
    if (previousDraftKey !== input.currentDraftKey) {
      releaseDraftPreviewUrls(previousDraftKey);
    }
  }, [input.currentDraftKey, releaseDraftPreviewUrls]);

  useEffect(() => {
    if (input.apiBase === null || input.capability === null) return;
    const controller = new AbortController();
    const draftRevision = draftRevisionRef.current.get(input.currentDraftKey) ?? 0;
    const presenceGeneration = attachmentPresenceGenerationRef.current.get(input.currentDraftKey) ?? 0;
    void listManagedDraftAttachments({
      apiBase: input.apiBase,
      capability: input.capability,
      fetch: managedAttachmentFetch,
      draftKey: input.currentDraftKey,
      signal: controller.signal,
    }).then(async (attachments) => {
      if (controller.signal.aborted) return;
      commitAttachmentPresence(
        input.currentDraftKey,
        presenceGeneration,
        attachments.length > 0 ? "present" : "absent",
      );
      const restored = await Promise.all(attachments.map(async (attachment): Promise<ComposerAttachment> => {
        let previewUrl: string | undefined;
        if (attachment.kind === "image") {
          const preview = await loadManagedAttachmentPreview({
            apiBase: input.apiBase!,
            capability: input.capability!,
            fetch: managedAttachmentFetch,
            draftKey: input.currentDraftKey,
            attachmentId: attachment.attachmentId,
            signal: controller.signal,
          });
          previewUrl = URL.createObjectURL(preview);
        }
        return {
          clientId: attachment.attachmentId,
          ...attachment,
          status: "ready",
          ...(previewUrl === undefined ? {} : { previewUrl }),
        };
      }));
      if (
        controller.signal.aborted
        || (draftRevisionRef.current.get(input.currentDraftKey) ?? 0) !== draftRevision
      ) {
        for (const item of restored) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        return;
      }
      updateDraft(input.currentDraftKey, (current) => {
        const transient = current.filter((item) => item.status !== "ready");
        const knownReadyIds = new Set(restored.map((item) => item.attachmentId));
        const lateReady = current.filter((item) => item.status === "ready"
          && item.attachmentId !== undefined
          && !knownReadyIds.has(item.attachmentId));
        for (const item of current) {
          if (item.status === "ready" && item.attachmentId && knownReadyIds.has(item.attachmentId) && item.previewUrl) {
            URL.revokeObjectURL(item.previewUrl);
          }
        }
        return [...restored, ...lateReady, ...transient];
      });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) input.onError(formatError(error));
    });
    return () => controller.abort("draft-changed");
  }, [commitAttachmentPresence, input.apiBase, input.capability, input.currentDraftKey, input.onError, updateDraft]);

  useEffect(() => () => {
    const released = new Set<string>();
    for (const items of Object.values(draftsRef.current)) {
      for (const item of items) {
        if (item.previewUrl && !released.has(item.previewUrl)) {
          URL.revokeObjectURL(item.previewUrl);
          released.add(item.previewUrl);
        }
      }
    }
    for (const handle of handlesRef.current.values()) {
      handle.controller?.abort("renderer-unmounted");
      if (handle.previewUrl !== null && !released.has(handle.previewUrl)) URL.revokeObjectURL(handle.previewUrl);
    }
  }, []);

  const hasDraftAttachments = useCallback((draftKey: string) => (
    (draftsRef.current[draftKey]?.length ?? 0) > 0
  ), []);

  return {
    attachments: drafts[input.currentDraftKey] ?? [],
    hasDraftAttachments,
    addFiles,
    remove,
    retry,
    clearDraft,
    replaceWithMessageAttachments,
  };
}

export function useMessagesWithAttachmentPreviews(input: {
  messages: OperatorMessage[];
  apiBase: string | null;
  capability: string | null;
}): OperatorMessage[] {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const urlsRef = useRef(urls);
  urlsRef.current = urls;

  useEffect(() => {
    if (input.apiBase === null || input.capability === null) return;
    const controller = new AbortController();
    const images = input.messages.flatMap((message) => (message.attachments ?? [])
      .filter((attachment) => attachment.kind === "image")
      .map((attachment) => ({ attachment, sessionId: message.sessionId })));
    const liveIds = new Set(images.map(({ attachment }) => attachment.attachmentId));
    setUrls((current) => {
      const next = { ...current };
      for (const [attachmentId, url] of Object.entries(current)) {
        if (!liveIds.has(attachmentId)) {
          URL.revokeObjectURL(url);
          delete next[attachmentId];
        }
      }
      return next;
    });
    for (const { attachment, sessionId } of images) {
      if (urlsRef.current[attachment.attachmentId] !== undefined) continue;
      void loadManagedAttachmentPreview({
        apiBase: input.apiBase,
        capability: input.capability,
        fetch: managedAttachmentFetch,
        sessionId,
        attachmentId: attachment.attachmentId,
        signal: controller.signal,
      }).then((blob) => {
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        setUrls((current) => current[attachment.attachmentId] === undefined
          ? { ...current, [attachment.attachmentId]: url }
          : (URL.revokeObjectURL(url), current));
      }).catch(() => undefined);
    }
    return () => controller.abort("messages-changed");
  }, [input.apiBase, input.capability, input.messages]);

  useEffect(() => () => {
    for (const url of Object.values(urlsRef.current)) URL.revokeObjectURL(url);
  }, []);

  return useMemo(() => input.messages.map((message) => ({
    ...message,
    attachments: (message.attachments ?? []).map((attachment): StructuredAttachment => ({
      ...attachment,
      ...(urls[attachment.attachmentId] === undefined ? {} : { previewUrl: urls[attachment.attachmentId] }),
    })),
  })), [input.messages, urls]);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
