import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

export interface TrustedJsonlIdentity {
  realPath: string;
  device: number;
  inode: number;
  size: number;
}

export interface TrustedJsonlFile {
  filePath: string;
  trustedRoot: string;
  identity: TrustedJsonlIdentity;
}

export type TrustedJsonlUnavailableReason =
  | "root-unavailable"
  | "not-found"
  | "outside-root"
  | "not-a-file"
  | "unreadable";

export type TrustedJsonlInspection =
  | {
      status: "available";
      file: TrustedJsonlFile;
    }
  | {
      status: "unavailable";
      reason: TrustedJsonlUnavailableReason;
    };

export type TrustedSidecarRead =
  | {
      status: "available";
      contents: string;
      identity: TrustedJsonlIdentity;
    }
  | {
      status: "unavailable";
      reason: TrustedJsonlUnavailableReason | "oversized";
    };

export interface TrustedJsonlProjectedLine<T> {
  lineOffset: number;
  lineEndOffset: number;
  events: T[];
}

export interface TrustedJsonlSlice<T> {
  events: T[];
  rawBytes: number;
  startOffset: number;
  endOffset: number;
  completeEndOffset: number;
  previousOffset: number | null;
  nextOffset: number;
  identity: TrustedJsonlIdentity;
}

export class TrustedJsonlCursorInvalidError extends Error {
  constructor(message = "trusted JSONL cursor is no longer valid") {
    super(message);
    this.name = "TrustedJsonlCursorInvalidError";
  }
}

const DEFAULT_PAGE_BYTES = 256 * 1024;
const DEFAULT_PAGE_EVENTS = 80;
const DEFAULT_COMPLETE_MAX_BYTES = 64 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

export async function resolveTrustedJsonlRoot(
  configuredRoot: string,
): Promise<string | null> {
  try {
    return await fs.realpath(path.resolve(configuredRoot));
  } catch {
    return null;
  }
}

export async function inspectTrustedJsonlCandidate(
  trustedRoot: string,
  candidate: string,
): Promise<TrustedJsonlInspection> {
  try {
    const realPath = await fs.realpath(candidate);
    if (!isPathInside(trustedRoot, realPath)) {
      return { status: "unavailable", reason: "outside-root" };
    }
    const stat = await fs.stat(realPath);
    if (!stat.isFile()) {
      return { status: "unavailable", reason: "not-a-file" };
    }
    const handle = await fs.open(realPath, "r");
    await handle.close();
    return {
      status: "available",
      file: {
        filePath: realPath,
        trustedRoot,
        identity: {
          realPath,
          device: stat.dev,
          inode: stat.ino,
          size: stat.size,
        },
      },
    };
  } catch (error) {
    return {
      status: "unavailable",
      reason: isMissingFileError(error) ? "not-found" : "unreadable",
    };
  }
}

export function sameTrustedJsonlFile(
  expected: Pick<TrustedJsonlIdentity, "realPath" | "device" | "inode">,
  actual: Pick<TrustedJsonlIdentity, "realPath" | "device" | "inode">,
): boolean {
  return expected.realPath === actual.realPath
    && expected.device === actual.device
    && expected.inode === actual.inode;
}

export async function openValidatedTrustedJsonl(
  file: TrustedJsonlFile,
  expectedIdentity?: Pick<TrustedJsonlIdentity, "realPath" | "device" | "inode">,
  minimumSize?: number,
): Promise<{ handle: fs.FileHandle; identity: TrustedJsonlIdentity }> {
  let handle: fs.FileHandle | null = null;
  try {
    const realPath = await fs.realpath(file.filePath);
    if (!isPathInside(file.trustedRoot, realPath)) {
      throw new TrustedJsonlCursorInvalidError();
    }
    handle = await fs.open(realPath, "r");
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new TrustedJsonlCursorInvalidError();
    }
    const identity = {
      realPath,
      device: stat.dev,
      inode: stat.ino,
      size: stat.size,
    };
    const requiredIdentity = expectedIdentity ?? file.identity;
    if (
      !sameTrustedJsonlFile(requiredIdentity, identity)
      || (minimumSize !== undefined && stat.size < minimumSize)
    ) {
      throw new TrustedJsonlCursorInvalidError();
    }
    return { handle, identity };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (error instanceof TrustedJsonlCursorInvalidError) {
      throw error;
    }
    throw new TrustedJsonlCursorInvalidError();
  }
}

