import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CodexRolloutCursorInvalidError,
  readCodexRolloutAppend,
  readCodexRolloutPage,
  resolveCodexRollout,
  type CodexRolloutResolution,
  type ResolveCodexRolloutOptions,
} from "./codex-rollout.js";
import type {
  LocalExecutionSessionLinkFact,
  LocalRunExecutionContextFact,
} from "./execution-context.js";
import {
  malformedProviderProcessEvent,
  projectClaudeTranscriptRecord,
  projectKimiWireRecord,
  type LocalConsoleProcessEvent,
} from "./process-event-projector.js";
import {
  inspectTrustedJsonlCandidate,
  readTrustedTextSidecar,
  readTrustedJsonlAppend,
  readTrustedJsonlPage,
  readTrustedJsonlRecords,
  resolveTrustedJsonlRoot,
  scanTrustedJsonlRecords,
  TrustedJsonlCursorInvalidError,
  type TrustedJsonlFile,
  type TrustedJsonlIdentity,
  type TrustedJsonlSlice,
} from "../trusted-jsonl.js";
import { resolveKimiRuntimeHomePaths } from "../kimi-runtime-home.js";

export type LocalProcessEngine = LocalExecutionSessionLinkFact["engine"];

export interface ProviderTraceLink {
  sessionId: string;
  runId: string;
  sourceMessageId: number;
  role: string;
  engine: LocalProcessEngine;
  externalSessionId: string;
  contextFingerprint: string;
  startedAt: string;
  legacyCodex?: boolean;
}

export type ProviderTraceUnavailableReason =
  | "invalid-session-id"
  | "root-unavailable"
  | "index-unavailable"
  | "not-found"
  | "duplicate"
  | "outside-root"
  | "not-a-file"
  | "unreadable"
  | "malformed"
  | "context-mismatch"
  | "cursor-invalid";

export type ProviderTraceResolution =
  | {
      status: "available";
      engine: "codex";
      externalSessionId: string;
      codex: Extract<CodexRolloutResolution, { status: "available" }>;
      identity: TrustedJsonlIdentity;
    }
  | {
      status: "available";
      engine: "claude";
      externalSessionId: string;
      file: TrustedJsonlFile;
      identity: TrustedJsonlIdentity;
    }
  | {
      status: "available";
      engine: "kimi";
      externalSessionId: string;
      file: TrustedJsonlFile;
      identity: TrustedJsonlIdentity;
    }
  | {
      status: "unavailable";
      engine: LocalProcessEngine;
      reason: ProviderTraceUnavailableReason | string;
    };

export interface ProviderTraceResolverOptions {
  rollout?: ResolveCodexRolloutOptions;
  dataRoot?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  claudeProjectsRoot?: string;
  kimiSourceHome?: string;
}

export interface ProviderContextSection {
  key: string;
  label: string;
  source: "codex-rollout" | "claude-transcript" | "kimi-wire";
  status: "recorded" | "not-recorded";
  contents: string[];
}

export interface ProviderTraceContext {
  sections: ProviderContextSection[];
  metadata: {
    model: string | null;
    effort: string | null;
    provider: string | null;
    cliVersion: string | null;
    cwd: string | null;
  };
}

const CLAUDE_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KIMI_SESSION_ID = /^session_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KIMI_WORKDIR_KEY = /^wd_.+_([0-9a-f]{12})$/u;

