import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { startLocalConsoleServer } from "../src/local-console/start.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 50,
  })));
});

describe("local console workspace state projection", () => {
  it("returns the bound branch on a conditional request after switching", async () => {
    const root = await makeGitRoot();
    const featureWorktree = path.join(root, "feature-worktree");
    await execFileAsync("git", ["-C", root, "worktree", "add", "-b", "feature/example", featureWorktree, "main"]);
    const canonicalFeatureWorktree = await fs.realpath(featureWorktree);
    const started = await startLocalConsoleServer({
      host: "127.0.0.1",
      port: 0,
      projectRoot: root,
      workdirRoot: path.join(root, "workdir"),
      sqlitePath: path.join(root, ".state", "local-console.sqlite"),
      listAgentFiles: async () => [],
    });

    try {
      const session = await started.runtime.createSession("workspace state");
      const stateUrl = new URL("/api/local-console/state", started.url);
      stateUrl.searchParams.set("sessionId", session.sessionId);
      const initialResponse = await fetch(stateUrl);
      expect(initialResponse.status).toBe(200);
      const initialEtag = initialResponse.headers.get("etag");
      expect(initialEtag).not.toBeNull();
      const initialState = await initialResponse.json() as {
        selectedSession: {
          workspaceMode: string;
          branchName?: string | null;
          workspaceRevision?: number;
          workspaceBinding?: unknown;
        } | null;
      };
      expect(initialState.selectedSession).toMatchObject({
        workspaceMode: "direct",
        branchName: "main",
      });
      expect(initialState.selectedSession?.workspaceBinding).toBeUndefined();

      const switched = await started.runtime.switchSessionWorkspaceBinding({
        sessionId: session.sessionId,
        target: { target: "branch", branchName: "feature/example" },
      });
      expect(switched.binding.workspace).toMatchObject({
        kind: "worktree",
        canonicalPath: canonicalFeatureWorktree,
        branchName: "feature/example",
      });
      expect(switched.binding.revision).toBe(1);

      const changedResponse = await fetch(stateUrl, {
        headers: { "if-none-match": initialEtag as string },
      });
      expect(changedResponse.status).toBe(200);
      const changedState = await changedResponse.json() as {
        selectedSession: {
          workspaceMode: string;
          branchName?: string | null;
          workspaceRevision?: number;
          workspaceBinding?: {
            kind: string;
            canonicalPath: string;
            branchName: string | null;
          };
        } | null;
      };
      expect(changedState.selectedSession).toMatchObject({
        workspaceMode: "worktree",
        branchName: "feature/example",
        workspaceRevision: 1,
        workspaceBinding: {
          kind: "worktree",
          canonicalPath: canonicalFeatureWorktree,
          branchName: "feature/example",
        },
      });
    } finally {
      await started.close();
    }
  });
});

async function makeGitRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-workspace-state-"));
  roots.push(root);
  await execFileAsync("git", ["init", "-b", "main", root]);
  await fs.writeFile(path.join(root, "README.md"), "fixture\n", "utf8");
  await execFileAsync("git", ["-C", root, "add", "README.md"]);
  await execFileAsync("git", [
    "-C", root,
    "-c", "user.name=Test",
    "-c", "user.email=test@example.com",
    "commit", "-m", "fixture",
  ]);
  return root;
}
