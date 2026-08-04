// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useManagedProcesses } from "./use-managed-processes";

const item = (id: string) => ({
  id,
  sessionId: id,
  workspaceRoot: "/tmp/workspace",
  kind: "service" as const,
  label: id,
  state: "running" as const,
  endpoint: null,
  readiness: null,
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
  wrapperPid: 1,
  targetPid: 2,
  exitCode: null,
  signal: null,
  acknowledged: false,
});

describe("useManagedProcesses", () => {
  it("drops a late previous-session response and never flashes it into the new session", async () => {
    const pending = new Map<string, (response: Response) => void>();
    const port = {
      list: vi.fn(({ sessionId }: { sessionId: string }) => new Promise<ReturnType<typeof item>[]>((resolve) => {
        pending.set(sessionId, (response) => { void response.json().then((body: { processes: ReturnType<typeof item>[] }) => resolve(body.processes)); });
      })),
      readLogs: vi.fn(),
      command: vi.fn(),
    };
    const { result, rerender } = renderHook(({ sessionId }) => useManagedProcesses({
      apiBase: "http://127.0.0.1:4000",
      sessionId,
      port,
      openExternalLink: () => undefined,
    }), { initialProps: { sessionId: "s1" } });
    rerender({ sessionId: "s2" });
    await act(async () => pending.get("s2")?.({ ok: true, json: async () => ({ processes: [item("s2")] }) } as Response));
    await waitFor(() => expect(result.current.state.items.map((entry) => entry.id)).toEqual(["s2"]));
    await act(async () => pending.get("s1")?.({ ok: true, json: async () => ({ processes: [item("s1")] }) } as Response));
    expect(result.current.state.items.map((entry) => entry.id)).toEqual(["s2"]);
  });

  it("hides a committed previous-session item in the render that changes selection", async () => {
    const pending = new Map<string, (items: ReturnType<typeof item>[]) => void>();
    const port = {
      list: vi.fn(({ sessionId }: { sessionId: string }) => new Promise<ReturnType<typeof item>[]>((resolve) => pending.set(sessionId, resolve))),
      readLogs: vi.fn(),
      command: vi.fn(),
    };
    const { result, rerender } = renderHook(({ sessionId }) => useManagedProcesses({
      apiBase: "http://127.0.0.1:4000",
      sessionId,
      port,
      openExternalLink: () => undefined,
    }), { initialProps: { sessionId: "s1" } });
    await act(async () => pending.get("s1")?.([item("s1")]));
    await waitFor(() => expect(result.current.state.items.map((entry) => entry.id)).toEqual(["s1"]));

    rerender({ sessionId: "s2" });
    expect(result.current.state.items).toEqual([]);
    expect(result.current.state.status).toBe("loading");
  });

  it("does not refetch for parent callback identity changes and coalesces duplicate stop clicks", async () => {
    let commandCount = 0;
    const port = {
      list: vi.fn(async () => [item("p1")]),
      readLogs: vi.fn(),
      command: vi.fn(async () => { commandCount += 1; }),
    };
    const { result, rerender } = renderHook(({ openExternalLink }) => useManagedProcesses({
      apiBase: "http://127.0.0.1:4000",
      sessionId: "s1",
      port,
      openExternalLink,
    }), { initialProps: { openExternalLink: (_url: string) => undefined } });
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    const callsBefore = port.list.mock.calls.length;
    rerender({ openExternalLink: (_url: string) => undefined });
    expect(port.list.mock.calls.length).toBe(callsBefore);
    act(() => {
      result.current.onStop("p1");
      result.current.onStop("p1");
    });
    await waitFor(() => expect(commandCount).toBe(1));
  });

  it("keeps the last log tail and process item when refresh or commands fail", async () => {
    let failLogs = false;
    const port = {
      list: vi.fn(async () => [item("p1")]),
      readLogs: vi.fn(async () => {
        if (failLogs) throw new Error("log transport failed");
        return { status: "ready" as const, stdout: "last tail", stderr: "", truncated: true };
      }),
      command: vi.fn(async () => { throw new Error("stop failed"); }),
    };
    const { result } = renderHook(() => useManagedProcesses({
      apiBase: "http://127.0.0.1:4000",
      sessionId: "s1",
      port,
      openExternalLink: () => undefined,
    }));
    await waitFor(() => expect(result.current.state.items).toHaveLength(1));
    act(() => result.current.onReadLogs("p1"));
    await waitFor(() => expect(result.current.logs.p1).toMatchObject({ status: "ready", stdout: "last tail", truncated: true }));
    failLogs = true;
    act(() => result.current.onReadLogs("p1"));
    await waitFor(() => expect(result.current.logs.p1).toMatchObject({ status: "ready", stdout: "last tail", message: "log transport failed" }));
    act(() => result.current.onStop("p1"));
    await waitFor(() => expect(result.current.state).toMatchObject({ items: [{ id: "p1" }], message: "stop failed" }));
  });

  it("does not surface a previous-session command failure after selection changes", async () => {
    let rejectCommand!: (error: Error) => void;
    const command = new Promise<void>((_resolve, reject) => { rejectCommand = reject; });
    const port = {
      list: vi.fn(async ({ sessionId }: { sessionId: string }) => [item(sessionId)]),
      readLogs: vi.fn(),
      command: vi.fn(async () => await command),
    };
    const { result, rerender } = renderHook(({ sessionId }) => useManagedProcesses({
      apiBase: "http://127.0.0.1:4000",
      sessionId,
      port,
      openExternalLink: () => undefined,
    }), { initialProps: { sessionId: "s1" } });
    await waitFor(() => expect(result.current.state.items).toHaveLength(1));
    act(() => result.current.onStop("s1"));
    rerender({ sessionId: "s2" });
    await waitFor(() => expect(result.current.state.items.map((entry) => entry.id)).toEqual(["s2"]));
    await act(async () => rejectCommand(new Error("old stop failed")));
    expect(result.current.state.message).toBeUndefined();
  });
});
