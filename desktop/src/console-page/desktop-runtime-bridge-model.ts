import type { DesktopStatusSnapshot } from "./desktop-api-contract.js";

export function readDesktopApiBase(search: string): string | null {
  const value = new URLSearchParams(search).get("api");
  return value?.trim() || null;
}

export function planDesktopApiBaseResolution(input: {
  current: string | null;
  injected: string | undefined;
}): { kind: "retain" } | { kind: "commit"; apiBase: string } | { kind: "read-preload" } {
  if (input.current !== null) return { kind: "retain" };
  return input.injected
    ? { kind: "commit", apiBase: input.injected }
    : { kind: "read-preload" };
}

export function decideDesktopAsyncCommit(cancelled: boolean, valuePresent: boolean): "commit" | "ignore" {
  return !cancelled && valuePresent ? "commit" : "ignore";
}

export function decideDesktopRegistryLoad(apiBase: string | null):
  | { kind: "skip" }
  | { kind: "load"; apiBase: string } {
  return apiBase === null ? { kind: "skip" } : { kind: "load", apiBase };
}

export function decideDesktopRegistryCommit(aborted: boolean): "commit" | "ignore" {
  return aborted ? "ignore" : "commit";
}

export function planDesktopStatusUpdate(snapshot: DesktopStatusSnapshot): {
  runnerStatus: DesktopStatusSnapshot["runner"]["status"];
  apiBase: string | null;
  error: string | null;
} {
  return {
    runnerStatus: snapshot.runner.status,
    apiBase: snapshot.localConsole?.url ?? null,
    error: snapshot.localConsole?.error ?? null,
  };
}