export async function resolveProviderTrace(input: {
  link: ProviderTraceLink;
  context: LocalRunExecutionContextFact | undefined;
  options?: ProviderTraceResolverOptions;
}): Promise<ProviderTraceResolution> {
  if (
    !(
      input.link.engine === "codex"
      && input.link.legacyCodex === true
      && input.context === undefined
    )
    && (
      input.context === undefined
      || input.context.sessionId !== input.link.sessionId
      || input.context.runId !== input.link.runId
      || input.context.sourceMessageId !== input.link.sourceMessageId
      || input.context.role !== input.link.role
      || input.context.engine !== input.link.engine
    )
  ) {
    return {
      status: "unavailable",
      engine: input.link.engine,
      reason: "context-mismatch",
    };
  }
  if (
    input.context !== undefined
    && !(input.link.engine === "codex" && input.link.legacyCodex === true)
    && (
      input.context.contextFingerprint !== input.link.contextFingerprint
      || path.resolve(input.context.workspace.cwd) !== input.context.workspace.cwd
    )
  ) {
    return {
      status: "unavailable",
      engine: input.link.engine,
      reason: "context-mismatch",
    };
  }
  if (input.link.engine === "codex") {
    const resolution = await resolveCodexRollout(
      input.link.externalSessionId,
      input.options?.rollout,
    );
    if (resolution.status !== "available") {
      return {
        status: "unavailable",
        engine: "codex",
        reason: resolution.reason,
      };
    }
    return {
      status: "available",
      engine: "codex",
      externalSessionId: input.link.externalSessionId,
      codex: resolution,
      identity: resolution.identity,
    };
  }
  if (input.link.engine === "claude") {
    return await resolveClaudeTrace(input.link, input.context!, input.options);
  }
  return await resolveKimiTrace(input.link, input.context!, input.options);
}

export async function readProviderTracePage(input: {
  resolution: Extract<ProviderTraceResolution, { status: "available" }>;
  runId: string;
  endOffset?: number;
  expectedIdentity?: Pick<TrustedJsonlIdentity, "realPath" | "device" | "inode">;
  minimumSize?: number;
  maxBytes?: number;
  maxEvents?: number;
}): Promise<TrustedJsonlSlice<LocalConsoleProcessEvent>> {
  if (input.resolution.engine === "codex") {
    try {
      return await readCodexRolloutPage({
        resolution: input.resolution.codex,
        runId: input.runId,
        ...(input.endOffset === undefined ? {} : { endOffset: input.endOffset }),
        ...(input.expectedIdentity === undefined
          ? {}
          : { expectedIdentity: input.expectedIdentity }),
        ...(input.minimumSize === undefined ? {} : { minimumSize: input.minimumSize }),
        ...(input.maxBytes === undefined ? {} : { maxBytes: input.maxBytes }),
        ...(input.maxEvents === undefined ? {} : { maxEvents: input.maxEvents }),
      });
    } catch (error) {
      if (error instanceof CodexRolloutCursorInvalidError) {
        throw new TrustedJsonlCursorInvalidError();
      }
      throw error;
    }
  }
  const resolution = input.resolution;
  const engine = resolution.engine;
  return await readTrustedJsonlPage({
    file: resolution.file,
    ...(input.endOffset === undefined ? {} : { endOffset: input.endOffset }),
    ...(input.expectedIdentity === undefined
      ? {}
      : { expectedIdentity: input.expectedIdentity }),
    ...(input.minimumSize === undefined ? {} : { minimumSize: input.minimumSize }),
    ...(input.maxBytes === undefined ? {} : { maxBytes: input.maxBytes }),
    ...(input.maxEvents === undefined ? {} : { maxEvents: input.maxEvents }),
    projectLine: async (value, context) => {
      if (resolution.engine === "claude") {
        return projectClaudeTranscriptRecord(
          await hydrateClaudeToolResult(value, resolution),
          { runId: input.runId, ...context },
        );
      }
      return projectKimiWireRecord(
        await validateKimiBlobReferences(value, resolution),
        { runId: input.runId, ...context },
      );
    },
    malformedLine: (context) => [
      malformedProviderProcessEvent(engine, input.runId, context.lineOffset),
    ],
  });
}

