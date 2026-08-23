import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  inspectTrustedJsonlCandidate,
  readTrustedJsonlRecords,
  resolveTrustedJsonlRoot,
  type TrustedJsonlFile,
} from "./trusted-jsonl.js";

const CLAUDE_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type ClaudeTuiTranscriptUnavailableReason =
  | "invalid-session-id"
  | "root-unavailable"
  | "not-found"
  | "duplicate"
  | "outside-root"
  | "not-a-file"
  | "unreadable"
  | "malformed"
  | "context-mismatch"
  | "cursor-invalid"
  | "no-final-assistant-message";

export type ClaudeTuiTranscriptFileResolution =
  | { status: "available"; file: TrustedJsonlFile }
  | { status: "unavailable"; reason: ClaudeTuiTranscriptUnavailableReason };

export type ClaudeTuiTranscriptFinal =
  | {
      status: "available";
      finalText: string;
      cachedInputTokens: number | null;
      usage: Readonly<Record<string, unknown>> | null;
      filePath: string;
    }
  | { status: "unavailable"; reason: ClaudeTuiTranscriptUnavailableReason };

export interface ClaudeTuiTranscriptOptions {
  sessionId: string;
  cwd: string;
  /** Read final assistant text only from records appended after this boundary. */
  afterRecordCount?: number;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  claudeProjectsRoot?: string;
}

/**
 * Locates the one Claude transcript that is both inside the configured Claude
 * projects root and bound to this canonical session/workspace pair.  This is
 * deliberately independent from terminal bytes and hook payloads.
 */
export async function resolveClaudeTuiTranscriptFile(
  options: ClaudeTuiTranscriptOptions,
): Promise<ClaudeTuiTranscriptFileResolution> {
  if (!CLAUDE_SESSION_ID.test(options.sessionId)) {
    return { status: "unavailable", reason: "invalid-session-id" };
  }
  const root = await resolveTrustedJsonlRoot(resolveClaudeProjectsRoot(options));
  if (root === null) return { status: "unavailable", reason: "root-unavailable" };

  let candidates: string[];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    candidates = entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => path.join(root, entry.name, `${options.sessionId}.jsonl`));
  } catch {
    return { status: "unavailable", reason: "unreadable" };
  }
  const existing: string[] = [];
  for (const candidate of candidates) {
    try {
      await fs.lstat(candidate);
      existing.push(candidate);
    } catch (error) {
      if (!isMissingFileError(error)) {
        return { status: "unavailable", reason: "unreadable" };
      }
    }
  }
  if (existing.length === 0) return { status: "unavailable", reason: "not-found" };
  if (existing.length > 1) return { status: "unavailable", reason: "duplicate" };

  const inspected = await inspectTrustedJsonlCandidate(root, existing[0]!);
  if (inspected.status !== "available") {
    return { status: "unavailable", reason: inspected.reason };
  }
  const expectedCwd = await canonicalComparablePath(options.cwd);
  let observedSession = false;
  let matchingCwd = false;
  let mismatchedSession = false;
  const cwdCache = new Map<string, string>();
  try {
    const records = await readTrustedJsonlRecords({ file: inspected.file });
    if (records.malformedLines > 0) {
      return { status: "unavailable", reason: "malformed" };
    }
    for (const value of records.records) {
      if (!isRecord(value)) continue;
      const recordSessionId = readString(value.sessionId);
      if (recordSessionId !== null) {
        observedSession = true;
        if (recordSessionId !== options.sessionId) mismatchedSession = true;
      }
      const recordCwd = readString(value.cwd);
      if (value.isSidechain !== true && recordCwd !== null) {
        let canonicalCwd = cwdCache.get(recordCwd);
        if (canonicalCwd === undefined) {
          canonicalCwd = await canonicalComparablePath(recordCwd);
          cwdCache.set(recordCwd, canonicalCwd);
        }
        if (canonicalCwd === expectedCwd) matchingCwd = true;
      }
    }
  } catch {
    return { status: "unavailable", reason: "unreadable" };
  }
  if (!observedSession) return { status: "unavailable", reason: "malformed" };
  if (mismatchedSession || !matchingCwd) {
    return { status: "unavailable", reason: "context-mismatch" };
  }
  return { status: "available", file: inspected.file };
}

