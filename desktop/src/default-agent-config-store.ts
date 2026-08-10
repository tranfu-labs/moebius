import fs from "node:fs/promises";
import path from "node:path";

import {
  normalizeExecutionProfile,
  type ExecutionProfile,
} from "./team-execution-profile.js";

const DEFAULT_AGENT_FILE = "default-agent-v1.json";

export interface DefaultAgentConfigDocumentV1 {
  schemaVersion: 1;
  /** Saved by the user; `null` until the first save. */
  profile: ExecutionProfile | null;
}

export interface DefaultAgentConfigStore {
  read(): Promise<DefaultAgentConfigDocumentV1>;
  save(profile: ExecutionProfile): Promise<DefaultAgentConfigDocumentV1>;
}

/**
 * The app-wide default Agent is a singleton execution profile owned by the
 * application itself — independent of any team, member or session. Without a
 * saved choice it resolves to the built-in general-assistant recommendation
 * (`DEFAULT_TEAM_EXECUTION_PROFILE`), never to blank.
 */
export function createDefaultAgentConfigStore(input: { dataRoot: string }): DefaultAgentConfigStore {
  const filePath = path.join(path.resolve(input.dataRoot), ".state", "agent-teams", DEFAULT_AGENT_FILE);
  return {
    async read() {
      const value = await readOptionalJson(filePath);
      if (value === null) {
        return { schemaVersion: 1, profile: null };
      }
      return normalizeDefaultAgentConfigDocument(value);
    },
    async save(profile) {
      const document = normalizeDefaultAgentConfigDocument({
        schemaVersion: 1,
        profile: normalizeExecutionProfile(profile),
      });
      await writeJsonAtomically(filePath, document);
      return document;
    },
  };
}

function normalizeDefaultAgentConfigDocument(value: unknown): DefaultAgentConfigDocumentV1 {
  if (!isPlainObject(value) || value.schemaVersion !== 1) {
    throw new DefaultAgentConfigError("默认 Agent 配置文件格式无效。");
  }
  const profile = value.profile;
  if (profile === null) {
    return { schemaVersion: 1, profile: null };
  }
  if (profile === undefined || !isPlainObject(profile)) {
    throw new DefaultAgentConfigError("默认 Agent 运行配置无效。");
  }
  return { schemaVersion: 1, profile: normalizeExecutionProfile(profile) };
}

async function readOptionalJson(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    if (error instanceof SyntaxError) {
      throw new DefaultAgentConfigError("默认 Agent 配置文件无法解析。");
    }
    throw error;
  }
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export class DefaultAgentConfigError extends Error {
  readonly code = "DEFAULT_AGENT_CONFIG_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "DefaultAgentConfigError";
  }
}
