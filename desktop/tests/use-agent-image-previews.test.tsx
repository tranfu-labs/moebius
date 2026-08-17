/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorMessage } from "@moebius/console-ui";

import { waitForCondition } from "../../src/testing/wait.js";
import type { AgentImageSourceLoadResult } from "../src/console-page/managed-attachment-port.js";
import type { ManagedAttachmentClient } from "../src/console-page/managed-attachment-port.js";
import { useAgentImagePreviews } from "../src/console-page/use-agent-image-previews.js";

vi.mock("../src/console-page/attachment-preview.js", () => ({
  createBoundedPngPreviews: async () => ({ thumbnail: new Blob(["t"]), large: new Blob(["l"]) }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useAgentImagePreviews", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it("loads candidates with bounded concurrency and exposes ready preview URLs", async () => {
    const calls: string[] = [];
    let active = 0;
    let peak = 0;
    const client = attachmentClient({
      loadAgentImageSource: vi.fn(async ({ path }): Promise<AgentImageSourceLoadResult> => {
        active += 1;
        peak = Math.max(peak, active);
        calls.push(path);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { ok: true, mediaType: "image/png", blob: new Blob() };
      }),
    });
    const messages = agentMessages([
      "/docs/one.png",
      "/docs/two.png",
      "/docs/three.png",
      "/docs/four.png",
      "/docs/five.png",
      "/docs/six.png",
    ]);
    await act(async () => root.render(<Harness client={client} messages={messages} />));
    await waitForCondition(() => host.textContent?.includes("ready:6") === true, {
      timeoutMs: 3_000,
      pollMs: 10,
      tick: async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      describe: "agent image previews settle",
      snapshot: () => ({ text: host.textContent }),
    });
    expect(calls).toEqual([
      "/docs/one.png",
      "/docs/two.png",
      "/docs/three.png",
      "/docs/four.png",
      "/docs/five.png",
      "/docs/six.png",
    ]);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("drops late responses after the message set changes and revokes removed URLs", async () => {
    const revoke = vi.mocked(URL.revokeObjectURL);
    const slow = new Map<string, (result: AgentImageSourceLoadResult) => void>();
    const client = attachmentClient({
      loadAgentImageSource: vi.fn(async ({ path, signal }): Promise<AgentImageSourceLoadResult> => {
        signal.addEventListener("abort", () => {
          const resolve = slow.get(path);
          slow.delete(path);
          if (resolve !== undefined) resolve({ ok: false, reason: "unavailable" });
        });
        return await new Promise<AgentImageSourceLoadResult>((resolve) => {
          slow.set(path, resolve);
        });
      }),
    });
    await act(async () => root.render(<Harness client={client} messages={agentMessages(["/docs/a.png"])} />));
    await waitForCondition(() => slow.size === 1, {
      timeoutMs: 2_000,
      pollMs: 10,
      tick: async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      describe: "first request in flight",
      snapshot: () => ({ text: host.textContent }),
    });
    await act(async () => root.render(<Harness client={client} messages={agentMessages([])} />));
    await waitForCondition(() => slow.size === 0, {
      timeoutMs: 2_000,
      pollMs: 10,
      tick: async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      describe: "abort settles in-flight request",
      snapshot: () => ({ text: host.textContent }),
    });
    expect(revoke).not.toHaveBeenCalled();

    const client2 = attachmentClient({
      loadAgentImageSource: vi.fn(async (): Promise<AgentImageSourceLoadResult> => ({
        ok: true,
        mediaType: "image/png",
        blob: new Blob(),
      })),
    });
    await act(async () => root.render(<Harness client={client2} messages={agentMessages(["/docs/b.png"])} />));
    await waitForCondition(() => host.textContent?.includes("ready:1") === true, {
      timeoutMs: 2_000,
      pollMs: 10,
      tick: async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      describe: "second batch becomes ready",
      snapshot: () => ({ text: host.textContent }),
    });
    await act(async () => root.render(<Harness client={client2} messages={agentMessages([])} />));
    await waitForCondition(() => revoke.mock.calls.length >= 1, {
      timeoutMs: 2_000,
      pollMs: 10,
      tick: async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      describe: "removed preview URL is revoked",
      snapshot: () => ({ text: host.textContent }),
    });
  });

  it("maps structured unavailability to missing and other failures to failed", async () => {
    const client = attachmentClient({
      loadAgentImageSource: vi.fn(async ({ path }): Promise<AgentImageSourceLoadResult> =>
        path === "/docs/evil.png"
          ? { ok: false, reason: "not-image" }
          : path === "/docs/boom.png"
            ? { ok: false, reason: "unavailable" }
            : { ok: true, mediaType: "image/png", blob: new Blob() }),
    });
    await act(async () => root.render(
      <Harness client={client} messages={agentMessages(["/docs/evil.png", "/docs/boom.png", "/docs/good.png"])} />,
    ));
    await waitForCondition(() => host.textContent?.includes("missing:1") === true
      && host.textContent?.includes("failed:1") === true
      && host.textContent?.includes("ready:1") === true, {
      timeoutMs: 3_000,
      pollMs: 10,
      tick: async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      describe: "mixed preview outcomes settle",
      snapshot: () => ({ text: host.textContent }),
    });
  });
});

function Harness({
  client,
  messages,
}: {
  client: ManagedAttachmentClient;
  messages: OperatorMessage[];
}): JSX.Element {
  const states = useAgentImagePreviews({
    client,
    messages,
    apiBase: "http://127.0.0.1:8787/",
    capability: "test-capability",
  });
  const counts = Object.values(states).reduce<Record<string, number>>((acc, state) => {
    acc[state.status] = (acc[state.status] ?? 0) + 1;
    return acc;
  }, {});
  return <div>
    <span>ready:{counts.ready ?? 0}</span>
    <span>missing:{counts.missing ?? 0}</span>
    <span>failed:{counts.failed ?? 0}</span>
    <span>loading:{counts.loading ?? 0}</span>
  </div>;
}

function agentMessages(paths: string[]): OperatorMessage[] {
  return [{
    id: 1,
    sessionId: "session-a",
    speaker: "agent",
    role: "dev",
    body: paths.map((path) => `见 ${path}。`).join("\n"),
    status: "completed",
    runId: null,
    runDir: null,
    error: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }];
}

function attachmentClient(overrides: Partial<ManagedAttachmentClient>): ManagedAttachmentClient {
  return {
    upload: vi.fn(async () => { throw new Error("unused"); }),
    listDraft: vi.fn(async () => []),
    cloneMessage: vi.fn(async () => []),
    removeDraft: vi.fn(async () => undefined),
    loadPreview: vi.fn(async () => new Blob()),
    loadAgentImageSource: vi.fn(async (): Promise<import("../src/console-page/managed-attachment-port.js").AgentImageSourceLoadResult> => ({
      ok: true,
      mediaType: "image/png",
      blob: new Blob(),
    })),
    ...overrides,
  };
}