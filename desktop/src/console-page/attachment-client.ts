import type { StructuredAttachment } from "@moebius/console-ui";
import type { ManagedAttachmentClient } from "./managed-attachment-port.js";
import { ManagedAttachmentFailure } from "./managed-attachment-model.js";

export const ATTACHMENT_CAPABILITY_HEADER = "x-moebius-attachment-capability";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export const managedAttachmentFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

export const managedAttachmentClient: ManagedAttachmentClient = {
  upload: (input) => uploadManagedAttachment({ ...input, fetch: managedAttachmentFetch }),
  listDraft: (input) => listManagedDraftAttachments({ ...input, fetch: managedAttachmentFetch }),
  cloneMessage: (input) => cloneManagedMessageAttachments({ ...input, fetch: managedAttachmentFetch }),
  removeDraft: (input) => removeManagedDraftAttachment({ ...input, fetch: managedAttachmentFetch }),
  loadPreview: (input) => loadManagedAttachmentPreview({ ...input, fetch: managedAttachmentFetch }),
  loadAgentImageSource: (input) => loadAgentImageSource({ ...input, fetch: managedAttachmentFetch }),
};

export interface AttachmentClientOptions {
  apiBase: string;
  capability: string;
  fetch: FetchLike;
}

export async function uploadManagedAttachment(input: AttachmentClientOptions & {
  draftKey: string;
  file: File;
  preview: Blob | null;
  largePreview: Blob | null;
  signal: AbortSignal;
}): Promise<StructuredAttachment> {
  const url = endpoint(input.apiBase, "/api/local-console/attachments");
  url.searchParams.set("draftKey", input.draftKey);
  url.searchParams.set("displayName", input.file.name || "clipboard-image.png");
  const uploadResponse = await input.fetch(url, {
    method: "POST",
    headers: {
      [ATTACHMENT_CAPABILITY_HEADER]: input.capability,
      "content-type": input.file.type || "application/octet-stream",
    },
    body: input.file,
    signal: input.signal,
  });
  const uploaded = await readJson<{
    status?: "ready" | "preview-required";
    uploadId?: string;
    svg?: boolean;
    attachment?: StructuredAttachment;
    error?: string;
  }>(uploadResponse);
  if (!uploadResponse.ok) {
    throw uploaded.error === undefined
      ? new ManagedAttachmentFailure("attachment-upload")
      : new Error(uploaded.error);
  }
  if (uploaded.status === "ready" && uploaded.attachment !== undefined) return uploaded.attachment;
  if (uploaded.status !== "preview-required" || uploaded.uploadId === undefined) {
    throw new ManagedAttachmentFailure("attachment-preview-not-ready");
  }
  const uploadId = encodeURIComponent(uploaded.uploadId);
  if (input.preview !== null && input.largePreview !== null) {
    const thumbnail = await submitDerivedPreview(input, uploadId, "/preview", input.preview);
    if (thumbnail.attachment !== undefined) return thumbnail.attachment;
    const large = await submitDerivedPreview(input, uploadId, "/preview-large", input.largePreview);
    if (large.attachment !== undefined) return large.attachment;
    throw new ManagedAttachmentFailure("attachment-preview-save");
  }
  if (uploaded.svg === true) {
    const fallbackUrl = endpoint(
      input.apiBase,
      `/api/local-console/attachments/uploads/${uploadId}/fallback`,
    );
    fallbackUrl.searchParams.set("draftKey", input.draftKey);
    const fallbackResponse = await input.fetch(fallbackUrl, {
      method: "POST",
      headers: { [ATTACHMENT_CAPABILITY_HEADER]: input.capability },
      signal: input.signal,
    });
    const fallback = await readJson<{ attachment?: StructuredAttachment; error?: string }>(fallbackResponse);
    if (!fallbackResponse.ok || fallback.attachment === undefined) {
      throw fallback.error === undefined
        ? new ManagedAttachmentFailure("attachment-preview-save")
        : new Error(fallback.error);
    }
    return fallback.attachment;
  }
  throw new ManagedAttachmentFailure("attachment-preview-not-ready");
}

async function submitDerivedPreview(
  input: AttachmentClientOptions & { draftKey: string; signal: AbortSignal },
  uploadId: string,
  suffix: "/preview" | "/preview-large",
  preview: Blob,
): Promise<{ attachment?: StructuredAttachment }> {
  const previewUrl = endpoint(
    input.apiBase,
    `/api/local-console/attachments/uploads/${uploadId}${suffix}`,
  );
  previewUrl.searchParams.set("draftKey", input.draftKey);
  const previewResponse = await input.fetch(previewUrl, {
    method: "POST",
    headers: {
      [ATTACHMENT_CAPABILITY_HEADER]: input.capability,
      "content-type": "image/png",
    },
    body: preview,
    signal: input.signal,
  });
  const finalized = await readJson<{ attachment?: StructuredAttachment; error?: string; status?: string }>(previewResponse);
  if (!previewResponse.ok) {
    throw finalized.error === undefined
      ? new ManagedAttachmentFailure("attachment-preview-save")
      : new Error(finalized.error);
  }
  return finalized;
}

