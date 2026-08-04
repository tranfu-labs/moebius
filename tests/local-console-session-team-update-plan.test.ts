import { describe, expect, it } from "vitest";

import { finalizeAgentTeamSnapshot } from "../src/local-console/session-team-snapshot.js";
import {
  classifyAgentTeamSnapshotChanges,
  planPersistedSessionTeamPromotion,
  planSessionTeamUpdateBinding,
} from "../src/local-console/session-team-update-plan.js";
import type { LocalConsoleAgentTeamSnapshot, LocalConsoleSessionSummary } from "../src/local-console/types.js";

describe("session team update plan", () => {
  it("holds failed updates and fails a waiting update when old work becomes unrecoverable", () => {
    expect(planPersistedSessionTeamPromotion({
      intentStatus: "failed", hasPendingTeam: true, hasUnrecoverableOldWork: false,
    })).toBe("wait");
    expect(planPersistedSessionTeamPromotion({
      intentStatus: "waiting", hasPendingTeam: true, hasUnrecoverableOldWork: true,
    })).toBe("fail");
    expect(planPersistedSessionTeamPromotion({
      intentStatus: "waiting", hasPendingTeam: true, hasUnrecoverableOldWork: false,
    })).toBe("promote");
  });

  it("reports definition and team information when only identity frontmatter changes", () => {
    const effective = snapshot("---\ndisplay_name: Alpha\ndescription: First\n---\nSame body", "Alpha", "First");
    const candidate = snapshot("---\ndisplay_name: Beta\ndescription: Second\n---\nSame body", "Beta", "Second");

    expect(classifyAgentTeamSnapshotChanges({ effective, candidate })).toEqual([
      { kind: "agent-definition", affectedMemberCount: 1 },
      { kind: "team-information", affectedMemberCount: 1 },
    ]);
  });

  it("keeps execution profile independent while counting a complete Markdown edit", () => {
    const effective = snapshot("Alpha", "Alpha", "First");
    const candidate = snapshot("Beta", "Alpha", "First", "claude");

    expect(classifyAgentTeamSnapshotChanges({ effective, candidate }).map(({ kind }) => kind)).toEqual([
      "agent-definition",
      "execution-profile",
    ]);
  });

  it.each([
    { label: "no binding", patch: { agentTeamOwnership: null, agentTeamId: null } },
    { label: "deleted target", patch: { agentTeamHealth: "deleted" } },
    { label: "invalid target", patch: { agentTeamHealth: "needs-repair" } },
    { label: "pending explicit switch", patch: { agentTeamPendingOwnership: "user", agentTeamPendingId: "team-b" } },
  ] as const)("does not inspect $label", ({ patch }) => {
    expect(planSessionTeamUpdateBinding({ ...sessionSummary(), ...patch })).toEqual({ kind: "idle" });
  });
});

function sessionSummary(): LocalConsoleSessionSummary {
  return {
    sessionId: "session-a", projectId: "local", workspaceMode: "direct", workspacePendingMode: null,
    title: "Session", status: "idle", awaitsHumanReason: null, unreadSince: null,
    runningCount: 0, waitingCount: 0, stuckCount: 0, errorCount: 0, interruptedCount: 0,
    agentTeamOwnership: "user", agentTeamId: "team-a", agentTeamHealth: "usable",
    agentTeamPendingOwnership: null, agentTeamPendingId: null,
    createdAt: "2026-08-04T10:00:00.000Z", updatedAt: "2026-08-04T10:00:00.000Z",
  };
}

function snapshot(
  agentMarkdown: string,
  displayName: string,
  description: string,
  cli: "codex" | "claude" | "kimi" = "codex",
): LocalConsoleAgentTeamSnapshot {
  return finalizeAgentTeamSnapshot({
    team: {
      ownership: "user",
      id: "team-a",
      name: "Team A",
      description: "Purpose",
      primaryAgentSlug: "lead",
    },
    members: [{
      name: "lead",
      displayName,
      description,
      agentMarkdown,
      executionProfile: { cli, model: "model", effort: "medium" },
    }],
  }, { capturedAt: "2026-08-04T00:00:00.000Z" });
}
