/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Translate } from "@moebius/console-ui";

import { createNewConversationDraft } from "../src/console-page/new-conversation.js";
import { useNewConversationSubmission } from "../src/console-page/use-new-conversation-submission.js";
import { createTestConsoleErrorSetter } from "./console-error-test-controller.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SubmissionBundle = ReturnType<typeof useNewConversationSubmission>;
type SubmissionArguments = Parameters<typeof useNewConversationSubmission>;

describe("new conversation submission controller", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: SubmissionBundle;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("keeps route, draft, and selection intact when a slow creation fails after its owner rerenders", async () => {
    const creation = deferred<{ sessionId: string } | null>();
    const initial = input(() => creation.promise, "initial");
    const replacement = input(async () => ({ sessionId: "replacement" }), "replacement");
    await render(initial);

    let pending!: Promise<void>;
    act(() => { pending = latest.createConversation(); });
    expect(initial.dispatch).toHaveBeenCalledWith({ type: "submit-started" });
    expect(initial.createSession).toHaveBeenCalledOnce();

    await render(replacement);
    await act(async () => {
      creation.resolve(null);
      await pending;
    });

    expect(replacement.createSession).not.toHaveBeenCalled();
    expect(replacement.dispatch).toHaveBeenCalledWith({
      type: "submit-failed",
      error: "replacement:desktop.error.conversationCreate",
    });
    for (const owner of [initial, replacement]) {
      expect(owner.rememberSelection).not.toHaveBeenCalled();
      expect(owner.commitRoute).not.toHaveBeenCalled();
      expect(owner.clearDraft).not.toHaveBeenCalled();
      expect(owner.clearAttachments).not.toHaveBeenCalled();
      expect(owner.activateComposer).not.toHaveBeenCalled();
    }
  });

  async function render(next: SubmissionInput): Promise<void> {
    await act(async () => root.render(<Harness input={next} />));
  }

  function Harness(props: { input: SubmissionInput }): null {
    const value = props.input;
    latest = useNewConversationSubmission(
      value.state,
      value.dispatch,
      value.catalog,
      value.attachments,
      ["attachment-ready"],
      false,
      { createSessionWithFirstMessage: value.createSession },
      { current: false },
      value.rememberSelection,
      value.commitRoute,
      value.draftStore,
      value.activateComposer,
      undefined,
      value.setError,
      value.t,
    );
    return null;
  }
});

interface SubmissionInput {
  state: SubmissionArguments[0];
  dispatch: SubmissionArguments[1];
  catalog: SubmissionArguments[2];
  attachments: SubmissionArguments[3];
  createSession: SubmissionArguments[6]["createSessionWithFirstMessage"];
  rememberSelection: SubmissionArguments[8];
  commitRoute: SubmissionArguments[9];
  draftStore: SubmissionArguments[10];
  activateComposer: SubmissionArguments[11];
  setError: SubmissionArguments[13];
  t: SubmissionArguments[14];
  clearDraft: ReturnType<typeof vi.fn>;
  clearAttachments: ReturnType<typeof vi.fn>;
}

function input(
  createSession: SubmissionInput["createSession"],
  owner: string,
): SubmissionInput {
  const clearDraft = vi.fn();
  const clearAttachments = vi.fn();
  return {
    state: createNewConversationDraft({
      projectId: "project-a",
      teamKey: "system:development",
      draft: "保留失败草稿",
    }),
    dispatch: vi.fn(),
    catalog: {
      state: {
        status: "ready",
        teams: [{
          teamKey: "system:development",
          id: "development",
          ownership: "system",
          createdAt: null,
          officialSourceName: null,
          name: "开发团队",
          description: null,
          primaryAgentSlug: "dev",
          memberOrder: [],
          members: [],
          status: "usable",
          canCreateConversation: true,
          canEditContent: false,
          canDeleteTeam: false,
          issues: [],
          officialManagement: null,
        }],
      },
      setState: vi.fn(),
      lastUsedTeamKey: null,
      setLastUsedTeamKey: vi.fn(),
      selection: null,
      setSelection: vi.fn(),
      refresh: vi.fn(),
    } as unknown as SubmissionArguments[2],
    attachments: { clearDraft: clearAttachments } as unknown as SubmissionArguments[3],
    createSession: vi.fn(createSession),
    rememberSelection: vi.fn(),
    commitRoute: vi.fn(),
    draftStore: { clear: clearDraft } as unknown as SubmissionArguments[10],
    activateComposer: vi.fn(),
    setError: createTestConsoleErrorSetter(vi.fn()),
    t: ((key: string) => `${owner}:${key}`) as Translate,
    clearDraft,
    clearAttachments,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
