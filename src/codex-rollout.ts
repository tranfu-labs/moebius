import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import { planCodexRolloutPromptProjection } from "./local-console/codex-rollout-invocation-plan.js";
import {
  malformedCodexRolloutEvent,
  projectCodexRolloutRecord,
  type LocalConsoleProcessEvent,
} from "./local-console/process-event-projector.js";
import {
  inspectTrustedJsonlCandidate,
  openValidatedTrustedJsonl,
  readTrustedJsonlAppend,
  readTrustedJsonlPage,
  sameTrustedJsonlFile,
  TrustedJsonlCursorInvalidError,
  type TrustedJsonlFile,
} from "./trusted-jsonl.js";

export type CodexRolloutUnavailableReason =
  | "invalid-thread-id"
  | "sessions-root-unavailable"
  | "not-found"
  | "duplicate"
  | "outside-sessions-root"
  | "not-a-file"
  | "unreadable";

export interface CodexRolloutIdentity {
  realPath: string;
  device: number;
  inode: number;
  size: number;
}

export type CodexRolloutResolution =
  | {
      status: "available";
      filePath: string;
      sessionsRoot: string;
      identity: CodexRolloutIdentity;
    }
  | {
      status: "unavailable";
      reason: CodexRolloutUnavailableReason;
    };

export interface ResolveCodexRolloutOptions {
  codexHome?: string;
  sessionsRoot?: string;
}

export interface ReadCodexRolloutPageOptions {
  resolution: Extract<CodexRolloutResolution, { status: "available" }>;
  runId: string;
  endOffset?: number;
  expectedIdentity?: Pick<CodexRolloutIdentity, "realPath" | "device" | "inode">;
  minimumSize?: number;
  maxBytes?: number;
  maxEvents?: number;
}

export interface ReadCodexRolloutAppendOptions {
  resolution: Extract<CodexRolloutResolution, { status: "available" }>;
  runId: string;
  startOffset: number;
  expectedIdentity: Pick<CodexRolloutIdentity, "realPath" | "device" | "inode">;
  minimumSize: number;
  maxBytes?: number;
  maxEvents?: number;
}

export interface ReadCodexRolloutInvocationOptions {
  resolution: Extract<CodexRolloutResolution, { status: "available" }>;
  expectedIdentity?: Pick<CodexRolloutIdentity, "realPath" | "device" | "inode">;
  minimumSize?: number;
  maxBytes?: number;
}

export interface CodexRolloutPromptLayer {
  status: "recorded" | "not-recorded";
  contents: string[];
}

export interface CodexRolloutInvocation {
  status: "available";
  prompts: {
    system: CodexRolloutPromptLayer;
    developer: CodexRolloutPromptLayer;
    user: CodexRolloutPromptLayer;
  };
  metadata: {
    model: string | null;
    effort: string | null;
    provider: string | null;
    cliVersion: string | null;
    cwd: string | null;
  };
  identity: CodexRolloutIdentity;
}

export interface CodexRolloutMalformedInvocation {
  status: "malformed";
  reason: "too-large" | "no-complete-records" | "records-unreadable";
}

export interface CodexRolloutEventSlice {
  events: LocalConsoleProcessEvent[];
  rawBytes: number;
  startOffset: number;
  endOffset: number;
  completeEndOffset: number;
  previousOffset: number | null;
  nextOffset: number;
  identity: CodexRolloutIdentity;
}

export class CodexRolloutCursorInvalidError extends Error {
  constructor(message = "Codex rollout cursor is no longer valid") {
    super(message);
    this.name = "CodexRolloutCursorInvalidError";
  }
}

const THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const READ_CHUNK_BYTES = 64 * 1024;
const DEFAULT_INVOCATION_MAX_BYTES = 64 * 1024 * 1024;
const RESOLUTION_CACHE_TTL_MS = 30_000;

interface CachedRolloutResolution {
  resolution: Extract<CodexRolloutResolution, { status: "available" }>;
  lastFullScanAt: number;
}

const rolloutResolutionCache = new Map<string, CachedRolloutResolution>();

interface CachedRolloutRootIndex {
  filePaths: string[];
  scannedAt: number;
}

const rolloutRootIndexCache = new Map<string, CachedRolloutRootIndex>();

export function resolveCodexSessionsRoot(options: ResolveCodexRolloutOptions = {}): string {
  if (options.sessionsRoot !== undefined) {
    return path.resolve(options.sessionsRoot);
  }
  const codexHome = options.codexHome
    ?? nonEmpty(process.env.CODEX_HOME)
    ?? path.join(os.homedir(), ".codex");
  return path.resolve(codexHome, "sessions");
}

