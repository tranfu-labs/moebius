import type {
  OperatorMessage,
  StructuredAttachment,
} from "@moebius/console-ui";

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

export function planMessageImageSources(messages: readonly OperatorMessage[]) {
  return messages.flatMap((message) => (message.attachments ?? [])
    .filter((attachment) => attachment.kind === "image")
    .map((attachment) => ({ attachment, sessionId: message.sessionId })));
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
      ...(urls[attachment.attachmentId] === undefined
        ? {}
        : { previewUrl: urls[attachment.attachmentId] }),
    })),
  }));
}

export function planAttachmentErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
