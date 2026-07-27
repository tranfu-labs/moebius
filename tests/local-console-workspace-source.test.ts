import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  localSessionWorktreePath,
  resolveLocalWorkspaceSource,
} from "../src/local-console/workspace-source.js";

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

describe("local console workspace source", () => {
  it("uses a stable short id for new worktree paths and branches", async () => {
    const root = await makeGitRoot();
    const workdirRoot = path.join(root, "runtime");
    const first = await resolveLocalWorkspaceSource({
      projectId: "project/with/a/long/identity",
      sessionId: "local:session-with-a-very-long-identity",
      folderPath: root,
      worktreeMode: true,
      workdirRoot,
    });
    const repeated = await resolveLocalWorkspaceSource({
      projectId: "project/with/a/long/identity",
      sessionId: "local:session-with-a-very-long-identity",
      folderPath: root,
      worktreeMode: true,
      workdirRoot,
    });
    const other = await resolveLocalWorkspaceSource({
      projectId: "project/with/a/long/identity",
      sessionId: "local:another-session",
      folderPath: root,
      worktreeMode: true,
      workdirRoot,
    });

    expect(first.cwd).toBe(repeated.cwd);
    expect(first.branchName).toBe(repeated.branchName);
    expect(path.dirname(first.cwd)).toBe(path.join(workdirRoot, "worktrees"));
    expect(path.basename(first.cwd)).toMatch(/^[A-Za-z0-9_-]{12}$/u);
    expect(first.branchName).toBe(`moebius/${path.basename(first.cwd)}`);
    expect(other.cwd).not.toBe(first.cwd);
    expect(other.branchName).not.toBe(first.branchName);
  });

  it("prefers an existing legacy path and reports its real branch without moving it", async () => {
    const root = await makeGitRoot();
    const workdirRoot = path.join(root, "runtime");
    const projectId = "legacy/project";
    const sessionId = "legacy:session";
    const legacyPath = path.join(
      workdirRoot,
      "local-worktrees",
      "legacy_project",
      "legacy_session",
    );
    await fs.mkdir(path.dirname(legacyPath), { recursive: true });
    await execFileAsync("git", [
      "-C",
      root,
      "worktree",
      "add",
      "-b",
      "user/kept-legacy-branch",
      legacyPath,
      "HEAD",
    ]);

    expect(localSessionWorktreePath(workdirRoot, projectId, sessionId)).toBe(legacyPath);
    const resolved = await resolveLocalWorkspaceSource({
      projectId,
      sessionId,
      folderPath: root,
      worktreeMode: true,
      workdirRoot,
    });

    expect(resolved.cwd).toBe(legacyPath);
    expect(resolved.worktreePath).toBe(legacyPath);
    expect(resolved.branchName).toBe("user/kept-legacy-branch");
    await expect(fs.stat(path.join(workdirRoot, "worktrees"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function makeGitRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-local-workspace-source-"));
  roots.push(root);
  await execFileAsync("git", ["init", "-b", "main", root]);
  await fs.writeFile(path.join(root, "README.md"), "fixture\n", "utf8");
  await execFileAsync("git", ["-C", root, "add", "README.md"]);
  await execFileAsync("git", [
    "-C",
    root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    "fixture",
  ]);
  return root;
}