export async function listManagedDraftAttachments(
  input: AttachmentClientOptions & { draftKey: string; signal?: AbortSignal },
): Promise<StructuredAttachment[]> {
  const url = endpoint(input.apiBase, "/api/local-console/attachments");
  url.searchParams.set("draftKey", input.draftKey);
  const response = await input.fetch(url, {
    headers: { [ATTACHMENT_CAPABILITY_HEADER]: input.capability },
    signal: input.signal,
  });
  const body = await readJson<{ attachments?: StructuredAttachment[]; error?: string }>(response);
  if (!response.ok || body.attachments === undefined) {
    throw body.error === undefined
      ? new ManagedAttachmentFailure("attachment-draft-restore")
      : new Error(body.error);
  }
  return body.attachments;
}

export async function cloneManagedMessageAttachments(
  input: AttachmentClientOptions & {
    sessionId: string;
    sourceMessageId: number;
    targetDraftKey: string;
  },
): Promise<StructuredAttachment[]> {
  const url = endpoint(input.apiBase, "/api/local-console/attachments/clone");
  const response = await input.fetch(url, {
    method: "POST",
    headers: {
      [ATTACHMENT_CAPABILITY_HEADER]: input.capability,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sessionId: input.sessionId,
      sourceMessageId: input.sourceMessageId,
      targetDraftKey: input.targetDraftKey,
    }),
  });
  const body = await readJson<{ attachments?: StructuredAttachment[]; error?: string }>(response);
  if (!response.ok || body.attachments === undefined) {
    throw body.error === undefined
      ? new ManagedAttachmentFailure("attachment-backfill")
      : new Error(body.error);
  }
  return body.attachments;
}

export async function removeManagedDraftAttachment(
  input: AttachmentClientOptions & { draftKey: string; attachmentId: string },
): Promise<void> {
  const url = endpoint(input.apiBase, `/api/local-console/attachments/${encodeURIComponent(input.attachmentId)}`);
  url.searchParams.set("draftKey", input.draftKey);
  const response = await input.fetch(url, {
    method: "DELETE",
    headers: { [ATTACHMENT_CAPABILITY_HEADER]: input.capability },
  });
  if (!response.ok && response.status !== 404) {
    const body = await readJson<{ error?: string }>(response);
    throw body.error === undefined
      ? new ManagedAttachmentFailure("attachment-remove")
      : new Error(body.error);
  }
}

export async function loadManagedAttachmentPreview(
  input: AttachmentClientOptions & {
    attachmentId: string;
    draftKey?: string;
    sessionId?: string;
    signal?: AbortSignal;
  },
): Promise<Blob> {
  const url = endpoint(input.apiBase, `/api/local-console/attachments/${encodeURIComponent(input.attachmentId)}/preview`);
  if (input.draftKey !== undefined) url.searchParams.set("draftKey", input.draftKey);
  if (input.sessionId !== undefined) url.searchParams.set("sessionId", input.sessionId);
  const response = await input.fetch(url, {
    headers: { [ATTACHMENT_CAPABILITY_HEADER]: input.capability },
    signal: input.signal,
  });
  if (response.status === 404) {
    throw new ManagedAttachmentFailure("attachment-preview-not-found");
  }
  if (!response.ok || response.headers.get("content-type") !== "image/png") {
    throw new ManagedAttachmentFailure("attachment-preview-read");
  }
  return await response.blob();
}

export type AgentImageSourceLoadResult =
  | { ok: true; mediaType: string; blob: Blob }
  | { ok: false; reason: string };

export async function loadAgentImageSource(
  input: AttachmentClientOptions & {
    sessionId: string;
    path: string;
    signal?: AbortSignal;
  },
): Promise<AgentImageSourceLoadResult> {
  const url = endpoint(
    input.apiBase,
    `/api/local-console/sessions/${encodeURIComponent(input.sessionId)}/agent-image-source`,
  );
  url.searchParams.set("path", input.path);
  const response = await input.fetch(url, {
    headers: { [ATTACHMENT_CAPABILITY_HEADER]: input.capability },
    signal: input.signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { reason?: string } | null;
    return { ok: false, reason: body?.reason ?? "unavailable" };
  }
  return {
    ok: true,
    mediaType: response.headers.get("content-type") ?? "application/octet-stream",
    blob: await response.blob(),
  };
}

function endpoint(base: string, path: string): URL {
  return new URL(path.replace(/^\//u, ""), base.endsWith("/") ? base : `${base}/`);
}

async function readJson<T>(response: Response): Promise<T> {
  return await response.json() as T;
}
