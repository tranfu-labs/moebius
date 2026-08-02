import { describe, expect, it } from "vitest";
import {
  decideAgentTeamHealthRead,
  decideWorkspaceContinuationCandidate,
  planContinuableWorkspace,
  planProjectDirectoryAvailability,
} from "../src/local-console/session-continuation-plan.js";
import type {
  LocalConsoleProjectSummary,
  LocalConsoleSessionSummary,
  LocalConsoleSessionWorkspaceSource,
} from "../src/local-console/types.js";

describe("session continuation plan", () => {
  it("requires both a reachable directory and a stored session before health inspection", () => {
    const session = { sessionId: "local:test" } as LocalConsoleSessionSummary;
    expect(decideWorkspaceContinuationCandidate({ directoryAvailable: false, session })).toEqual({ kind: "unavailable" });
    expect(decideWorkspaceContinuationCandidate({ directoryAvailable: true, session: undefined })).toEqual({ kind: "unavailable" });
    expect(decideWorkspaceContinuationCandidate({ directoryAvailable: true, session }))
      .toEqual({ kind: "inspect-health", session });
  });

  it("blocks deleted or repair-required teams from continuing", () => {
    const source = { sessionId: "local:test" } as unknown as LocalConsoleSessionWorkspaceSource;
    expect(planContinuableWorkspace({ source, session: { agentTeamHealth: "deleted" } as LocalConsoleSessionSummary }))
      .toBeNull();
    expect(planContinuableWorkspace({ source, session: { agentTeamHealth: "usable" } as LocalConsoleSessionSummary }))
      .toBe(source);
  });

  it("projects directory availability and team health lookup responsibility", () => {
    const project = { projectId: "project-1" } as LocalConsoleProjectSummary;
    expect(planProjectDirectoryAvailability(project, false)).toMatchObject({
      directoryAvailable: false,
      newConversationDisabledReason: "当前项目本地文件夹不可用，无法新建对话",
    });
    expect(decideAgentTeamHealthRead({ ownership: null, teamId: null, resolverAvailable: true }))
      .toEqual({ kind: "not-bound" });
    expect(decideAgentTeamHealthRead({ ownership: "user", teamId: "team-1", resolverAvailable: false }))
      .toEqual({ kind: "preserve" });
  });
});
