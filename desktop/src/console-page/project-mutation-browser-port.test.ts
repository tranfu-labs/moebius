import { afterEach, describe, expect, it, vi } from "vitest";

import { browserProjectMutationPort } from "./project-mutation-browser-port.js";

function response(status = 200, body: unknown = { project: {} }): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

describe("browserProjectMutationPort", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("writes a project workspace preference through the existing PATCH route", async () => {
    const fetch = vi.fn<FetchLike>(async () => response());
    vi.stubGlobal("fetch", fetch);

    await browserProjectMutationPort.updateWorkspacePreference(
      "http://127.0.0.1:4310",
      "project/a",
      "worktree",
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:4310/api/local-console/projects/project%2Fa",
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ worktreeMode: true }),
    });
  });

  it("serializes same-project choices and continues after an earlier failure", async () => {
    const first = deferred<Response>();
    const fetch = vi.fn<FetchLike>()
      .mockImplementationOnce(async () => await first.promise)
      .mockResolvedValueOnce(response());
    vi.stubGlobal("fetch", fetch);

    const firstRequest = browserProjectMutationPort.updateWorkspacePreference(
      "http://127.0.0.1:4310",
      "project-a",
      "worktree",
    );
    const secondRequest = browserProjectMutationPort.updateWorkspacePreference(
      "http://127.0.0.1:4310",
      "project-a",
      "direct",
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetch).toHaveBeenCalledOnce();
    first.resolve(response(503, { error: "temporarily unavailable" }));
    await expect(firstRequest).rejects.toThrow("temporarily unavailable");
    await expect(secondRequest).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      body: JSON.stringify({ worktreeMode: false }),
    }));
  });
});
