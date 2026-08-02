/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorAgentTeamsState, Translate } from "@moebius/console-ui";

import type { AgentTeamCatalogBundle } from "../src/console-page/use-agent-team-catalog.js";
import { useAgentTeamCopy } from "../src/console-page/use-agent-team-copy.js";
import { useAgentTeamMemberMutations } from "../src/console-page/use-agent-team-member-mutations.js";
import { useAgentTeamRecordMutations } from "../src/console-page/use-agent-team-record-mutations.js";
import type { AgentTeamListItem, AgentTeamMemberAddResponse } from "../src/team-ipc-contract.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type RecordInput = Parameters<typeof useAgentTeamRecordMutations>[0];
type RecordBundle = ReturnType<typeof useAgentTeamRecordMutations>;
type CopyInput = Parameters<typeof useAgentTeamCopy>[0];
type CopyBundle = ReturnType<typeof useAgentTeamCopy>;
type MemberInput = Parameters<typeof useAgentTeamMemberMutations>[0];
type MemberBundle = ReturnType<typeof useAgentTeamMemberMutations>;

describe("agent team record mutation controller", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: RecordBundle;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("commits a slow update through the latest parent ports and reports a missing operation", async () => {
    const response = deferred<AgentTeamListItem>();
    const firstCommit = vi.fn();
    const latestCommit = vi.fn();
    const api = { updateAgentTeamInformation: async () => response.promise };
    await act(async () => root.render(<Harness input={recordInput(api, firstCommit)} />));
    let pending!: Promise<void>;
    await act(async () => {
      pending = latest.updateInformation("user:launch", { name: "Renamed", description: "Next" });
      await Promise.resolve();
    });
    await act(async () => root.render(<Harness input={recordInput({}, latestCommit)} />));
    await act(async () => {
      response.resolve(teamItem("Renamed"));
      await pending;
    });
    expect(firstCommit).not.toHaveBeenCalled();
    expect(latestCommit).toHaveBeenCalledOnce();

    await expect(latest.updateInformation(
      "user:launch",
      { name: "Unavailable", description: "" },
    )).rejects.toThrow("desktop.error.updateTeam");
  });

  function Harness(props: { input: RecordInput }): null {
    latest = useAgentTeamRecordMutations(props.input);
    return null;
  }
});

describe("agent team copy controller", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: CopyBundle;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("activates a slow duplicate with the latest catalog, draft, and navigation owners", async () => {
    const response = deferred<AgentTeamListItem>();
    const firstCommit = vi.fn();
    const latestCommit = vi.fn();
    const firstDraftCommit = vi.fn();
    const latestDraftCommit = vi.fn();
    const latestActivation = vi.fn();
    await act(async () => root.render(<Harness input={copyInput({
      duplicateUserAgentTeam: async () => response.promise,
    }, firstCommit, firstDraftCommit, vi.fn())} />));
    let pending!: Promise<string>;
    await act(async () => {
      pending = latest.duplicateUser("user:launch");
      await Promise.resolve();
    });
    await act(async () => root.render(<Harness input={copyInput({
      readAgentTeamMember: async () => ({
        slug: "lead",
        displayName: "Lead",
        description: "Ships",
        agentMarkdown: "# Lead",
      }),
    }, latestCommit, latestDraftCommit, latestActivation)} />));
    await act(async () => {
      response.resolve(teamItem("Launch copy"));
      await pending;
    });
    expect(firstCommit).not.toHaveBeenCalled();
    expect(firstDraftCommit).not.toHaveBeenCalled();
    expect(latestCommit).toHaveBeenCalledOnce();
    expect(latestDraftCommit).toHaveBeenCalledTimes(2);
    expect(latestActivation).toHaveBeenCalledWith("user:launch", "lead");

    await expect(latest.duplicateUser("user:launch"))
      .rejects.toThrow("desktop.error.duplicateUserTeam");
  });

  function Harness(props: { input: CopyInput }): null {
    latest = useAgentTeamCopy(props.input);
    return null;
  }
});

