import { createHash, randomBytes } from "node:crypto";
import { access, readFile, realpath, unlink } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import {
  MANAGED_PROCESS_MAX_ITEMS_PER_SESSION,
  MANAGED_PROCESS_MAX_LOG_BYTES,
  MANAGED_PROCESS_MAX_LOG_READ_BYTES,
  MANAGED_PROCESS_READINESS_INTERVAL_MS,
  MANAGED_PROCESS_READINESS_FAILURE_THRESHOLD,
  MANAGED_PROCESS_READINESS_TIMEOUT_MS,
} from "../config.js";
import {
  ManagedProcessAdmissionError,
  admitManagedProcessStart,
  planManagedProcessRunningCountIncrement,
  type ManagedProcessStartRequest,
  type ManagedProcessSummary,
} from "./managed-process-contract.js";
import type { ManagedProcessToolCompletion } from "./execution-driver.js";
import type {
  LaunchdManagedProcessHandle,
  LaunchdReconciliationBlockedFact,
  LaunchdWrapperStatus,
} from "./managed-process-launchd-adapter.js";

export interface ManagedProcessOwnershipPort {
  init(): Promise<void>;
  reconcile(): Promise<void | { blocked: readonly LaunchdReconciliationBlockedFact[] }>;
  start(input: { executable: string; args: readonly string[]; cwd: string; ownershipScopeHash: string }): Promise<LaunchdManagedProcessHandle>;
  readStatus(handle: Pick<LaunchdManagedProcessHandle, "statusPath">): Promise<LaunchdWrapperStatus | null>;
  stop(handle: Pick<LaunchdManagedProcessHandle, "processId">): Promise<void>;
  release(handle: Pick<LaunchdManagedProcessHandle, "processId">): Promise<void>;
}

export interface ManagedProcessCapability {
  socketPath: string;
  token: string;
}

interface CapabilityBinding {
  sessionId: string;
  workspaceRoot: string;
  providerRunId: string;
}

interface RegistryItem {
  summary: ManagedProcessSummary;
  handle: LaunchdManagedProcessHandle;
  stopPromise: Promise<ManagedProcessSummary> | null;
  readinessDeadline: number;
  ownershipReleased: boolean;
  hasBeenReady: boolean;
  readinessFailureCount: number;
}

export interface ManagedProcessLogResult {
  stdout: string;
  stderr: string;
  truncated: boolean;
  cursor: string;
  unchanged: boolean;
}

export class ManagedProcessSupervisor {
  readonly #adapter: ManagedProcessOwnershipPort;
  readonly #socketPath: string;
  readonly #items = new Map<string, RegistryItem>();
  readonly #capabilities = new Map<string, CapabilityBinding>();
  readonly #completionListeners = new Map<string, Set<(event: ManagedProcessToolCompletion) => void>>();
  #server: net.Server | null = null;
  #pollTimer: NodeJS.Timeout | null = null;
  #reconciliationBlocked: readonly LaunchdReconciliationBlockedFact[] = [];

  constructor(input: { adapter: ManagedProcessOwnershipPort; socketPath: string }) {
    this.#adapter = input.adapter;
    this.#socketPath = input.socketPath;
  }

