/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Translate } from "@moebius/console-ui";

import type { AiTeamBuilderIpcResponse } from "../src/ai-team-builder/contract.js";
import type { AgentTeamListItem } from "../src/team-ipc-contract.js";
import { useAgentTeamBuilderController } from "../src/console-page/use-agent-team-builder.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type BuilderInput = Parameters<typeof useAgentTeamBuilderController>[0];
type BuilderBundle = ReturnType<typeof useAgentTeamBuilderController>;

describe("agent team builder controller", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: BuilderBundle;

  beforeEach(() => {
    window.localStorage.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("uses the latest owner callbacks after rerender while a start response is slow, then exposes failure", async () => {
    const startResult = deferred<AiTeamBuilderIpcResponse>();
    const firstOwner = vi.fn(async () => "user:launch-team");
    const latestOwner = vi.fn(async () => "user:launch-team");
    const firstReplace = vi.fn();
    const latestReplace = vi.fn();
    const api = {
      startAiTeamBuilder: () => startResult.promise,
      listAgentTeams: async () => ({ status: "ready" as const, teams: [launchTeam] }),
    };
    const base = {
      api,
      storage: window.localStorage,
      storageKey: "builder-test",
      createDraftId: () => "draft-1",
      t: translate,
    };

    await act(async () => root.render(
      <Harness input={{ ...base, activateCopiedTeam: firstOwner, replaceTeams: firstReplace }} />,
    ));
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = latest.onStart();
      await Promise.resolve();
    });
    await act(async () => root.render(
      <Harness input={{ ...base, activateCopiedTeam: latestOwner, replaceTeams: latestReplace }} />,
    ));
    await act(async () => {
      startResult.resolve({ ok: true, state: selectedBuilderState });
      await pending;
    });

    expect(firstOwner).not.toHaveBeenCalled();
    expect(firstReplace).not.toHaveBeenCalled();
    expect(latestOwner).toHaveBeenCalledWith(launchTeam);
    expect(latestReplace).toHaveBeenCalledOnce();

    const failedApi = {
      ...api,
      startAiTeamBuilder: async () => Promise.reject(new Error("offline")),
    };
    await act(async () => root.render(
      <Harness input={{
        ...base,
        api: failedApi,
        activateCopiedTeam: latestOwner,
        replaceTeams: latestReplace,
      }} />,
    ));
    await act(async () => {
      await latest.onStart();
    });
    expect(latest.state).toMatchObject({
      phase: "failed",
      error: { code: "temporarily-unavailable", canRetry: true },
    });
  });

  function Harness(props: { input: BuilderInput }): null {
    latest = useAgentTeamBuilderController(props.input);
    return null;
  }
});

const translate = ((key: string) => key) as Translate;

const launchTeam = {
  id: "launch-team",
  ownership: "user",
  definition: {
    name: "Launch team",
    description: "Ships releases",
    primaryAgentSlug: "lead",
    memberOrder: ["lead"],
  },
  members: [{ slug: "lead", displayName: "Lead", description: "Owns launch" }],
  status: "usable",
  canCreateConversation: true,
  issues: [],
} as AgentTeamListItem;

const selectedBuilderState = {
  builderCli: null,
  phase: "selected" as const,
  messages: [],
  proposal: null,
  proposalRevision: null,
  error: null,
  actions: [],
  selectedTeamId: "launch-team",
};

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
