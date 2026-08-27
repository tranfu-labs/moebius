import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";
import type { LocalWorkspaceBinding } from "../src/local-console/workspace-binding-plan.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("local console workspace binding persistence", () => {
  it("keeps legacy workspaceMode readable and restores binding baselines and revisions after restart", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-workspace-binding-persistence-"));
    roots.push(root);
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const sessionLogRoot = path.join(root, "sessions");
    const store = await createSqliteLocalConsoleStore({ sqlitePath, sessionLogRoot });
    await store.init();

    const project = await store.createProject({
      folderPath: path.join(root, "project"),
      worktreeMode: false,
      now: "2026-08-26T00:00:00.000Z",
    });
    const sessionId = "local:workspace-binding-persistence";
    await store.createSession({
      sessionId,
      projectId: project.projectId,
      title: "workspace binding persistence",
      workspaceMode: "worktree",
      baselineCommit: "legacy-baseline",
      now: "2026-08-26T00:00:01.000Z",
    });

    const legacySource = await store.getSessionWorkspace(sessionId);
    expect(legacySource).toMatchObject({
      workspaceMode: "worktree",
      baselineCommit: "legacy-baseline",
    });
    expect(legacySource.workspaceBinding).toBeUndefined();
    expect(await store.getSessionWorkspaceBinding!(sessionId)).toBeNull();

    const projectRootBinding = makeBinding({
      projectId: project.projectId,
      kind: "project-root",
      canonicalPath: project.folderPath,
      branchName: "main",
      lifecycle: "project-root",
    });
    const worktreeBinding = makeBinding({
      projectId: project.projectId,
      kind: "worktree",
      canonicalPath: path.join(root, "worktree-feature"),
      branchName: "feature/example",
      baseRef: "main",
      originalRepoRoot: project.folderPath,
      lifecycle: "user-managed",
    });

    await store.setSessionWorkspaceBinding!({
      sessionId,
      workspace: projectRootBinding,
      baselineCommit: "root-baseline",
      revision: 0,
      now: "2026-08-26T00:00:02.000Z",
    });
    await store.setSessionWorkspaceBinding!({
      sessionId,
      workspace: worktreeBinding,
      baselineCommit: "worktree-baseline",
      revision: 1,
      now: "2026-08-26T00:00:03.000Z",
    });
    await store.setSessionWorkspaceBinding!({
      sessionId,
      workspace: projectRootBinding,
      revision: 2,
      now: "2026-08-26T00:00:04.000Z",
    });

    const currentSource = await store.getSessionWorkspace(sessionId);
    expect(currentSource).toMatchObject({
      workspaceMode: "direct",
      workspaceBinding: projectRootBinding,
      workspaceRevision: 2,
      baselineCommit: "root-baseline",
    });
    expect(await store.getSessionBaselineCommit!(sessionId)).toBe("root-baseline");
    expect((await store.listSessions()).find((item) => item.sessionId === sessionId)).toEqual(
      expect.objectContaining({
          sessionId,
          workspaceMode: "direct",
          workspaceBinding: projectRootBinding,
          workspaceRevision: 2,
        }),
    );
    expect(await store.listSessionWorkspaceBindings!()).toEqual([{
      sessionId,
      workspace: projectRootBinding,
    }]);

    const database = new DatabaseSync(sqlitePath, { readOnly: true });
    try {
      const rows = database.prepare(
        `SELECT canonical_path, baseline_commit, revision, is_current
         FROM local_session_workspace_bindings
         WHERE session_id = ?
         ORDER BY canonical_path`,
      ).all(sessionId);
      expect(rows).toEqual([
        { canonical_path: projectRootBinding.canonicalPath, baseline_commit: "root-baseline", revision: 2, is_current: 1 },
        { canonical_path: worktreeBinding.canonicalPath, baseline_commit: "worktree-baseline", revision: 1, is_current: 0 },
      ]);
      expect(database.prepare(
        "SELECT 1 AS found FROM schema_migrations WHERE version = ?",
      ).get("conversation-workspace-session-binding-persistence")).toEqual({ found: 1 });
    } finally {
      database.close();
    }

    await store.close();
    const archivedDatabase = new DatabaseSync(sqlitePath);
    try {
      archivedDatabase
        .prepare("UPDATE sessions SET archived_at = ?, updated_at = ? WHERE session_id = ?")
        .run("2026-08-26T00:00:05.000Z", "2026-08-26T00:00:05.000Z", sessionId);
    } finally {
      archivedDatabase.close();
    }
    const restartedStore = await createSqliteLocalConsoleStore({ sqlitePath, sessionLogRoot });
    await restartedStore.init();
    try {
      expect((await restartedStore.listSessions()).find((item) => item.sessionId === sessionId)).toBeUndefined();
      expect(await restartedStore.listSessionWorkspaceBindings!()).toEqual([{
        sessionId,
        workspace: projectRootBinding,
      }]);
      expect(await restartedStore.getSessionWorkspaceBinding!(sessionId)).toEqual({
        sessionId,
        workspace: projectRootBinding,
        baselineCommit: "root-baseline",
        revision: 2,
      });
      await expect(restartedStore.setSessionWorkspaceBinding!({
        sessionId,
        workspace: worktreeBinding,
        revision: 2,
        now: "2026-08-26T00:00:05.000Z",
      })).rejects.toThrow("workspace binding revision is stale");
      expect((await restartedStore.getSessionWorkspace(sessionId)).workspaceBinding).toEqual(projectRootBinding);
    } finally {
      await restartedStore.close();
    }
  });
});

function makeBinding(input: Partial<LocalWorkspaceBinding> & Pick<LocalWorkspaceBinding, "projectId" | "kind" | "canonicalPath">): LocalWorkspaceBinding {
  return {
    projectId: input.projectId,
    kind: input.kind,
    canonicalPath: input.canonicalPath,
    branchName: input.branchName ?? null,
    baseRef: input.baseRef ?? null,
    originalRepoRoot: input.originalRepoRoot ?? null,
    lifecycle: input.lifecycle ?? "unknown",
  };
}
