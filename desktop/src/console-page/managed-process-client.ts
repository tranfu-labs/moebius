import type { ManagedProcessLogResult } from "../../../src/local-console/managed-process-supervisor.js";
import type { ManagedProcessSummary } from "../../../src/local-console/managed-process-contract.js";
import type { ManagedProcessBrowserPort } from "./managed-process-sync-contract.js";
import { fetchFromBrowser } from "./browser-fetch.js";

export type ManagedProcessFetch = typeof globalThis.fetch;

export async function listManagedProcesses(input: { apiBase: string; sessionId: string; fetch: ManagedProcessFetch; signal?: AbortSignal }): Promise<ManagedProcessSummary[]> {
  const response = await input.fetch(managedUrl(input.apiBase, input.sessionId), { signal: input.signal });
  const body = await response.json() as { processes?: ManagedProcessSummary[]; error?: string };
  if (!response.ok || body.processes === undefined) throw new Error(body.error ?? "managed process list failed");
  return body.processes;
}

export async function readManagedProcessLogs(input: { apiBase: string; sessionId: string; id: string; cursor?: string; fetch: ManagedProcessFetch; signal?: AbortSignal }): Promise<ManagedProcessLogResult> {
  const url = new URL(`${managedUrl(input.apiBase, input.sessionId)}/${encodeURIComponent(input.id)}/logs`);
  if (input.cursor !== undefined) url.searchParams.set("cursor", input.cursor);
  const response = await input.fetch(url.toString(), { signal: input.signal });
  const body = await response.json() as ManagedProcessLogResult | { error?: string };
  if (!response.ok) throw new Error("error" in body ? body.error ?? "managed process logs failed" : "managed process logs failed");
  return body as ManagedProcessLogResult;
}

export async function commandManagedProcess(input: { apiBase: string; sessionId: string; id?: string; command: "stop" | "acknowledge-exited"; fetch: ManagedProcessFetch }): Promise<void> {
  const suffix = input.command === "stop" && input.id !== undefined
    ? `${encodeURIComponent(input.id)}/stop`
    : "acknowledge-exited";
  const response = await input.fetch(`${managedUrl(input.apiBase, input.sessionId)}/${suffix}`, { method: "POST" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `managed process ${input.command} failed`);
  }
}

function managedUrl(apiBase: string, sessionId: string): string {
  return new URL(`/api/local-console/sessions/${encodeURIComponent(sessionId)}/managed-processes`, apiBase).toString();
}

export const browserManagedProcessPort: ManagedProcessBrowserPort = {
  list: (input) => listManagedProcesses({ ...input, fetch: fetchFromBrowser }),
  readLogs: async (input) => ({ status: "ready", ...await readManagedProcessLogs({ ...input, fetch: fetchFromBrowser }) }),
  command: (input) => commandManagedProcess({ ...input, fetch: fetchFromBrowser }),
};
