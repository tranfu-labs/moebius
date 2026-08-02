const STORAGE_KEY = "moebius.console.conversation-reading-positions";
const MAX_POSITIONS = 500;

interface ReadingPositionDocument {
  version: 1;
  positions: Record<string, number>;
}

export interface ConversationReadingPositionStore {
  read(sessionId: string): number | null;
  write(sessionId: string, messageId: number): void;
  remove(sessionId: string): void;
  retain(sessionIds: readonly string[]): void;
}

export function planRetainedConversationSessionIds(state: {
  projects: readonly {
    sessions: readonly {
      sessionId: string;
      parentSessionId?: string | null;
      analysisParentSessionId?: string | null;
    }[];
  }[];
} | null): string[] {
  return state?.projects.flatMap((project) => project.sessions
    .filter((session) => session.parentSessionId == null && session.analysisParentSessionId == null)
    .map((session) => session.sessionId)) ?? [];
}

export function createConversationReadingPositionStore(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
): ConversationReadingPositionStore {
  const readDocument = (): ReadingPositionDocument => {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return emptyDocument();
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isReadingPositionDocument(parsed)) {
        storage.removeItem(STORAGE_KEY);
        return emptyDocument();
      }
      return parsed;
    } catch {
      storage.removeItem(STORAGE_KEY);
      return emptyDocument();
    }
  };
  const writeDocument = (document: ReadingPositionDocument) => {
    storage.setItem(STORAGE_KEY, JSON.stringify(document));
  };

  return {
    read(sessionId) {
      return readDocument().positions[sessionId] ?? null;
    },
    write(sessionId, messageId) {
      if (!validSessionId(sessionId) || !Number.isInteger(messageId) || messageId < 0) return;
      const document = readDocument();
      const entries = Object.entries({
        ...document.positions,
        [sessionId]: messageId,
      });
      writeDocument({
        version: 1,
        positions: Object.fromEntries(entries.slice(-MAX_POSITIONS)),
      });
    },
    remove(sessionId) {
      if (!validSessionId(sessionId)) return;
      const document = readDocument();
      if (!(sessionId in document.positions)) return;
      delete document.positions[sessionId];
      if (Object.keys(document.positions).length === 0) {
        storage.removeItem(STORAGE_KEY);
        return;
      }
      writeDocument(document);
    },
    retain(sessionIds) {
      const retained = new Set(sessionIds.filter(validSessionId));
      const document = readDocument();
      const positions = Object.fromEntries(
        Object.entries(document.positions).filter(([sessionId]) => retained.has(sessionId)),
      );
      if (Object.keys(positions).length === Object.keys(document.positions).length) return;
      if (Object.keys(positions).length === 0) {
        storage.removeItem(STORAGE_KEY);
        return;
      }
      writeDocument({ version: 1, positions });
    },
  };
}

function emptyDocument(): ReadingPositionDocument {
  return { version: 1, positions: {} };
}

function isReadingPositionDocument(value: unknown): value is ReadingPositionDocument {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.positions)) return false;
  const entries = Object.entries(value.positions);
  return entries.length <= MAX_POSITIONS && entries.every(([sessionId, messageId]) =>
    validSessionId(sessionId)
    && typeof messageId === "number"
    && Number.isInteger(messageId)
    && messageId >= 0);
}

function validSessionId(value: string): boolean {
  return value.trim() !== "" && value.length <= 512;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