  async init(): Promise<void> {
    await this.#adapter.init();
    const reconciliation = await this.#adapter.reconcile();
    this.#reconciliationBlocked = reconciliation?.blocked ?? [];
    await unlink(this.#socketPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    this.#server = net.createServer((connection) => this.#acceptConnection(connection));
    await new Promise<void>((resolve, reject) => {
      this.#server!.once("error", reject);
      this.#server!.listen(this.#socketPath, () => {
        this.#server!.off("error", reject);
        resolve();
      });
    });
    this.#pollTimer = setInterval(() => { void this.#refreshAll(); }, MANAGED_PROCESS_READINESS_INTERVAL_MS);
    this.#pollTimer.unref();
  }

  createCapability(binding: CapabilityBinding): ManagedProcessCapability {
    const token = randomBytes(32).toString("base64url");
    this.#capabilities.set(token, { ...binding, workspaceRoot: path.resolve(binding.workspaceRoot) });
    return { socketPath: this.#socketPath, token };
  }

  revokeCapability(token: string): void {
    this.#capabilities.delete(token);
  }

  onToolCompletion(providerRunId: string, listener: (event: ManagedProcessToolCompletion) => void): () => void {
    const listeners = this.#completionListeners.get(providerRunId) ?? new Set();
    listeners.add(listener);
    this.#completionListeners.set(providerRunId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#completionListeners.delete(providerRunId);
    };
  }

  getRunningCount(): number {
    return [...this.#items.values()].filter((item) => item.summary.state !== "exited").length;
  }

  getReconciliationBlocked(): readonly LaunchdReconciliationBlockedFact[] {
    return this.#reconciliationBlocked.map((fact) => ({ ...fact }));
  }

  getRunningCountsBySession(): ReadonlyMap<string, number> {
    const counts = new Map<string, number>();
    for (const item of this.#items.values()) {
      if (item.summary.state === "exited") continue;
      counts.set(item.summary.sessionId, planManagedProcessRunningCountIncrement(counts.get(item.summary.sessionId)));
    }
    return counts;
  }

  async list(sessionId: string): Promise<ManagedProcessSummary[]> {
    await this.#refreshAll();
    return [...this.#items.values()]
      .filter((item) => item.summary.sessionId === sessionId && !item.summary.acknowledged)
      .map((item) => ({ ...item.summary }))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async inspect(sessionId: string, id: string): Promise<ManagedProcessSummary> {
    await this.#refresh(id);
    return { ...this.#ownedItem(sessionId, id).summary };
  }

  async readLogs(sessionId: string, id: string, cursor?: string): Promise<ManagedProcessLogResult> {
    const item = this.#ownedItem(sessionId, id);
    const [stdout, stderr] = await Promise.all([
      boundedRead(item.handle.stdoutPath),
      boundedRead(item.handle.stderrPath),
    ]);
    const metadata = await readLogMetadata(item.handle.logMetadataPath);
    const safeStdout = escapeAndBoundLog(stdout.text);
    const safeStderr = escapeAndBoundLog(stderr.text);
    const nextCursor = createHash("sha256").update(safeStdout.text).update("\0").update(safeStderr.text).update(metadata.stdoutTruncated ? "1" : "0").update(metadata.stderrTruncated ? "1" : "0").digest("base64url");
    const unchanged = cursor === nextCursor;
    return {
      stdout: unchanged ? "" : safeStdout.text,
      stderr: unchanged ? "" : safeStderr.text,
      truncated: stdout.truncated || stderr.truncated || safeStdout.truncated || safeStderr.truncated || metadata.stdoutTruncated || metadata.stderrTruncated,
      cursor: nextCursor,
      unchanged,
    };
  }

  async stop(sessionId: string, id: string): Promise<ManagedProcessSummary> {
    const item = this.#ownedItem(sessionId, id);
    if (item.stopPromise !== null) return await item.stopPromise;
    if (item.ownershipReleased) return { ...item.summary };
    const wasExited = item.summary.state === "exited";
    const previousState = item.summary.state;
    if (!wasExited) item.summary.state = "stopping";
    item.summary.updatedAt = new Date().toISOString();
    const stopPromise = (async () => {
      if (wasExited) await this.#adapter.release(item.handle);
      else await this.#adapter.stop(item.handle);
      item.ownershipReleased = true;
      item.summary.state = "exited";
      if (!wasExited) item.summary.signal ??= "SIGTERM";
      item.summary.updatedAt = new Date().toISOString();
      return { ...item.summary };
    })();
    item.stopPromise = stopPromise;
    try {
      return await stopPromise;
    } catch (error) {
      if (!item.ownershipReleased) {
        item.stopPromise = null;
        item.summary.state = previousState;
        item.summary.updatedAt = new Date().toISOString();
      }
      throw error;
    }
  }

  async acknowledgeExited(sessionId: string): Promise<void> {
    const exited = [...this.#items.values()].filter((item) => item.summary.sessionId === sessionId && item.summary.state === "exited" && !item.summary.acknowledged);
    for (const item of exited) await this.stop(sessionId, item.summary.id);
    const now = new Date().toISOString();
    for (const item of exited) {
      item.summary.acknowledged = true;
      item.summary.updatedAt = now;
    }
  }

  async close(): Promise<void> {
    if (this.#pollTimer !== null) clearInterval(this.#pollTimer);
    this.#pollTimer = null;
    this.#capabilities.clear();
    this.#completionListeners.clear();
    const failures: unknown[] = [];
    for (const item of this.#items.values()) {
      if (item.ownershipReleased) continue;
      try { await this.stop(item.summary.sessionId, item.summary.id); } catch (error) { failures.push(error); }
    }
    if (this.#server !== null) {
      await new Promise<void>((resolve, reject) => this.#server!.close((error) => error === undefined ? resolve() : reject(error)));
      this.#server = null;
    }
    await unlink(this.#socketPath).catch(() => undefined);
    if (failures.length > 0) throw new AggregateError(failures, "Managed process cleanup failed.");
  }

  async #start(binding: CapabilityBinding, raw: unknown): Promise<ManagedProcessSummary> {
    const admitted = admitManagedProcessStart(raw, binding.workspaceRoot);
    const retainedCount = [...this.#items.values()].filter((item) =>
      item.summary.sessionId === binding.sessionId && !item.summary.acknowledged).length;
    if (retainedCount >= MANAGED_PROCESS_MAX_ITEMS_PER_SESSION) {
      throw new ManagedProcessAdmissionError("process-limit", "Managed process limit reached for this session.");
    }
    const workspaceRoot = await realpath(binding.workspaceRoot);
    const cwd = await resolveWorkspaceCwd(workspaceRoot, admitted.cwd);
    const executable = await resolveExecutable(admitted.executable, process.env.PATH ?? "", cwd);
    const handle = await this.#adapter.start({
      executable,
      args: admitted.args,
      cwd,
      ownershipScopeHash: createHash("sha256").update(`${binding.sessionId}\0${workspaceRoot}`).digest("hex"),
    });
    const now = new Date().toISOString();
    const item: RegistryItem = {
      handle,
      stopPromise: null,
      readinessDeadline: Date.now() + MANAGED_PROCESS_READINESS_TIMEOUT_MS,
      ownershipReleased: false,
      hasBeenReady: false,
      readinessFailureCount: 0,
      summary: {
        id: handle.processId,
        sessionId: binding.sessionId,
        workspaceRoot,
        kind: admitted.kind,
        label: admitted.label,
        state: "starting",
        endpoint: admitted.endpoint ?? null,
        readiness: admitted.readiness ?? null,
        createdAt: now,
        updatedAt: now,
        wrapperPid: null,
        targetPid: null,
        exitCode: null,
        signal: null,
        acknowledged: false,
      },
    };
    this.#items.set(handle.processId, item);
    await this.#refresh(handle.processId);
    return { ...item.summary };
  }

  #ownedItem(sessionId: string, id: string): RegistryItem {
    const item = this.#items.get(id);
    if (item === undefined || item.summary.sessionId !== sessionId) {
      throw new ManagedProcessAdmissionError("process-not-found", "Managed process was not found in this session.");
    }
    return item;
  }

  async #refreshAll(): Promise<void> {
    await Promise.all([...this.#items.keys()].map(async (id) => this.#refresh(id)));
  }

  async #refresh(id: string): Promise<void> {
    const item = this.#items.get(id);
    if (item === undefined || item.summary.state === "stopping" || item.summary.state === "exited") return;
    const status = await this.#adapter.readStatus(item.handle);
    if (status === null) return;
    item.summary.wrapperPid = status.wrapperPid;
    item.summary.targetPid = status.targetPid ?? null;
    item.summary.updatedAt = new Date().toISOString();
    if (status.exitedAt !== undefined || status.error !== undefined) {
      item.summary.state = "exited";
      item.summary.exitCode = status.exitCode ?? 1;
      item.summary.signal = status.signal ?? null;
      return;
    }
    if (item.summary.readiness === null) {
      item.summary.state = "running";
      return;
    }
    const ready = await checkReadiness(item.summary.readiness, item.handle.stdoutPath);
    if (ready) {
      item.hasBeenReady = true;
      item.readinessFailureCount = 0;
      item.summary.state = "ready";
      return;
    }
    item.readinessFailureCount += 1;
    if (item.hasBeenReady) {
      item.summary.state = item.readinessFailureCount >= MANAGED_PROCESS_READINESS_FAILURE_THRESHOLD ? "unhealthy" : "ready";
      return;
    }
    item.summary.state = Date.now() >= item.readinessDeadline ? "unhealthy" : "starting";
  }

  #acceptConnection(connection: net.Socket): void {
    let buffer = "";
    connection.setEncoding("utf8");
    connection.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      buffer = "";
      void this.#handleBridgeLine(line).then(
        (result) => connection.end(`${JSON.stringify({ result })}\n`),
        (error) => connection.end(`${JSON.stringify({ error: safeError(error) })}\n`),
      );
    });
  }

  async #handleBridgeLine(line: string): Promise<unknown> {
    if (Buffer.byteLength(line) > 128 * 1024) throw new ManagedProcessAdmissionError("payload-too-large", "Bridge payload is too large.");
    const request = JSON.parse(line) as { token?: unknown; method?: unknown; params?: unknown };
    if (typeof request.token !== "string") throw new ManagedProcessAdmissionError("capability-required", "Capability is required.");
    const binding = this.#capabilities.get(request.token);
    if (binding === undefined) throw new ManagedProcessAdmissionError("capability-invalid", "Capability is invalid or expired.");
    switch (request.method) {
      case "start": return await this.#start(binding, request.params);
      case "list": return await this.list(binding.sessionId);
      case "inspect": return await this.inspect(binding.sessionId, readId(request.params));
      case "read_logs": return await this.readLogs(binding.sessionId, readId(request.params));
      case "stop": return await this.stop(binding.sessionId, readId(request.params));
      case "report_completion": {
        const completion = readCompletion(request.params, binding.providerRunId);
        for (const listener of this.#completionListeners.get(binding.providerRunId) ?? []) listener(completion);
        return { recorded: true };
      }
      default: throw new ManagedProcessAdmissionError("unknown-tool", "Unknown managed process tool.");
    }
  }
}

