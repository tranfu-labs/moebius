/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorAgentTeamsState, Translate } from "@moebius/console-ui";

import type { AgentTeamCatalogBundle } from "../src/console-page/use-agent-team-catalog.js";
import { useAgentTeamProfile } from "../src/console-page/use-agent-team-profile.js";
import type { AgentTeamListItem } from "../src/team-ipc-contract.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ProfileInput = Parameters<typeof useAgentTeamProfile>[0];
type ProfileBundle = ReturnType<typeof useAgentTeamProfile>;

describe("agent team profile controller", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: ProfileBundle;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("commits a slow primary-agent response to the latest catalog owner and keeps failure target-owned", async () => {
    const response = deferred<AgentTeamListItem>();
    const firstCommit = vi.fn();
    const latestCommit = vi.fn();
    const api = { setAgentTeamPrimaryAgent: async () => response.promise };
    await act(async () => root.render(<Harness input={{ api, catalog: catalog(firstCommit), t: translate }} />));
    let pending!: Promise<void>;
    await act(async () => {
      pending = latest.changePrimaryAgent("user:launch", "editor");
      await Promise.resolve();
    });
    await act(async () => root.render(
      <Harness input={{ api, catalog: catalog(latestCommit), t: translate }} />,
    ));
    await act(async () => {
      response.resolve(teamItem("editor"));
      await pending;
    });
    expect(firstCommit).not.toHaveBeenCalled();
    expect(latestCommit).toHaveBeenCalledOnce();
    expect(latest.primaryAgentChange).toMatchObject({ teamKey: "user:launch", status: "saved" });

    await act(async () => root.render(<Harness input={{
      api: { setAgentTeamPrimaryAgent: async () => Promise.reject(new Error("offline")) },
      catalog: catalog(latestCommit),
      t: translate,
    }} />));
    await act(async () => latest.changePrimaryAgent("user:launch", "editor"));
    expect(latest.primaryAgentChange).toMatchObject({
      teamKey: "user:launch",
      status: "failed",
      error: "offline",
    });
  });

  function Harness(props: { input: ProfileInput }): null {
    latest = useAgentTeamProfile(props.input);
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
    memberOrder: ["lead", "editor"],
    members: [
      { slug: "lead", displayName: "Lead", description: "Ships", available: true },
      { slug: "editor", displayName: "Editor", description: "Edits", available: true },
    ],
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
    replaceTeams: () => undefined,
    refresh: () => undefined,
  };
}

function teamItem(primaryAgentSlug: string): AgentTeamListItem {
  return {
    id: "launch",
    ownership: "user",
    definition: {
      name: "Launch",
      description: "Ships",
      primaryAgentSlug,
      memberOrder: ["lead", "editor"],
    },
    members: [
      { slug: "lead", displayName: "Lead", description: "Ships" },
      { slug: "editor", displayName: "Editor", description: "Edits" },
    ],
    status: "usable",
    canCreateConversation: true,
    issues: [],
  };
}

const translate = ((key: string) => key) as Translate;

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
