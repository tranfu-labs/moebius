import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";

import { parseAgentMarkdownFrontmatter } from "../agent-frontmatter.js";

export const MOEBIUS_SKILL_SOURCE_DIRECTORY = ".agents/skills";
export const MOEBIUS_SKILL_REGISTRY_DIRECTORY = "skills/moebius";
export const MOEBIUS_SKILL_PROJECTION_HOME_ENV = "MOEBIUS_SKILL_PROJECTION_HOME";
export const MOEBIUS_SKILL_PROVIDER_LINK_PREFIX = "moebius-";
export const MOEBIUS_SKILL_PROVIDERS = ["claude", "codex"] as const;

const skillMaterializationLocks = new Map<string, Promise<void>>();

export type MoebiusSkillProvider = (typeof MOEBIUS_SKILL_PROVIDERS)[number];
export type MoebiusSkillProjectionLinkStatus =
  | "created"
  | "existing"
  | "conflict"
  | "failed";

export interface MoebiusSkillMetadata {
  directoryName: string;
  name: string;
  description: string;
  sourcePath: string;
  registryPath: string;
  providerLinkName: string;
}

export interface MoebiusSkillProjectionLink {
  skill: string;
  path: string;
  target: string;
  status: MoebiusSkillProjectionLinkStatus;
}

export interface MoebiusSkillProjection {
  provider: MoebiusSkillProvider;
  root: string;
  links: MoebiusSkillProjectionLink[];
}

export interface MoebiusSkillRegistryResult {
  registryRoot: string;
  skills: MoebiusSkillMetadata[];
  projections: MoebiusSkillProjection[];
  diagnostics: string[];
}

export interface InstallMoebiusSkillRegistryInput {
  dataRoot: string;
  sourceRoot?: string;
  projectionHomeDir: string;
  providers?: readonly MoebiusSkillProvider[];
}

export async function installMoebiusSkillRegistryAtStartup(
  dataRoot: string,
  sourceRoot: string | undefined,
  projectionHomeDir: string | undefined,
  logDiagnostic?: (diagnostic: string) => void,
): Promise<MoebiusSkillRegistryResult | null> {
  if (projectionHomeDir === undefined) {
    return null;
  }
  const result = await installMoebiusSkillRegistry({
    dataRoot,
    sourceRoot,
    projectionHomeDir,
  });
  for (const diagnostic of result.diagnostics) {
    logDiagnostic?.(diagnostic);
  }
  return result;
}

/**
 * Resolve the home used for provider-standard Skill projections.
 *
 * The environment override is intentionally test/dev scoped: production uses
 * the real user home, while isolated acceptance runs can keep all writes in a
 * temporary data root.
 */
export function resolveMoebiusSkillProjectionHomeDir(
  env: NodeJS.ProcessEnv = process.env,
  fallback = os.homedir(),
): string {
  const configured = env[MOEBIUS_SKILL_PROJECTION_HOME_ENV]?.trim();
  return path.resolve(configured === undefined || configured.length === 0 ? fallback : configured);
}

export async function installMoebiusSkillRegistry(
  input: InstallMoebiusSkillRegistryInput,
): Promise<MoebiusSkillRegistryResult> {
  const dataRoot = path.resolve(input.dataRoot);
  const sourceRoot = path.resolve(input.sourceRoot ?? path.join(dataRoot, MOEBIUS_SKILL_SOURCE_DIRECTORY));
  const registryRoot = path.join(dataRoot, MOEBIUS_SKILL_REGISTRY_DIRECTORY);
  const projectionHomeDir = path.resolve(input.projectionHomeDir);
  const providers = input.providers ?? MOEBIUS_SKILL_PROVIDERS;
  const result: MoebiusSkillRegistryResult = {
    registryRoot,
    skills: [],
    projections: providers.map((provider) => ({
      provider,
      root: providerSkillsRoot(projectionHomeDir, provider),
      links: [],
    })),
    diagnostics: [],
  };

  let sourceEntries: Dirent<string>[];
  try {
    sourceEntries = await fs.readdir(sourceRoot, { withFileTypes: true });
  } catch (error) {
    result.diagnostics.push(`无法读取 Moebius Skill 源目录：${sourceRoot}；${formatError(error)}`);
    return result;
  }

  try {
    await fs.mkdir(registryRoot, { recursive: true });
  } catch (error) {
    result.diagnostics.push(`无法创建 Moebius Skill 注册表目录：${registryRoot}；${formatError(error)}`);
    return result;
  }

  for (const entry of sourceEntries.sort((left, right) => left.name.localeCompare(right.name))) {
    const sourcePath = path.join(sourceRoot, entry.name);
    if (!(entry.isDirectory() || await isDirectorySymlink(sourcePath, entry.isSymbolicLink()))) {
      continue;
    }
    if (!isSafeSkillDirectoryName(entry.name)) {
      result.diagnostics.push(`跳过名称不符合 Skill 目录约定的目录：${sourcePath}`);
      continue;
    }

    const skillFilePath = path.join(sourcePath, "SKILL.md");
    let metadata: Pick<MoebiusSkillMetadata, "name" | "description">;
    try {
      metadata = await readSkillMetadata(skillFilePath);
    } catch (error) {
      result.diagnostics.push(`跳过无效的 Moebius Skill：${skillFilePath}；${formatError(error)}`);
      continue;
    }

    const registryPath = path.join(registryRoot, entry.name);
    try {
      await materializeSkillDirectory(sourcePath, registryPath);
    } catch (error) {
      result.diagnostics.push(`无法写入 Moebius Skill 注册表：${registryPath}；${formatError(error)}`);
      continue;
    }

    result.skills.push({
      directoryName: entry.name,
      name: metadata.name,
      description: metadata.description,
      sourcePath,
      registryPath,
      providerLinkName: `${MOEBIUS_SKILL_PROVIDER_LINK_PREFIX}${entry.name}`,
    });
  }

  for (const projection of result.projections) {
    await projectSkills(result.skills, projection, result.diagnostics);
  }
  return result;
}