export async function readProviderTraceAppend(input: {
  resolution: Extract<ProviderTraceResolution, { status: "available" }>;
  runId: string;
  startOffset: number;
  expectedIdentity: Pick<TrustedJsonlIdentity, "realPath" | "device" | "inode">;
  minimumSize: number;
  maxBytes?: number;
  maxEvents?: number;
}): Promise<TrustedJsonlSlice<LocalConsoleProcessEvent>> {
  if (input.resolution.engine === "codex") {
    try {
      return await readCodexRolloutAppend({
        resolution: input.resolution.codex,
        runId: input.runId,
        startOffset: input.startOffset,
        expectedIdentity: input.expectedIdentity,
        minimumSize: input.minimumSize,
        ...(input.maxBytes === undefined ? {} : { maxBytes: input.maxBytes }),
        ...(input.maxEvents === undefined ? {} : { maxEvents: input.maxEvents }),
      });
    } catch (error) {
      if (error instanceof CodexRolloutCursorInvalidError) {
        throw new TrustedJsonlCursorInvalidError();
      }
      throw error;
    }
  }
  const resolution = input.resolution;
  const engine = resolution.engine;
  return await readTrustedJsonlAppend({
    file: resolution.file,
    startOffset: input.startOffset,
    expectedIdentity: input.expectedIdentity,
    minimumSize: input.minimumSize,
    ...(input.maxBytes === undefined ? {} : { maxBytes: input.maxBytes }),
    ...(input.maxEvents === undefined ? {} : { maxEvents: input.maxEvents }),
    projectLine: async (value, context) => {
      if (resolution.engine === "claude") {
        return projectClaudeTranscriptRecord(
          await hydrateClaudeToolResult(value, resolution),
          { runId: input.runId, ...context },
        );
      }
      return projectKimiWireRecord(
        await validateKimiBlobReferences(value, resolution),
        { runId: input.runId, ...context },
      );
    },
    malformedLine: (context) => [
      malformedProviderProcessEvent(engine, input.runId, context.lineOffset),
    ],
  });
}

export async function readProviderTraceContext(
  resolution: Extract<ProviderTraceResolution, { status: "available"; engine: "claude" | "kimi" }>,
): Promise<ProviderTraceContext | { status: "malformed"; reason: string }> {
  let loaded;
  try {
    loaded = await readTrustedJsonlRecords({ file: resolution.file });
  } catch (error) {
    if (error instanceof TrustedJsonlCursorInvalidError) {
      return { status: "malformed", reason: "cursor-invalid" };
    }
    throw error;
  }
  if (loaded.records.length === 0 || loaded.malformedLines > 0) {
    return { status: "malformed", reason: "records-unreadable" };
  }
  return resolution.engine === "claude"
    ? claudeContext(loaded.records)
    : kimiContext(loaded.records);
}

function resolveClaudeProjectsRoot(options: ProviderTraceResolverOptions | undefined): string {
  if (options?.claudeProjectsRoot !== undefined) {
    return path.resolve(options.claudeProjectsRoot);
  }
  const env = options?.env ?? process.env;
  const configured = env.CLAUDE_CONFIG_DIR?.trim();
  return path.resolve(
    configured && configured.length > 0
      ? path.join(configured, "projects")
      : path.join(options?.homeDir ?? os.homedir(), ".claude", "projects"),
  );
}