describe("agent team member mutation controller", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: MemberBundle;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("commits a slow duplicate to latest owners and preserves failure behavior", async () => {
    const response = deferred<AgentTeamMemberAddResponse>();
    const firstCommit = vi.fn();
    const latestCommit = vi.fn();
    const firstDraftCommit = vi.fn();
    const latestDraftCommit = vi.fn();
    const latestActivation = vi.fn();
    await act(async () => root.render(<Harness input={memberInput({
      duplicateAgentTeamMember: async () => response.promise,
    }, firstCommit, firstDraftCommit, vi.fn())} />));
    let pending!: Promise<void>;
    await act(async () => {
      pending = latest.duplicateMember("user:launch", "lead");
      await Promise.resolve();
    });
    await act(async () => root.render(
      <Harness input={memberInput({}, latestCommit, latestDraftCommit, latestActivation)} />,
    ));
    await act(async () => {
      response.resolve({
        team: teamItem("Launch"),
        member: {
          slug: "writer",
          displayName: "Writer",
          description: "Writes",
          agentMarkdown: "# Writer",
        },
      });
      await pending;
    });
    expect(firstCommit).not.toHaveBeenCalled();
    expect(firstDraftCommit).not.toHaveBeenCalled();
    expect(latestCommit).toHaveBeenCalledOnce();
    expect(latestDraftCommit).toHaveBeenCalledOnce();
    expect(latestActivation).toHaveBeenCalledWith("user:launch", "writer");

    await expect(latest.duplicateMember("user:launch", "lead"))
      .rejects.toThrow("desktop.error.duplicateAgent");
  });

  function Harness(props: { input: MemberInput }): null {
    latest = useAgentTeamMemberMutations(props.input);
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

function recordInput(api: RecordInput["api"], commit: ReturnType<typeof vi.fn>): RecordInput {
  return {
    api,
    catalog: catalog(commit),
    copy: { assertDraftsResolved: vi.fn() } as unknown as RecordInput["copy"],
    member: {
      draftsRef: { current: { membersByKey: {} } },
      commitDrafts: vi.fn(),
      setSaveAllFailures: vi.fn(),
    } as unknown as RecordInput["member"],
    navigation: {
      activeTeamKey: null,
      activate: vi.fn(),
      close: vi.fn(),
    } as unknown as RecordInput["navigation"],
    profile: { clearPrimaryAgentChange: vi.fn() } as unknown as RecordInput["profile"],
    t: translate,
  };
}

function copyInput(
  api: CopyInput["api"],
  catalogCommit: ReturnType<typeof vi.fn>,
  draftCommit: ReturnType<typeof vi.fn>,
  activate: ReturnType<typeof vi.fn>,
): CopyInput {
  return {
    api,
    catalog: catalog(catalogCommit),
    member: {
      draftsRef: { current: { membersByKey: {} } },
      commitDrafts: draftCommit,
    } as unknown as CopyInput["member"],
    navigation: { activateSelection: activate } as unknown as CopyInput["navigation"],
    t: translate,
  };
}

function memberInput(
  api: MemberInput["api"],
  catalogCommit: ReturnType<typeof vi.fn>,
  draftCommit: ReturnType<typeof vi.fn>,
  activate: ReturnType<typeof vi.fn>,
): MemberInput {
  return {
    api,
    catalog: catalog(catalogCommit),
    copy: { assertDraftsResolved: vi.fn() } as unknown as MemberInput["copy"],
    member: {
      draftsRef: { current: { membersByKey: {} } },
      commitDrafts: draftCommit,
    } as unknown as MemberInput["member"],
    navigation: { activateSelection: activate } as unknown as MemberInput["navigation"],
    t: translate,
  };
}

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

function teamItem(name: string): AgentTeamListItem {
  return {
    id: "launch",
    ownership: "user",
    definition: { name, description: "Next", primaryAgentSlug: "lead", memberOrder: ["lead"] },
    members: [{ slug: "lead", displayName: "Lead", description: "Ships" }],
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
