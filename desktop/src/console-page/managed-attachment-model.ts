import type { ComposerAttachment, OperatorMessage, StructuredAttachment } from "@moebius/console-ui";

import type { SidebarConversationDraftAttachmentPresence } from "./sidebar-conversation-drafts.js";
import type { DerivedPngPreviews } from "./attachment-preview.js";
import type {
  ManagedAttachmentFailureCode,
  PendingAttachmentHandle,
} from "./managed-attachment-contract.js";
import {
  NEW_CONVERSATION_DRAFT_KEY,
  sessionDraftKey,
  type ConversationDraftKey,
} from "./conversation-draft-model.js";

export function planConsoleAttachmentDraftKeys(input: {
  newConversationOpen: boolean;
  composerDraftKey: ConversationDraftKey;
  activeSubSessionId: string | null;
  activeSidebarSessionId: string | null;
  activeSidebarAttachmentDraftKey: `draft:sidebar:${string}` | null;
}): { main: string; subSession: string; sidebar: string } {
  return {
    main: input.newConversationOpen ? NEW_CONVERSATION_DRAFT_KEY : input.composerDraftKey,
    subSession: sessionDraftKey(input.activeSubSessionId ?? "__inactive-sub-session__"),
    sidebar: input.activeSidebarAttachmentDraftKey
      ?? (input.activeSidebarSessionId === null
        ? "draft:sidebar:__inactive__"
        : sessionDraftKey(input.activeSidebarSessionId)),
  };
}

export function decideSidebarAttachmentPresenceCommit(changed: boolean): "commit" | "skip" {
  return changed ? "commit" : "skip";
}

export function decideAttachmentService(options: {
  apiBase: string | null;
  capability: string | null;
}):
  | { kind: "unavailable" }
  | { kind: "available"; apiBase: string; capability: string } {
  return options.apiBase === null || options.capability === null
    ? { kind: "unavailable" }
    : { kind: "available", apiBase: options.apiBase, capability: options.capability };
}

/** Maps two-tier derivation results to upload commit arguments (domain): both tiers are null without a decode. */
export function planUploadPreviewArgs(
  previews: DerivedPngPreviews | null,
): { preview: Blob | null; largePreview: Blob | null } {
  return previews === null
    ? { preview: null, largePreview: null }
    : { preview: previews.thumbnail, largePreview: previews.large };
}

export function planReadyAttachmentIds(attachments: readonly ComposerAttachment[]): string[] {
  return attachments.flatMap((attachment) =>
    attachment.status === "ready" && attachment.attachmentId !== undefined
      ? [attachment.attachmentId]
      : []);
}

export function planHasBlockingAttachments(attachments: readonly ComposerAttachment[]): boolean {
  return attachments.some((attachment) => attachment.status !== "ready");
}

export function planMessageImageSources(messages: readonly OperatorMessage[]) {
  return messages.flatMap((message) => (message.attachments ?? [])
    .filter((attachment) => attachment.kind === "image")
    .map((attachment) => ({ attachment, sessionId: message.sessionId })));
}

/** A preview URL belongs to both the conversation and the attachment. */
export function previewCacheKey(sessionId: string, attachmentId: string): string {
  return `${sessionId}\u0000${attachmentId}`;
}

export function planRemovedPreviewIds(
  urls: Readonly<Record<string, string>>,
  liveIds: ReadonlySet<string>,
): string[] {
  return Object.keys(urls).filter((attachmentId) => !liveIds.has(attachmentId));
}

export function decidePreviewLoad(existingUrl: string | undefined): "load" | "skip" {
  return existingUrl === undefined ? "load" : "skip";
}

export function decideAsyncAttachmentCommit(aborted: boolean): "commit" | "ignore" {
  return aborted ? "ignore" : "commit";
}

export function planPreviewUrlCommit(
  current: Readonly<Record<string, string>>,
  attachmentId: string,
  url: string,
):
  | { kind: "discard" }
  | { kind: "commit"; urls: Record<string, string> } {
  return current[attachmentId] === undefined
    ? { kind: "commit", urls: { ...current, [attachmentId]: url } }
    : { kind: "discard" };
}