async function resolveClaudeTrace(
  link: ProviderTraceLink,
  context: LocalRunExecutionContextFact,
  options: ProviderTraceResolverOptions | undefined,
): Promise<ProviderTraceResolution> {
  if (!CLAUDE_SESSION_ID.test(link.externalSessionId)) {
    return { status: "unavailable", engine: "claude", reason: "invalid-session-id" };
  }
  const root = await resolveTrustedJsonlRoot(resolveClaudeProjectsRoot(options));
  if (root === null) {
    return { status: "unavailable", engine: "claude", reason: "root-unavailable" };
  }
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return { status: "unavailable", engine: "claude", reason: "unreadable" };
  }
  const candidates = entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => path.join(root, entry.name, `${link.externalSessionId}.jsonl`));
  const existing: string[] = [];
  for (const candidate of candidates) {
    try {
      await fs.lstat(candidate);
      existing.push(candidate);
    } catch (error) {
      if (!isMissingFileError(error)) {
        return { status: "unavailable", engine: "claude", reason: "unreadable" };
      }
    }
  }
  if (existing.length === 0) {
    return { status: "unavailable", engine: "claude", reason: "not-found" };
  }
  if (existing.length > 1) {
    return { status: "unavailable", engine: "claude", reason: "duplicate" };
  }
  const inspection = await inspectTrustedJsonlCandidate(root, existing[0]!);
  if (inspection.status !== "available") {
    return {
      status: "unavailable",
      engine: "claude",
      reason: inspection.reason,
    };
  }
  let observedSession = false;
  let matchingCwd = false;
  let mismatchedSession = false;
  let malformedLines = 0;
  const expectedCwd = await canonicalComparablePath(context.workspace.cwd);
  const cwdCache = new Map<string, string>();
  try {
    const scan = await scanTrustedJsonlRecords({
      file: inspection.file,
      onRecord: async (value) => {
        if (!isRecord(value)) {
          return;
        }
        const recordSessionId = readString(value.sessionId);
        if (recordSessionId !== null) {
          observedSession = true;
          if (recordSessionId !== link.externalSessionId) {
            mismatchedSession = true;
          }
        }
        const recordCwd = readString(value.cwd);
        if (value.isSidechain !== true && recordCwd !== null) {
          let canonicalCwd = cwdCache.get(recordCwd);
          if (canonicalCwd === undefined) {
            canonicalCwd = await canonicalComparablePath(recordCwd);
            cwdCache.set(recordCwd, canonicalCwd);
          }
          if (canonicalCwd === expectedCwd) {
            matchingCwd = true;
          }
        }
      },
    });
    malformedLines = scan.malformedLines;
  } catch {
    return { status: "unavailable", engine: "claude", reason: "unreadable" };
  }
  if (
    malformedLines > 0
    || !observedSession
    || !matchingCwd
    || mismatchedSession
  ) {
    return {
      status: "unavailable",
      engine: "claude",
      reason: malformedLines > 0 || !observedSession
        ? "malformed"
        : "context-mismatch",
    };
  }
  return {
    status: "available",
    engine: "claude",
    externalSessionId: link.externalSessionId,
    file: inspection.file,
    identity: inspection.file.identity,
  };
}

async function resolveKimiTrace(
  link: ProviderTraceLink,
  context: LocalRunExecutionContextFact,
  options: ProviderTraceResolverOptions | undefined,
): Promise<ProviderTraceResolution> {
  if (!KIMI_SESSION_ID.test(link.externalSessionId)) {
    return { status: "unavailable", engine: "kimi", reason: "invalid-session-id" };
  }
  const sourceHome = path.resolve(
    options?.kimiSourceHome
      ?? resolveKimiRuntimeHomePaths({
        dataRoot: options?.dataRoot ?? process.cwd(),
        env: options?.env ?? process.env,
        homeDir: options?.homeDir,
      }).sourceHome,
  );
  const sessionsRoot = await resolveTrustedJsonlRoot(path.join(sourceHome, "sessions"));
  if (sessionsRoot === null) {
    return { status: "unavailable", engine: "kimi", reason: "root-unavailable" };
  }
  let index: string;
  try {
    index = await fs.readFile(path.join(sourceHome, "session_index.jsonl"), "utf8");
  } catch {
    return { status: "unavailable", engine: "kimi", reason: "index-unavailable" };
  }
  const mappings = new Map<string, { workDir: string; workDirKey: string }>();
  const complete = index.endsWith("\n")
    ? index
    : index.slice(0, Math.max(0, index.lastIndexOf("\n") + 1));
  for (const line of complete.split("\n")) {
    if (line === "") {
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      return { status: "unavailable", engine: "kimi", reason: "malformed" };
    }
    if (!isRecord(value) || value.sessionId !== link.externalSessionId) {
      continue;
    }
    const sessionDir = readString(value.sessionDir);
    const workDir = readString(value.workDir);
    if (
      sessionDir === null
      || workDir === null
      || path.basename(path.resolve(sessionDir)) !== link.externalSessionId
    ) {
      return { status: "unavailable", engine: "kimi", reason: "malformed" };
    }
    const workDirKey = path.basename(path.dirname(sessionDir));
    const mappingKey = `${path.resolve(workDir)}\0${workDirKey}`;
    mappings.set(mappingKey, { workDir: path.resolve(workDir), workDirKey });
  }
  if (mappings.size === 0) {
    return { status: "unavailable", engine: "kimi", reason: "not-found" };
  }
  if (mappings.size > 1) {
    return { status: "unavailable", engine: "kimi", reason: "duplicate" };
  }
  const mapping = [...mappings.values()][0]!;
  const match = KIMI_WORKDIR_KEY.exec(mapping.workDirKey);
  const [mappingCwd, contextCwd] = await Promise.all([
    canonicalComparablePath(mapping.workDir),
    canonicalComparablePath(context.workspace.cwd),
  ]);
  const expectedHash = crypto
    .createHash("sha256")
    .update(mapping.workDir)
    .digest("hex")
    .slice(0, 12);
  if (
    mappingCwd !== contextCwd
    || match?.[1] !== expectedHash
  ) {
    return { status: "unavailable", engine: "kimi", reason: "context-mismatch" };
  }
  const candidate = path.join(
    sessionsRoot,
    mapping.workDirKey,
    link.externalSessionId,
    "agents",
    "main",
    "wire.jsonl",
  );
  const inspection = await inspectTrustedJsonlCandidate(sessionsRoot, candidate);
  if (inspection.status !== "available") {
    return {
      status: "unavailable",
      engine: "kimi",
      reason: inspection.reason,
    };
  }
  return {
    status: "available",
    engine: "kimi",
    externalSessionId: link.externalSessionId,
    file: inspection.file,
    identity: inspection.file.identity,
  };
}