export async function resolveCodexRollout(
  threadId: string,
  options: ResolveCodexRolloutOptions = {},
): Promise<CodexRolloutResolution> {
  if (!THREAD_ID_PATTERN.test(threadId)) {
    return { status: "unavailable", reason: "invalid-thread-id" };
  }
  const configuredRoot = resolveCodexSessionsRoot(options);
  let sessionsRoot: string;
  try {
    sessionsRoot = await fs.realpath(configuredRoot);
  } catch {
    return { status: "unavailable", reason: "sessions-root-unavailable" };
  }
  const cacheKey = `${sessionsRoot}\0${threadId}`;
  const cached = rolloutResolutionCache.get(cacheKey);
  if (cached !== undefined && Date.now() - cached.lastFullScanAt < RESOLUTION_CACHE_TTL_MS) {
    const refreshed = await inspectRolloutCandidate(sessionsRoot, cached.resolution.filePath);
    if (
      refreshed.status === "available"
      && sameCodexRolloutFile(cached.resolution.identity, refreshed.identity)
      && refreshed.identity.size >= cached.resolution.identity.size
    ) {
      rolloutResolutionCache.set(cacheKey, {
        resolution: refreshed,
        lastFullScanAt: cached.lastFullScanAt,
      });
      return refreshed;
    }
    rolloutResolutionCache.delete(cacheKey);
  }

  let rootIndex = rolloutRootIndexCache.get(sessionsRoot);
  const now = Date.now();
  let reusedRootIndex = rootIndex !== undefined
    && now - rootIndex.scannedAt < RESOLUTION_CACHE_TTL_MS;
  if (rootIndex === undefined || now - rootIndex.scannedAt >= RESOLUTION_CACHE_TTL_MS) {
    try {
      rootIndex = await scanRolloutRoot(sessionsRoot);
      reusedRootIndex = false;
    } catch {
      return { status: "unavailable", reason: "unreadable" };
    }
  }
  let candidates = rolloutCandidates(rootIndex, threadId);
  if (candidates.length === 0 && reusedRootIndex) {
    try {
      rootIndex = await scanRolloutRoot(sessionsRoot);
      candidates = rolloutCandidates(rootIndex, threadId);
    } catch {
      return { status: "unavailable", reason: "unreadable" };
    }
  }

  if (candidates.length === 0) {
    rolloutResolutionCache.delete(cacheKey);
    return { status: "unavailable", reason: "not-found" };
  }
  if (candidates.length > 1) {
    rolloutResolutionCache.delete(cacheKey);
    return { status: "unavailable", reason: "duplicate" };
  }

  const resolution = await inspectRolloutCandidate(sessionsRoot, candidates[0]!);
  if (resolution.status === "available") {
    rolloutResolutionCache.set(cacheKey, {
      resolution,
      lastFullScanAt: rootIndex.scannedAt,
    });
  } else {
    rolloutResolutionCache.delete(cacheKey);
  }
  return resolution;
}

async function scanRolloutRoot(sessionsRoot: string): Promise<CachedRolloutRootIndex> {
  const filePaths: string[] = [];
  const pending = [sessionsRoot];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    let entries: Dirent[];
    entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
        filePaths.push(entryPath);
      }
    }
  }
  const index = { filePaths, scannedAt: Date.now() };
  rolloutRootIndexCache.set(sessionsRoot, index);
  return index;
}

function rolloutCandidates(index: CachedRolloutRootIndex, threadId: string): string[] {
  return index.filePaths.filter((filePath) => filePath.endsWith(`-${threadId}.jsonl`));
}

export function sameCodexRolloutFile(
  expected: Pick<CodexRolloutIdentity, "realPath" | "device" | "inode">,
  actual: Pick<CodexRolloutIdentity, "realPath" | "device" | "inode">,
): boolean {
  return sameTrustedJsonlFile(expected, actual);
}

