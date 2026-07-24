import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  malformedCodexRolloutEvent,
  projectCodexRolloutRecord,
  type LocalConsoleProcessEvent,
} from "./process-event-projector.js";

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
const DEFAULT_PAGE_BYTES = 256 * 1024;
const DEFAULT_PAGE_EVENTS = 80;
const READ_CHUNK_BYTES = 64 * 1024;
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
  return expected.realPath === actual.realPath
    && expected.device === actual.device
    && expected.inode === actual.inode;
}

export async function readCodexRolloutPage(
  options: ReadCodexRolloutPageOptions,
): Promise<CodexRolloutEventSlice> {
  const maxBytes = positiveInteger(options.maxBytes ?? DEFAULT_PAGE_BYTES, "maxBytes");
  const maxEvents = positiveInteger(options.maxEvents ?? DEFAULT_PAGE_EVENTS, "maxEvents");
  const opened = await openValidatedRollout(
    options.resolution,
    options.expectedIdentity,
    options.minimumSize,
  );
  try {
    const completeEndOffset = await findCompleteJsonlEnd(opened.handle, opened.identity.size);
    const endOffset = options.endOffset ?? completeEndOffset;
    if (!Number.isInteger(endOffset) || endOffset < 0 || endOffset > completeEndOffset) {
      throw new CodexRolloutCursorInvalidError();
    }
    const window = await readBackwardWindow(opened.handle, endOffset, maxBytes);
    const groups = projectWindow(window.buffer, window.startOffset, options.runId);
    const selected = selectEventSuffix(groups, maxEvents);
    const startOffset = selected.length > 0
      ? selected[0]!.lineOffset
      : window.startOffset;
    const events = dedupeEvents(selected.flatMap((group) => group.events));
    return {
      events,
      rawBytes: endOffset - startOffset,
      startOffset,
      endOffset,
      completeEndOffset,
      previousOffset: startOffset > 0 ? startOffset : null,
      nextOffset: endOffset,
      identity: opened.identity,
    };
  } finally {
    await opened.handle.close();
  }
}

export async function readCodexRolloutAppend(
  options: ReadCodexRolloutAppendOptions,
): Promise<CodexRolloutEventSlice> {
  const maxBytes = positiveInteger(options.maxBytes ?? DEFAULT_PAGE_BYTES, "maxBytes");
  const maxEvents = positiveInteger(options.maxEvents ?? DEFAULT_PAGE_EVENTS, "maxEvents");
  const opened = await openValidatedRollout(
    options.resolution,
    options.expectedIdentity,
    options.minimumSize,
  );
  try {
    const completeEndOffset = await findCompleteJsonlEnd(opened.handle, opened.identity.size);
    if (
      !Number.isInteger(options.startOffset)
      || options.startOffset < 0
      || options.startOffset > completeEndOffset
    ) {
      throw new CodexRolloutCursorInvalidError();
    }
    const window = await readForwardWindow(
      opened.handle,
      options.startOffset,
      completeEndOffset,
      maxBytes,
    );
    const groups = projectWindow(window.buffer, options.startOffset, options.runId);
    const selected = selectEventPrefix(groups, maxEvents);
    const nextOffset = selected.length > 0
      ? selected.at(-1)!.lineEndOffset
      : window.endOffset;
    return {
      events: dedupeEvents(selected.flatMap((group) => group.events)),
      rawBytes: nextOffset - options.startOffset,
      startOffset: options.startOffset,
      endOffset: nextOffset,
      completeEndOffset,
      previousOffset: options.startOffset > 0 ? options.startOffset : null,
      nextOffset,
      identity: opened.identity,
    };
  } finally {
    await opened.handle.close();
  }
}

interface ProjectedLine {
  lineOffset: number;
  lineEndOffset: number;
  events: LocalConsoleProcessEvent[];
}

