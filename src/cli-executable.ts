import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export interface ResolveCliExecutableOptions {
  executableName: string;
  defaultRelativePath: readonly string[];
  pathValue: string | undefined;
  cwd: string;
  homeDir: string;
  stat?: typeof fs.stat;
  access?: typeof fs.access;
  notFound: () => Error;
  notExecutable: () => Error;
}

export async function resolveCliExecutable(
  options: ResolveCliExecutableOptions,
): Promise<string> {
  const stat = options.stat ?? fs.stat;
  const access = options.access ?? fs.access;
  const pathCandidates = (options.pathValue === undefined
    ? []
    : options.pathValue.split(path.delimiter))
    .map((entry) => path.resolve(options.cwd, entry, options.executableName));

  for (const candidate of pathCandidates) {
    if (!await candidateExists(candidate, stat, options.notExecutable)) {
      continue;
    }
    await assertExecutableRegularFile(candidate, stat, access, options.notExecutable);
    return candidate;
  }

  const defaultCandidate = path.resolve(options.homeDir, ...options.defaultRelativePath);
  if (!await candidateExists(defaultCandidate, stat, options.notExecutable)) {
    throw options.notFound();
  }
  await assertExecutableRegularFile(
    defaultCandidate,
    stat,
    access,
    options.notExecutable,
  );
  return defaultCandidate;
}

async function candidateExists(
  candidate: string,
  stat: typeof fs.stat,
  notExecutable: () => Error,
): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT") || isNodeErrorCode(error, "ENOTDIR")) {
      return false;
    }
    if (isNodeErrorCode(error, "EACCES") || isNodeErrorCode(error, "EPERM")) {
      throw notExecutable();
    }
    throw error;
  }
}

async function assertExecutableRegularFile(
  candidate: string,
  stat: typeof fs.stat,
  access: typeof fs.access,
  notExecutable: () => Error,
): Promise<void> {
  const info = await stat(candidate);
  if (!info.isFile()) {
    throw notExecutable();
  }
  try {
    await access(candidate, fsConstants.X_OK);
  } catch {
    throw notExecutable();
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === code;
}
