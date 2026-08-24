// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OperatorRunSnapshot } from "@moebius/console-ui";

import { loadClaudeTerminalTrace } from "./console-api-client.js";
import { fetchFromBrowser } from "./browser-fetch.js";
import type { ClaudeTerminalTracePort } from "./claude-terminal-trace-model.js";
import { useClaudeTerminalTraces } from "./use-claude-terminal-traces.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useClaudeTerminalTraces", () => {
  it("polls the matching active Claude run with a monotonic cursor and drops it when the run is gone", async () => {
    const pages = [
      {
        sessionId: "session-1",
        runId: "run-1",
        chunks: [{ cursor: 0, dataBase64: "QQ==" }],
        nextCursor: 1,
        bytesObserved: 1,
        bytesRetained: 1,
        incomplete: false,
      },
      {
        sessionId: "session-1",
        runId: "run-1",
        chunks: [{ cursor: 1, dataBase64: "Qg==" }],
        nextCursor: 2,
        bytesObserved: 2,
        bytesRetained: 2,
        incomplete: false,
      },
    ];
    const requestedUrls: string[] = [];
    const fetch = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify(pages.shift() ?? {
        sessionId: "session-1",
        runId: "run-1",
        chunks: [],
        nextCursor: 2,
        bytesObserved: 2,
        bytesRetained: 2,
        incomplete: false,
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const port = createTracePort(fetch);

    const { result, rerender } = renderHook(({ runs }) => useClaudeTerminalTraces(
      "http://127.0.0.1:43123/", runs, port,
    ), { initialProps: { runs: [claudeRun("session-1", "run-1")] } });
    await waitFor(() => expect(traceFor(result.current, "session-1", "run-1")).toMatchObject({
      status: "ready", nextCursor: 1, chunks: [{ cursor: 0, dataBase64: "QQ==" }],
    }));
    await waitFor(() => expect(traceFor(result.current, "session-1", "run-1")).toMatchObject({
      status: "ready", nextCursor: 2, chunks: [
        { cursor: 0, dataBase64: "QQ==" },
        { cursor: 1, dataBase64: "Qg==" },
      ],
    }));
    expect(requestedUrls[0]).toContain("cursor=0");
    expect(requestedUrls[1]).toContain("cursor=1");

    rerender({ runs: [] });
    await waitFor(() => expect(result.current).toEqual([]));
  });

  it("keeps an already-rendered trace in a reconnecting state after a transient request error", async () => {
    let rejectSecondRequest: ((reason?: unknown) => void) | undefined;
    const load = vi.fn()
      .mockResolvedValueOnce({
        sessionId: "session-1",
        runId: "run-1",
        chunks: [{ cursor: 0, dataBase64: "QQ==" }],
        nextCursor: 1,
        bytesObserved: 1,
        bytesRetained: 1,
        incomplete: false,
      })
      .mockImplementationOnce(() => new Promise<never>((_resolve, reject) => {
        rejectSecondRequest = reject;
      }));
    const port: ClaudeTerminalTracePort = { load };
    const { result } = renderHook(() => useClaudeTerminalTraces(
      "http://127.0.0.1:43123/", [claudeRun("session-1", "run-1")], port,
    ));
    await waitFor(() => expect(traceFor(result.current, "session-1", "run-1")?.status).toBe("ready"));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    rejectSecondRequest?.(new Error("loopback disconnected"));
    await waitFor(() => expect(traceFor(result.current, "session-1", "run-1")).toMatchObject({
      status: "reconnecting",
      chunks: [{ cursor: 0, dataBase64: "QQ==" }],
      nextCursor: 1,
    }));
  });

  it("loads a settled Claude attempt from the open process tab once and preserves incompleteness", async () => {
    const load = vi.fn().mockResolvedValue({
      sessionId: "session-history",
      runId: "run-history",
      chunks: [{ cursor: 0, dataBase64: "QQ==" }],
      nextCursor: 1,
      bytesObserved: 10,
      bytesRetained: 1,
      incomplete: true,
    });
    const port: ClaudeTerminalTracePort = { load };
    const { result } = renderHook(() => useClaudeTerminalTraces(
      "http://127.0.0.1:43123/",
      [],
      port,
      [{
        sessionId: "session-history",
        requestedRunId: "run-history",
        role: "dev",
        status: "settled",
        unavailableReason: null,
        attempts: [{
          runId: "run-history",
          attempt: 1,
          role: "dev",
          engine: "claude",
          model: null,
          effort: null,
          provider: "anthropic",
          cliVersion: null,
          metadataSource: "provider-native",
          threadId: "thread-history",
          startedAt: "2026-07-23T01:00:00.000Z",
          status: "completed",
        }],
        events: [],
        previousCursor: null,
        appendCursor: null,
        atLatest: true,
      }],
    ));

    await waitFor(() => expect(traceFor(result.current, "session-history", "run-history")).toMatchObject({
      status: "ready",
      incomplete: true,
      bytesObserved: 10,
      bytesRetained: 1,
    }));
    expect(load).toHaveBeenCalledTimes(1);
  });
});

function createTracePort(fetch: typeof fetchFromBrowser): ClaudeTerminalTracePort {
  return {
    load: (input) => loadClaudeTerminalTrace({ ...input, fetch }),
  };
}

function traceFor(
  traces: ReturnType<typeof useClaudeTerminalTraces>,
  sessionId: string,
  runId: string,
) {
  return traces.find((trace) => trace.sessionId === sessionId && trace.runId === runId)?.state;
}

function claudeRun(sessionId: string, runId: string): OperatorRunSnapshot {
  return {
    sessionId,
    runId,
    role: "dev",
    status: "running",
    startedAt: null,
    elapsedMs: null,
    engine: "claude",
    runDir: null,
    cwd: null,
    workspaceMode: null,
    worktreeUnavailableReason: null,
    stdoutTail: null,
    stderrTail: null,
    liveMarkdown: null,
    lastOutputSummary: "working",
    tailDiagnostic: null,
    interruptible: true,
  };
}