async function resolveWorkspaceCwd(workspaceRoot: string, relative: string): Promise<string> {
  const candidate = path.resolve(workspaceRoot, relative === "." ? "" : relative);
  const resolved = await realpath(candidate);
  if (resolved !== workspaceRoot && !resolved.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw new ManagedProcessAdmissionError("cwd-outside-workspace", "cwd resolves outside the workspace.");
  }
  return resolved;
}

async function resolveExecutable(command: string, pathValue: string, cwd: string): Promise<string> {
  for (const entry of pathValue.split(path.delimiter)) {
    const candidate = path.resolve(entry === "" ? cwd : entry, command);
    try { await access(candidate, 0o1); return await realpath(candidate); } catch { /* continue */ }
  }
  throw new ManagedProcessAdmissionError("executable-not-found", "Executable is not available on the managed PATH.");
}

async function checkReadiness(readiness: NonNullable<ManagedProcessStartRequest["readiness"]>, stdoutPath: string): Promise<boolean> {
  if (readiness.type === "stdout-pattern") {
    return (await readFile(stdoutPath, "utf8").catch(() => "")).includes(readiness.pattern);
  }
  if (readiness.type === "http") {
    return await checkHttpReadiness(readiness.url, 0);
  }
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: readiness.host, port: readiness.port });
    const finish = (value: boolean) => { socket.destroy(); resolve(value); };
    socket.setTimeout(1_000, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function checkHttpReadiness(url: string, redirects: number): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000), redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location === null || redirects >= 3) return false;
      const redirected = new URL(location, url);
      if (!isLoopbackHttpUrl(redirected)) return false;
      return await checkHttpReadiness(redirected.toString(), redirects + 1);
    }
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  }
}

