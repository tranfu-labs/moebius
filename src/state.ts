import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { ROLE_THREADS_STATE_PATH } from "./config.js";
import type { RoleThreadState } from "./conversation.js";
import {
  githubRunnerSqlitePathForStateFile,
  migrateLegacySharedGitHubState,
} from "./github-state-store.js";
import { runSqliteStateCommand } from "./sqlite-state.js";

export type RoleThreadStateStore = Record<string, Record<string, RoleThreadState>>;

export async function loadRoleThreadStateStore(filePath = ROLE_THREADS_STATE_PATH): Promise<RoleThreadStateStore> {
  await migrateLegacyRoleThreadState(filePath);
  const store = await runSqliteStateCommand<unknown>({
    sqlitePath: githubRunnerSqlitePathForStateFile(filePath),
    command: { kind: "load-role-threads" },
  });
  if (!isRoleThreadStateStore(store)) {
    throw new Error(`Invalid role thread state file: ${filePath}`);
  }
  return store;
}

async function loadLegacyRoleThreadStateStore(filePath: string): Promise<RoleThreadStateStore> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }

  const parsed: unknown = JSON.parse(raw);
  if (!isRoleThreadStateStore(parsed)) {
    throw new Error(`Invalid role thread state file: ${filePath}`);
  }

  return parsed;
}

export async function saveRoleThreadStateStore(
  store: RoleThreadStateStore,
  filePath = ROLE_THREADS_STATE_PATH,
): Promise<void> {
  if (!isRoleThreadStateStore(store)) {
    throw new Error(`Invalid role thread state file: ${filePath}`);
  }
  await migrateLegacyRoleThreadState(filePath);
  await runSqliteStateCommand({
    sqlitePath: githubRunnerSqlitePathForStateFile(filePath),
    command: { kind: "save-role-threads", store },
  });
}

export async function saveRoleThreadStateEntry(
  issueKey: string,
  role: string,
  state: RoleThreadState,
  filePath = ROLE_THREADS_STATE_PATH,
): Promise<void> {
  await withStateFileLock(filePath, async () => {
    await migrateLegacyRoleThreadState(filePath);
    await runSqliteStateCommand({
      sqlitePath: githubRunnerSqlitePathForStateFile(filePath),
      command: { kind: "save-role-thread-entry", issueKey, role, state },
    });
  });
}

export function getRoleThreadState(
  store: RoleThreadStateStore,
  issueKey: string,
  role: string,
): RoleThreadState | null {
  return store[issueKey]?.[role] ?? null;
}

export function withRoleThreadState(
  store: RoleThreadStateStore,
  issueKey: string,
  role: string,
  state: RoleThreadState,
): RoleThreadStateStore {
  return {
    ...store,
    [issueKey]: {
      ...(store[issueKey] ?? {}),
      [role]: state,
    },
  };
}

function isRoleThreadStateStore(value: unknown): value is RoleThreadStateStore {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((issueState) => {
    if (typeof issueState !== "object" || issueState === null || Array.isArray(issueState)) {
      return false;
    }

    return Object.values(issueState).every(isRoleThreadState);
  });
}

function isRoleThreadState(value: unknown): value is RoleThreadState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const state = value as Partial<RoleThreadState>;
  const lastSeenIndex = state.lastSeenIndex;
  return (
    typeof state.threadId === "string" &&
    state.threadId.length > 0 &&
    Number.isInteger(lastSeenIndex) &&
    lastSeenIndex !== undefined &&
    lastSeenIndex >= -1 &&
    (state.provider === undefined || state.provider === "codex") &&
    optionalNonEmptyString(state.contextFingerprint) &&
    optionalNonEmptyString(state.workspaceFingerprint) &&
    optionalNonEmptyString(state.personaFingerprint)
  );
}

function optionalNonEmptyString(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.length > 0);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function migrateLegacyRoleThreadState(filePath: string): Promise<void> {
  await migrateLegacySharedGitHubState({ filePath, source: "role-threads" });
  const sqlitePath = githubRunnerSqlitePathForStateFile(filePath);
  const status = await runSqliteStateCommand<{ status: string | null }>({
    sqlitePath,
    command: { kind: "get-migration-status", source: "role-threads" },
  });
  if (status.status === "imported") {
    return;
  }

  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  const store = await loadLegacyRoleThreadStateStore(filePath);
  await runSqliteStateCommand({
    sqlitePath,
    command: { kind: "import-role-threads", store, legacyDigest: digest(raw) },
  });
}

function digest(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

const stateFileLocks = new Map<string, Promise<void>>();

async function withStateFileLock(filePath: string, operation: () => Promise<void>): Promise<void> {
  const previous = stateFileLocks.get(filePath) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous.catch(() => {}).then(() => current);
  stateFileLocks.set(filePath, next);
  await previous.catch(() => {});

  try {
    await operation();
  } finally {
    release();
    if (stateFileLocks.get(filePath) === next) {
      stateFileLocks.delete(filePath);
    }
  }
}