async function hydrateClaudeToolResult(
  value: unknown,
  resolution: Extract<ProviderTraceResolution, { status: "available"; engine: "claude" }>,
): Promise<unknown> {
  if (!isRecord(value) || !isRecord(value.toolUseResult)) {
    return value;
  }
  const declaredPath = readString(value.toolUseResult.persistedOutputPath);
  const message = isRecord(value.message) ? value.message : null;
  if (declaredPath === null || message === null || !Array.isArray(message.content)) {
    return value;
  }
  const sidecarRoot = path.join(
    path.dirname(resolution.file.filePath),
    resolution.externalSessionId,
    "tool-results",
  );
  const result = await readTrustedTextSidecar({
    trustedRoot: sidecarRoot,
    candidate: path.isAbsolute(declaredPath)
      ? declaredPath
      : path.join(sidecarRoot, declaredPath),
  });
  const replacement = result.status === "available"
    ? result.contents
    : "[Claude tool result sidecar unavailable]";
  return {
    ...value,
    message: {
      ...message,
      content: message.content.map((part) =>
        isRecord(part) && part.type === "tool_result"
          ? { ...part, content: replacement }
          : part),
    },
  };
}

async function validateKimiBlobReferences(
  value: unknown,
  resolution: Extract<ProviderTraceResolution, { status: "available"; engine: "kimi" }>,
): Promise<unknown> {
  const blobRoot = path.join(path.dirname(resolution.file.filePath), "blobs");
  const trustedBlobRoot = await resolveTrustedJsonlRoot(blobRoot);
  return await visit(value);

  async function visit(candidate: unknown): Promise<unknown> {
    if (Array.isArray(candidate)) {
      return await Promise.all(candidate.map(visit));
    }
    if (!isRecord(candidate)) {
      return candidate;
    }
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(candidate)) {
      if (key === "url" && typeof child === "string" && child.startsWith("blobref:")) {
        const match = /^blobref:([^;]+);([0-9a-f]{64})$/u.exec(child);
        if (match === null || trustedBlobRoot === null) {
          output[key] = "[Kimi blob unavailable]";
          continue;
        }
        const inspected = await inspectTrustedJsonlCandidate(
          trustedBlobRoot,
          path.join(trustedBlobRoot, match[2]!),
        );
        output[key] = inspected.status === "available"
          ? child
          : "[Kimi blob unavailable]";
        continue;
      }
      output[key] = await visit(child);
    }
    return output;
  }
}

