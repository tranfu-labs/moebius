import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DESKTOP_DATA_ROOT_ENV = "MOEBIUS_DATA_ROOT";

export interface ResolveDesktopDataRootInput {
  env?: NodeJS.ProcessEnv;
  isPackaged: boolean;
  projectRoot: string;
  homeDir?: string;
}

export interface ResolveDesktopInstanceUserDataPathInput {
  dataRoot: string;
  packagedDefaultDataRoot: string;
  defaultUserDataPath: string;
}

export interface SeedCopyOperation {
  source: string;
  destination: string;
}

export interface SeedCopyPlan {
  operations: SeedCopyOperation[];
  skippedDestinations: string[];
}

export interface SeedPlanFileSystem {
  exists(filePath: string): Promise<boolean>;
  listFiles(root: string): Promise<string[]>;
}

export function resolveDesktopDataRoot(input: ResolveDesktopDataRootInput): string {
  const override = input.env?.[DESKTOP_DATA_ROOT_ENV]?.trim();
  if (override !== undefined && override.length > 0) {
    return path.resolve(override);
  }

  if (input.isPackaged) {
    return path.join(input.homeDir ?? os.homedir(), ".moebius");
  }

  return path.resolve(input.projectRoot);
}

export function resolveDesktopInstanceUserDataPath(input: ResolveDesktopInstanceUserDataPathInput): string {
  const dataRoot = path.resolve(input.dataRoot);
  const packagedDefaultDataRoot = path.resolve(input.packagedDefaultDataRoot);
  if (dataRoot === packagedDefaultDataRoot) {
    return path.resolve(input.defaultUserDataPath);
  }
  return path.join(dataRoot, ".state", "desktop-user-data");
}

export async function buildSeedCopyPlan(input: {
  seedRoot: string;
  dataRoot: string;
  fileSystem?: SeedPlanFileSystem;
}): Promise<SeedCopyPlan> {
  const fileSystem = input.fileSystem ?? nodeSeedPlanFileSystem;
  const candidates = [
    { source: path.join(input.seedRoot, "config.toml"), destination: path.join(input.dataRoot, "config.toml") },
    ...(await listAgentSeedFiles({ seedRoot: input.seedRoot, dataRoot: input.dataRoot, fileSystem })),
  ];

  const operations: SeedCopyOperation[] = [];
  const skippedDestinations: string[] = [];
  for (const candidate of candidates) {
    if (await fileSystem.exists(candidate.destination)) {
      skippedDestinations.push(candidate.destination);
      continue;
    }
    operations.push(candidate);
  }

  return { operations, skippedDestinations };
}

export async function executeSeedCopyPlan(operations: readonly SeedCopyOperation[]): Promise<void> {
  for (const operation of operations) {
    await fs.mkdir(path.dirname(operation.destination), { recursive: true });
    await fs.copyFile(operation.source, operation.destination);
  }
}

async function listAgentSeedFiles(input: {
  seedRoot: string;
  dataRoot: string;
  fileSystem: SeedPlanFileSystem;
}): Promise<SeedCopyOperation[]> {
  const agentsRoot = path.join(input.seedRoot, "agents");
  const files = await input.fileSystem.listFiles(agentsRoot);
  return files.map((source) => {
    const relativePath = path.relative(agentsRoot, source);
    return {
      source,
      destination: path.join(input.dataRoot, "agents", relativePath),
    };
  });
}

const nodeSeedPlanFileSystem: SeedPlanFileSystem = {
  async exists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return false;
      }
      throw error;
    }
  },
  async listFiles(root) {
    return listFilesRecursively(root);
  },
};

async function listFilesRecursively(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursively(fullPath);
      }
      if (entry.isFile()) {
        return [fullPath];
      }
      return [];
    }),
  );
  return files.flat().sort();
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