export function planMessagesWithAttachmentPreviews(
  messages: readonly OperatorMessage[],
  urls: Readonly<Record<string, string>>,
): OperatorMessage[] {
  return messages.map((message) => ({
    ...message,
    attachments: (message.attachments ?? []).map((attachment): StructuredAttachment => ({
      ...attachment,
      ...(urls[previewCacheKey(message.sessionId, attachment.attachmentId)] === undefined
        ? {}
        : { previewUrl: urls[previewCacheKey(message.sessionId, attachment.attachmentId)] }),
    })),
  }));
}

export class ManagedAttachmentFailure extends Error {
  constructor(readonly code: ManagedAttachmentFailureCode) {
    super(code);
    this.name = "ManagedAttachmentFailure";
  }
}

export function planAttachmentErrorMessage(
  error: unknown,
  translateFailure: (code: ManagedAttachmentFailureCode) => string,
): string {
  if (error instanceof ManagedAttachmentFailure) return translateFailure(error.code);
  return error instanceof Error ? error.message : String(error);
}

export function planDraftAttachments(
  drafts: Readonly<Record<string, ComposerAttachment[]>>,
  draftKey: string,
): ComposerAttachment[] {
  return drafts[draftKey] ?? [];
}

export function planNextAttachmentGeneration(current: number | undefined): number {
  return (current ?? 0) + 1;
}

export function decideAttachmentPresenceCommit(options: {
  currentGeneration: number | undefined;
  expectedGeneration: number;
}): "commit" | "ignore" {
  return (options.currentGeneration ?? 0) === options.expectedGeneration ? "commit" : "ignore";
}

export function planDraftAttachmentPresence(count: number): SidebarConversationDraftAttachmentPresence {
  return count > 0 ? "present" : "absent";
}

export function planHasDraftAttachments(
  drafts: Readonly<Record<string, ComposerAttachment[]>>,
  draftKey: string,
): boolean {
  return (drafts[draftKey]?.length ?? 0) > 0;
}

export function decideAttachmentHandleCurrent<T>(options: {
  aborted: boolean;
  current: T | undefined;
  expected: T;
}): "current" | "stale" {
  return options.aborted || options.current !== options.expected ? "stale" : "current";
}

export function planAttachmentStatusItems(
  items: readonly ComposerAttachment[],
  clientId: string,
  status: "pending" | "failed",
  error?: string,
): ComposerAttachment[] {
  return items.map((item) => item.clientId === clientId
    ? { ...item, status, error }
    : item);
}

export function planAttachmentPreviewTransition(options: {
  preview: Blob | null;
  previousUrl: string | null;
  visible: boolean;
}):
  | { kind: "image"; revokeUrl: string | null; visible: boolean; preview: Blob }
  | { kind: "file"; revokeUrl: string | null } {
  if (options.preview !== null) {
    return {
      kind: "image",
      revokeUrl: options.previousUrl,
      visible: options.visible,
      preview: options.preview,
    };
  }
  return { kind: "file", revokeUrl: options.previousUrl };
}

export function planAttachmentPreviewItems(
  items: readonly ComposerAttachment[],
  clientId: string,
  transition:
    | { kind: "image"; previewUrl: string | null }
    | { kind: "file" },
): ComposerAttachment[] {
  return items.map((item) => item.clientId === clientId
    ? transition.kind === "image"
      ? { ...item, kind: "image", previewUrl: transition.previewUrl ?? undefined }
      : { ...item, kind: "file", previewUrl: undefined }
    : item);
}

export function planReadyAttachmentItems(
  items: readonly ComposerAttachment[],
  clientId: string,
  attachment: {
    attachmentId: string;
    kind: "file" | "image";
    displayName: string;
    mediaType: string;
    byteSize: number;
  },
  previewUrl: string | null,
): ComposerAttachment[] {
  return items.map((item) => item.clientId === clientId
    ? {
        clientId,
        ...attachment,
        status: "ready",
        ...(previewUrl === null ? {} : { previewUrl }),
      }
    : item);
}

