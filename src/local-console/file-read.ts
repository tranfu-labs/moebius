import fs from "node:fs/promises";
import path from "node:path";

import type {
  LocalConsoleFileContent,
  LocalConsoleFileReferenceContent,
  LocalConsoleFileReferenceLine,
} from "./types.js";

export const LOCAL_CONSOLE_FILE_CONTENT_MAX_BYTES = 2 * 1024 * 1024;
export const LOCAL_CONSOLE_FILE_REFERENCE_CONTEXT_LINES = 40;
export const LOCAL_CONSOLE_FILE_REFERENCE_MAX_SCAN_BYTES = 64 * 1024 * 1024;
export const LOCAL_CONSOLE_FILE_REFERENCE_MAX_LINE_BYTES = 256 * 1024;
export const LOCAL_CONSOLE_FILE_REFERENCE_MAX_RESPONSE_BYTES = 1024 * 1024;
const LOCAL_CONSOLE_FILE_REFERENCE_READ_CHUNK_BYTES = 64 * 1024;

export async function listLocalWorkspaceFiles(workspacePath: string): Promise<string[]> {
  const root = await fs.realpath(workspacePath);
  const files: string[] = [];
  await visit(root, "");
  return files.sort((left, right) => left.localeCompare(right));

  async function visit(directory: string, relativeDirectory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (relativeDirectory === "" && entry.name === ".git") {
        continue;
      }
      const relativePath = relativeDirectory === ""
        ? entry.name
        : `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) {
        await visit(path.join(directory, entry.name), relativePath);
        continue;
      }
      if (entry.isFile() || entry.isSymbolicLink()) {
        files.push(relativePath);
      }
    }
  }
}

export async function readLocalWorkspaceTextFile(input: {
  workspacePath: string;
  filePath: string;
  maxBytes?: number;
}): Promise<LocalConsoleFileContent & { text?: string }> {
  const normalizedPath = normalizeLocalWorkspaceFilePath(input.filePath);
  if (normalizedPath === null) {
    return unavailable(input.filePath, "outside-workspace");
  }

  let root: string;
  let candidate: string;
  try {
    root = await fs.realpath(input.workspacePath);
    candidate = await fs.realpath(path.join(root, ...normalizedPath.split("/")));
  } catch (error) {
    return unavailable(normalizedPath, isMissingFileError(error) ? "not-found" : "workspace-unavailable");
  }
  if (!isPathInside(root, candidate)) {
    return unavailable(normalizedPath, "outside-workspace");
  }

  let stat;
  try {
    stat = await fs.stat(candidate);
  } catch (error) {
    return unavailable(normalizedPath, isMissingFileError(error) ? "not-found" : "workspace-unavailable");
  }
  if (!stat.isFile()) {
    return unavailable(normalizedPath, "not-file");
  }
  if (stat.size > (input.maxBytes ?? LOCAL_CONSOLE_FILE_CONTENT_MAX_BYTES)) {
    return unavailable(normalizedPath, "file-too-large");
  }

  let content: Buffer;
  try {
    content = await fs.readFile(candidate);
  } catch {
    return unavailable(normalizedPath, "workspace-unavailable");
  }
  if (content.includes(0)) {
    return unavailable(normalizedPath, "binary-file");
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return unavailable(normalizedPath, "binary-file");
  }
  return {
    available: true,
    path: normalizedPath,
    lines: textToUnchangedLines(text),
    reason: null,
    text,
  };
}

export async function readLocalFileReferenceWindow(input: {
  filePath: string;
  line: number;
  column: number | null;
  contextLines?: number;
  maxScanBytes?: number;
  maxLineBytes?: number;
  maxResponseBytes?: number;
}): Promise<LocalConsoleFileReferenceContent> {
  if (
    !path.posix.isAbsolute(input.filePath)
    || !Number.isSafeInteger(input.line)
    || input.line < 1
    || (input.column !== null && (!Number.isSafeInteger(input.column) || input.column < 1))
  ) {
    return unavailableFileReference(input, "invalid-path");
  }

  let candidate: string;
  try {
    candidate = await fs.realpath(input.filePath);
  } catch (error) {
    return unavailableFileReference(input, isMissingFileError(error) ? "not-found" : "unavailable");
  }
  const canonicalInput = {
    filePath: candidate,
    line: input.line,
    column: input.column,
  };

  let stat;
  try {
    stat = await fs.stat(candidate);
  } catch (error) {
    return unavailableFileReference(canonicalInput, isMissingFileError(error) ? "not-found" : "unavailable", "external-preview");
  }
  if (!stat.isFile()) {
    return unavailableFileReference(canonicalInput, "not-file", "external-preview");
  }

  const contextLines = Math.max(
    0,
    Math.min(200, input.contextLines ?? LOCAL_CONSOLE_FILE_REFERENCE_CONTEXT_LINES),
  );
  const startLine = Math.max(1, input.line - contextLines);
  const endLine = input.line + contextLines;
  const maxScanBytes = Math.max(
    LOCAL_CONSOLE_FILE_REFERENCE_READ_CHUNK_BYTES,
    input.maxScanBytes ?? LOCAL_CONSOLE_FILE_REFERENCE_MAX_SCAN_BYTES,
  );
  const maxLineBytes = Math.max(1, input.maxLineBytes ?? LOCAL_CONSOLE_FILE_REFERENCE_MAX_LINE_BYTES);
  const maxResponseBytes = Math.max(
    1,
    input.maxResponseBytes ?? LOCAL_CONSOLE_FILE_REFERENCE_MAX_RESPONSE_BYTES,
  );
  const lines: LocalConsoleFileReferenceLine[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const readBuffer = Buffer.allocUnsafe(LOCAL_CONSOLE_FILE_REFERENCE_READ_CHUNK_BYTES);
  let pending = "";
  let position = 0;
  let lineNumber = 0;
  let reachedEndWindow = false;
  let sawEof = false;
  let responseBytes = 0;
  let fileHandle;

  try {
    fileHandle = await fs.open(candidate, "r");
    while (position < stat.size && position < maxScanBytes && !reachedEndWindow) {
      const length = Math.min(
        readBuffer.byteLength,
        stat.size - position,
        maxScanBytes - position,
      );
      const read = await fileHandle.read(readBuffer, 0, length, position);
      if (read.bytesRead === 0) {
        sawEof = true;
        break;
      }
      position += read.bytesRead;
      const chunk = readBuffer.subarray(0, read.bytesRead);
      if (chunk.includes(0)) {
        return unavailableFileReference(canonicalInput, "binary-file", "external-preview");
      }
      pending += decoder.decode(chunk, { stream: position < stat.size });
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const text = trimCarriageReturn(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        lineNumber += 1;
        const lineBytes = Buffer.byteLength(text);
        if (lineBytes > maxLineBytes) {
          return unavailableFileReference(canonicalInput, "line-too-large", "external-preview");
        }
        if (lineNumber >= startLine && lineNumber <= endLine) {
          responseBytes += serializedReferenceLineBytes(lineNumber, text);
          if (responseBytes > maxResponseBytes) {
            return unavailableFileReference(canonicalInput, "response-too-large", "external-preview");
          }
          lines.push({ lineNumber, text });
        }
        if (lineNumber >= endLine) {
          reachedEndWindow = true;
          break;
        }
        newline = pending.indexOf("\n");
      }
      if (Buffer.byteLength(pending) > maxLineBytes) {
        return unavailableFileReference(canonicalInput, "line-too-large", "external-preview");
      }
    }
    sawEof ||= position >= stat.size;
    if (sawEof && !reachedEndWindow) {
      pending += decoder.decode();
      if (pending !== "") {
        lineNumber += 1;
        const lineBytes = Buffer.byteLength(pending);
        if (lineBytes > maxLineBytes) {
          return unavailableFileReference(canonicalInput, "line-too-large", "external-preview");
        }
        if (lineNumber >= startLine && lineNumber <= endLine) {
          responseBytes += serializedReferenceLineBytes(lineNumber, pending);
          if (responseBytes > maxResponseBytes) {
            return unavailableFileReference(canonicalInput, "response-too-large", "external-preview");
          }
          lines.push({ lineNumber, text: trimCarriageReturn(pending) });
        }
      }
    }
  } catch (error) {
    return unavailableFileReference(
      canonicalInput,
      error instanceof TypeError ? "binary-file" : "unavailable",
      "external-preview",
    );
  } finally {
    await fileHandle?.close().catch(() => undefined);
  }

  if (lineNumber < input.line) {
    return unavailableFileReference(
      canonicalInput,
      position >= maxScanBytes && position < stat.size ? "scan-limit" : "line-not-found",
      "external-preview",
    );
  }
  const result: LocalConsoleFileReferenceContent = {
    available: true,
    scope: "external-preview",
    isComplete: false,
    path: candidate,
    lines,
    reason: null,
    targetLine: input.line,
    targetColumn: input.column,
    truncatedBefore: startLine > 1,
    truncatedAfter: reachedEndWindow && (pending !== "" || position < stat.size),
    relativePath: null,
    text: null,
  };
  return Buffer.byteLength(JSON.stringify(result)) > maxResponseBytes
    ? unavailableFileReference(canonicalInput, "response-too-large", "external-preview")
    : result;
}

export async function readLocalFileReference(input: {
  workspacePath: string;
  filePath: string;
  line: number;
  column: number | null;
  hasExplicitLine: boolean;
}): Promise<LocalConsoleFileReferenceContent> {
  if (!path.posix.isAbsolute(input.filePath)) {
    return unavailableFileReference(input, "invalid-path");
  }
  let root: string;
  let candidate: string;
  try {
    [root, candidate] = await Promise.all([
      fs.realpath(input.workspacePath),
      fs.realpath(input.filePath),
    ]);
  } catch (error) {
    return unavailableFileReference(input, isMissingFileError(error) ? "not-found" : "unavailable");
  }
  if (!isPathInside(root, candidate)) {
    return await readLocalFileReferenceWindow({
      filePath: candidate,
      line: input.line,
      column: input.column,
    });
  }
  const relativePath = path.relative(root, candidate).split(path.sep).join("/");
  const content = await readLocalWorkspaceTextFile({
    workspacePath: root,
    filePath: relativePath,
  });
  if (!content.available) {
    return {
      ...unavailableFileReference({ ...input, filePath: candidate }, mapWorkspaceFileReason(content.reason)),
      scope: "workspace-file",
      relativePath,
    };
  }
  const lines = splitTextLines(content.text ?? "").map((text, index) => ({
    lineNumber: index + 1,
    text,
  }));
  if (input.hasExplicitLine && input.line > lines.length) {
    return {
      ...unavailableFileReference({ ...input, filePath: candidate }, "line-not-found"),
      scope: "workspace-file",
      relativePath,
    };
  }
  return {
    available: true,
    scope: "workspace-file",
    isComplete: true,
    path: candidate,
    relativePath,
    text: content.text ?? "",
    lines,
    reason: null,
    targetLine: input.line,
    targetColumn: input.column,
    truncatedBefore: false,
    truncatedAfter: false,
  };
}

export function normalizeLocalWorkspaceFilePath(filePath: string): string | null {
  const portable = filePath.replaceAll("\\", "/");
  if (portable.trim() === "" || portable.startsWith("/") || /^[a-z]:\//iu.test(portable)) {
    return null;
  }
  const normalized = path.posix.normalize(portable);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    return null;
  }
  return normalized;
}

export function textToUnchangedLines(text: string): LocalConsoleFileContent["lines"] {
  return splitTextLines(text).map((line, index) => ({
    kind: "unchanged",
    oldLineNumber: index + 1,
    newLineNumber: index + 1,
    text: line,
  }));
}

export function splitTextLines(text: string): string[] {
  if (text === "") {
    return [];
  }
  const lines = text.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines.map((line) => line.endsWith("\r") ? line.slice(0, -1) : line);
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

function unavailable(
  filePath: string,
  reason: Extract<LocalConsoleFileContent, { available: false }>["reason"],
): Extract<LocalConsoleFileContent, { available: false }> {
  return { available: false, path: filePath, lines: [], reason };
}

function unavailableFileReference(
  input: Pick<Parameters<typeof readLocalFileReferenceWindow>[0], "filePath" | "line" | "column">,
  reason: Extract<LocalConsoleFileReferenceContent, { available: false }>["reason"],
  scope: Extract<LocalConsoleFileReferenceContent, { available: false }>["scope"] = null,
): Extract<LocalConsoleFileReferenceContent, { available: false }> {
  return {
    available: false,
    scope,
    isComplete: null,
    path: input.filePath,
    lines: [],
    reason,
    targetLine: input.line,
    targetColumn: input.column,
    relativePath: null,
    text: null,
  };
}

function mapWorkspaceFileReason(
  reason: Extract<LocalConsoleFileContent, { available: false }>["reason"],
): Extract<LocalConsoleFileReferenceContent, { available: false }>["reason"] {
  if (reason === "outside-workspace") return "unavailable";
  return reason;
}

function trimCarriageReturn(value: string): string {
  return value.endsWith("\r") ? value.slice(0, -1) : value;
}

function serializedReferenceLineBytes(lineNumber: number, text: string): number {
  return Buffer.byteLength(JSON.stringify({ lineNumber, text }));
}
