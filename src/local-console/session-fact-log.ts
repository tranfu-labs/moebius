import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { canonicalJson } from "./canonical-json.js";

export { canonicalJson } from "./canonical-json.js";

const SAMPLE_BYTES = 64;
const BACKWARD_SCAN_CHUNK_BYTES = 64 * 1024;

export interface SessionFactLogSnapshot {
  /** 每个完整行解析出的 JSON 值，顺序与文件一致；调用方只读。 */
  values: readonly unknown[];
  /** 已解析的完整行覆盖的字节数。 */
  parsedLength: number;
  /** 文件当前字节数，大于 parsedLength 时说明尾部有半行。 */
  size: number;
}

interface CacheEntry {
  size: number;
  mtimeMs: number;
  ino: number;
  parsedLength: number;
  /** 已解析前缀首尾的采样字节，用来识别文件被原地改写而非追加。 */
  head: Buffer;
  tail: Buffer;
  values: unknown[];
}

const cache = new Map<string, CacheEntry>();

/**
 * 读取会话事实日志的全部完整行。
 *
 * 日志是只追加的，所以缓存按「inode + 大小 + mtime + 首尾采样」判活；文件变长时只解析新增字节，
 * 避免每次轮询都把整个文件重新 JSON.parse 一遍。返回 null 表示文件不存在。
 */
export async function readSessionFactLog(
  logPath: string,
  sessionId: string,
): Promise<SessionFactLogSnapshot | null> {
  let stats: fsSync.Stats;
  try {
    stats = await fs.stat(logPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      cache.delete(logPath);
      return null;
    }
    throw error;
  }

  const cached = cache.get(logPath);
  if (
    cached !== undefined
    && cached.ino === stats.ino
    && cached.size === stats.size
    && cached.mtimeMs === stats.mtimeMs
  ) {
    return { values: cached.values, parsedLength: cached.parsedLength, size: cached.size };
  }

  const handle = await fs.open(logPath, "r");
  try {
    const reusable = cached !== undefined
      && cached.ino === stats.ino
      && stats.size >= cached.parsedLength
      && await prefixMatches(handle, cached);
    const base = reusable && cached !== undefined ? cached : null;
    const from = base === null ? 0 : base.parsedLength;
    const chunk = Buffer.alloc(stats.size - from);
    await readExactly(handle, chunk, from);
    const completeLength = completeLineLength(chunk);
    const values = base === null ? [] : base.values;
    if (completeLength > 0) {
      const text = chunk.subarray(0, completeLength).toString("utf8");
      const firstLineNumber = values.length + 1;
      for (const [offset, line] of text.slice(0, -1).split("\n").entries()) {
        values.push(parseLine(line, sessionId, firstLineNumber + offset));
      }
    }
    const parsedLength = from + completeLength;
    const head = base === null
      ? Buffer.from(chunk.subarray(0, Math.min(SAMPLE_BYTES, completeLength)))
      : base.head;
    const tail = base !== null && completeLength === 0
      ? base.tail
      : tailSample(chunk, completeLength, base?.tail ?? Buffer.alloc(0));
    cache.set(logPath, {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      ino: stats.ino,
      parsedLength,
      head,
      tail,
      values,
    });
    return { values, parsedLength, size: stats.size };
  } finally {
    await handle.close();
  }
}

/** 丢弃缓存；测试或外部改写日志后使用。 */
export function invalidateSessionFactLog(logPath?: string): void {
  if (logPath === undefined) {
    cache.clear();
    return;
  }
  cache.delete(logPath);
}

/**
 * 追加一行 JSONL。
 *
 * 只用 stat + 尾字节判断上次是否写了半行，不读整个文件——追加成本与文件大小无关。
 */
