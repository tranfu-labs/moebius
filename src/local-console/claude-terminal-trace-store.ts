import fs from "node:fs/promises";
import path from "node:path";

import {
  LocalClaudeTerminalTraceCursorError,
  LocalClaudeTerminalTraceUnavailableError,
  type LocalClaudeTerminalTrace,
  type LocalClaudeTerminalTraceAppendResult,
  type LocalClaudeTerminalTraceChunk,
  type LocalConsoleClaudeTerminalTracePage,
} from "./claude-terminal-trace.js";

const TRACE_FILE = "claude-tui-terminal.trace.jsonl";
const META_FILE = "claude-tui-terminal.trace.meta.json";

interface PersistedClaudeTerminalTraceMeta {
  version: 1;
  nextCursor: number;
  bytesObserved: number;
  bytesRetained: number;
  incomplete: boolean;
}

export class LocalClaudeTerminalTraceStore {
  readonly #pending = new Map<string, Promise<void>>();
  readonly #errors = new Map<string, unknown>();

  append(input: {
    runId: string;
    runDir: string | null;
    trace: LocalClaudeTerminalTrace;
    result: LocalClaudeTerminalTraceAppendResult;
  }): void {
    if (input.runDir === null || input.result.kind === "ignored") return;

    const previous = this.#pending.get(input.runId) ?? Promise.resolve();
    const task = previous
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(input.runDir!, { recursive: true, mode: 0o700 });
        if (input.result.kind === "accepted") {
          await fs.appendFile(
            path.join(input.runDir!, TRACE_FILE),
            `${JSON.stringify(input.result.chunk)}\n`,
            { encoding: "utf8", mode: 0o600 },
          );
        }
        if (input.trace.incomplete) await writeMeta(input.runDir!, toMeta(input.trace));
      });
    this.#pending.set(input.runId, task);
    void task.catch((error: unknown) => {
      this.#errors.set(input.runId, error);
    });
  }

  async flush(runId: string): Promise<void> {
    const pending = this.#pending.get(runId);
    if (pending !== undefined) await pending;
    const error = this.#errors.get(runId);
    if (error !== undefined) throw error;
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.#pending.keys()].map((runId) => this.flush(runId)));
  }

  async read(input: {
    sessionId: string;
    runId: string;
    runDir: string;
    cursor: number;
  }): Promise<LocalConsoleClaudeTerminalTracePage> {
    await this.flush(input.runId);
    try {
      const [chunks, meta] = await Promise.all([
        readChunks(path.join(input.runDir, TRACE_FILE)),
        readMeta(path.join(input.runDir, META_FILE)),
      ]);
      if (chunks === null && meta === null) throw new LocalClaudeTerminalTraceUnavailableError();
      const persistedChunks = chunks ?? [];
      const resolvedMeta = meta ?? deriveMeta(persistedChunks);
      if (input.cursor > resolvedMeta.nextCursor) throw new LocalClaudeTerminalTraceCursorError();
      return {
        sessionId: input.sessionId,
        runId: input.runId,
        chunks: persistedChunks
          .filter((chunk) => chunk.cursor >= input.cursor)
          .map((chunk) => ({ ...chunk })),
        nextCursor: resolvedMeta.nextCursor,
        bytesObserved: resolvedMeta.bytesObserved,
        bytesRetained: resolvedMeta.bytesRetained,
        incomplete: resolvedMeta.incomplete,
      };
    } catch (error) {
      if (error instanceof LocalClaudeTerminalTraceCursorError) {
        throw error;
      }
      throw new LocalClaudeTerminalTraceUnavailableError();
    }
  }
}

function toMeta(trace: LocalClaudeTerminalTrace): PersistedClaudeTerminalTraceMeta {
  return {
    version: 1,
    nextCursor: trace.nextCursor,
    bytesObserved: trace.bytesObserved,
    bytesRetained: trace.bytesRetained,
    incomplete: trace.incomplete,
  };
}

async function writeMeta(runDir: string, meta: PersistedClaudeTerminalTraceMeta): Promise<void> {
  const target = path.join(runDir, META_FILE);
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(meta)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, target);
}

async function readChunks(filePath: string): Promise<LocalClaudeTerminalTraceChunk[] | null> {
  let contents: string;
  try {
    contents = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
  const chunks: LocalClaudeTerminalTraceChunk[] = [];
  for (const line of contents.split("\n")) {
    if (line.trim() === "") continue;
    const value: unknown = JSON.parse(line);
    if (!isChunk(value)) throw new Error("invalid Claude terminal trace chunk");
    chunks.push(value);
  }
  return chunks;
}

async function readMeta(filePath: string): Promise<PersistedClaudeTerminalTraceMeta | null> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (!isMeta(value)) throw new Error("invalid Claude terminal trace metadata");
    return value;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

function deriveMeta(chunks: readonly LocalClaudeTerminalTraceChunk[]): PersistedClaudeTerminalTraceMeta {
  const nextCursor = chunks.reduce((max, chunk) => Math.max(max, chunk.cursor + 1), 0);
  const bytesRetained = chunks.reduce((total, chunk) => total + Buffer.from(chunk.dataBase64, "base64").byteLength, 0);
  return {
    version: 1,
    nextCursor,
    bytesObserved: bytesRetained,
    bytesRetained,
    incomplete: false,
  };
}

function isChunk(value: unknown): value is LocalClaudeTerminalTraceChunk {
  if (!isRecord(value)) return false;
  const cursor = value.cursor;
  const dataBase64 = value.dataBase64;
  return typeof cursor === "number"
    && Number.isSafeInteger(cursor)
    && cursor >= 0
    && typeof dataBase64 === "string";
}

function isMeta(value: unknown): value is PersistedClaudeTerminalTraceMeta {
  if (!isRecord(value)) return false;
  return value.version === 1
    && Number.isSafeInteger(value.nextCursor)
    && Number.isSafeInteger(value.bytesObserved)
    && Number.isSafeInteger(value.bytesRetained)
    && typeof value.incomplete === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