export function decideAttachmentFileBatch(files: readonly File[]): "add" | "skip" {
  return files.length === 0 ? "skip" : "add";
}

export function planPendingAttachment(options: {
  clientId: string;
  draftKey: string;
  file: File;
  previewUrl: string | null;
  presenceGeneration: number;
}): { handle: PendingAttachmentHandle; item: ComposerAttachment } {
  const image = options.file.type.startsWith("image/");
  return {
    handle: {
      draftKey: options.draftKey,
      file: options.file,
      controller: null,
      previewUrl: options.previewUrl,
      presenceGeneration: options.presenceGeneration,
    },
    item: {
      clientId: options.clientId,
      kind: image ? "image" : "file",
      displayName: options.file.name || "clipboard-image.png",
      mediaType: options.file.type || "application/octet-stream",
      byteSize: options.file.size,
      status: "pending",
      ...(options.previewUrl === null ? {} : { previewUrl: options.previewUrl }),
    },
  };
}

export function decideImageFile(file: File): "image" | "file" {
  return file.type.startsWith("image/") ? "image" : "file";
}

export function decideAttachmentKind(kind: "file" | "image"): "file" | "image" {
  return kind;
}

export function planAttachmentRemoval(options: {
  clientId: string;
  currentDraftKey: string;
  drafts: Readonly<Record<string, ComposerAttachment[]>>;
  handles: ReadonlyMap<string, PendingAttachmentHandle>;
  service: ReturnType<typeof decideAttachmentService>;
}) {
  const handle = options.handles.get(options.clientId);
  const draftKey = handle?.draftKey ?? options.currentDraftKey;
  const item = planDraftAttachments(options.drafts, draftKey)
    .find((candidate) => candidate.clientId === options.clientId);
  const previewUrls = new Set<string>();
  if (handle?.previewUrl != null) previewUrls.add(handle.previewUrl);
  if (item?.previewUrl != null) previewUrls.add(item.previewUrl);
  return {
    draftKey,
    handle,
    presence: handle !== undefined || item !== undefined ? "mutate" as const : "unchanged" as const,
    previewUrls: [...previewUrls],
    remote: item?.attachmentId !== undefined && options.service.kind === "available"
      ? {
          apiBase: options.service.apiBase,
          capability: options.service.capability,
          draftKey,
          attachmentId: item.attachmentId,
        }
      : null,
  };
}

export function decideAttachmentRetry(handle: PendingAttachmentHandle | undefined):
  | { kind: "skip" }
  | { kind: "retry"; handle: PendingAttachmentHandle } {
  return handle === undefined || handle.controller !== null
    ? { kind: "skip" }
    : { kind: "retry", handle };
}

export function planRetriedAttachmentItems(
  items: readonly ComposerAttachment[],
  clientId: string,
): ComposerAttachment[] {
  const item = items.find((candidate) => candidate.clientId === clientId);
  return item === undefined
    ? [...items]
    : [
        ...items.filter((candidate) => candidate.clientId !== clientId),
        { ...item, status: "pending", error: undefined },
      ];
}

export function planDraftCleanup(
  items: readonly ComposerAttachment[],
  handles: ReadonlyMap<string, PendingAttachmentHandle>,
) {
  return {
    clientIds: items.map((item) => item.clientId),
    handles: items.flatMap((item) => {
      const handle = handles.get(item.clientId);
      return handle === undefined ? [] : [handle];
    }),
    previewUrls: [...new Set(items.flatMap((item) => item.previewUrl === undefined ? [] : [item.previewUrl]))],
  };
}

export function decideAttachmentDraftOwner(
  draftKey: string,
  sessionId: string,
): "match" | "mismatch" {
  return draftKey === `draft:${sessionId}` ? "match" : "mismatch";
}

export function planAttachmentIds(items: readonly ComposerAttachment[]): string[] {
  return items.flatMap((item) => item.attachmentId === undefined ? [] : [item.attachmentId]);
}

