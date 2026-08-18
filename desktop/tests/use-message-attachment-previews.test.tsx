/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorMessage } from "@moebius/console-ui";

import { waitForCondition } from "../../src/testing/wait.js";
import type { ManagedAttachmentClient } from "../src/console-page/managed-attachment-port.js";
import { useMessagesWithAttachmentPreviews } from "../src/console-page/use-message-attachment-previews.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useMessagesWithAttachmentPreviews", () => {
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

  it("projects loading, ready, and failed preview states onto message attachments", async () => {
    const client = attachmentClient({
      loadPreview: vi.fn(async ({ attachmentId }) => {
        if (attachmentId === "broken") throw new Error("read failed");
        return new Blob(["png"]);
      }),
    });
    await act(async () => root.render(
      <Harness client={client} messages={messageWithAttachments(["fine", "broken"])} />,
    ));
    await waitForCondition(() => host.textContent?.includes("fine:ready") === true
      && host.textContent?.includes("broken:failed") === true, {
      timeoutMs: 2_000,
      pollMs: 10,
      tick: async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      describe: "preview states settle",
      snapshot: () => ({ text: host.textContent }),
    });
    expect(host.textContent).toContain("fine:ready");
    expect(host.textContent).toContain("broken:failed");
  });

  it("revokes removed preview URLs when the message set changes", async () => {
    const revoke = vi.mocked(URL.revokeObjectURL);
    const client = attachmentClient({
      loadPreview: vi.fn(async () => new Blob(["png"])),
    });
    await act(async () => root.render(
      <Harness client={client} messages={messageWithAttachments(["a"])} />,
    ));
    await waitForCondition(() => host.textContent?.includes("a:ready") === true, {
      timeoutMs: 2_000,
      pollMs: 10,
      tick: async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      describe: "first preview ready",
      snapshot: () => ({ text: host.textContent }),
    });
    const before = revoke.mock.calls.length;
    await act(async () => root.render(<Harness client={client} messages={[]} />));
    await waitForCondition(() => revoke.mock.calls.length > before, {
      timeoutMs: 2_000,
      pollMs: 10,
      tick: async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      describe: "removed preview revoked",
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
  const withPreviews = useMessagesWithAttachmentPreviews({
    client,
    messages,
    apiBase: "http://127.0.0.1:8787/",
    capability: "test-capability",
  });
  const labels = withPreviews.flatMap((message) => (message.attachments ?? []).map((attachment) =>
    `${attachment.attachmentId}:${attachment.previewStatus ?? "none"}`));
  return <div>{labels.join(",")}</div>;
}

function messageWithAttachments(attachmentIds: string[]): OperatorMessage[] {
  return [{
    id: 1,
    sessionId: "session-a",
    speaker: "user",
    role: null,
    body: "",
    status: "completed",
    runId: null,
    runDir: null,
    error: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    attachments: attachmentIds.map((attachmentId) => ({
      attachmentId,
      kind: "image",
      displayName: `${attachmentId}.png`,
      mediaType: "image/png",
      byteSize: 1,
    })),
  }];
}

function attachmentClient(overrides: Partial<ManagedAttachmentClient>): ManagedAttachmentClient {
  return {
    upload: vi.fn(async () => { throw new Error("unused"); }),
    listDraft: vi.fn(async () => []),
    cloneMessage: vi.fn(async () => []),
    removeDraft: vi.fn(async () => undefined),
    loadPreview: vi.fn(async () => new Blob()),
    loadAgentImageSource: vi.fn(async (): Promise<import("../src/console-page/managed-attachment-port.js").AgentImageSourceLoadResult> => ({ ok: true, mediaType: "image/png", blob: new Blob() })),
    ...overrides,
  };
}
