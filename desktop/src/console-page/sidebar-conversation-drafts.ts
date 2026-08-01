export const SIDEBAR_CONVERSATION_DRAFTS_KEY = "moebius.sidebar-conversation-drafts.v1";

export interface SidebarConversationTextFragment {
  id: string;
  label: string;
  text: string;
}

export interface SidebarConversationDraftContext {
  projectId: string | null;
  workspaceMode: "direct" | "worktree";
  teamKey: string | null;
}

export interface SidebarConversationDraft {
  draftId: string;
  hostSessionId: string;
  originSessionId: string | null;
  entryTemplate: "session-analysis" | null;
  writePolicy: "normal" | "confirm-current-plan-before-write";
  initialContext: SidebarConversationDraftContext;
  context: SidebarConversationDraftContext;
  textFragments: SidebarConversationTextFragment[];
  body: string;
  attachmentDraftKey: `draft:sidebar:${string}`;
  updatedAt: string;
}

interface SidebarConversationDraftDocument {
  version: 1;
  drafts: SidebarConversationDraft[];
}

export interface SidebarConversationDraftStore {
  list(): SidebarConversationDraft[];
  read(draftId: string): SidebarConversationDraft | null;
  write(draft: SidebarConversationDraft): void;
  remove(draftId: string): void;
  findMergeable(input: {
    hostSessionId: string;
    originSessionId: string;
    initialProjectId: string | null;
    initialWorkspaceMode: "direct" | "worktree";
    entryTemplate: "session-analysis";
  }): SidebarConversationDraft | null;
}

export function createSidebarConversationDraftStore(storage: Storage): SidebarConversationDraftStore {
  const readDocument = (): SidebarConversationDraftDocument => {
    try {
      const raw = storage.getItem(SIDEBAR_CONVERSATION_DRAFTS_KEY);
      if (raw === null) return { version: 1, drafts: [] };
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed !== "object"
        || parsed === null
        || (parsed as { version?: unknown }).version !== 1
        || !Array.isArray((parsed as { drafts?: unknown }).drafts)
      ) {
        return { version: 1, drafts: [] };
      }
      return {
        version: 1,
        drafts: (parsed as { drafts: unknown[] }).drafts
          .map(parseSidebarConversationDraft)
          .filter((draft): draft is SidebarConversationDraft => draft !== null),
      };
    } catch {
      return { version: 1, drafts: [] };
    }
  };
  const writeDocument = (document: SidebarConversationDraftDocument): void => {
    try {
      storage.setItem(SIDEBAR_CONVERSATION_DRAFTS_KEY, JSON.stringify(document));
    } catch {
      // Persistence is best-effort; the current in-memory draft remains usable.
    }
  };
  return {
    list: () => readDocument().drafts,
    read: (draftId) => readDocument().drafts.find((draft) => draft.draftId === draftId) ?? null,
    write(draft) {
      const document = readDocument();
      const index = document.drafts.findIndex((candidate) => candidate.draftId === draft.draftId);
      if (index < 0) document.drafts.push(draft);
      else document.drafts[index] = draft;
      writeDocument(document);
    },
    remove(draftId) {
      const document = readDocument();
      document.drafts = document.drafts.filter((draft) => draft.draftId !== draftId);
      writeDocument(document);
    },
    findMergeable(input) {
      return readDocument().drafts.find((draft) =>
        draft.entryTemplate === input.entryTemplate
        && draft.hostSessionId === input.hostSessionId
        && draft.originSessionId === input.originSessionId
        && draft.initialContext.projectId === input.initialProjectId
        && draft.initialContext.workspaceMode === input.initialWorkspaceMode) ?? null;
    },
  };
}

export function createSidebarConversationDraft(input: {
  draftId: string;
  hostSessionId: string;
  originSessionId: string | null;
  entryTemplate: "session-analysis" | null;
  context: SidebarConversationDraftContext;
  now: string;
}): SidebarConversationDraft {
  return {
    ...input,
    writePolicy: input.entryTemplate === "session-analysis"
      ? "confirm-current-plan-before-write"
      : "normal",
    initialContext: { ...input.context },
    context: { ...input.context },
    textFragments: [],
    body: "",
    attachmentDraftKey: `draft:sidebar:${input.draftId}`,
    updatedAt: input.now,
  };
}

export function sidebarConversationDraftHasUserChanges(draft: SidebarConversationDraft): boolean {
  return draft.body.trim() !== ""
    || draft.textFragments.length > 0
    || draft.context.projectId !== draft.initialContext.projectId
    || draft.context.workspaceMode !== draft.initialContext.workspaceMode
    || draft.context.teamKey !== draft.initialContext.teamKey;
}

export function sidebarConversationDraftRequiresDiscardConfirmation(
  draft: SidebarConversationDraft,
  hasAttachments: boolean,
): boolean {
  return sidebarConversationDraftHasUserChanges(draft) || hasAttachments;
}

function parseSidebarConversationDraft(value: unknown): SidebarConversationDraft | null {
  if (typeof value !== "object" || value === null) return null;
  const draft = value as Partial<SidebarConversationDraft>;
  if (
    typeof draft.draftId !== "string"
    || typeof draft.hostSessionId !== "string"
    || (draft.originSessionId !== null && typeof draft.originSessionId !== "string")
    || (draft.entryTemplate !== null && draft.entryTemplate !== "session-analysis")
    || (draft.writePolicy !== "normal" && draft.writePolicy !== "confirm-current-plan-before-write")
    || !isContext(draft.initialContext)
    || !isContext(draft.context)
    || !Array.isArray(draft.textFragments)
    || !draft.textFragments.every(isTextFragment)
    || typeof draft.body !== "string"
    || typeof draft.attachmentDraftKey !== "string"
    || typeof draft.updatedAt !== "string"
  ) {
    return null;
  }
  return draft as SidebarConversationDraft;
}

function isContext(value: unknown): value is SidebarConversationDraftContext {
  if (typeof value !== "object" || value === null) return false;
  const context = value as Partial<SidebarConversationDraftContext>;
  return (context.projectId === null || typeof context.projectId === "string")
    && (context.workspaceMode === "direct" || context.workspaceMode === "worktree")
    && (context.teamKey === null || typeof context.teamKey === "string");
}

function isTextFragment(value: unknown): value is SidebarConversationTextFragment {
  if (typeof value !== "object" || value === null) return false;
  const fragment = value as Partial<SidebarConversationTextFragment>;
  return typeof fragment.id === "string"
    && typeof fragment.label === "string"
    && typeof fragment.text === "string";
}