function isLoopbackHttpUrl(url: URL): boolean {
  return url.protocol === "http:"
    && (url.hostname === "127.0.0.1" || url.hostname === "localhost")
    && url.username === ""
    && url.password === "";
}

async function boundedRead(filePath: string): Promise<{ text: string; truncated: boolean }> {
  const content = await readFile(filePath).catch(() => Buffer.alloc(0));
  const truncated = content.byteLength > MANAGED_PROCESS_MAX_LOG_READ_BYTES / 2;
  const bounded = truncated ? content.subarray(content.byteLength - MANAGED_PROCESS_MAX_LOG_READ_BYTES / 2) : content;
  return { text: bounded.toString("utf8"), truncated };
}

function escapeLogControls(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, (character) =>
    `\\u${character.codePointAt(0)!.toString(16).padStart(4, "0")}`);
}

function escapeAndBoundLog(value: string): { text: string; truncated: boolean } {
  const escaped = escapeLogControls(value);
  const content = Buffer.from(escaped, "utf8");
  const limit = MANAGED_PROCESS_MAX_LOG_READ_BYTES / 2;
  if (content.byteLength <= limit) return { text: escaped, truncated: false };
  return { text: content.subarray(content.byteLength - limit).toString("utf8"), truncated: true };
}

async function readLogMetadata(filePath: string): Promise<{ stdoutTruncated: boolean; stderrTruncated: boolean }> {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
    return {
      stdoutTruncated: value.stdoutTruncated === true,
      stderrTruncated: value.stderrTruncated === true,
    };
  } catch {
    return { stdoutTruncated: false, stderrTruncated: false };
  }
}

function readId(value: unknown): string {
  if (typeof value !== "object" || value === null || typeof (value as { id?: unknown }).id !== "string") {
    throw new ManagedProcessAdmissionError("invalid-process-id", "A managed process id is required.");
  }
  return (value as { id: string }).id;
}

function safeError(error: unknown): { code: string; message: string } {
  return {
    code: error instanceof ManagedProcessAdmissionError ? error.code : "managed-process-failed",
    message: error instanceof Error ? error.message : "Managed process operation failed.",
  };
}

function readCompletion(value: unknown, providerRunId: string): ManagedProcessToolCompletion {
  if (typeof value !== "object" || value === null) {
    throw new ManagedProcessAdmissionError("invalid-tool-completion", "Managed tool completion is invalid.");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.toolCallId !== "string" || record.toolCallId.length === 0 || (record.completionKind !== "completed" && record.completionKind !== "failed")) {
    throw new ManagedProcessAdmissionError("invalid-tool-completion", "Managed tool completion is invalid.");
  }
  return {
    providerRunId,
    toolCallId: record.toolCallId,
    completionKind: record.completionKind,
    completedAt: new Date().toISOString(),
  };
}