export async function readCodexRolloutInvocation(
  options: ReadCodexRolloutInvocationOptions,
): Promise<CodexRolloutInvocation | CodexRolloutMalformedInvocation> {
  const maxBytes = positiveInteger(
    options.maxBytes ?? DEFAULT_INVOCATION_MAX_BYTES,
    "maxBytes",
  );
  const opened = await openValidatedRollout(
    options.resolution,
    options.expectedIdentity,
    options.minimumSize,
  );
  try {
    const completeEndOffset = await findCompleteJsonlEnd(opened.handle, opened.identity.size);
    if (completeEndOffset === 0) {
      return { status: "malformed", reason: "no-complete-records" };
    }
    if (completeEndOffset > maxBytes) {
      return { status: "malformed", reason: "too-large" };
    }
    const buffer = await readRange(opened.handle, 0, completeEndOffset);
    const system: string[] = [];
    const developer: string[] = [];
    const user: string[] = [];
    let model: string | null = null;
    let effort: string | null = null;
    let provider: string | null = null;
    let cliVersion: string | null = null;
    let cwd: string | null = null;
    let readableRecords = 0;

    for (const rawLine of buffer.toString("utf8").split("\n")) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (line === "") {
        continue;
      }
      let record: unknown;
      try {
        record = JSON.parse(line) as unknown;
      } catch {
        continue;
      }
      if (!isRecord(record)) {
        continue;
      }
      readableRecords += 1;
      const topLevelType = readString(record.type);
      const payload = isRecord(record.payload) ? record.payload : null;
      if (payload === null) {
        continue;
      }
      if (topLevelType === "session_meta") {
        const instructions = isRecord(payload.base_instructions)
          ? readString(payload.base_instructions.text)
          : readString(payload.base_instructions);
        pushDistinct(system, instructions);
        provider = readString(payload.model_provider)
          ?? readString(payload.provider)
          ?? provider;
        cliVersion = readString(payload.cli_version)
          ?? readString(payload.codex_version)
          ?? cliVersion;
        cwd = readString(payload.cwd) ?? cwd;
        continue;
      }
      if (topLevelType === "turn_context") {
        model = readString(payload.model) ?? model;
        effort = readString(payload.effort)
          ?? readString(payload.reasoning_effort)
          ?? effort;
        provider = readString(payload.model_provider)
          ?? readString(payload.provider)
          ?? provider;
        cwd = readString(payload.cwd) ?? cwd;
        continue;
      }
      if (topLevelType !== "response_item" || payload.type !== "message") {
        continue;
      }
      const content = readPromptContent(payload.content);
      const promptProjection = planCodexRolloutPromptProjection(payload.role, content);
      pushDistinct(developer, promptProjection.developer);
      pushDistinct(user, promptProjection.user);
    }

    if (readableRecords === 0) {
      return { status: "malformed", reason: "records-unreadable" };
    }
    const finalStat = await opened.handle.stat();
    const finalIdentity = {
      realPath: opened.identity.realPath,
      device: finalStat.dev,
      inode: finalStat.ino,
      size: finalStat.size,
    };
    if (
      !finalStat.isFile()
      || !sameCodexRolloutFile(opened.identity, finalIdentity)
      || finalIdentity.size < completeEndOffset
    ) {
      throw new CodexRolloutCursorInvalidError("Codex rollout changed while reading invocation");
    }
    return {
      status: "available",
      prompts: {
        system: promptLayer(system),
        developer: promptLayer(developer),
        user: promptLayer(user),
      },
      metadata: { model, effort, provider, cliVersion, cwd },
      identity: finalIdentity,
    };
  } finally {
    await opened.handle.close();
  }
}

export async function readCodexRolloutPage(
  options: ReadCodexRolloutPageOptions,
): Promise<CodexRolloutEventSlice> {
  try {
    const slice = await readTrustedJsonlPage({
      file: trustedFile(options.resolution),
      ...(options.endOffset === undefined ? {} : { endOffset: options.endOffset }),
      ...(options.expectedIdentity === undefined
        ? {}
        : { expectedIdentity: options.expectedIdentity }),
      ...(options.minimumSize === undefined ? {} : { minimumSize: options.minimumSize }),
      ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
      ...(options.maxEvents === undefined ? {} : { maxEvents: options.maxEvents }),
      projectLine: (value, context) =>
        projectCodexRolloutRecord(value, { runId: options.runId, ...context }),
      malformedLine: (context) => [
        malformedCodexRolloutEvent(options.runId, context.lineOffset),
      ],
    });
    return {
      ...slice,
      events: dedupeEvents(slice.events),
    };
  } catch (error) {
    if (error instanceof TrustedJsonlCursorInvalidError) {
      throw new CodexRolloutCursorInvalidError();
    }
    throw error;
  }
}

export async function readCodexRolloutAppend(
  options: ReadCodexRolloutAppendOptions,
): Promise<CodexRolloutEventSlice> {
  try {
    const slice = await readTrustedJsonlAppend({
      file: trustedFile(options.resolution),
      startOffset: options.startOffset,
      expectedIdentity: options.expectedIdentity,
      minimumSize: options.minimumSize,
      ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
      ...(options.maxEvents === undefined ? {} : { maxEvents: options.maxEvents }),
      projectLine: (value, context) =>
        projectCodexRolloutRecord(value, { runId: options.runId, ...context }),
      malformedLine: (context) => [
        malformedCodexRolloutEvent(options.runId, context.lineOffset),
      ],
    });
    return {
      ...slice,
      events: dedupeEvents(slice.events),
    };
  } catch (error) {
    if (error instanceof TrustedJsonlCursorInvalidError) {
      throw new CodexRolloutCursorInvalidError();
    }
    throw error;
  }
}