export function planRestoredAttachment(
  attachment: {
    attachmentId: string;
    kind: "file" | "image";
    displayName: string;
    mediaType: string;
    byteSize: number;
  },
  previewUrl: string | undefined,
): ComposerAttachment {
  return {
    clientId: attachment.attachmentId,
    ...attachment,
    status: "ready",
    ...(previewUrl === undefined ? {} : { previewUrl }),
  };
}

export function planAttachmentPreviewUrls(items: readonly ComposerAttachment[]): string[] {
  return [...new Set(items.flatMap((item) => item.previewUrl === undefined ? [] : [item.previewUrl]))];
}

export function decideAttachmentRevision(options: {
  current: number | undefined;
  expected: number;
}): "current" | "stale" {
  return options.current === options.expected ? "current" : "stale";
}

export function planAttachmentGeneration(current: number | undefined): number {
  return current ?? 0;
}

export function decideAttachmentRestorationCommit(options: {
  aborted: boolean;
  currentRevision: number | undefined;
  expectedRevision: number;
}): "current" | "stale" {
  return options.aborted || (options.currentRevision ?? 0) !== options.expectedRevision
    ? "stale"
    : "current";
}

export function planMergedDraftAttachments(options: {
  current: readonly ComposerAttachment[];
  restored: readonly ComposerAttachment[];
}): { items: ComposerAttachment[]; revokeUrls: string[] } {
  const transient = options.current.filter((item) => item.status !== "ready");
  const knownReadyIds = new Set(options.restored.map((item) => item.attachmentId));
  const lateReady = options.current.filter((item) => item.status === "ready"
    && item.attachmentId !== undefined
    && !knownReadyIds.has(item.attachmentId));
  const revokeUrls = options.current.flatMap((item) => item.status === "ready"
    && item.attachmentId !== undefined
    && knownReadyIds.has(item.attachmentId)
    && item.previewUrl !== undefined
    ? [item.previewUrl]
    : []);
  return { items: [...options.restored, ...lateReady, ...transient], revokeUrls };
}

export function planVisibleRestoredAttachments(
  items: readonly ComposerAttachment[],
  visible: boolean,
): { items: ComposerAttachment[]; revokeUrls: string[] } {
  if (visible) return { items: [...items], revokeUrls: [] };
  return {
    items: items.map(({ previewUrl: _previewUrl, ...item }) => item),
    revokeUrls: planAttachmentPreviewUrls(items),
  };
}

export function planReleasedDraftPreviews(options: {
  items: readonly ComposerAttachment[];
  handles: ReadonlyMap<string, PendingAttachmentHandle>;
  draftKey: string;
}): {
  items: ComposerAttachment[];
  previewUrls: string[];
  handles: PendingAttachmentHandle[];
} {
  const handles = [...options.handles.values()].filter(
    (handle) => handle.draftKey === options.draftKey && handle.previewUrl !== null,
  );
  return {
    items: options.items.map(({ previewUrl: _previewUrl, ...item }) => item),
    previewUrls: [...new Set([
      ...planAttachmentPreviewUrls(options.items),
      ...handles.flatMap((handle) => handle.previewUrl === null ? [] : [handle.previewUrl]),
    ])],
    handles,
  };
}

export function decideAttachmentDraftChanged(previous: string, current: string): "changed" | "same" {
  return previous === current ? "same" : "changed";
}

export function planAttachmentRuntimeCleanup(options: {
  drafts: Readonly<Record<string, ComposerAttachment[]>>;
  handles: ReadonlyMap<string, PendingAttachmentHandle>;
}): { previewUrls: string[]; handles: PendingAttachmentHandle[] } {
  const handles = [...options.handles.values()];
  return {
    previewUrls: [...new Set([
      ...Object.values(options.drafts).flatMap(planAttachmentPreviewUrls),
      ...handles.flatMap((handle) => handle.previewUrl === null ? [] : [handle.previewUrl]),
    ])],
    handles,
  };
}
