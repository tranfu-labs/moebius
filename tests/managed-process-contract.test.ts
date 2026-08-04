import { describe, expect, it } from "vitest";

import {
  ManagedProcessAdmissionError,
  admitManagedProcessStart,
  managedProcessArchiveScopeSessionIds,
  projectManagedProcessRunningCounts,
} from "../src/local-console/managed-process-contract.js";

const workspace = "/tmp/moebius-managed-workspace";

describe("managed process admission", () => {
  it("admits a structured loopback service and preserves argv boundaries", () => {
    expect(admitManagedProcessStart({
      kind: "service",
      label: "Storybook",
      executable: "pnpm",
      args: ["--filter", "@moebius/console-ui", "storybook"],
      cwd: "packages/console-ui",
      readiness: { type: "tcp", host: "127.0.0.1", port: 6006 },
      endpoint: { url: "http://127.0.0.1:6006" },
    }, workspace)).toMatchObject({ executable: "pnpm", cwd: "packages/console-ui" });
    expect(admitManagedProcessStart({
      kind: "task", label: "finite task", executable: "python3", args: ["train.py"], cwd: ".", readiness: { type: "none" },
    }, workspace).readiness).toBeUndefined();
  });

  it.each([
    [{ kind: "task", label: "bad", executable: "sh -c", args: [], cwd: "." }, "invalid-executable"],
    [{ kind: "task", label: "bad", executable: "sh", args: ["-c", "sleep 10"], cwd: "." }, "shell-not-allowed"],
    [{ kind: "task", label: "bad", executable: "node", args: [], cwd: "/tmp" }, "cwd-outside-workspace"],
    [{ kind: "service", label: "bad", executable: "node", args: [], cwd: ".", endpoint: { url: "https://example.com" } }, "external-endpoint"],
    [{ kind: "service", label: "bad", executable: "node", args: [], cwd: ".", endpoint: { url: "https://localhost:6006" } }, "external-endpoint"],
    [{ kind: "service", label: "bad", executable: "node", args: [], cwd: ".", readiness: { type: "tcp", host: "0.0.0.0", port: 80 } }, "external-readiness"],
  ])("fails closed without converting unsafe input into a command", (input, code) => {
    expect(() => admitManagedProcessStart(input, workspace)).toThrowError(
      expect.objectContaining<Partial<ManagedProcessAdmissionError>>({ code }),
    );
  });
});

describe("managed process archive scope", () => {
  it("includes worker and analysis descendants but not unrelated sessions", () => {
    expect(managedProcessArchiveScopeSessionIds([
      { sessionId: "root", parentSessionId: null, analysisParentSessionId: null },
      { sessionId: "worker", parentSessionId: "root", analysisParentSessionId: null },
      { sessionId: "analysis", parentSessionId: null, analysisParentSessionId: "worker" },
      { sessionId: "other", parentSessionId: null, analysisParentSessionId: null },
    ], "root")).toEqual(["root", "worker", "analysis"]);
  });

  it("projects managed work separately from Agent running counts while propagating archive scope", () => {
    const session = {
      sessionId: "root",
      projectId: "project",
      workspaceMode: "direct" as const,
      workspacePendingMode: null,
      title: "Root",
      status: "idle" as const,
      awaitsHumanReason: null,
      unreadSince: null,
      runningCount: 0,
      waitingCount: 0,
      stuckCount: 0,
      errorCount: 0,
      interruptedCount: 0,
      createdAt: "2026-08-04T00:00:00.000Z",
      updatedAt: "2026-08-04T00:00:00.000Z",
    };
    const child = { ...session, sessionId: "child", parentSessionId: "root" };
    const project = {
      projectId: "project",
      sourceType: "local-folder" as const,
      title: "Project",
      folderPath: workspace,
      worktreeMode: false,
      workspaceCwd: workspace,
      workspaceMode: "direct" as const,
      worktreePath: null,
      worktreeUnavailableReason: null,
      workspaceUpdatedAt: null,
      sessions: [session, child],
      runningCount: 0,
      waitingCount: 0,
      stuckCount: 0,
      errorCount: 0,
    };
    const projected = projectManagedProcessRunningCounts({
      projects: [project],
      project,
      selectedSession: session,
    } as never, new Map([["child", 1]]));

    expect(projected.project).toMatchObject({ runningCount: 0, managedRunningCount: 1 });
    expect(projected.project.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: "root", runningCount: 0, managedRunningCount: 1 }),
      expect.objectContaining({ sessionId: "child", runningCount: 0, managedRunningCount: 1 }),
    ]));
  });
});
