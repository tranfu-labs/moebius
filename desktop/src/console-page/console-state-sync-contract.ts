export interface ConsoleStateSyncSnapshot {
  selectedProjectId: string;
  selectedSessionId: string;
  selectedSession: {
    sessionId: string;
    unreadSince?: string | null;
  } | null;
  messages: Array<{
    speaker: string;
    createdAt: string;
  }>;
}

export interface ConsoleStateSyncPort {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
  acknowledgeDisplayedResult(input: {
    apiBase: string;
    sessionId: string;
    unreadSince: string;
  }): Promise<void>;
}
