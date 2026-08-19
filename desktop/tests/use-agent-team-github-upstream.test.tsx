/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorAgentTeamsState } from "@moebius/console-ui";

import type { AgentTeamCatalogBundle } from "../src/console-page/use-agent-team-catalog.js";
import { useAgentTeamGithubUpstream } from "../src/console-page/use-agent-team-github-upstream.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type UpstreamInput = Parameters<typeof useAgentTeamGithubUpstream>[0];
type UpstreamBundle = ReturnType<typeof useAgentTeamGithubUpstream>;

describe("agent team github upstream controller", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: UpstreamBundle;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("detaches a followed team's upstream and refreshes the catalog", async () => {
    const detachGithubTeamUpstream = vi.fn(async () => ({ status: "detached" as const }));
    const refresh = vi.fn();
    await act(async () => root.render(<Harness input={{
      api: { detachGithubTeamUpstream },
      catalog: catalog({ state: teamStateWithUpstream, refresh }),
    }} />));

    await act(async () => latest.detachUpstream("user:launch"));

    expect(detachGithubTeamUpstream).toHaveBeenCalledWith({ teamId: "launch" });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does not call detach for a team with no upstream repository", async () => {
    const detachGithubTeamUpstream = vi.fn(async () => ({ status: "detached" as const }));
    const refresh = vi.fn();
    await act(async () => root.render(<Harness input={{
      api: { detachGithubTeamUpstream },
      catalog: catalog({ refresh }),
    }} />));

    await act(async () => latest.detachUpstream("user:launch"));

    expect(detachGithubTeamUpstream).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reports the upstream check outcome without touching the catalog", async () => {
    const checkGithubTeamUpstream = vi.fn(async () => ({
      status: "update-available" as const,
      recentSync: null,
      pendingMergeMemberCount: 0,
    }));
    const refresh = vi.fn();
    await act(async () => root.render(<Harness input={{
      api: { checkGithubTeamUpstream },
      catalog: catalog({ state: teamStateWithUpstream, refresh }),
    }} />));

    const result = await act(async () => latest.retryUpstream("user:launch"));

    expect(checkGithubTeamUpstream).toHaveBeenCalledWith({ teamId: "launch" });
    expect(result).toEqual({
      status: "update-available",
      recentSync: null,
      pendingMergeMemberCount: 0,
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("treats a not-following response and an unwired team as unreachable", async () => {
    const checkGithubTeamUpstream = vi.fn(async () => ({ status: "not-following" as const }));
    await act(async () => root.render(<Harness input={{
      api: { checkGithubTeamUpstream },
      catalog: catalog({ state: teamStateWithUpstream }),
    }} />));
    expect(await act(async () => latest.retryUpstream("user:launch"))).toEqual({
      status: "unreachable",
      recentSync: null,
      pendingMergeMemberCount: 0,
    });

    await act(async () => root.render(<Harness input={{ api: { checkGithubTeamUpstream }, catalog: catalog() }} />));
    expect(await act(async () => latest.retryUpstream("user:launch"))).toEqual({
      status: "unreachable",
      recentSync: null,
      pendingMergeMemberCount: 0,
    });
    expect(checkGithubTeamUpstream).toHaveBeenCalledOnce();
  });

  it("syncs the upstream update and refreshes the catalog", async () => {
    const syncGithubTeamUpstream = vi.fn(async () => ({
      status: "applied" as const,
      changedMemberCount: 2,
      pendingMergeMemberCount: 0,
    }));
    const refresh = vi.fn();
    await act(async () => root.render(<Harness input={{
      api: { syncGithubTeamUpstream },
      catalog: catalog({ state: teamStateWithUpstream, refresh }),
    }} />));

    const result = await act(async () => latest.syncUpstream("user:launch"));

    expect(syncGithubTeamUpstream).toHaveBeenCalledWith({ teamId: "launch" });
    expect(result).toEqual({ status: "applied", message: null });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("surfaces a failed sync response with its message", async () => {
    const syncGithubTeamUpstream = vi.fn(async () => ({ status: "failed" as const, message: "boom" }));
    await act(async () => root.render(<Harness input={{
      api: { syncGithubTeamUpstream },
      catalog: catalog({ state: teamStateWithUpstream }),
    }} />));

    await expect(act(async () => latest.syncUpstream("user:launch"))).resolves.toEqual({
      status: "failed",
      message: "boom",
    });
  });

  it("reverts the last sync and refreshes the catalog", async () => {
    const revertGithubTeamSync = vi.fn(async () => ({ status: "reverted" as const }));
    const refresh = vi.fn();
    await act(async () => root.render(<Harness input={{
      api: { revertGithubTeamSync },
      catalog: catalog({ state: teamStateWithUpstream, refresh }),
    }} />));

    const result = await act(async () => latest.revertUpstream("user:launch"));

    expect(revertGithubTeamSync).toHaveBeenCalledWith({ teamId: "launch" });
    expect(result).toBe("reverted");
    expect(refresh).toHaveBeenCalledOnce();
  });

  function Harness(props: { input: UpstreamInput }): null {
    latest = useAgentTeamGithubUpstream(props.input);
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

const teamStateWithUpstream: OperatorAgentTeamsState = {
  ...teamState,
  teams: teamState.teams.map((team) => ({ ...team, upstreamRepository: "someone/moebius-team" })),
};

function catalog(input: { state?: OperatorAgentTeamsState; refresh?: ReturnType<typeof vi.fn> } = {}): AgentTeamCatalogBundle {
  return {
    state: input.state ?? teamState,
    setState: (update) => {
      if (typeof update === "function") update(input.state ?? teamState);
    },
    lastUsedTeamKey: null,
    setLastUsedTeamKey: () => undefined,
    selection: null,
    setSelection: () => undefined,
    replaceTeams: () => undefined,
    refresh: input.refresh ?? (() => undefined),
  };
}
