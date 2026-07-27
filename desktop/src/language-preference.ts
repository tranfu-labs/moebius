import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

import {
  isDesktopLocale,
  type DesktopLocale,
} from "./language-preference-contract.js";

const PREFERENCE_VERSION = 1;
const PREFERENCE_FILE_NAME = "language-preference.json";

interface LanguagePreferenceDocument {
  version: typeof PREFERENCE_VERSION;
  locale: DesktopLocale;
}

export interface LanguagePreferenceWriteOperations {
  mkdir(directory: string): Promise<void>;
  writeFile(filePath: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(filePath: string): Promise<void>;
  createTemporaryPath(preferencePath: string): string;
}

const defaultWriteOperations: LanguagePreferenceWriteOperations = {
  async mkdir(directory) {
    await fs.mkdir(directory, { recursive: true });
  },
  async writeFile(filePath, contents) {
    await fs.writeFile(filePath, contents, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
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

export function resolveLanguagePreferencePath(dataRoot: string): string {
  return path.join(dataRoot, ".state", PREFERENCE_FILE_NAME);
}

export function parseLanguagePreference(value: unknown): DesktopLocale {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || (value as Partial<LanguagePreferenceDocument>).version !== PREFERENCE_VERSION
  ) {
    return "zh-CN";
  }
  const locale = (value as Partial<LanguagePreferenceDocument>).locale;
  return isDesktopLocale(locale) ? locale : "zh-CN";
}

export async function readLanguagePreference(dataRoot: string): Promise<DesktopLocale> {
  try {
    const raw = await fs.readFile(resolveLanguagePreferencePath(dataRoot), "utf8");
    return parseLanguagePreference(JSON.parse(raw) as unknown);
  } catch {
    return "zh-CN";
  }
}

export async function saveLanguagePreference(
  dataRoot: string,
  locale: DesktopLocale,
  operations: LanguagePreferenceWriteOperations = defaultWriteOperations,
): Promise<void> {
  const preferencePath = resolveLanguagePreferencePath(dataRoot);
  const directory = path.dirname(preferencePath);
  const temporaryPath = operations.createTemporaryPath(preferencePath);
  const document: LanguagePreferenceDocument = {
    version: PREFERENCE_VERSION,
    locale,
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
