import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SqliteStateWorkerConfiguration,
  SqliteStateWorkerRequest,
  SqliteStateWorkerResponse,
} from "../src/sqlite-state.js";
import { waitForCondition, waitForValue } from "../src/testing/wait.js";

interface FakeWorkerInstance extends EventEmitter {
  readonly workerData: SqliteStateWorkerConfiguration;
  readonly sent: SqliteStateWorkerRequest[];
  terminateCount: number;
  referenced: boolean;
  postMessage(message: SqliteStateWorkerRequest): void;
  terminate(): Promise<number>;
  ref(): void;
  unref(): void;
}

const workerHarness = vi.hoisted(() => ({
  instances: [] as FakeWorkerInstance[],
  autoReady: true,
}));

vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await vi.importActual<typeof import("node:events")>("node:events");
  class FakeWorker extends EventEmitter {
    readonly workerData: SqliteStateWorkerConfiguration;
    readonly sent: SqliteStateWorkerRequest[] = [];
    terminateCount = 0;
    referenced = true;

    constructor(_url: URL, options: { workerData: SqliteStateWorkerConfiguration }) {
      super();
      this.workerData = options.workerData;
      workerHarness.instances.push(this as FakeWorkerInstance);
      if (workerHarness.autoReady) {
        queueMicrotask(() => this.emit("message", { type: "ready" } satisfies SqliteStateWorkerResponse));
      }
    }

    postMessage(message: SqliteStateWorkerRequest): void {
      this.sent.push(message);
      if (message.type === "close") {
        queueMicrotask(() => {
          this.emit("message", { type: "closed" } satisfies SqliteStateWorkerResponse);
          this.emit("exit", 0);
        });
      }
    }

    terminate(): Promise<number> {
      this.terminateCount += 1;
      queueMicrotask(() => this.emit("exit", 1));
      return Promise.resolve(1);
    }

    ref(): void {
      this.referenced = true;
    }

    unref(): void {
      this.referenced = false;
    }
  }
  return { Worker: FakeWorker };
});

const {
  closeSqliteStateWorkers,
  readSqliteStateWorkerDiagnostics,
  runSqliteStateCommand,
  SqliteStateTimeoutError,
  SqliteStateWorkerError,
} = await import("../src/sqlite-state.js");