export async function readTrustedTextSidecar(options: {
  trustedRoot: string;
  candidate: string;
  maxBytes?: number;
}): Promise<TrustedSidecarRead> {
  const root = await resolveTrustedJsonlRoot(options.trustedRoot);
  if (root === null) {
    return { status: "unavailable", reason: "root-unavailable" };
  }
  const inspected = await inspectTrustedJsonlCandidate(root, options.candidate);
  if (inspected.status !== "available") {
    return inspected;
  }
  const maxBytes = positiveInteger(
    options.maxBytes ?? DEFAULT_COMPLETE_MAX_BYTES,
    "maxBytes",
  );
  if (inspected.file.identity.size > maxBytes) {
    return { status: "unavailable", reason: "oversized" };
  }
  let opened: Awaited<ReturnType<typeof openValidatedTrustedJsonl>> | null = null;
  try {
    opened = await openValidatedTrustedJsonl(inspected.file, inspected.file.identity);
    const buffer = await readRange(opened.handle, 0, opened.identity.size);
    const finalIdentity = await validateTrustedReadAfter(
      inspected.file,
      opened.handle,
      opened.identity,
      opened.identity.size,
    );
    if (finalIdentity.size !== opened.identity.size) {
      return { status: "unavailable", reason: "unreadable" };
    }
    return {
      status: "available",
      contents: buffer.toString("utf8"),
      identity: finalIdentity,
    };
  } catch {
    return { status: "unavailable", reason: "unreadable" };
  } finally {
    await opened?.handle.close().catch(() => undefined);
  }
}

export async function readTrustedJsonlPage<T>(options: {
  file: TrustedJsonlFile;
  endOffset?: number;
  expectedIdentity?: Pick<TrustedJsonlIdentity, "realPath" | "device" | "inode">;
  minimumSize?: number;
  maxBytes?: number;
  maxEvents?: number;
  projectLine: (value: unknown, context: { lineOffset: number }) => T[] | Promise<T[]>;
  malformedLine: (context: { lineOffset: number }) => T[] | Promise<T[]>;
}): Promise<TrustedJsonlSlice<T>> {
  const maxBytes = positiveInteger(options.maxBytes ?? DEFAULT_PAGE_BYTES, "maxBytes");
  const maxEvents = positiveInteger(options.maxEvents ?? DEFAULT_PAGE_EVENTS, "maxEvents");
  const opened = await openValidatedTrustedJsonl(
    options.file,
    options.expectedIdentity,
    options.minimumSize,
  );
  try {
    const completeEndOffset = await findCompleteJsonlEnd(opened.handle, opened.identity.size);
    const endOffset = options.endOffset ?? completeEndOffset;
    if (!Number.isInteger(endOffset) || endOffset < 0 || endOffset > completeEndOffset) {
      throw new TrustedJsonlCursorInvalidError();
    }
    const window = await readBackwardWindow(opened.handle, endOffset, maxBytes);
    const groups = await projectWindow(window.buffer, window.startOffset, options);
    const selected = selectEventSuffix(groups, maxEvents);
    const startOffset = selected.length > 0
      ? selected[0]!.lineOffset
      : window.startOffset;
    const finalIdentity = await validateTrustedReadAfter(
      options.file,
      opened.handle,
      opened.identity,
      completeEndOffset,
    );
    return {
      events: selected.flatMap((group) => group.events),
      rawBytes: endOffset - startOffset,
      startOffset,
      endOffset,
      completeEndOffset,
      previousOffset: startOffset > 0 ? startOffset : null,
      nextOffset: endOffset,
      identity: finalIdentity,
    };
  } finally {
    await opened.handle.close();
  }
}

export async function readTrustedJsonlAppend<T>(options: {
  file: TrustedJsonlFile;
  startOffset: number;
  expectedIdentity: Pick<TrustedJsonlIdentity, "realPath" | "device" | "inode">;
  minimumSize: number;
  maxBytes?: number;
  maxEvents?: number;
  projectLine: (value: unknown, context: { lineOffset: number }) => T[] | Promise<T[]>;
  malformedLine: (context: { lineOffset: number }) => T[] | Promise<T[]>;
}): Promise<TrustedJsonlSlice<T>> {
  const maxBytes = positiveInteger(options.maxBytes ?? DEFAULT_PAGE_BYTES, "maxBytes");
  const maxEvents = positiveInteger(options.maxEvents ?? DEFAULT_PAGE_EVENTS, "maxEvents");
  const opened = await openValidatedTrustedJsonl(
    options.file,
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
      throw new TrustedJsonlCursorInvalidError();
    }
    const window = await readForwardWindow(
      opened.handle,
      options.startOffset,
      completeEndOffset,
      maxBytes,
    );
    const groups = await projectWindow(window.buffer, options.startOffset, options);
    const selected = selectEventPrefix(groups, maxEvents);
    const nextOffset = selected.length > 0
      ? selected.at(-1)!.lineEndOffset
      : window.endOffset;
    const finalIdentity = await validateTrustedReadAfter(
      options.file,
      opened.handle,
      opened.identity,
      completeEndOffset,
    );
    return {
      events: selected.flatMap((group) => group.events),
      rawBytes: nextOffset - options.startOffset,
      startOffset: options.startOffset,
      endOffset: nextOffset,
      completeEndOffset,
      previousOffset: options.startOffset > 0 ? options.startOffset : null,
      nextOffset,
      identity: finalIdentity,
    };
  } finally {
    await opened.handle.close();
  }
}