/**
 * Captures the number of complete, trusted records before a new human input
 * reaches Claude. A missing or still-writing transcript simply has no cursor;
 * final resolution remains responsible for its own fail-closed validation.
 */
export async function captureClaudeTuiTranscriptRecordCount(
  options: ClaudeTuiTranscriptOptions,
): Promise<number | null> {
  const resolution = await resolveClaudeTuiTranscriptFile(options);
  if (resolution.status !== "available") return null;
  try {
    const records = await readTrustedJsonlRecords({ file: resolution.file });
    return records.malformedLines === 0 ? records.records.length : null;
  } catch {
    return null;
  }
}

/**
 * Reads only the final assistant message and its usage after the lifecycle
 * receiver has observed Stop.  It intentionally does not project thought,
 * tool, or terminal records into public Markdown.
 */
export async function resolveClaudeTuiTranscriptFinal(
  options: ClaudeTuiTranscriptOptions,
): Promise<ClaudeTuiTranscriptFinal> {
  const resolution = await resolveClaudeTuiTranscriptFile(options);
  if (resolution.status !== "available") return resolution;
  try {
    const records = await readTrustedJsonlRecords({ file: resolution.file });
    if (records.malformedLines > 0) {
      return { status: "unavailable", reason: "malformed" };
    }
    const afterRecordCount = options.afterRecordCount ?? 0;
    if (
      !Number.isSafeInteger(afterRecordCount)
      || afterRecordCount < 0
      || afterRecordCount > records.records.length
    ) {
      return { status: "unavailable", reason: "cursor-invalid" };
    }
    for (let index = records.records.length - 1; index >= afterRecordCount; index -= 1) {
      const record = records.records[index];
      const message = isRecord(record) && isRecord(record.message) ? record.message : null;
      if (message === null || message.role !== "assistant") continue;
      const finalText = readAssistantText(message.content);
      if (finalText.length === 0) continue;
      const usage = firstRecord(message.usage, isRecord(record) ? record.usage : undefined);
      return {
        status: "available",
        finalText,
        cachedInputTokens: readCachedInputTokens(usage),
        usage,
        filePath: resolution.file.filePath,
      };
    }
    return { status: "unavailable", reason: "no-final-assistant-message" };
  } catch {
    return { status: "unavailable", reason: "unreadable" };
  }
}

function resolveClaudeProjectsRoot(options: ClaudeTuiTranscriptOptions): string {
  if (options.claudeProjectsRoot !== undefined) {
    return path.resolve(options.claudeProjectsRoot);
  }
  const configured = options.env?.CLAUDE_CONFIG_DIR?.trim()
    ?? process.env.CLAUDE_CONFIG_DIR?.trim();
  return path.resolve(
    configured && configured.length > 0
      ? path.join(configured, "projects")
      : path.join(options.homeDir ?? os.homedir(), ".claude", "projects"),
  );
}

function readAssistantText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.flatMap((part) =>
    isRecord(part) && part.type === "text" && typeof part.text === "string"
      ? [part.text]
      : [],
  ).join("");
}

function readCachedInputTokens(usage: Readonly<Record<string, unknown>> | null): number | null {
  if (usage === null) return null;
  for (const key of ["cache_read_input_tokens", "cacheReadInputTokens"]) {
    const value = usage[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  }
  return null;
}

function firstRecord(...values: unknown[]): Readonly<Record<string, unknown>> | null {
  for (const value of values) {
    if (isRecord(value)) return value;
  }
  return null;
}

async function canonicalComparablePath(value: string): Promise<string> {
  const resolved = path.resolve(value);
  try {
    return await fs.realpath(resolved);
  } catch {
    return resolved;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error.code === "ENOENT" || error.code === "ENOTDIR");
}
