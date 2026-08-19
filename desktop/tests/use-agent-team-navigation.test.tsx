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

  async function renderHarness(input: {
    initialTeams: ReadyTeams;
    setSelection?: ReturnType<typeof vi.fn>;
  }): Promise<{ setCatalogState: (state: OperatorAgentTeamsState) => void }> {
    let setCatalogState: (state: OperatorAgentTeamsState) => void = () => undefined;
    const setSelection = input.setSelection ?? vi.fn();
    const StatefulHarness = (): null => {
      const [catalogState, setState] = useState<OperatorAgentTeamsState>({
        status: "ready",
        teams: input.initialTeams,
      });
      setCatalogState = setState;
      const catalog = catalogBundle(catalogState, setState, setSelection);
      latest = useAgentTeamNavigation({ catalog, member: memberBundle() });
      return null;
    };
    await act(async () => root.render(<StatefulHarness />));
    return { setCatalogState };
  }
});

function teamWith(teamKey: string): ReadyTeams[number] {
  return {
    teamKey,
    id: teamKey.split(":")[1]!,
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

function memberBundle(): ReturnType<typeof useAgentTeamMemberEditor> {
  return {
    setSaveAllFailures: () => undefined,
    loadMember: () => undefined,
  } as unknown as ReturnType<typeof useAgentTeamMemberEditor>;
}