describe("sqlite state worker pool", () => {
  beforeEach(() => {
    workerHarness.instances.length = 0;
    workerHarness.autoReady = true;
  });

  afterEach(async () => {
    await closeSqliteStateWorkers();
    expect(readSqliteStateWorkerDiagnostics()).toMatchObject({
      laneCount: 0,
      workerCount: 0,
      queuedRequestCount: 0,
      activeRequestCount: 0,
    });
  });

  it("canonicalizes symlinks, reuses matching lanes, and isolates every connection dimension", async () => {
    const realRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-worker-pool-real-"));
    const linkedRoot = `${realRoot}-link`;
    await fs.symlink(realRoot, linkedRoot, "dir");
    const realPath = path.join(realRoot, ".state", "state.sqlite");
    const linkedPath = path.join(linkedRoot, ".state", "state.sqlite");
    const createdBefore = readSqliteStateWorkerDiagnostics().createdWorkerCount;

    const first = runSqliteStateCommand<{ order: number }>({
      sqlitePath: linkedPath,
      command: { kind: "local-list-projects" },
    });
    const firstWorker = await waitForWorker(0);
    const firstRequest = await waitForCommand(firstWorker, 0);
    const second = runSqliteStateCommand<{ order: number }>({
      sqlitePath: realPath,
      command: { kind: "local-list-projects" },
    });
    const third = runSqliteStateCommand<{ order: number }>({
      sqlitePath: realPath,
      command: { kind: "local-list-projects" },
    });

    expect(commandRequests(firstWorker)).toHaveLength(1);
    replySuccess(firstWorker, firstRequest, { order: 1 });
    const secondRequest = await waitForCommand(firstWorker, 1);
    replySuccess(firstWorker, secondRequest, { order: 2 });
    const thirdRequest = await waitForCommand(firstWorker, 2);
    replySuccess(firstWorker, thirdRequest, { order: 3 });
    await expect(Promise.all([first, second, third])).resolves.toEqual([
      { order: 1 },
      { order: 2 },
      { order: 3 },
    ]);

    const isolatedCalls = [
      runSqliteStateCommand({
        sqlitePath: realPath,
        readOnly: true,
        command: { kind: "local-list-projects" },
      }),
      runSqliteStateCommand({
        sqlitePath: realPath,
        busyTimeoutMs: 3_000,
        command: { kind: "local-list-projects" },
      }),
      runSqliteStateCommand({
        sqlitePath: path.join(realRoot, ".state", "other.sqlite"),
        command: { kind: "local-list-projects" },
      }),
    ];
    await waitForCondition(() => workerHarness.instances.length === 4, {
      describe: "one worker for each distinct SQLite lane dimension",
      snapshot: () => workerHarness.instances.map((worker) => worker.workerData),
    });
    for (const worker of workerHarness.instances.slice(1)) {
      const request = await waitForCommand(worker, 0);
      replySuccess(worker, request, {});
    }
    await expect(Promise.all(isolatedCalls)).resolves.toEqual([{}, {}, {}]);
    expect(readSqliteStateWorkerDiagnostics()).toMatchObject({
      laneCount: 4,
      workerCount: 4,
      createdWorkerCount: createdBefore + 4,
    });
    expect(firstWorker.workerData.sqlitePath).toBe(linkedPath);
  });

  it("removes a queued timeout without disturbing the active command", async () => {
    const sqlitePath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "moebius-worker-pool-queue-")), "state.sqlite");
    const active = runSqliteStateCommand({
      sqlitePath,
      timeoutMs: 1_000,
      command: { kind: "local-list-projects" },
    });
    const worker = await waitForWorker(0);
    const activeRequest = await waitForCommand(worker, 0);
    const queued = runSqliteStateCommand({
      sqlitePath,
      timeoutMs: 30,
      command: { kind: "local-list-sessions" },
    });

    await expect(queued).rejects.toBeInstanceOf(SqliteStateTimeoutError);
    expect(commandRequests(worker)).toEqual([activeRequest]);
    expect(worker.terminateCount).toBe(0);
    replySuccess(worker, activeRequest, { active: true });
    await expect(active).resolves.toEqual({ active: true });
  });

  it("does not retry an ambiguous timed-out command and resumes the FIFO on a new generation", async () => {
    const sqlitePath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "moebius-worker-pool-active-")), "state.sqlite");
    const ambiguous = runSqliteStateCommand({
      sqlitePath,
      timeoutMs: 30,
      command: { kind: "local-init" },
    });
    const firstWorker = await waitForWorker(0);
    const ambiguousRequest = await waitForCommand(firstWorker, 0);
    const queued = runSqliteStateCommand({
      sqlitePath,
      timeoutMs: 1_000,
      command: { kind: "local-list-projects" },
    });

    await expect(ambiguous).rejects.toBeInstanceOf(SqliteStateTimeoutError);
    const replacement = await waitForWorker(1);
    const queuedRequest = await waitForCommand(replacement, 0);
    const allDispatchedIds = workerHarness.instances.flatMap((worker) =>
      commandRequests(worker).map((request) => request.requestId));
    expect(allDispatchedIds.filter((requestId) => requestId === ambiguousRequest.requestId)).toHaveLength(1);
    expect(commandRequests(replacement).map((request) => request.requestId)).not.toContain(ambiguousRequest.requestId);
    expect(firstWorker.terminateCount).toBe(1);
    replySuccess(replacement, queuedRequest, { recovered: true });
    await expect(queued).resolves.toEqual({ recovered: true });
  });

  it("rejects a crashed active command once and preserves queued order across recovery", async () => {
    const sqlitePath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "moebius-worker-pool-crash-")), "state.sqlite");
    let rejectionCount = 0;
    const active = runSqliteStateCommand({
      sqlitePath,
      command: { kind: "local-list-projects" },
    }).catch((error: unknown) => {
      rejectionCount += 1;
      throw error;
    });
    const firstWorker = await waitForWorker(0);
    await waitForCommand(firstWorker, 0);
    const second = runSqliteStateCommand({ sqlitePath, command: { kind: "local-list-sessions" } });
    const third = runSqliteStateCommand({ sqlitePath, command: { kind: "local-list-session-message-indexes" } });

    firstWorker.emit("error", new Error("worker crashed"));
    await expect(active).rejects.toBeInstanceOf(SqliteStateWorkerError);
    expect(rejectionCount).toBe(1);
    const replacement = await waitForWorker(1);
    const secondRequest = await waitForCommand(replacement, 0);
    expect(secondRequest.command.kind).toBe("local-list-sessions");
    replySuccess(replacement, secondRequest, { second: true });
    const thirdRequest = await waitForCommand(replacement, 1);
    expect(thirdRequest.command.kind).toBe("local-list-session-message-indexes");
    replySuccess(replacement, thirdRequest, { third: true });
    await expect(Promise.all([second, third])).resolves.toEqual([{ second: true }, { third: true }]);
  });

  it("retires the connection generation after a command error before continuing the queue", async () => {
    const sqlitePath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "moebius-worker-pool-error-")), "state.sqlite");
    const failed = runSqliteStateCommand({
      sqlitePath,
      command: { kind: "local-init" },
    });
    const firstWorker = await waitForWorker(0);
    const failedRequest = await waitForCommand(firstWorker, 0);
    const queued = runSqliteStateCommand({ sqlitePath, command: { kind: "local-list-projects" } });

    replyFailure(firstWorker, failedRequest, "transaction rolled back");
    await expect(failed).rejects.toThrow("transaction rolled back");
    const replacement = await waitForWorker(1);
    const queuedRequest = await waitForCommand(replacement, 0);
    expect(firstWorker.terminateCount).toBe(1);
    expect(queuedRequest.requestId).not.toBe(failedRequest.requestId);
    replySuccess(replacement, queuedRequest, { recovered: true });
    await expect(queued).resolves.toEqual({ recovered: true });
  });

  it("fails an unready generation without dispatching commands and allows a later generation to recover", async () => {
    workerHarness.autoReady = false;
    const sqlitePath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "moebius-worker-pool-init-")), "state.sqlite");
    const first = runSqliteStateCommand({ sqlitePath, command: { kind: "local-list-projects" } });
    const second = runSqliteStateCommand({ sqlitePath, command: { kind: "local-list-sessions" } });
    const failedWorker = await waitForWorker(0);
    failedWorker.emit("message", {
      type: "initialization-error",
      error: { message: "schema initialization failed" },
    } satisfies SqliteStateWorkerResponse);

    await expect(first).rejects.toThrow("schema initialization failed");
    await expect(second).rejects.toThrow("schema initialization failed");
    expect(commandRequests(failedWorker)).toHaveLength(0);

    workerHarness.autoReady = true;
    const recovered = runSqliteStateCommand({ sqlitePath, command: { kind: "local-list-projects" } });
    const replacement = await waitForWorker(1);
    const recoveredRequest = await waitForCommand(replacement, 0);
    replySuccess(replacement, recoveredRequest, { recovered: true });
    await expect(recovered).resolves.toEqual({ recovered: true });
  });
});