async function openValidatedRollout(
  resolution: Extract<CodexRolloutResolution, { status: "available" }>,
  expectedIdentity: Pick<CodexRolloutIdentity, "realPath" | "device" | "inode"> | undefined,
  minimumSize: number | undefined,
): Promise<{ handle: fs.FileHandle; identity: CodexRolloutIdentity }> {
  try {
    return await openValidatedTrustedJsonl(
      trustedFile(resolution),
      expectedIdentity,
      minimumSize,
    );
  } catch (error) {
    if (error instanceof TrustedJsonlCursorInvalidError) {
      throw new CodexRolloutCursorInvalidError();
    }
    throw error;
  }
}

async function findCompleteJsonlEnd(handle: fs.FileHandle, size: number): Promise<number> {
  if (size === 0) {
    return 0;
  }
  const lastByte = Buffer.alloc(1);
  await handle.read(lastByte, 0, 1, size - 1);
  if (lastByte[0] === 0x0a) {
    return size;
  }
  let cursor = size;
  while (cursor > 0) {
    const length = Math.min(READ_CHUNK_BYTES, cursor);
    const start = cursor - length;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    const newline = buffer.lastIndexOf(0x0a);
    if (newline >= 0) {
      return start + newline + 1;
    }
    cursor = start;
  }
  return 0;
}

async function readRange(
  handle: fs.FileHandle,
  startOffset: number,
  endOffset: number,
): Promise<Buffer> {
  const length = endOffset - startOffset;
  const buffer = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const result = await handle.read(buffer, read, length - read, startOffset + read);
    if (result.bytesRead === 0) {
      throw new CodexRolloutCursorInvalidError("Codex rollout changed while reading");
    }
    read += result.bytesRead;
  }
  return buffer;
}

function dedupeEvents(events: LocalConsoleProcessEvent[]): LocalConsoleProcessEvent[] {
  const seen = new Set<string>();
  const retained: LocalConsoleProcessEvent[] = [];
  for (const event of events) {
    if (seen.has(event.key)) {
      continue;
    }
    seen.add(event.key);
    const previous = retained.at(-1);
    if (previous !== undefined && isMirroredAgentMessage(previous, event)) {
      continue;
    }
    retained.push(event);
  }
  return retained;
}

function isMirroredAgentMessage(
  left: LocalConsoleProcessEvent,
  right: LocalConsoleProcessEvent,
): boolean {
  if (
    left.kind !== "agent-output"
    || right.kind !== "agent-output"
    || left.output !== right.output
    || left.protocolType === right.protocolType
  ) {
    return false;
  }
  if (left.timestamp === null || right.timestamp === null) {
    return false;
  }
  const leftTime = Date.parse(left.timestamp);
  const rightTime = Date.parse(right.timestamp);
  return Number.isFinite(leftTime)
    && Number.isFinite(rightTime)
    && Math.abs(leftTime - rightTime) <= 1_000;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function promptLayer(contents: string[]): CodexRolloutPromptLayer {
  return {
    status: contents.length === 0 ? "not-recorded" : "recorded",
    contents,
  };
}

function pushDistinct(target: string[], value: string | null): void {
  if (value !== null && target.at(-1) !== value) {
    target.push(value);
  }
}

function readPromptContent(value: unknown): string | null {
  if (typeof value === "string" && value !== "") {
    return value;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const parts = value.flatMap((item): string[] => {
    if (!isRecord(item)) {
      return [];
    }
    const type = readString(item.type);
    if (type !== "input_text" && type !== "text") {
      return [];
    }
    const text = readString(item.text);
    return text === null ? [] : [text];
  });
  return parts.length === 0 ? null : parts.join("");
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: string | undefined): string | null {
  return value !== undefined && value.trim() !== "" ? value : null;
}

async function inspectRolloutCandidate(
  sessionsRoot: string,
  candidate: string,
): Promise<CodexRolloutResolution> {
  const inspection = await inspectTrustedJsonlCandidate(sessionsRoot, candidate);
  if (inspection.status === "available") {
    return {
      status: "available",
      filePath: inspection.file.filePath,
      sessionsRoot,
      identity: inspection.file.identity,
    };
  }
  return {
    status: "unavailable",
    reason: inspection.reason === "outside-root"
      ? "outside-sessions-root"
      : inspection.reason === "root-unavailable"
        ? "sessions-root-unavailable"
        : inspection.reason,
  };
}

function trustedFile(
  resolution: Extract<CodexRolloutResolution, { status: "available" }>,
): TrustedJsonlFile {
  return {
    filePath: resolution.filePath,
    trustedRoot: resolution.sessionsRoot,
    identity: resolution.identity,
  };
}
