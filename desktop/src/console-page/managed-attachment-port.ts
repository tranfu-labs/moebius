import type { StructuredAttachment } from "@moebius/console-ui";

export interface ManagedAttachmentClient {
  upload(input: {
    apiBase: string;
    capability: string;
    draftKey: string;
    file: File;
    preview: Blob | null;
    largePreview: Blob | null;
    signal: AbortSignal;
  }): Promise<StructuredAttachment>;
  listDraft(input: {
    apiBase: string;
    capability: string;
    draftKey: string;
    signal?: AbortSignal;
  }): Promise<StructuredAttachment[]>;
  cloneMessage(input: {
    apiBase: string;
    capability: string;
    sessionId: string;
    sourceMessageId: number;
    targetDraftKey: string;
  }): Promise<StructuredAttachment[]>;
  removeDraft(input: {
    apiBase: string;
    capability: string;
    draftKey: string;
    attachmentId: string;
  }): Promise<void>;
  loadPreview(input: {
    apiBase: string;
    capability: string;
    attachmentId: string;
    draftKey?: string;
    sessionId?: string;
    signal?: AbortSignal;
  }): Promise<Blob>;
}
