/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { waitForCondition } from "../../src/testing/wait.js";
import { managedAttachmentClient } from "../src/console-page/attachment-client.js";
import { useManagedAttachmentDrafts } from "../src/console-page/use-managed-attachments.js";
import type { SidebarConversationDraftAttachmentPresence } from "../src/console-page/sidebar-conversation-drafts.js";

vi.mock("../src/console-page/attachment-preview.js", () => ({
  createBoundedPngPreview: async () => null,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("managed attachment draft presence", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "new-client-id") });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("delivers a slow authoritative result to the latest callback and keeps failures unknown", async () => {
    let resolveList!: (response: Response) => void;
    const list = new Promise<Response>((resolve) => {
      resolveList = resolve;
    });
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
      return url.searchParams.get("draftKey") === "draft:sidebar:a"
        ? list
        : Promise.resolve(jsonResponse({ error: "list unavailable" }, 500));
    }));
    const first = vi.fn();
    const latest = vi.fn();
    const onError = vi.fn();

    await act(async () => root.render(
      <AttachmentHarness draftKey="draft:sidebar:a" onPresence={first} onError={onError} />,
    ));
    await waitFor(() => vi.mocked(fetch).mock.calls.length === 1);
    await act(async () => root.render(
      <AttachmentHarness draftKey="draft:sidebar:a" onPresence={latest} onError={onError} />,
    ));
    await act(async () => resolveList(jsonResponse({ attachments: [] })));
    await waitFor(() => latest.mock.calls.length === 1);
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith("draft:sidebar:a", "absent");

    await act(async () => root.render(
      <AttachmentHarness draftKey="draft:sidebar:b" onPresence={latest} onError={onError} />,
    ));
    await waitFor(() => onError.mock.calls.length === 1);
    expect(latest).not.toHaveBeenCalledWith("draft:sidebar:b", expect.anything());
  });

  it("keeps restored attachments when add and remove advance only presence generation", async () => {
    let resolveList!: (response: Response) => void;
    const list = new Promise<Response>((resolve) => {
      resolveList = resolve;
    });
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
      const method = init?.method ?? "GET";
      if (method === "GET") return list;
      if (method === "POST") {
        return Promise.resolve(jsonResponse({
          status: "ready",
          attachment: attachment("new-attachment", "new.txt"),
        }));
      }
      if (method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(jsonResponse({ error: "unexpected request" }, 500));
    }));
    const onPresence = vi.fn();
    const onError = vi.fn();

    await act(async () => root.render(
      <AttachmentHarness draftKey="draft:sidebar:a" onPresence={onPresence} onError={onError} />,
    ));
    await waitFor(() => vi.mocked(fetch).mock.calls.length === 1);
    const add = host.querySelector<HTMLButtonElement>('button[aria-label="add"]')!;
    await act(async () => add.click());
    await waitFor(() => host.textContent?.includes("new.txt") === true);
    await waitFor(() => onPresence.mock.calls.some((call) => call[1] === "present"));
    const remove = host.querySelector<HTMLButtonElement>('button[aria-label="remove-new.txt"]')!;
    await act(async () => remove.click());
    expect(host.textContent).not.toContain("new.txt");

    await act(async () => resolveList(jsonResponse({
      attachments: [attachment("server-a", "server-a.txt"), attachment("server-b", "server-b.txt")],
    })));
    await waitFor(() => host.textContent?.includes("server-a.txt") === true
      && host.textContent?.includes("server-b.txt") === true);
    expect(onPresence.mock.calls).toEqual([
      ["draft:sidebar:a", "unknown"],
      ["draft:sidebar:a", "present"],
      ["draft:sidebar:a", "unknown"],
    ]);
    expect(onError).not.toHaveBeenCalled();
  });
});

function AttachmentHarness({
  draftKey,
  onPresence,
  onError,
}: {
  draftKey: string;
  onPresence(draftKey: string, presence: SidebarConversationDraftAttachmentPresence): void;
  onError(error: string): void;
}): JSX.Element {
  const managed = useManagedAttachmentDrafts({
    client: managedAttachmentClient,
    apiBase: "http://127.0.0.1:8787/",
    capability: "test-capability",
    currentDraftKey: draftKey,
    onDraftAttachmentPresenceChange: onPresence,
    onError,
  });
  return <div>
    <button aria-label="add" onClick={() => managed.addFiles([
      new File(["new"], "new.txt", { type: "text/plain" }),
    ])}>add</button>
    {managed.attachments.map((item) => <div key={item.clientId}>
      <span>{item.displayName}</span>
      <button aria-label={`remove-${item.displayName}`} onClick={() => managed.remove(item.clientId)}>
        remove
      </button>
    </div>)}
  </div>;
}

function attachment(attachmentId: string, displayName: string) {
  return {
    attachmentId,
    kind: "file" as const,
    displayName,
    mediaType: "text/plain",
    byteSize: 3,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  await waitForCondition(predicate, {
    timeoutMs,
    pollMs: 10,
    tick: async (ms) => act(async () => new Promise((resolve) => setTimeout(resolve, ms))),
    describe: "managed attachment harness condition",
    snapshot: () => ({ text: document.body.textContent }),
  });
}