async function waitForWorker(index: number): Promise<FakeWorkerInstance> {
  return waitForValue(() => workerHarness.instances[index], {
    describe: `sqlite state worker ${String(index + 1)} to be created`,
    snapshot: () => ({ workerCount: workerHarness.instances.length }),
  });
}

async function waitForCommand(worker: FakeWorkerInstance, index: number): Promise<Extract<SqliteStateWorkerRequest, { type: "command" }>> {
  return waitForValue(() => commandRequests(worker)[index], {
    describe: `sqlite state command ${String(index + 1)} to be dispatched`,
    snapshot: () => ({ sent: worker.sent }),
  });
}

function commandRequests(worker: FakeWorkerInstance): Array<Extract<SqliteStateWorkerRequest, { type: "command" }>> {
  return worker.sent.filter((request): request is Extract<SqliteStateWorkerRequest, { type: "command" }> =>
    request.type === "command");
}

function replySuccess(worker: FakeWorkerInstance, request: Extract<SqliteStateWorkerRequest, { type: "command" }>, result: unknown): void {
  worker.emit("message", {
    type: "result",
    requestId: request.requestId,
    ok: true,
    result,
  } satisfies SqliteStateWorkerResponse);
}

function replyFailure(worker: FakeWorkerInstance, request: Extract<SqliteStateWorkerRequest, { type: "command" }>, message: string): void {
  worker.emit("message", {
    type: "result",
    requestId: request.requestId,
    ok: false,
    error: { message },
  } satisfies SqliteStateWorkerResponse);
}
