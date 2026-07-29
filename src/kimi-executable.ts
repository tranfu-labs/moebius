import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export type KimiExecutableFailureCode =
  | "kimi-cli-not-found"
  | "kimi-cli-not-executable";

export interface ResolveKimiExecutableOptions {
  pathValue: string | undefined;
  cwd: string;
  homeDir: string;
  stat?: typeof fs.stat;
  access?: typeof fs.access;
}

export async function resolveKimiExecutable(
  options: ResolveKimiExecutableOptions,
): Promise<string> {
  const stat = options.stat ?? fs.stat;
  const access = options.access ?? fs.access;
  const pathCandidates = (options.pathValue === undefined
    ? []
    : options.pathValue.split(path.delimiter))
    .map((entry) => path.resolve(options.cwd, entry, "kimi"));

  for (const candidate of pathCandidates) {
    if (!await candidateExists(candidate, stat)) {
      continue;
    }
    await assertExecutableRegularFile(candidate, stat, access);
    return candidate;
  }

  const defaultCandidate = path.resolve(options.homeDir, ".kimi-code", "bin", "kimi");
  if (!await candidateExists(defaultCandidate, stat)) {
    throw new KimiExecutableError(
      "kimi-cli-not-found",
      "没有找到 Kimi CLI。请先安装 Kimi，然后重试。",
    );
  }
  await assertExecutableRegularFile(defaultCandidate, stat, access);
  return defaultCandidate;
}

async function candidateExists(
  candidate: string,
  stat: typeof fs.stat,
): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT") || isNodeErrorCode(error, "ENOTDIR")) {
      return false;
    }
    if (isNodeErrorCode(error, "EACCES") || isNodeErrorCode(error, "EPERM")) {
      throw notExecutableError();
    }
    throw error;
  }
}

async function assertExecutableRegularFile(
  candidate: string,
  stat: typeof fs.stat,
  access: typeof fs.access,
): Promise<void> {
  const info = await stat(candidate);
  if (!info.isFile()) {
    throw notExecutableError();
  }
  try {
    await access(candidate, fsConstants.X_OK);
  } catch {
    throw notExecutableError();
  }
}

function notExecutableError(): KimiExecutableError {
  return new KimiExecutableError(
    "kimi-cli-not-executable",
    "找到 Kimi CLI，但它不可执行。请修复文件执行权限后重试。",
  );
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === code;
}

export class KimiExecutableError extends Error {
  constructor(
    readonly code: KimiExecutableFailureCode,
    readonly safeMessage: string,
  ) {
    super(safeMessage);
    this.name = "KimiExecutableError";
  }
}
