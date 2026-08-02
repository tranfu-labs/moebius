/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AgentTeamListResponse } from "../src/team-ipc-contract.js";
import {
  useAgentTeamCatalog,
  type AgentTeamCatalogBundle,
} from "../src/console-page/use-agent-team-catalog.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("agent team catalog controller", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: AgentTeamCatalogBundle;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("keeps the replacement port result when a retired load resolves late, then exposes failure", async () => {
    const stale = deferred<AgentTeamListResponse>();
    await act(async () => root.render(<Harness api={{ listAgentTeams: () => stale.promise }} />));
    expect(latest.state.status).toBe("loading");

    await act(async () => root.render(<Harness api={{
      listAgentTeams: async () => ({ status: "ready", teams: [replacementTeam] }),
      readLastUsedAgentTeam: async () => ({ ownership: "user", teamId: "replacement" }),
    }} />));
    expect(latest.state).toMatchObject({ status: "ready" });
    expect(latest.lastUsedTeamKey).toBe("user:replacement");

    await act(async () => stale.resolve({ status: "ready", teams: [staleTeam] }));
    expect(latest.state.status === "ready" ? latest.state.teams[0]?.id : null).toBe("replacement");

    await act(async () => root.render(<Harness api={{
      listAgentTeams: async () => Promise.reject(new Error("offline")),
    }} />));
    expect(latest.state.status).toBe("error");
  });

  function Harness(props: { api: Parameters<typeof useAgentTeamCatalog>[0] }): null {
    latest = useAgentTeamCatalog(props.api);
    return null;
  }
});

const replacementTeam = {
  id: "replacement",
  ownership: "user" as const,
  definition: null,
  members: [],
  status: "usable" as const,
  canCreateConversation: true,
  issues: [],
};

const staleTeam = { ...replacementTeam, id: "stale" };

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