export async function readTrustedJsonlRecords(options: {
  file: TrustedJsonlFile;
  expectedIdentity?: Pick<TrustedJsonlIdentity, "realPath" | "device" | "inode">;
  minimumSize?: number;
  maxBytes?: number;
}): Promise<{
  records: unknown[];
  malformedLines: number;
  identity: TrustedJsonlIdentity;
}> {
  const maxBytes = positiveInteger(options.maxBytes ?? DEFAULT_COMPLETE_MAX_BYTES, "maxBytes");
  const opened = await openValidatedTrustedJsonl(
    options.file,
    options.expectedIdentity,
    options.minimumSize,
  );
  try {
    const completeEndOffset = await findCompleteJsonlEnd(opened.handle, opened.identity.size);
    if (completeEndOffset > maxBytes) {
      throw new TrustedJsonlCursorInvalidError("trusted JSONL exceeds complete-read budget");
    }
    const buffer = await readRange(opened.handle, 0, completeEndOffset);
    const records: unknown[] = [];
    let malformedLines = 0;
    for (const rawLine of buffer.toString("utf8").split("\n")) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (line === "") {
        continue;
      }
      try {
        records.push(JSON.parse(line) as unknown);
      } catch {
        malformedLines += 1;
      }
    }
    const finalIdentity = await validateTrustedReadAfter(
      options.file,
      opened.handle,
      opened.identity,
      completeEndOffset,
    );
    return { records, malformedLines, identity: finalIdentity };
  } finally {
    await opened.handle.close();
  }
}

export async function scanTrustedJsonlRecords(options: {
  file: TrustedJsonlFile;
  expectedIdentity?: Pick<TrustedJsonlIdentity, "realPath" | "device" | "inode">;
  minimumSize?: number;
  onRecord: (value: unknown) => void | Promise<void>;
}): Promise<{
  malformedLines: number;
  identity: TrustedJsonlIdentity;
}> {
  const opened = await openValidatedTrustedJsonl(
    options.file,
    options.expectedIdentity,
    options.minimumSize,
  );
  try {
    const completeEndOffset = await findCompleteJsonlEnd(opened.handle, opened.identity.size);
    let malformedLines = 0;
    if (completeEndOffset > 0) {
      const lines = readline.createInterface({
        input: opened.handle.createReadStream({
          start: 0,
          end: completeEndOffset - 1,
          autoClose: false,
        }),
        crlfDelay: Infinity,
      });
      for await (const line of lines) {
        if (line === "") {
          continue;
        }
        try {
          await options.onRecord(JSON.parse(line) as unknown);
        } catch {
          malformedLines += 1;
        }
      }
    }
    return {
      malformedLines,
      identity: await validateTrustedReadAfter(
        options.file,
        opened.handle,
        opened.identity,
        completeEndOffset,
      ),
    };
  } finally {
    await opened.handle.close();
  }
}

async function validateTrustedReadAfter(
  file: TrustedJsonlFile,
  handle: fs.FileHandle,
  initialIdentity: TrustedJsonlIdentity,
  minimumSize: number,
): Promise<TrustedJsonlIdentity> {
  try {
    const [realPath, stat] = await Promise.all([
      fs.realpath(file.filePath),
      handle.stat(),
    ]);
    const identity = {
      realPath,
      device: stat.dev,
      inode: stat.ino,
      size: stat.size,
    };
    if (
      !stat.isFile()
      || !isPathInside(file.trustedRoot, realPath)
      || !sameTrustedJsonlFile(initialIdentity, identity)
      || identity.size < minimumSize
    ) {
      throw new TrustedJsonlCursorInvalidError();
    }
    return identity;
  } catch (error) {
    if (error instanceof TrustedJsonlCursorInvalidError) {
      throw error;
    }
    throw new TrustedJsonlCursorInvalidError();
  }
}

async function projectWindow<T>(
  buffer: Buffer,
  baseOffset: number,
  options: {
    projectLine: (value: unknown, context: { lineOffset: number }) => T[] | Promise<T[]>;
    malformedLine: (context: { lineOffset: number }) => T[] | Promise<T[]>;
  },
): Promise<TrustedJsonlProjectedLine<T>[]> {
  const groups: TrustedJsonlProjectedLine<T>[] = [];
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
      let events: T[];
      try {
        events = await options.projectLine(JSON.parse(content.toString("utf8")), { lineOffset });
      } catch {
        events = await options.malformedLine({ lineOffset });
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

function selectEventSuffix<T>(
  groups: TrustedJsonlProjectedLine<T>[],
  maxEvents: number,
): TrustedJsonlProjectedLine<T>[] {
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

function selectEventPrefix<T>(
  groups: TrustedJsonlProjectedLine<T>[],
  maxEvents: number,
): TrustedJsonlProjectedLine<T>[] {
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
      throw new TrustedJsonlCursorInvalidError();
    }
    read += result.bytesRead;
  }
  return buffer;
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}