export async function appendSessionFactLogLine(logPath: string, line: string): Promise<void> {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const payload = Buffer.from(`${line}\n`, "utf8");
  const handle = await fs.open(logPath, "a+");
  try {
    const size = (await handle.stat()).size;
    if (size > 0 && !await endsWithNewline(handle, size)) {
      await handle.truncate(await findLastNewline(handle, size));
    }
    let written = 0;
    while (written < payload.length) {
      const result = await handle.write(payload, written, payload.length - written);
      written += result.bytesWritten;
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** {@link appendSessionFactLogLine} 的同步版本，供 SQLite worker 在事务内使用。 */
export function appendSessionFactLogLineSync(logPath: string, line: string): void {
  fsSync.mkdirSync(path.dirname(logPath), { recursive: true });
  const payload = Buffer.from(`${line}\n`, "utf8");
  const descriptor = fsSync.openSync(logPath, "a+");
  try {
    const size = fsSync.fstatSync(descriptor).size;
    if (size > 0 && !endsWithNewlineSync(descriptor, size)) {
      fsSync.ftruncateSync(descriptor, findLastNewlineSync(descriptor, size));
    }
    let written = 0;
    while (written < payload.length) {
      written += fsSync.writeSync(descriptor, payload, written, payload.length - written);
    }
    fsSync.fsyncSync(descriptor);
  } finally {
    fsSync.closeSync(descriptor);
  }
}

function parseLine(line: string, sessionId: string, lineNumber: number): unknown {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`invalid session fact log ${sessionId} line ${String(lineNumber)}: ${String(error)}`);
  }
}

function completeLineLength(buffer: Buffer): number {
  if (buffer.length === 0) {
    return 0;
  }
  const lastNewline = buffer.lastIndexOf(0x0a);
  return lastNewline < 0 ? 0 : lastNewline + 1;
}

function tailSample(chunk: Buffer, completeLength: number, fallback: Buffer): Buffer {
  if (completeLength === 0) {
    return fallback;
  }
  const start = Math.max(0, completeLength - SAMPLE_BYTES);
  return Buffer.from(chunk.subarray(start, completeLength));
}

/** 校验已缓存前缀的首尾采样是否还在原位——文件被原地改写时它们对不上，缓存作废。 */
async function prefixMatches(handle: fs.FileHandle, cached: CacheEntry): Promise<boolean> {
  if (cached.parsedLength === 0) {
    return true;
  }
  if (cached.head.length === 0 || cached.tail.length === 0) {
    return false;
  }
  return await sampleMatches(handle, cached.head, 0)
    && await sampleMatches(handle, cached.tail, cached.parsedLength - cached.tail.length);
}

async function sampleMatches(handle: fs.FileHandle, expected: Buffer, position: number): Promise<boolean> {
  const sample = Buffer.alloc(expected.length);
  await readExactly(handle, sample, position);
  return sample.equals(expected);
}

async function readExactly(handle: fs.FileHandle, buffer: Buffer, position: number): Promise<void> {
  let read = 0;
  while (read < buffer.length) {
    const result = await handle.read(buffer, read, buffer.length - read, position + read);
    if (result.bytesRead === 0) {
      throw new Error(`unexpected end of session fact log at ${String(position + read)}`);
    }
    read += result.bytesRead;
  }
}

async function endsWithNewline(handle: fs.FileHandle, size: number): Promise<boolean> {
  const last = Buffer.alloc(1);
  await readExactly(handle, last, size - 1);
  return last[0] === 0x0a;
}

function endsWithNewlineSync(descriptor: number, size: number): boolean {
  const last = Buffer.alloc(1);
  readExactlySync(descriptor, last, size - 1);
  return last[0] === 0x0a;
}

async function findLastNewline(handle: fs.FileHandle, size: number): Promise<number> {
  let end = size;
  while (end > 0) {
    const start = Math.max(0, end - BACKWARD_SCAN_CHUNK_BYTES);
    const chunk = Buffer.alloc(end - start);
    await readExactly(handle, chunk, start);
    const index = chunk.lastIndexOf(0x0a);
    if (index >= 0) {
      return start + index + 1;
    }
    end = start;
  }
  return 0;
}

function findLastNewlineSync(descriptor: number, size: number): number {
  let end = size;
  while (end > 0) {
    const start = Math.max(0, end - BACKWARD_SCAN_CHUNK_BYTES);
    const chunk = Buffer.alloc(end - start);
    readExactlySync(descriptor, chunk, start);
    const index = chunk.lastIndexOf(0x0a);
    if (index >= 0) {
      return start + index + 1;
    }
    end = start;
  }
  return 0;
}

function readExactlySync(descriptor: number, buffer: Buffer, position: number): void {
  let read = 0;
  while (read < buffer.length) {
    const bytes = fsSync.readSync(descriptor, buffer, read, buffer.length - read, position + read);
    if (bytes === 0) {
      throw new Error(`unexpected end of session fact log at ${String(position + read)}`);
    }
    read += bytes;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