async function projectSkills(
  skills: readonly MoebiusSkillMetadata[],
  projection: MoebiusSkillProjection,
  diagnostics: string[],
): Promise<void> {
  try {
    await fs.mkdir(projection.root, { recursive: true });
  } catch (error) {
    diagnostics.push(`无法创建 ${projection.provider} Skill 投影目录：${projection.root}；${formatError(error)}`);
    for (const skill of skills) {
      projection.links.push({
        skill: skill.directoryName,
        path: path.join(projection.root, skill.providerLinkName),
        target: skill.registryPath,
        status: "failed",
      });
    }
    return;
  }

  for (const skill of skills) {
    const linkPath = path.join(projection.root, skill.providerLinkName);
    const status = await ensureSkillLink(linkPath, skill.registryPath);
    projection.links.push({
      skill: skill.directoryName,
      path: linkPath,
      target: skill.registryPath,
      status,
    });
    if (status === "conflict" || status === "failed") {
      diagnostics.push(`${projection.provider} Skill 投影未建立：${linkPath}（${status}）`);
    }
  }
}

async function readSkillMetadata(
  skillFilePath: string,
): Promise<Pick<MoebiusSkillMetadata, "name" | "description">> {
  const markdown = await fs.readFile(skillFilePath, "utf8");
  const parsed = parseAgentMarkdownFrontmatter(markdown);
  if (parsed.frontmatter === null) {
    throw new Error("缺少 YAML frontmatter");
  }
  const name = readNonEmptyString(parsed.frontmatter.name, "name");
  const description = readNonEmptyString(parsed.frontmatter.description, "description");
  return { name, description };
}

async function materializeSkillDirectory(sourcePath: string, registryPath: string): Promise<void> {
  const previous = skillMaterializationLocks.get(registryPath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  skillMaterializationLocks.set(registryPath, current);
  await previous;
  try {
    let existing: Awaited<ReturnType<typeof fs.lstat>> | undefined;
    try {
      existing = await fs.lstat(registryPath);
    } catch (error) {
      if (!isNodeErrorWithCode(error, "ENOENT")) {
        throw error;
      }
    }
    if (existing !== undefined && (existing.isSymbolicLink() || !existing.isDirectory())) {
      throw new Error("注册表目标已被非目录条目占用");
    }
    await fs.cp(sourcePath, registryPath, { recursive: true, force: true });
  } finally {
    release();
    if (skillMaterializationLocks.get(registryPath) === current) {
      skillMaterializationLocks.delete(registryPath);
    }
  }
}

async function ensureSkillLink(
  linkPath: string,
  targetPath: string,
): Promise<MoebiusSkillProjectionLinkStatus> {
  try {
    const existing = await fs.lstat(linkPath);
    if (!existing.isSymbolicLink()) {
      return "conflict";
    }
    const currentTarget = path.resolve(path.dirname(linkPath), await fs.readlink(linkPath));
    return currentTarget === path.resolve(targetPath) ? "existing" : "conflict";
  } catch (error) {
    if (!isNodeErrorWithCode(error, "ENOENT")) {
      return "failed";
    }
  }

  try {
    await fs.symlink(targetPath, linkPath, "dir");
    return "created";
  } catch (error) {
    if (isNodeErrorWithCode(error, "EEXIST")) {
      return ensureSkillLink(linkPath, targetPath);
    }
    return "failed";
  }
}

async function isDirectorySymlink(filePath: string, isSymlink: boolean): Promise<boolean> {
  if (!isSymlink) {
    return false;
  }
  try {
    return (await fs.stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

function providerSkillsRoot(homeDir: string, provider: MoebiusSkillProvider): string {
  return provider === "claude"
    ? path.join(homeDir, ".claude", "skills")
    : path.join(homeDir, ".codex", "skills");
}

function isSafeSkillDirectoryName(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/u.test(value);
}

function readNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`frontmatter.${field} 必须是非空字符串`);
  }
  return value.trim();
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === code;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
