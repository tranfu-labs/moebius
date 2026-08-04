import { afterEach, describe, expect, it, vi } from "vitest";

import { browserManagedProcessPort } from "./managed-process-client";

describe("browserManagedProcessPort", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("invokes the native browser fetch with globalThis as its receiver", async () => {
    const fetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(new Response(JSON.stringify({ processes: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    });
    vi.stubGlobal("fetch", fetch);

    await expect(browserManagedProcessPort.list({
      apiBase: "http://127.0.0.1:43123/",
      sessionId: "session-1",
    })).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("sends the opaque log cursor and preserves an unchanged response", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => new Response(JSON.stringify({
      stdout: "", stderr: "", truncated: true, cursor: "next-cursor", unchanged: true,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);

    await expect(browserManagedProcessPort.readLogs({
      apiBase: "http://127.0.0.1:43123/", sessionId: "session-1", id: "process-1", cursor: "old cursor",
    })).resolves.toMatchObject({ status: "ready", cursor: "next-cursor", unchanged: true });
    expect(String(fetch.mock.calls[0]?.[0])).toContain("cursor=old+cursor");
  });
});
