import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { WORKTREE_GIT_TIMEOUT_MS } from "../config.js";
import type { LocalConsoleWorkspaceMode } from "./types.js";
import type {
  LocalWorkspaceBinding,
  LocalWorkspaceSwitchTarget,
} from "./workspace-binding-plan.js";

export interface LocalWorkspaceSourceInput {
  projectId: string;
  sessionId: string;
  folderPath: string;
  worktreeMode: boolean;
  workdirRoot: string;
  gitTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface ResolvedLocalWorkspace {
  cwd: string;
  mode: LocalConsoleWorkspaceMode;
  worktreePath: string | null;
  worktreeUnavailableReason: string | null;
  branchName: string | null;
  baseRef: string | null;
  originalRepoRoot: string | null;
}

export interface GitRunOptions {
  label: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface WorkspaceResolverDependencies {
  access(targetPath: string): Promise<void>;
  mkdir(targetPath: string, options: { recursive: true }): Promise<void>;
  pathExists(targetPath: string): Promise<boolean>;
  runGit(args: string[], options: GitRunOptions, acceptedExitCodes: number[]): Promise<GitProcessResult>;
  gitTimeoutMs: number;
}

export interface GitProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export type LocalWorkspaceTarget = LocalWorkspaceSwitchTarget;

export interface LocalGitWorktreeRecord {
  worktreePath: string;
  headRef: string;
  branchName: string | null;
  prunable: boolean;
}

export type LocalWorkspaceTargetResolutionReason =
  | "invalid-target"
  | "not-git-repository"
  | "target-not-found"
  | "ambiguous-target"
  | "prunable-worktree"
  | "unreadable-worktree"
  | "outside-project"
  | "invalid-worktree-list";

export class LocalWorkspaceTargetResolutionError extends Error {
  constructor(
    readonly reason: LocalWorkspaceTargetResolutionReason,
    detail?: string,
  ) {
    super(detail === undefined ? `workspace target resolution failed: ${reason}` : `workspace target resolution failed: ${reason}: ${detail}`);
    this.name = "LocalWorkspaceTargetResolutionError";
  }
}

export interface CachedLocalWorkspaceFacts {
  isGitRepository: boolean;
  branchName: string | null;
}

interface WorkspaceFactsCacheEntry {
  expiresAt: number;
  value: Promise<CachedLocalWorkspaceFacts>;
}

const WORKSPACE_FACTS_CACHE_TTL_MS = 30_000;
const workspaceFactsCache = new Map<string, WorkspaceFactsCacheEntry>();

const defaultDependencies: WorkspaceResolverDependencies = {
  access: (targetPath) => fs.access(targetPath),
  mkdir: async (targetPath, options) => {
    await fs.mkdir(targetPath, options);
  },
  pathExists,
  runGit: runGitProcess,
  gitTimeoutMs: WORKTREE_GIT_TIMEOUT_MS,
};

export async function resolveLocalWorkspaceSource(
  input: LocalWorkspaceSourceInput,
  dependencies: WorkspaceResolverDependencies = defaultDependencies,
): Promise<ResolvedLocalWorkspace> {
  const effectiveDependencies = {
    ...dependencies,
    gitTimeoutMs: input.gitTimeoutMs ?? dependencies.gitTimeoutMs,
  };
  const folderPath = path.resolve(input.folderPath);
  await effectiveDependencies.access(folderPath);

  if (!input.worktreeMode) {
    return {
      cwd: folderPath,
      mode: "direct",
      worktreePath: null,
      worktreeUnavailableReason: null,
      branchName: null,
      baseRef: null,
      originalRepoRoot: null,
    };
  }

  const repoRoot = await detectGitRepositoryRoot(folderPath, input.signal, effectiveDependencies);
  if (repoRoot === null) {
    return {
      cwd: folderPath,
      mode: "direct",
      worktreePath: null,
      worktreeUnavailableReason: "not-git-repository",
      branchName: null,
      baseRef: null,
      originalRepoRoot: null,
    };
  }

  const worktreePath = localWorktreePath(input.workdirRoot, input.projectId, input.sessionId);
  const branchName = localWorktreeBranch(input.projectId, input.sessionId);
  await effectiveDependencies.mkdir(path.dirname(worktreePath), { recursive: true });
  if (await effectiveDependencies.pathExists(worktreePath)) {
    await assertUsableGitWorktree(worktreePath, input.signal, effectiveDependencies);
    return {
      cwd: worktreePath,
      mode: "worktree",
      worktreePath,
      worktreeUnavailableReason: null,
      branchName: await readCurrentBranch(worktreePath, input.signal, effectiveDependencies),
      baseRef: await readHeadRef(worktreePath, input.signal, effectiveDependencies),
      originalRepoRoot: repoRoot,
    };
  }

  try {
    await runBoundedGit(
      ["-C", repoRoot, "worktree", "add", "-B", branchName, worktreePath, "HEAD"],
      "worktree-add",
      input.signal,
      effectiveDependencies,
    );
  } catch (error) {
    if (!(await effectiveDependencies.pathExists(worktreePath))) {
      throw error;
    }
    await assertUsableGitWorktree(worktreePath, input.signal, effectiveDependencies);
  }

  return {
    cwd: worktreePath,
    mode: "worktree",
    worktreePath,
    worktreeUnavailableReason: null,
    branchName: await readCurrentBranch(worktreePath, input.signal, effectiveDependencies),
    baseRef: await readHeadRef(worktreePath, input.signal, effectiveDependencies),
    originalRepoRoot: repoRoot,
  };
}

export async function resolveLocalWorkspaceTarget(
  input: {
    projectId: string;
    folderPath: string;
    workdirRoot: string;
    target: LocalWorkspaceTarget;
    gitTimeoutMs?: number;
    signal?: AbortSignal;
  },
  dependencies: WorkspaceResolverDependencies = defaultDependencies,
): Promise<LocalWorkspaceBinding> {
  const effectiveDependencies = {
    ...dependencies,
    gitTimeoutMs: input.gitTimeoutMs ?? dependencies.gitTimeoutMs,
  };
  const folderPath = path.resolve(input.folderPath);
  await effectiveDependencies.access(folderPath);
  const detectedRoot = await detectGitRepositoryRoot(folderPath, input.signal, effectiveDependencies);
  if (detectedRoot === null) {
    throw new LocalWorkspaceTargetResolutionError("not-git-repository");
  }

  const records = await readGitWorktreeList(detectedRoot, input.signal, effectiveDependencies);
  const projectRoot = records[0]?.worktreePath;
  if (projectRoot === undefined) {
    throw new LocalWorkspaceTargetResolutionError("invalid-worktree-list", "no worktree records");
  }
  const expectedCommonDir = await readGitCommonDir(detectedRoot, input.signal, effectiveDependencies);
  const targetRecord = selectGitWorktreeRecord({
    target: input.target,
    projectRoot,
    records,
  });
  if (targetRecord.prunable) {
    throw new LocalWorkspaceTargetResolutionError("prunable-worktree");
  }

  await assertReadableProjectWorktree({
    record: targetRecord,
    expectedCommonDir,
    signal: input.signal,
    dependencies: effectiveDependencies,
  });
  const canonicalWorkdirRoot = await fs.realpath(input.workdirRoot).catch(() => path.resolve(input.workdirRoot));
  return toWorkspaceBinding({
    projectId: input.projectId,
    projectRoot,
    workdirRoot: canonicalWorkdirRoot,
    record: targetRecord,
  });
}

/**
 * Reads the legacy session worktree identity without creating a new worktree.
 * A missing legacy directory is retained as an unknown binding so a later
 * controlled switch can still move the session to an existing target safely.
 */
export async function resolveExistingLocalWorkspaceBinding(
  input: {
    projectId: string;
    sessionId: string;
    folderPath: string;
    workdirRoot: string;
    gitTimeoutMs?: number;
    signal?: AbortSignal;
  },
  dependencies: WorkspaceResolverDependencies = defaultDependencies,
): Promise<LocalWorkspaceBinding> {
  const worktreePath = localSessionWorktreePath(input.workdirRoot, input.projectId, input.sessionId);
  const effectiveDependencies = {
    ...dependencies,
    gitTimeoutMs: input.gitTimeoutMs ?? dependencies.gitTimeoutMs,
  };
  if (!(await effectiveDependencies.pathExists(worktreePath))) {
    return {
      projectId: input.projectId,
      kind: "worktree",
      canonicalPath: path.resolve(worktreePath),
      branchName: null,
      baseRef: null,
      originalRepoRoot: path.resolve(input.folderPath),
      lifecycle: "unknown",
    };
  }

  const resolved = await resolveLocalWorkspaceSource({
    ...input,
    worktreeMode: true,
  }, effectiveDependencies);
  if (resolved.mode !== "worktree" || resolved.worktreePath === null) {
    return {
      projectId: input.projectId,
      kind: "project-root",
      canonicalPath: path.resolve(resolved.cwd),
      branchName: null,
      baseRef: null,
      originalRepoRoot: null,
      lifecycle: "project-root",
    };
  }
  return {
    projectId: input.projectId,
    kind: "worktree",
    canonicalPath: path.resolve(resolved.worktreePath),
    branchName: resolved.branchName,
    baseRef: resolved.baseRef,
    originalRepoRoot: resolved.originalRepoRoot,
    lifecycle: workspaceLifecycle(path.resolve(resolved.worktreePath), path.resolve(input.workdirRoot)),
  };
}

export function parseGitWorktreeListPorcelain(output: string): LocalGitWorktreeRecord[] {
  const records: LocalGitWorktreeRecord[] = [];
  let current: {
    worktreePath: string;
    headRef: string | null;
    branchName: string | null;
    prunable: boolean;
  } | null = null;

  const flush = () => {
    if (current === null) {
      return;
    }
    if (current.headRef === null) {
      throw new Error("missing HEAD");
    }
    records.push({
      worktreePath: path.resolve(current.worktreePath),
      headRef: current.headRef,
      branchName: current.branchName,
      prunable: current.prunable,
    });
    current = null;
  };

  for (const rawLine of output.split(/\r?\n/u)) {
    if (rawLine === "") {
      flush();
      continue;
    }
    if (rawLine.startsWith("worktree ")) {
      flush();
      const worktreePath = rawLine.slice("worktree ".length).trim();
      if (worktreePath === "") {
        throw new Error("missing worktree path");
      }
      current = { worktreePath, headRef: null, branchName: null, prunable: false };
      continue;
    }
    if (current === null) {
      throw new Error("worktree record starts without a path");
    }
    if (rawLine.startsWith("HEAD ")) {
      const headRef = rawLine.slice("HEAD ".length).trim();
      if (headRef === "") {
        throw new Error("missing HEAD");
      }
      current.headRef = headRef;
    } else if (rawLine.startsWith("branch ")) {
      const branchRef = rawLine.slice("branch ".length).trim();
      if (!branchRef.startsWith("refs/heads/") || branchRef.length === "refs/heads/".length) {
        throw new Error("invalid branch ref");
      }
      current.branchName = branchRef.slice("refs/heads/".length);
    } else if (rawLine === "prunable" || rawLine.startsWith("prunable ")) {
      current.prunable = true;
    }
  }
  flush();
  return records;
}

export async function readCachedLocalWorkspaceFacts(input: {
  folderPath: string;
  gitTimeoutMs?: number;
  signal?: AbortSignal;
}): Promise<CachedLocalWorkspaceFacts> {
  const folderPath = path.resolve(input.folderPath);
  const cached = workspaceFactsCache.get(folderPath);
  if (cached !== undefined && cached.expiresAt > Date.now()) {
    return await cached.value;
  }
  const dependencies = {
    ...defaultDependencies,
    gitTimeoutMs: input.gitTimeoutMs ?? defaultDependencies.gitTimeoutMs,
  };
  const value = inspectLocalWorkspaceFacts(folderPath, input.signal, dependencies);
  workspaceFactsCache.set(folderPath, {
    expiresAt: Date.now() + WORKSPACE_FACTS_CACHE_TTL_MS,
    value,
  });
  try {
    return await value;
  } catch (error) {
    workspaceFactsCache.delete(folderPath);
    throw error;
  }
}

export function invalidateLocalWorkspaceFacts(folderPath?: string): void {
  if (folderPath === undefined) {
    workspaceFactsCache.clear();
    return;
  }
  workspaceFactsCache.delete(path.resolve(folderPath));
}

export function localSessionWorktreePath(workdirRoot: string, projectId: string, sessionId: string): string {
  return localWorktreePath(workdirRoot, projectId, sessionId);
}

async function inspectLocalWorkspaceFacts(
  folderPath: string,
  signal: AbortSignal | undefined,
  dependencies: WorkspaceResolverDependencies,
): Promise<CachedLocalWorkspaceFacts> {
  const repoRoot = await detectGitRepositoryRoot(folderPath, signal, dependencies);
  if (repoRoot === null) {
    return { isGitRepository: false, branchName: null };
  }
  return {
    isGitRepository: true,
    branchName: await readCurrentBranch(folderPath, signal, dependencies).catch(() => null),
  };
}

export interface GeneratedLocalWorkspaceDiff {
  baseRef: string;
  branchName: string;
  worktreePath: string;
  originalRepoRoot: string | null;
  patchPath: string;
  affectedFiles: string[];
  empty: boolean;
}

export async function generateLocalWorkspaceDiff(input: {
  worktreePath: string;
  runDir: string;
  baseRef?: string | null;
  branchName?: string | null;
  originalRepoRoot?: string | null;
  gitTimeoutMs?: number;
  signal?: AbortSignal;
}): Promise<GeneratedLocalWorkspaceDiff> {
  const dependencies = {
    ...defaultDependencies,
    gitTimeoutMs: input.gitTimeoutMs ?? defaultDependencies.gitTimeoutMs,
  };
  await fs.mkdir(input.runDir, { recursive: true });
  const baseRef = input.baseRef ?? (await readHeadRef(input.worktreePath, input.signal, dependencies));
  const branchName = input.branchName ?? (await readCurrentBranch(input.worktreePath, input.signal, dependencies));
  await runBoundedGit(
    ["-C", input.worktreePath, "add", "-N", "."],
    "worktree-diff-intent-to-add",
    input.signal,
    dependencies,
  );
  const diff = await runBoundedGit(
    ["-C", input.worktreePath, "diff", "--binary", baseRef, "--"],
    "worktree-diff",
    input.signal,
    dependencies,
  );
  const affected = await runBoundedGit(
    ["-C", input.worktreePath, "diff", "--name-only", "-z", baseRef, "--"],
    "worktree-diff-affected-files",
    input.signal,
    dependencies,
  );
  const patchPath = path.join(input.runDir, "workspace.patch");
  await fs.writeFile(patchPath, diff.stdout, "utf8");
  return {
    baseRef,
    branchName,
    worktreePath: input.worktreePath,
    originalRepoRoot: input.originalRepoRoot ?? null,
    patchPath,
    affectedFiles: splitNulList(affected.stdout),
    empty: diff.stdout.trim() === "",
  };
}

export async function readLocalGitStatus(input: {
  folderPath: string;
  gitTimeoutMs?: number;
  signal?: AbortSignal;
}): Promise<string> {
  const dependencies = {
    ...defaultDependencies,
    gitTimeoutMs: input.gitTimeoutMs ?? defaultDependencies.gitTimeoutMs,
  };
  const status = await runBoundedGit(
    ["-C", input.folderPath, "status", "--short"],
    "git-status",
    input.signal,
    dependencies,
  );
  return status.stdout.trim();
}

export async function applyLocalWorkspaceDiff(input: {
  originalFolderPath: string;
  patchPath: string;
  reverse?: boolean;
  requireClean?: boolean;
  gitTimeoutMs?: number;
  signal?: AbortSignal;
}): Promise<{ beforeStatus: string; afterStatus: string }> {
  const dependencies = {
    ...defaultDependencies,
    gitTimeoutMs: input.gitTimeoutMs ?? defaultDependencies.gitTimeoutMs,
  };
  const reverse = input.reverse ?? false;
  const beforeStatus = await readLocalGitStatus({
    folderPath: input.originalFolderPath,
    gitTimeoutMs: dependencies.gitTimeoutMs,
    signal: input.signal,
  });
  if ((input.requireClean ?? !reverse) && beforeStatus !== "") {
    throw new Error(`original-repo-dirty-before-diff-return:${beforeStatus}`);
  }
  await runBoundedGit(
    ["-C", input.originalFolderPath, "apply", ...(reverse ? ["--reverse"] : []), "--check", input.patchPath],
    reverse ? "diff-rollback-check" : "diff-apply-check",
    input.signal,
    dependencies,
  );
  await runBoundedGit(
    ["-C", input.originalFolderPath, "apply", ...(reverse ? ["--reverse"] : []), input.patchPath],
    reverse ? "diff-rollback" : "diff-apply",
    input.signal,
    dependencies,
  );
  return {
    beforeStatus,
    afterStatus: await readLocalGitStatus({
      folderPath: input.originalFolderPath,
      gitTimeoutMs: dependencies.gitTimeoutMs,
      signal: input.signal,
    }),
  };
}

export async function rollbackLocalWorkspaceDiff(input: {
  originalFolderPath: string;
  patchPath: string;
  gitTimeoutMs?: number;
  signal?: AbortSignal;
}): Promise<{ beforeStatus: string; afterStatus: string }> {
  return await applyLocalWorkspaceDiff({
    ...input,
    reverse: true,
    requireClean: false,
  });
}

async function detectGitRepositoryRoot(
  folderPath: string,
  signal: AbortSignal | undefined,
  dependencies: WorkspaceResolverDependencies,
): Promise<string | null> {
  const result = await runBoundedGit(["-C", folderPath, "rev-parse", "--show-toplevel"], "rev-parse", signal, dependencies, [0, 128]);
  if (result.code !== 0) {
    return null;
  }
  const root = result.stdout.trim();
  return root === "" ? null : path.resolve(root);
}

async function readGitWorktreeList(
  repoRoot: string,
  signal: AbortSignal | undefined,
  dependencies: WorkspaceResolverDependencies,
): Promise<LocalGitWorktreeRecord[]> {
  const result = await runBoundedGit(
    ["-C", repoRoot, "worktree", "list", "--porcelain"],
    "worktree-list",
    signal,
    dependencies,
  );
  try {
    const records = parseGitWorktreeListPorcelain(result.stdout);
    if (records.length === 0) {
      throw new Error("no worktree records");
    }
    return records;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unparseable output";
    throw new LocalWorkspaceTargetResolutionError("invalid-worktree-list", detail);
  }
}

function selectGitWorktreeRecord(input: {
  target: LocalWorkspaceTarget;
  projectRoot: string;
  records: readonly LocalGitWorktreeRecord[];
}): LocalGitWorktreeRecord {
  const target = input.target;
  if (target.target === "project-root") {
    const projectRootRecords = input.records.filter((record) => record.worktreePath === input.projectRoot);
    if (projectRootRecords.length !== 1) {
      throw new LocalWorkspaceTargetResolutionError("invalid-worktree-list", "project root is not unique");
    }
    return projectRootRecords[0]!;
  }

  if (target.target !== "branch") {
    throw new LocalWorkspaceTargetResolutionError("invalid-target");
  }
  const branchName = target.branchName;
  if (branchName === "" || branchName.includes("\u0000")) {
    throw new LocalWorkspaceTargetResolutionError("invalid-target");
  }
  const matches = input.records.filter((record) => record.branchName === branchName);
  if (matches.length === 0) {
    throw new LocalWorkspaceTargetResolutionError("target-not-found");
  }
  if (matches.length > 1) {
    throw new LocalWorkspaceTargetResolutionError("ambiguous-target");
  }
  return matches[0]!;
}

async function assertReadableProjectWorktree(input: {
  record: LocalGitWorktreeRecord;
  expectedCommonDir: string;
  signal: AbortSignal | undefined;
  dependencies: WorkspaceResolverDependencies;
}): Promise<void> {
  try {
    await input.dependencies.access(input.record.worktreePath);
  } catch {
    throw new LocalWorkspaceTargetResolutionError("unreadable-worktree");
  }

  const actualRoot = await detectGitRepositoryRoot(input.record.worktreePath, input.signal, input.dependencies);
  if (actualRoot === null) {
    throw new LocalWorkspaceTargetResolutionError("unreadable-worktree");
  }
  if (actualRoot !== input.record.worktreePath) {
    throw new LocalWorkspaceTargetResolutionError("outside-project");
  }
  const actualCommonDir = await readGitCommonDir(input.record.worktreePath, input.signal, input.dependencies);
  if (actualCommonDir !== input.expectedCommonDir) {
    throw new LocalWorkspaceTargetResolutionError("outside-project");
  }
}

async function readGitCommonDir(
  worktreePath: string,
  signal: AbortSignal | undefined,
  dependencies: WorkspaceResolverDependencies,
): Promise<string> {
  const result = await runBoundedGit(
    ["-C", worktreePath, "rev-parse", "--git-common-dir"],
    "worktree-common-dir",
    signal,
    dependencies,
  );
  const commonDir = result.stdout.trim();
  if (commonDir === "") {
    throw new LocalWorkspaceTargetResolutionError("invalid-worktree-list", "missing common dir");
  }
  return path.resolve(worktreePath, commonDir);
}

function toWorkspaceBinding(input: {
  projectId: string;
  projectRoot: string;
  workdirRoot: string;
  record: LocalGitWorktreeRecord;
}): LocalWorkspaceBinding {
  const canonicalPath = path.resolve(input.record.worktreePath);
  const kind = canonicalPath === input.projectRoot ? "project-root" : "worktree";
  return {
    projectId: input.projectId,
    kind,
    canonicalPath,
    branchName: input.record.branchName,
    baseRef: input.record.headRef,
    originalRepoRoot: input.projectRoot,
    lifecycle: kind === "project-root" ? "project-root" : workspaceLifecycle(canonicalPath, input.workdirRoot),
  };
}

function workspaceLifecycle(
  worktreePath: string,
  workdirRoot: string,
): "moebius-temporary" | "user-managed" {
  const normalizedRoot = path.resolve(workdirRoot);
  const managedRoots = [
    path.join(normalizedRoot, "worktrees"),
    path.join(normalizedRoot, "local-worktrees"),
  ];
  return managedRoots.some((managedRoot) => isPathWithin(worktreePath, managedRoot))
    ? "moebius-temporary"
    : "user-managed";
}

function isPathWithin(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function assertUsableGitWorktree(
  worktreePath: string,
  signal: AbortSignal | undefined,
  dependencies: WorkspaceResolverDependencies,
): Promise<void> {
  const result = await runBoundedGit(["-C", worktreePath, "rev-parse", "--show-toplevel"], "worktree-reuse", signal, dependencies, [0]);
  if (result.code !== 0) {
    throw new Error(formatGitFailure("git", result, "worktree-reuse"));
  }
}

async function readHeadRef(
  worktreePath: string,
  signal: AbortSignal | undefined,
  dependencies: WorkspaceResolverDependencies,
): Promise<string> {
  const result = await runBoundedGit(["-C", worktreePath, "rev-parse", "HEAD"], "worktree-head", signal, dependencies, [0]);
  return result.stdout.trim();
}

async function readCurrentBranch(
  worktreePath: string,
  signal: AbortSignal | undefined,
  dependencies: WorkspaceResolverDependencies,
): Promise<string> {
  const result = await runBoundedGit(["-C", worktreePath, "branch", "--show-current"], "worktree-branch", signal, dependencies, [0]);
  const branch = result.stdout.trim();
  return branch === "" ? "detached" : branch;
}

async function runBoundedGit(
  args: string[],
  label: string,
  signal: AbortSignal | undefined,
  dependencies: WorkspaceResolverDependencies,
  acceptedExitCodes = [0],
): Promise<GitProcessResult> {
  return await dependencies.runGit(args, { label, timeoutMs: dependencies.gitTimeoutMs, signal }, acceptedExitCodes);
}

function localWorktreePath(workdirRoot: string, projectId: string, sessionId: string): string {
  const legacyPath = legacyLocalWorktreePath(workdirRoot, projectId, sessionId);
  return existsSync(legacyPath)
    ? legacyPath
    : path.join(workdirRoot, "worktrees", localWorktreeId(projectId, sessionId));
}

function localWorktreeBranch(projectId: string, sessionId: string): string {
  return `moebius/${localWorktreeId(projectId, sessionId)}`;
}

function legacyLocalWorktreePath(workdirRoot: string, projectId: string, sessionId: string): string {
  return path.join(workdirRoot, "local-worktrees", safePathSegment(projectId), safePathSegment(sessionId));
}

function localWorktreeId(projectId: string, sessionId: string): string {
  return createHash("sha256")
    .update("moebius-local-worktree\0")
    .update(projectId)
    .update("\0")
    .update(sessionId)
    .digest("base64url")
    .slice(0, 12);
}

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/gu, "_");
}

function splitNulList(value: string): string[] {
  return value.split("\0").filter((entry) => entry !== "");
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function runGitProcess(
  args: string[],
  options: GitRunOptions,
  acceptedExitCodes: number[],
): Promise<GitProcessResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeoutTimer: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      clearTimeout(timeoutTimer);
      options.signal?.removeEventListener("abort", onAbort);
    };
    const settleReject = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };
    const terminate = () => {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, 1_000).unref?.();
    };
    const onAbort = () => {
      terminate();
      settleReject(new Error(`workspace-git-aborted:${options.label}`));
    };

    timeoutTimer = setTimeout(() => {
      terminate();
      settleReject(new Error(`workspace-git-timeout:${options.label}:${String(options.timeoutMs)}ms`));
    }, options.timeoutMs);
    timeoutTimer.unref?.();

    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });

    if (child.stdout === null || child.stderr === null) {
      settleReject(new Error("git did not expose stdout/stderr pipes"));
      return;
    }
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.once("error", settleReject);
    child.once("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      const result = { code, signal, stdout, stderr };
      if (code !== null && acceptedExitCodes.includes(code)) {
        resolve(result);
        return;
      }
      reject(new Error(formatGitFailure("git", result, options.label)));
    });
  });
}

function formatGitFailure(
  command: string,
  result: { code: number | null; signal: NodeJS.Signals | null; stderr: string },
  label: string,
): string {
  const suffix = result.signal === null ? `exit-code-${String(result.code)}` : `signal-${result.signal}`;
  const detail = result.stderr.trim();
  return detail === "" ? `${command} ${label} failed with ${suffix}` : `${command} ${label} failed with ${suffix}: ${detail}`;
}
