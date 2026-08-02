import fs from "node:fs";
import { parse as parseToml } from "smol-toml";

export interface CodexLocalConfig {
  provider?: string;
  model?: string;
}

export interface LocalConfig {
  codex?: CodexLocalConfig;
}

export const DEFAULT_LOCAL_CONFIG: LocalConfig = {};

export function loadMergedLocalConfig(input: { configPath: string; localConfigPath: string }): LocalConfig {
  const defaultConfig = loadLocalConfig(input.configPath);
  return loadOptionalLocalConfig(input.localConfigPath) ?? defaultConfig;
}

export function loadLocalConfig(filePath: string): LocalConfig {
  return loadOptionalLocalConfig(filePath) ?? DEFAULT_LOCAL_CONFIG;
}

function loadOptionalLocalConfig(filePath: string): LocalConfig | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  return parseLocalConfig(raw, filePath);
}

export function parseLocalConfig(raw: string, source = "config.toml"): LocalConfig {
  let parsed: unknown;
  try {
    parsed = parseToml(raw);
  } catch (error) {
    throw new Error(`Invalid local config TOML at ${source}: ${formatError(error)}`);
  }
  if (!isPlainObject(parsed) || !hasSupportedShape(parsed)) {
    throw new Error(`Invalid local config shape at ${source}`);
  }

  const result: LocalConfig = {};
  if (parsed["codex"] !== undefined) {
    const codex = parsed["codex"] as Record<string, unknown>;
    result.codex = {
      ...(codex["provider"] === undefined ? {} : { provider: String(codex["provider"]).trim() }),
      ...(codex["model"] === undefined ? {} : { model: String(codex["model"]).trim() }),
    };
  }
  return result;
}

function hasSupportedShape(config: Record<string, unknown>): boolean {
  for (const key of Object.keys(config)) {
    if (key !== "codex" && key !== "watchRepositories") {
      return false;
    }
  }
  return isLegacyRepositories(config["watchRepositories"]) && isCodexShape(config["codex"]);
}

function isLegacyRepositories(value: unknown): boolean {
  return value === undefined || (
    Array.isArray(value)
    && value.every((entry) => isPlainObject(entry)
      && typeof entry["owner"] === "string"
      && entry["owner"].trim() !== ""
      && typeof entry["repo"] === "string"
      && entry["repo"].trim() !== "")
  );
}

function isCodexShape(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isPlainObject(value)) return false;
  for (const key of Object.keys(value)) {
    if (key !== "provider" && key !== "model") return false;
  }
  return (value["provider"] === undefined
      || (typeof value["provider"] === "string" && value["provider"].trim() !== ""))
    && (value["model"] === undefined || typeof value["model"] === "string");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
