import type { ManagedProcessPanelItem, ManagedProcessLogView } from "@moebius/console-ui";

export interface ManagedProcessBrowserPort {
  list(input: { apiBase: string; sessionId: string; signal?: AbortSignal }): Promise<ManagedProcessPanelItem[]>;
  readLogs(input: { apiBase: string; sessionId: string; id: string; cursor?: string }): Promise<Extract<ManagedProcessLogView, { status: "ready" }>>;
  command(input: { apiBase: string; sessionId: string; id?: string; command: "stop" | "acknowledge-exited" }): Promise<void>;
}