function claudeContext(records: unknown[]): ProviderTraceContext {
  const user: string[] = [];
  const assistant: string[] = [];
  const metadata: string[] = [];
  let model: string | null = null;
  let effort: string | null = null;
  let cliVersion: string | null = null;
  let cwd: string | null = null;
  for (const value of records) {
    if (!isRecord(value)) {
      continue;
    }
    cwd = readString(value.cwd) ?? cwd;
    cliVersion = readString(value.version) ?? cliVersion;
    effort = readString(value.effort) ?? effort;
    const message = isRecord(value.message) ? value.message : null;
    model = readString(message?.model) ?? model;
    if (message !== null && Array.isArray(message.content)) {
      const target = message.role === "user"
        ? user
        : message.role === "assistant"
          ? assistant
          : null;
      if (target !== null) {
        for (const part of message.content) {
          if (isRecord(part) && part.type === "text") {
            pushDistinct(target, readString(part.text));
          }
        }
      }
    }
    if (metadata.length === 0 && readString(value.sessionId) !== null) {
      metadata.push(serialize({
        sessionId: value.sessionId,
        cwd: value.cwd,
        entrypoint: value.entrypoint,
        permissionMode: value.permissionMode,
        version: value.version,
      }));
    }
  }
  return {
    sections: [
      section("user", "USER", "claude-transcript", user),
      section("assistant", "ASSISTANT", "claude-transcript", assistant),
      section("session-metadata", "SESSION_METADATA", "claude-transcript", metadata),
    ],
    metadata: {
      model,
      effort,
      provider: "Anthropic",
      cliVersion,
      cwd,
    },
  };
}

function kimiContext(records: unknown[]): ProviderTraceContext {
  const system: string[] = [];
  const turn: string[] = [];
  const context: string[] = [];
  const request: string[] = [];
  let model: string | null = null;
  let effort: string | null = null;
  let provider: string | null = null;
  for (const value of records) {
    if (!isRecord(value)) {
      continue;
    }
    const type = readString(value.type);
    if (type === "config.update") {
      pushDistinct(system, readString(value.systemPrompt));
      model = readString(value.modelAlias) ?? model;
      effort = readString(value.thinkingEffort) ?? effort;
    } else if (type === "turn.prompt") {
      pushDistinct(turn, rawField(value.input));
    } else if (type === "context.append_message") {
      pushDistinct(context, rawField(value.message));
    } else if (type === "llm.request") {
      pushDistinct(request, serialize(value));
      model = readString(value.model) ?? readString(value.modelAlias) ?? model;
      effort = readString(value.thinkingEffort) ?? effort;
      provider = readString(value.provider) ?? provider;
    }
  }
  return {
    sections: [
      section("system", "SYSTEM_PROMPT", "kimi-wire", system),
      section("turn", "TURN_PROMPT", "kimi-wire", turn),
      section("context", "CONTEXT", "kimi-wire", context),
      section("request", "LLM_REQUEST", "kimi-wire", request),
    ],
    metadata: {
      model,
      effort,
      provider,
      cliVersion: null,
      cwd: null,
    },
  };
}

function section(
  key: string,
  label: string,
  source: ProviderContextSection["source"],
  contents: string[],
): ProviderContextSection {
  return {
    key,
    label,
    source,
    status: contents.length === 0 ? "not-recorded" : "recorded",
    contents,
  };
}

function pushDistinct(target: string[], value: string | null): void {
  if (value !== null && target.at(-1) !== value) {
    target.push(value);
  }
}

function rawField(value: unknown): string | null {
  return value === undefined || value === null
    ? null
    : typeof value === "string"
      ? value
      : serialize(value);
}

function serialize(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
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

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error.code === "ENOENT" || error.code === "ENOTDIR");
}
