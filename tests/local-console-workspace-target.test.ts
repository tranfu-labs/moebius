import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  LocalWorkspaceTargetResolutionError,
  parseGitWorktreeListPorcelain,
  resolveLocalWorkspaceTarget,
  type GitProcessResult,
  type WorkspaceResolverDependencies,
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

describe("local console workspace target resolution", () => {
  it("resolves the project root and an existing branch worktree with real Git facts", async () => {
    const root = await makeGitRoot();
    const workdirRoot = path.join(root, "runtime");
    const targetPath = path.join(workdirRoot, "worktrees", "existing-feature");
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await execFileAsync("git", ["-C", root, "worktree", "add", "-b", "feature/existing", targetPath, "HEAD"]);
    const canonicalRoot = await fs.realpath(root);
    const canonicalTargetPath = await fs.realpath(targetPath);

    const projectRoot = await resolveLocalWorkspaceTarget({
      projectId: "project-a",
      folderPath: root,
      workdirRoot,
      target: { target: "project-root" },
    });
    const branchWorktree = await resolveLocalWorkspaceTarget({
      projectId: "project-a",
      folderPath: root,
      workdirRoot,
      target: { target: "branch", branchName: "feature/existing" },
    });

    expect(projectRoot).toMatchObject({
      projectId: "project-a",
      kind: "project-root",
      canonicalPath: canonicalRoot,
      branchName: "main",
      originalRepoRoot: canonicalRoot,
      lifecycle: "project-root",
    });
    expect(branchWorktree).toMatchObject({
      projectId: "project-a",
      kind: "worktree",
      canonicalPath: canonicalTargetPath,
      branchName: "feature/existing",
      baseRef: projectRoot.baseRef,
      originalRepoRoot: canonicalRoot,
      lifecycle: "moebius-temporary",
    });
  });

  it("rejects a branch that is not present in the project worktree list", async () => {
    const root = await makeGitRoot();

    await expect(resolveLocalWorkspaceTarget({
      projectId: "project-a",
      folderPath: root,
      workdirRoot: path.join(root, "runtime"),
      target: { target: "branch", branchName: "feature/missing" },
    })).rejects.toMatchObject({
      reason: "target-not-found",
    });

    const nonGitRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-local-workspace-target-non-git-"));
    roots.push(nonGitRoot);
    await expect(resolveLocalWorkspaceTarget({
      projectId: "project-a",
      folderPath: nonGitRoot,
      workdirRoot: path.join(nonGitRoot, "runtime"),
      target: { target: "project-root" },
    })).rejects.toMatchObject({
      reason: "not-git-repository",
    });
  });

  it("rejects malformed, ambiguous, prunable, unreadable, and outside-project records deterministically", async () => {
    expect(() => parseGitWorktreeListPorcelain([
      "worktree /repo",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /repo/feature",
      "HEAD def456",
      "branch refs/heads/feature/a",
      "prunable gitdir file points to non-existent location",
      "",
    ].join("\n"))).not.toThrow();

    expect(() => parseGitWorktreeListPorcelain("HEAD abc123\n")).toThrow("worktree record starts without a path");

    const root = "/repo";
    const workdirRoot = "/runtime";
    const duplicateBranchOutput = [
      "worktree /repo",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /repo/feature-a",
      "HEAD def456",
      "branch refs/heads/shared",
      "",
      "worktree /repo/feature-b",
      "HEAD ghi789",
      "branch refs/heads/shared",
      "",
    ].join("\n");
    await expect(resolveLocalWorkspaceTarget({
      projectId: "project-a",
      folderPath: root,
      workdirRoot,
      target: { target: "branch", branchName: "shared" },
    }, fakeGitDependencies({ root, worktreeList: duplicateBranchOutput }))).rejects.toMatchObject({
      reason: "ambiguous-target",
    });

    const prunableOutput = [
      "worktree /repo",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /runtime/worktrees/old",
      "HEAD def456",
      "branch refs/heads/old",
      "prunable gitdir file points to non-existent location",
      "",
    ].join("\n");
    await expect(resolveLocalWorkspaceTarget({
      projectId: "project-a",
      folderPath: root,
      workdirRoot,
      target: { target: "branch", branchName: "old" },
    }, fakeGitDependencies({ root, worktreeList: prunableOutput }))).rejects.toMatchObject({
      reason: "prunable-worktree",
    });

    const outsideOutput = [
      "worktree /repo",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /outside/feature",
      "HEAD def456",
      "branch refs/heads/outside",
      "",
    ].join("\n");
    await expect(resolveLocalWorkspaceTarget({
      projectId: "project-a",
      folderPath: root,
      workdirRoot,
      target: { target: "branch", branchName: "outside" },
    }, fakeGitDependencies({
      root,
      worktreeList: outsideOutput,
      repositoryRootByPath: { "/outside/feature": "/other-repository" },
    }))).rejects.toMatchObject({
      reason: "outside-project",
    });

    const unreadableOutput = [
      "worktree /repo",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /repo/unreadable",
      "HEAD def456",
      "branch refs/heads/unreadable",
      "",
    ].join("\n");
    await expect(resolveLocalWorkspaceTarget({
      projectId: "project-a",
      folderPath: root,
      workdirRoot,
      target: { target: "branch", branchName: "unreadable" },
    }, fakeGitDependencies({
      root,
      worktreeList: unreadableOutput,
      unreadablePaths: ["/repo/unreadable"],
    }))).rejects.toMatchObject({
      reason: "unreadable-worktree",
    });
  });
});

function fakeGitDependencies(input: {
  root: string;
  worktreeList: string;
  repositoryRootByPath?: Record<string, string>;
  unreadablePaths?: string[];
}): WorkspaceResolverDependencies {
  const repositoryRootByPath = input.repositoryRootByPath ?? {};
  const unreadablePaths = new Set(input.unreadablePaths ?? []);
  return {
    access: async (targetPath) => {
      if (unreadablePaths.has(targetPath)) {
        throw new Error("unreadable fixture path");
      }
    },
    mkdir: async () => {},
    pathExists: async () => false,
    runGit: async (args): Promise<GitProcessResult> => {
      const folderPath = args[args.indexOf("-C") + 1] ?? input.root;
      if (args.includes("--show-toplevel")) {
        return result(repositoryRootByPath[folderPath] ?? input.root);
      }
      if (args.includes("--git-common-dir")) {
        return result(repositoryRootByPath[folderPath] === undefined ? ".git" : "/other-repository/.git");
      }
      if (args.includes("list") && args.includes("--porcelain")) {
        return result(input.worktreeList);
      }
      throw new Error(`unexpected fake git args: ${args.join(" ")}`);
    },
    gitTimeoutMs: 1_000,
  };
}

function result(stdout: string): GitProcessResult {
  return { code: 0, signal: null, stdout, stderr: "" };
}

async function makeGitRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-local-workspace-target-"));
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
