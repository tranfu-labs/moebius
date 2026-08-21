/** @vitest-environment jsdom */

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorAgentTeamsState } from "@moebius/console-ui";

import type { AgentTeamCatalogBundle } from "../src/console-page/use-agent-team-catalog.js";
import { useAgentTeamNavigation } from "../src/console-page/use-agent-team-navigation.js";
import type { useAgentTeamMemberEditor } from "../src/console-page/use-agent-team-member-editor.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type NavigationBundle = ReturnType<typeof useAgentTeamNavigation>;
type ReadyTeams = Extract<OperatorAgentTeamsState, { status: "ready" }>["teams"];

describe("agent team navigation", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: NavigationBundle;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("opens a team that is already in the catalog immediately", async () => {
    const setSelection = vi.fn();
    const { setCatalogState } = await renderHarness({
      initialTeams: [teamWith("user:launch")],
      setSelection,
    });

    await act(async () => latest.open("user:launch"));

    expect(latest.activeTeamKey).toBe("user:launch");
    // Opening a team selects its first member.
    expect(setSelection).toHaveBeenCalledWith({ teamKey: "user:launch", memberSlug: "lead" });
    void setCatalogState;
  });

  it("keeps a pending open intent until the team reaches the catalog, then opens it", async () => {
    const setSelection = vi.fn();
    const { setCatalogState } = await renderHarness({ initialTeams: [], setSelection });

    await act(async () => latest.open("user:launch"));
    expect(latest.activeTeamKey).toBeNull();

    // The catalog refresh lands with the new team (e.g. right after a GitHub
    // install); the pending intent must open it without another click.
    await act(async () => setCatalogState({ status: "ready", teams: [teamWith("user:launch")] }));
    expect(latest.activeTeamKey).toBe("user:launch");
    expect(setSelection).toHaveBeenCalledWith({ teamKey: "user:launch", memberSlug: "lead" });
  });

  it("drops a pending open intent on close", async () => {
    const { setCatalogState } = await renderHarness({ initialTeams: [] });

    await act(async () => latest.open("user:launch"));
    await act(async () => latest.close());
    await act(async () => setCatalogState({ status: "ready", teams: [teamWith("user:launch")] }));
    expect(latest.activeTeamKey).toBeNull();
  });

  it("opens the requested member as one navigation intent", async () => {
    const setSelection = vi.fn();
    const loadMember = vi.fn();
    await renderHarness({
      initialTeams: [teamWith("user:launch", ["lead", "qa"])],
      setSelection,
      loadMember,
    });

    await act(async () => latest.openMember("user:launch", "qa"));

    expect(latest.activeTeamKey).toBe("user:launch");
    expect(setSelection).toHaveBeenCalledWith({ teamKey: "user:launch", memberSlug: "qa" });
    expect(loadMember).toHaveBeenCalledWith("user:launch", "qa");
  });

  it("keeps a requested member intent until the team reaches the catalog", async () => {
    const setSelection = vi.fn();
    const loadMember = vi.fn();
    const { setCatalogState } = await renderHarness({
      initialTeams: [],
      setSelection,
      loadMember,
    });

    await act(async () => latest.openMember("user:launch", "qa"));
    expect(latest.activeTeamKey).toBeNull();

    await act(async () => setCatalogState({
      status: "ready",
      teams: [teamWith("user:launch", ["lead", "qa"])],
    }));

    expect(latest.activeTeamKey).toBe("user:launch");
    expect(setSelection).toHaveBeenCalledWith({ teamKey: "user:launch", memberSlug: "qa" });
    expect(loadMember).toHaveBeenCalledWith("user:launch", "qa");
  });

  it("keeps the newest requested member when navigation is re-entered before catalog load", async () => {
    const setSelection = vi.fn();
    const loadMember = vi.fn();
    const { setCatalogState } = await renderHarness({
      initialTeams: [],
      setSelection,
      loadMember,
    });

    await act(async () => {
      latest.openMember("user:launch", "qa");
      latest.openMember("user:launch", "lead");
    });
    await act(async () => setCatalogState({
      status: "ready",
      teams: [teamWith("user:launch", ["lead", "qa"])],
    }));

    expect(setSelection).toHaveBeenLastCalledWith({ teamKey: "user:launch", memberSlug: "lead" });
    expect(loadMember).toHaveBeenLastCalledWith("user:launch", "lead");
  });

  it("keeps the team open without guessing when the requested member is gone", async () => {
    const setSelection = vi.fn();
    const loadMember = vi.fn();
    await renderHarness({
      initialTeams: [teamWith("user:launch")],
      setSelection,
      loadMember,
    });

    await act(async () => latest.openMember("user:launch", "qa"));

    expect(latest.activeTeamKey).toBe("user:launch");
    expect(setSelection).toHaveBeenCalledWith({ teamKey: "user:launch", memberSlug: null });
    expect(loadMember).not.toHaveBeenCalled();
  });

  async function renderHarness(input: {
    initialTeams: ReadyTeams;
    setSelection?: ReturnType<typeof vi.fn>;
    loadMember?: ReturnType<typeof vi.fn>;
  }): Promise<{ setCatalogState: (state: OperatorAgentTeamsState) => void }> {
    let setCatalogState: (state: OperatorAgentTeamsState) => void = () => undefined;
    const setSelection = input.setSelection ?? vi.fn();
    const loadMember = input.loadMember ?? vi.fn();
    const StatefulHarness = (): null => {
      const [catalogState, setState] = useState<OperatorAgentTeamsState>({
        status: "ready",
        teams: input.initialTeams,
      });
      setCatalogState = setState;
      const catalog = catalogBundle(catalogState, setState, setSelection);
      latest = useAgentTeamNavigation({ catalog, member: memberBundle(loadMember) });
      return null;
    };
    await act(async () => root.render(<StatefulHarness />));
    return { setCatalogState };
  }
});

function teamWith(teamKey: string, memberSlugs = ["lead"]): ReadyTeams[number] {
  return {
    teamKey,
    id: teamKey.split(":")[1]!,
    ownership: "user",
    name: "Launch",
    description: null,
    primaryAgentSlug: "lead",
    memberOrder: memberSlugs,
    members: memberSlugs.map((slug) => ({
      slug,
      displayName: slug === "lead" ? "Lead" : "QA",
      description: "Ships",
      available: true,
    })),
    status: "usable",
    canCreateConversation: true,
    canEditContent: true,
    canDeleteTeam: true,
    issues: [],
  };
}

function catalogBundle(
  state: OperatorAgentTeamsState,
  setState: (state: OperatorAgentTeamsState) => void,
  setSelection: ReturnType<typeof vi.fn>,
): AgentTeamCatalogBundle {
  return {
    state,
    setState: (update) => {
      const next = typeof update === "function" ? update(state) : update;
      setState(next as OperatorAgentTeamsState);
    },
    lastUsedTeamKey: null,
    setLastUsedTeamKey: () => undefined,
    selection: null,
    setSelection,
    replaceTeams: () => undefined,
    refresh: () => undefined,
  };
}

function memberBundle(loadMember: ReturnType<typeof vi.fn>): ReturnType<typeof useAgentTeamMemberEditor> {
  return {
    setSaveAllFailures: () => undefined,
    loadMember,
  } as unknown as ReturnType<typeof useAgentTeamMemberEditor>;
}
