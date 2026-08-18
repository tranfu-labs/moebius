/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StructuredAttachment } from "@moebius/console-ui";

import { waitForCondition } from "../../src/testing/wait.js";
import { managedAttachmentClient } from "../src/console-page/attachment-client.js";
import type { ManagedAttachmentFailureCode } from "../src/console-page/managed-attachment-contract.js";
import type { ManagedAttachmentClient } from "../src/console-page/managed-attachment-port.js";
import { ManagedAttachmentFailure } from "../src/console-page/managed-attachment-model.js";
import { useManagedAttachmentDrafts } from "../src/console-page/use-managed-attachments.js";
import type { SidebarConversationDraftAttachmentPresence } from "../src/console-page/sidebar-conversation-drafts.js";

vi.mock("../src/console-page/attachment-preview.js", () => ({
  createBoundedPngPreviews: async () => null,
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

  it("commits a slow failure through the latest translator and error callback", async () => {
    const slow = deferred<StructuredAttachment[]>();
    const client = attachmentClient({ listDraft: vi.fn(async () => await slow.promise) });
    const firstError = vi.fn();
    const latestError = vi.fn();
    const firstTranslate = vi.fn(() => "first-language");
    const latestTranslate = vi.fn(() => "latest-language");

    await act(async () => root.render(
      <AttachmentHarness
        client={client}
        draftKey="draft:sidebar:a"
        onPresence={vi.fn()}
        onError={firstError}
        translateFailure={firstTranslate}
      />,
    ));
    await waitFor(() => vi.mocked(client.listDraft).mock.calls.length === 1);
    await act(async () => root.render(
      <AttachmentHarness
        client={client}
        draftKey="draft:sidebar:a"
        onPresence={vi.fn()}
        onError={latestError}
        translateFailure={latestTranslate}
      />,
    ));
    await act(async () => slow.reject(new ManagedAttachmentFailure("attachment-draft-restore")));
    await waitFor(() => latestError.mock.calls.length === 1);

    expect(firstTranslate).not.toHaveBeenCalled();
    expect(firstError).not.toHaveBeenCalled();
    expect(latestTranslate).toHaveBeenCalledWith("attachment-draft-restore");
    expect(latestError).toHaveBeenCalledWith("latest-language");
  });

  it("renders a slow upload failure with the latest translator after a parent rerender", async () => {
    const slow = deferred<StructuredAttachment>();
    const client = attachmentClient({
      upload: vi.fn(async () => await slow.promise),
    });
    const firstTranslate = vi.fn(() => "first-upload-language");
    const latestTranslate = vi.fn(() => "latest-upload-language");

    await act(async () => root.render(
      <AttachmentHarness
        client={client}
        draftKey="draft:sidebar:a"
        onPresence={vi.fn()}
        onError={vi.fn()}
        translateFailure={firstTranslate}
      />,
    ));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="add"]')!.click());
    await waitFor(() => vi.mocked(client.upload).mock.calls.length === 1);
    await act(async () => root.render(
      <AttachmentHarness
        client={client}
        draftKey="draft:sidebar:a"
        onPresence={vi.fn()}
        onError={vi.fn()}
        translateFailure={latestTranslate}
      />,
    ));
    await act(async () => slow.reject(new ManagedAttachmentFailure("attachment-upload")));
    await waitFor(() => host.textContent?.includes("latest-upload-language") === true);

    expect(firstTranslate).not.toHaveBeenCalled();
    expect(latestTranslate).toHaveBeenCalledWith("attachment-upload");
  });

  it("ignores an aborted slow failure after the draft owner changes", async () => {
    const slow = deferred<StructuredAttachment[]>();
    const client = attachmentClient({
      listDraft: vi.fn(async ({ draftKey }) => draftKey === "draft:sidebar:a"
        ? await slow.promise
        : []),
    });
    const onError = vi.fn();
    const translateFailure = vi.fn(() => "should-not-commit");

    await act(async () => root.render(
      <AttachmentHarness
        client={client}
        draftKey="draft:sidebar:a"
        onPresence={vi.fn()}
        onError={onError}
        translateFailure={translateFailure}
      />,
    ));
    await waitFor(() => vi.mocked(client.listDraft).mock.calls.length === 1);
    await act(async () => root.render(
      <AttachmentHarness
        client={client}
        draftKey="draft:sidebar:b"
        onPresence={vi.fn()}
        onError={onError}
        translateFailure={translateFailure}
      />,
    ));
    await waitFor(() => vi.mocked(client.listDraft).mock.calls.length === 2);
    await act(async () => slow.reject(new ManagedAttachmentFailure("attachment-draft-restore")));

    expect(translateFailure).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});

function AttachmentHarness({
  draftKey,
  onPresence,
  onError,
  client = managedAttachmentClient,
  translateFailure = (code) => code,
}: {
  draftKey: string;
  onPresence(draftKey: string, presence: SidebarConversationDraftAttachmentPresence): void;
  onError(error: string): void;
  client?: ManagedAttachmentClient;
  translateFailure?: (code: ManagedAttachmentFailureCode) => string;
}): JSX.Element {
  const managed = useManagedAttachmentDrafts({
    client,
    apiBase: "http://127.0.0.1:8787/",
    capability: "test-capability",
    currentDraftKey: draftKey,
    onDraftAttachmentPresenceChange: onPresence,
    onError,
    translateFailure,
  });
  return <div>
    <button aria-label="add" onClick={() => managed.addFiles([
      new File(["new"], "new.txt", { type: "text/plain" }),
    ])}>add</button>
    {managed.attachments.map((item) => <div key={item.clientId}>
      <span>{item.displayName}</span>
      <span>{item.error}</span>
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

function attachmentClient(overrides: Partial<ManagedAttachmentClient>): ManagedAttachmentClient {
  return {
    upload: vi.fn(async () => attachment("uploaded", "uploaded.txt")),
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

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
