import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

const KIMI_CONFIG_FILE = "config.toml";
const KIMI_ISOLATION_DISABLED_TOOLS = ["Agent", "AgentSwarm"] as const;
const KIMI_SHARED_RUNTIME_ENTRIES = [
  "credentials",
  "oauth",
  "device_id",
  "sessions",
  "session_index.jsonl",
] as const;

export interface KimiRuntimeHomePaths {
  sourceHome: string;
  managedHome: string;
}

export function resolveKimiRuntimeHomePaths(input: {
  dataRoot: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}): KimiRuntimeHomePaths {
  const configuredHome = input.env?.KIMI_CODE_HOME?.trim();
  return {
    sourceHome: path.resolve(
      configuredHome && configuredHome.length > 0
        ? configuredHome
        : path.join(input.homeDir ?? os.homedir(), ".kimi-code"),
    ),
    managedHome: path.resolve(input.dataRoot, ".state", "kimi-runtime-home"),
  };
}

export async function prepareKimiRuntimeHome(input: KimiRuntimeHomePaths): Promise<void> {
  const sourceHome = path.resolve(input.sourceHome);
  const managedHome = path.resolve(input.managedHome);
  if (sourceHome === managedHome) {
    throw isolationError("Kimi 的用户配置目录与 Moebius 受管目录发生冲突。");
  }

  await ensureManagedHome(managedHome);
  await writeManagedConfig(sourceHome, managedHome);
  await Promise.all(
    KIMI_SHARED_RUNTIME_ENTRIES.map((entry) =>
      ensureSharedRuntimeEntry(sourceHome, managedHome, entry)),
  );
}

export function withManagedKimiHome(
  env: NodeJS.ProcessEnv,
  managedHome: string,
): NodeJS.ProcessEnv {
  return {
    ...env,
    KIMI_CODE_HOME: path.resolve(managedHome),
  };
}

async function ensureManagedHome(managedHome: string): Promise<void> {
  try {
    await fs.mkdir(managedHome, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(managedHome);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw isolationError("Kimi 受管运行目录不是安全的本地目录。");
    }
    await fs.chmod(managedHome, 0o700);
  } catch (error) {
    if (error instanceof KimiRuntimeIsolationError) {
      throw error;
    }
    throw isolationError("无法建立 Kimi 受管运行目录，已阻止本次运行。", error);
  }
}

async function writeManagedConfig(sourceHome: string, managedHome: string): Promise<void> {
  const sourcePath = path.join(sourceHome, KIMI_CONFIG_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(sourcePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      raw = "";
    } else {
      throw isolationError("无法读取 Kimi 用户配置，已阻止本次运行。", error);
    }
  }

  let parsed: unknown;
  try {
    parsed = parseToml(raw);
  } catch (error) {
    throw isolationError("Kimi 用户配置无法解析，已阻止本次运行。", error);
  }
  if (!isRecord(parsed)) {
    throw isolationError("Kimi 用户配置不是有效的配置对象，已阻止本次运行。");
  }

  const tools = parsed.tools;
  if (tools !== undefined && !isRecord(tools)) {
    throw isolationError("Kimi 的 tools 配置格式无效，已阻止本次运行。");
  }
  const disabled = tools?.disabled;
  if (
    disabled !== undefined
    && (!Array.isArray(disabled) || disabled.some((value) => typeof value !== "string"))
  ) {
    throw isolationError("Kimi 的 tools.disabled 配置格式无效，已阻止本次运行。");
  }

  const existingDisabled = disabled === undefined ? [] : disabled as string[];
  const nextDisabled = [...existingDisabled];
  for (const tool of KIMI_ISOLATION_DISABLED_TOOLS) {
    if (!nextDisabled.includes(tool)) {
      nextDisabled.push(tool);
    }
  }
  parsed.tools = {
    ...(tools ?? {}),
    disabled: nextDisabled,
  };

  const targetPath = path.join(managedHome, KIMI_CONFIG_FILE);
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await fs.writeFile(temporaryPath, stringifyToml(parsed), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await fs.rename(temporaryPath, targetPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw isolationError("无法建立 Kimi 受管隔离配置，已阻止本次运行。", error);
  }
}

async function ensureSharedRuntimeEntry(
  sourceHome: string,
  managedHome: string,
  entry: string,
): Promise<void> {
  const sourcePath = path.join(sourceHome, entry);
  const targetPath = path.join(managedHome, entry);
  let sourceStat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    sourceStat = await fs.lstat(sourcePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }
    throw isolationError(`无法检查 Kimi 运行资料：${entry}。`, error);
  }

  try {
    const targetStat = await fs.lstat(targetPath);
    if (!targetStat.isSymbolicLink()) {
      throw isolationError(`Kimi 受管目录中的 ${entry} 不是受控引用。`);
    }
    const linkedPath = path.resolve(path.dirname(targetPath), await fs.readlink(targetPath));
    if (linkedPath !== sourcePath) {
      throw isolationError(`Kimi 受管目录中的 ${entry} 指向了意外位置。`);
    }
    return;
  } catch (error) {
    if (!(isNodeError(error) && error.code === "ENOENT")) {
      if (error instanceof KimiRuntimeIsolationError) {
        throw error;
      }
      throw isolationError(`无法检查 Kimi 受管运行资料：${entry}。`, error);
    }
  }

  try {
    await fs.symlink(
      sourcePath,
      targetPath,
      sourceStat.isDirectory() ? "dir" : "file",
    );
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      await ensureSharedRuntimeEntry(sourceHome, managedHome, entry);
      return;
    }
    throw isolationError(`无法隔离 Kimi 运行资料：${entry}。`, error);
  }
}

function isolationError(message: string, cause?: unknown): KimiRuntimeIsolationError {
  return new KimiRuntimeIsolationError(message, { cause });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export class KimiRuntimeIsolationError extends Error {
  readonly code = "KIMI_RUNTIME_ISOLATION_FAILED";

  constructor(readonly safeMessage: string, options?: ErrorOptions) {
    super(safeMessage, options);
    this.name = "KimiRuntimeIsolationError";
  }
}
