/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorAgentTeamsState, Translate } from "@moebius/console-ui";

import { updateAgentTeamMemberDraft } from "../src/console-page/team-state.js";
import type { AgentTeamCatalogBundle } from "../src/console-page/use-agent-team-catalog.js";
import { useAgentTeamMemberEditor } from "../src/console-page/use-agent-team-member-editor.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type EditorInput = Parameters<typeof useAgentTeamMemberEditor>[0];
type EditorBundle = ReturnType<typeof useAgentTeamMemberEditor>;

describe("agent team member editor controller", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: EditorBundle;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("commits a slow save to the latest catalog owner after rerender and exposes later failure", async () => {
    const saved = deferred<ReturnType<typeof memberDocument>>();
    const firstCatalogCommit = vi.fn();
    const latestCatalogCommit = vi.fn();
    const api = {
      readAgentTeamMember: async () => memberDocument(),
      writeAgentTeamMember: async () => saved.promise,
    };
    await act(async () => root.render(<Harness input={{
      api,
      catalog: catalog(firstCatalogCommit),
      t: translate,
    }} />));
    await act(async () => latest.loadMember("user:launch", "lead"));
    await act(async () => latest.commitDrafts(updateAgentTeamMemberDraft(
      latest.draftsRef.current,
      "user:launch",
      "lead",
      "# Lead\n\nChanged",
    )));

    let pending!: Promise<void>;
    await act(async () => {
      pending = latest.saveMember("user:launch", "lead");
      await Promise.resolve();
    });
    await act(async () => root.render(<Harness input={{
      api,
      catalog: catalog(latestCatalogCommit),
      t: translate,
    }} />));
    await act(async () => {
      saved.resolve(memberDocument("# Lead\n\nChanged"));
      await pending;
    });

    expect(firstCatalogCommit).not.toHaveBeenCalled();
    expect(latestCatalogCommit).toHaveBeenCalledOnce();
    expect(latest.draftsRef.current.membersByKey["user:launch\u0000lead"]).toMatchObject({
      saveStatus: "idle",
      savedMarkdown: "# Lead\n\nChanged",
    });

    await act(async () => latest.commitDrafts(updateAgentTeamMemberDraft(
      latest.draftsRef.current,
      "user:launch",
      "lead",
      "# Lead\n\nFails",
    )));
    await act(async () => root.render(<Harness input={{
      api: { ...api, writeAgentTeamMember: async () => Promise.reject(new Error("offline")) },
      catalog: catalog(latestCatalogCommit),
      t: translate,
    }} />));
    await act(async () => latest.saveMember("user:launch", "lead"));
    expect(latest.draftsRef.current.membersByKey["user:launch\u0000lead"]).toMatchObject({
      saveStatus: "failed",
      saveError: "offline",
    });
  });

  function Harness(props: { input: EditorInput }): null {
    latest = useAgentTeamMemberEditor(props.input);
    return null;
  }
});

const teamState: OperatorAgentTeamsState = {
  status: "ready",
  teams: [{
    teamKey: "user:launch",
    id: "launch",
    ownership: "user",
    name: "Launch",
    description: null,
    primaryAgentSlug: "lead",
    memberOrder: ["lead"],
    members: [{ slug: "lead", displayName: "Lead", description: "Ships", available: true }],
    status: "usable",
    canCreateConversation: true,
    canEditContent: true,
    canDeleteTeam: true,
    issues: [],
  }],
};

function catalog(commit: ReturnType<typeof vi.fn>): AgentTeamCatalogBundle {
  return {
    state: teamState,
    setState: (update) => {
      commit();
      if (typeof update === "function") update(teamState);
    },
    lastUsedTeamKey: null,
    setLastUsedTeamKey: () => undefined,
    selection: null,
    setSelection: () => undefined,
    refresh: () => undefined,
  };
}

function memberDocument(agentMarkdown = "# Lead\n\nOriginal") {
  return {
    slug: "lead",
    displayName: "Lead",
    description: "Ships",
    available: true,
    agentMarkdown,
  };
}

const translate = ((key: string) => key) as Translate;

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
