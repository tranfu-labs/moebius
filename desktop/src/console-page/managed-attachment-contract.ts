import type { ComposerAttachment } from "@moebius/console-ui";
import type { MutableRefObject } from "react";

import type { ManagedAttachmentClient } from "./managed-attachment-port.js";
import type { SidebarConversationDraftAttachmentPresence } from "./sidebar-conversation-drafts.js";

export interface PendingAttachmentHandle {
  draftKey: string;
  file: File;
  controller: AbortController | null;
  previewUrl: string | null;
  presenceGeneration: number;
}

export interface ManagedAttachmentDraftInput {
  client: ManagedAttachmentClient;
  apiBase: string | null;
  capability: string | null;
  currentDraftKey: string;
  onError(error: string): void;
  onDraftAttachmentPresenceChange?(
    draftKey: string,
    presence: SidebarConversationDraftAttachmentPresence,
  ): void;
}

export interface ManagedAttachmentRuntime {
  draftsRef: MutableRefObject<Record<string, ComposerAttachment[]>>;
  handlesRef: MutableRefObject<Map<string, PendingAttachmentHandle>>;
  draftRevisionRef: MutableRefObject<Map<string, number>>;
  presenceGenerationRef: MutableRefObject<Map<string, number>>;
  currentDraftKeyRef: MutableRefObject<string>;
  uploadQueueRef: MutableRefObject<Promise<void>>;
  updateDraft(
    draftKey: string,
    update: (items: ComposerAttachment[]) => ComposerAttachment[],
  ): void;
  setDraft(draftKey: string, items: ComposerAttachment[]): void;
  beginPresenceMutation(draftKey: string): number;
  commitPresence(
    draftKey: string,
    generation: number,
    presence: SidebarConversationDraftAttachmentPresence,
  ): void;
}
