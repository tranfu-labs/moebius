import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

const PREFERENCE_VERSION = 1;
const PREFERENCE_FILE_NAME = "notification-preference.json";

export interface TaskReminderPreferenceDocument {
  version: typeof PREFERENCE_VERSION;
  /** 任务提醒总开关；默认开启。 */
  enabled: boolean;
}

export interface TaskReminderPreferenceWriteOperations {
  mkdir(directory: string): Promise<void>;
  writeFile(filePath: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(filePath: string): Promise<void>;
  createTemporaryPath(preferencePath: string): string;
}

const defaultWriteOperations: TaskReminderPreferenceWriteOperations = {
  async mkdir(directory) {
    await fs.mkdir(directory, { recursive: true });
  },
  async writeFile(filePath, contents) {
    await fs.writeFile(filePath, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
  },
  async rename(from, to) {
    await fs.rename(from, to);
  },
  async remove(filePath) {
    await fs.rm(filePath, { force: true });
  },
  createTemporaryPath(preferencePath) {
    return `${preferencePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  },
};

export function resolveTaskReminderPreferencePath(dataRoot: string): string {
  return path.join(dataRoot, ".state", PREFERENCE_FILE_NAME);
}

export function parseTaskReminderPreference(value: unknown): boolean {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || (value as Partial<TaskReminderPreferenceDocument>).version !== PREFERENCE_VERSION
  ) {
    return true;
  }
  const enabled = (value as Partial<TaskReminderPreferenceDocument>).enabled;
  return typeof enabled === "boolean" ? enabled : true;
}

export async function readTaskReminderPreference(dataRoot: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(resolveTaskReminderPreferencePath(dataRoot), "utf8");
    return parseTaskReminderPreference(JSON.parse(raw) as unknown);
  } catch {
    return true;
  }
}

export async function saveTaskReminderPreference(
  dataRoot: string,
  enabled: boolean,
  operations: TaskReminderPreferenceWriteOperations = defaultWriteOperations,
): Promise<void> {
  const preferencePath = resolveTaskReminderPreferencePath(dataRoot);
  const directory = path.dirname(preferencePath);
  const temporaryPath = operations.createTemporaryPath(preferencePath);
  const document: TaskReminderPreferenceDocument = {
    version: PREFERENCE_VERSION,
    enabled,
  };
  await operations.mkdir(directory);
  try {
    await operations.writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`);
    await operations.rename(temporaryPath, preferencePath);
  } catch (error) {
    await operations.remove(temporaryPath).catch(() => undefined);
    throw error;
  }
}
