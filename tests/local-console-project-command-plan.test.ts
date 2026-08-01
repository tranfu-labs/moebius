import { describe, expect, it } from "vitest";
import { planProjectRemoval } from "../src/local-console/project-command-plan.js";
import type { LocalConsoleProjectSummary, LocalConsoleSessionSummary } from "../src/local-console/types.js";

const session = (sessionId: string, parent: string | null = null) => ({
  sessionId,
  analysisParentSessionId: parent,
} as LocalConsoleSessionSummary);

describe("project command plan", () => {
  it("rejects missing and active projects unless force is explicit", () => {
    expect(planProjectRemoval({ project: undefined, allSessions: [], force: false })).toEqual({ kind: "not-found" });
    const project = { runningCount: 1, sessions: [session("root")] } as LocalConsoleProjectSummary;
    expect(planProjectRemoval({ project, allSessions: [session("root")], force: false })).toEqual({ kind: "running" });
  });

  it("includes transitive analysis children and marks forced runs for interruption", () => {
    const root = session("root");
    const child = session("child", "root");
    const grandchild = session("grandchild", "child");
    const project = { runningCount: 1, sessions: [root] } as LocalConsoleProjectSummary;
    expect(planProjectRemoval({ project, allSessions: [root, child, grandchild], force: true })).toEqual({
      kind: "remove",
      sessionIds: ["root", "child", "grandchild"],
      abortActiveRuns: true,
    });
  });
});