async function openValidatedRollout(
  resolution: Extract<CodexRolloutResolution, { status: "available" }>,
  expectedIdentity: Pick<CodexRolloutIdentity, "realPath" | "device" | "inode"> | undefined,
  minimumSize: number | undefined,
): Promise<{ handle: fs.FileHandle; identity: CodexRolloutIdentity }> {
  let handle: fs.FileHandle | null = null;
  try {
    const realPath = await fs.realpath(resolution.filePath);
    if (!isPathInside(resolution.sessionsRoot, realPath)) {
      throw new CodexRolloutCursorInvalidError();
    }
    handle = await fs.open(realPath, "r");
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new CodexRolloutCursorInvalidError();
    }
    const identity = {
      realPath,
      device: stat.dev,
      inode: stat.ino,
      size: stat.size,
    };
    const requiredIdentity = expectedIdentity ?? resolution.identity;
    if (
      !sameCodexRolloutFile(requiredIdentity, identity)
      || (minimumSize !== undefined && stat.size < minimumSize)
    ) {
      throw new CodexRolloutCursorInvalidError();
    }
    return { handle, identity };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (error instanceof CodexRolloutCursorInvalidError) {
      throw error;
    }
    throw new CodexRolloutCursorInvalidError();
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

async function readBackwardWindow(
  handle: fs.FileHandle,
  endOffset: number,
  maxBytes: number,
): Promise<{ startOffset: number; buffer: Buffer }> {
  if (endOffset === 0) {
    return { startOffset: 0, buffer: Buffer.alloc(0) };
  }
  let startOffset = Math.max(0, endOffset - maxBytes);
  let buffer = await readRange(handle, startOffset, endOffset);
  if (startOffset === 0) {
    return { startOffset, buffer };
  }
  const byteBeforeStart = await readRange(handle, startOffset - 1, startOffset);
  if (byteBeforeStart[0] === 0x0a) {
    return { startOffset, buffer };
  }

  while (startOffset > 0) {
    const previousStart = Math.max(0, startOffset - READ_CHUNK_BYTES);
    const previous = await readRange(handle, previousStart, startOffset);
    const newline = previous.lastIndexOf(0x0a);
    if (newline >= 0) {
      buffer = Buffer.concat([previous.subarray(newline + 1), buffer]);
      startOffset = previousStart + newline + 1;
      break;
    }
    buffer = Buffer.concat([previous, buffer]);
    startOffset = previousStart;
  }
  return { startOffset, buffer };
}

async function readForwardWindow(
  handle: fs.FileHandle,
  startOffset: number,
  completeEndOffset: number,
  maxBytes: number,
): Promise<{ endOffset: number; buffer: Buffer }> {
  if (startOffset === completeEndOffset) {
    return { endOffset: startOffset, buffer: Buffer.alloc(0) };
  }
  let endOffset = Math.min(completeEndOffset, startOffset + maxBytes);
  let buffer = await readRange(handle, startOffset, endOffset);
  if (endOffset < completeEndOffset) {
    const newline = buffer.lastIndexOf(0x0a);
    if (newline >= 0) {
      endOffset = startOffset + newline + 1;
      buffer = buffer.subarray(0, newline + 1);
    } else {
      while (endOffset < completeEndOffset) {
        const nextEnd = Math.min(completeEndOffset, endOffset + READ_CHUNK_BYTES);
        const next = await readRange(handle, endOffset, nextEnd);
        const nextNewline = next.indexOf(0x0a);
        if (nextNewline >= 0) {
          buffer = Buffer.concat([buffer, next.subarray(0, nextNewline + 1)]);
          endOffset += nextNewline + 1;
          break;
        }
        buffer = Buffer.concat([buffer, next]);
        endOffset = nextEnd;
      }
    }
  }
  return { endOffset, buffer };
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

function projectWindow(buffer: Buffer, baseOffset: number, runId: string): ProjectedLine[] {
  const groups: ProjectedLine[] = [];
  let lineStart = 0;
  while (lineStart < buffer.length) {
    const newline = buffer.indexOf(0x0a, lineStart);
    if (newline < 0) {
      break;
    }
    const raw = buffer.subarray(lineStart, newline);
    const content = raw.at(-1) === 0x0d ? raw.subarray(0, -1) : raw;
    const lineOffset = baseOffset + lineStart;
    if (content.length > 0) {
      let events: LocalConsoleProcessEvent[];
      try {
        events = projectCodexRolloutRecord(JSON.parse(content.toString("utf8")), {
          runId,
          lineOffset,
        });
      } catch {
        events = [malformedCodexRolloutEvent(runId, lineOffset)];
      }
      groups.push({
        lineOffset,
        lineEndOffset: baseOffset + newline + 1,
        events,
      });
    }
    lineStart = newline + 1;
  }
  return groups;
}

function selectEventSuffix(groups: ProjectedLine[], maxEvents: number): ProjectedLine[] {
  let count = 0;
  let start = groups.length;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const next = groups[index]!;
    if (next.events.length > 0 && count > 0 && count + next.events.length > maxEvents) {
      break;
    }
    start = index;
    count += next.events.length;
  }
  return groups.slice(start);
}

function selectEventPrefix(groups: ProjectedLine[], maxEvents: number): ProjectedLine[] {
  let count = 0;
  let end = 0;
  for (const group of groups) {
    if (group.events.length > 0 && count > 0 && count + group.events.length > maxEvents) {
      break;
    }
    end += 1;
    count += group.events.length;
  }
  return groups.slice(0, end);
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
    left.kind !== "agent-markdown"
    || right.kind !== "agent-markdown"
    || left.markdown !== right.markdown
  ) {
    return false;
  }
  const leftOrigin = agentMessageOrigin(left.key);
  const rightOrigin = agentMessageOrigin(right.key);
  if (leftOrigin === null || rightOrigin === null || leftOrigin === rightOrigin) {
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

function agentMessageOrigin(key: string): "event" | "response" | null {
  if (key.includes(":agent:event:")) {
    return "event";
  }
  return key.includes(":agent:response:") ? "response" : null;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

function nonEmpty(value: string | undefined): string | null {
  return value !== undefined && value.trim() !== "" ? value : null;
}

async function inspectRolloutCandidate(
  sessionsRoot: string,
  candidate: string,
): Promise<CodexRolloutResolution> {
  try {
    const realPath = await fs.realpath(candidate);
    if (!isPathInside(sessionsRoot, realPath)) {
      return { status: "unavailable", reason: "outside-sessions-root" };
    }
    const stat = await fs.stat(realPath);
    if (!stat.isFile()) {
      return { status: "unavailable", reason: "not-a-file" };
    }
    const handle = await fs.open(realPath, "r");
    await handle.close();
    return {
      status: "available",
      filePath: realPath,
      sessionsRoot,
      identity: {
        realPath,
        device: stat.dev,
        inode: stat.ino,
        size: stat.size,
      },
    };
  } catch (error) {
    return {
      status: "unavailable",
      reason: isMissingFileError(error) ? "not-found" : "unreadable",
    };
  }
}
