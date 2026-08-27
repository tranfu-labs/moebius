import { createRequire } from "node:module";
import { mkdtemp, mkdir, unlink, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ManagedProcessSupervisor,
  type ManagedProcessOwnershipPort,
} from "../src/local-console/managed-process-supervisor.js";
import type { LaunchdManagedProcessHandle, LaunchdWrapperStatus } from "../src/local-console/managed-process-launchd-adapter.js";
import type { LocalConsoleWorkspaceSwitchResult } from "../src/local-console/types.js";
import { waitForValue } from "../src/testing/wait.js";

const cleanup: ManagedProcessSupervisor[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(async (supervisor) => supervisor.close().catch(() => undefined)));
});

describe("managed process supervisor bridge", () => {
  it("starts with an empty registry while retaining reconciliation blocked facts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moebius-managed-blocked-"));
    const adapter = new FakeOwnership(root);
    adapter.reconciliationBlocked = [{
      processId: "00000000-0000-4000-8000-000000000099",
      code: "managed-process-cleanup-blocked",
    }];
    const supervisor = new ManagedProcessSupervisor({ adapter, socketPath: path.join(root, "bridge.sock") });
    cleanup.push(supervisor);

    await expect(supervisor.init()).resolves.toBeUndefined();
    expect(supervisor.getReconciliationBlocked()).toEqual(adapter.reconciliationBlocked);
    expect(supervisor.getRunningCount()).toBe(0);
  });

  it("uses invocation capabilities, keeps one session registry across turns, and stops idempotently", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moebius-managed-supervisor-"));
    const workspace = path.join(root, "workspace");
    await mkdir(workspace);
    const adapter = new FakeOwnership(root);
    const supervisor = new ManagedProcessSupervisor({ adapter, socketPath: path.join(root, "bridge.sock") });
    cleanup.push(supervisor);
    await supervisor.init();

    const first = supervisor.createCapability({ sessionId: "s1", workspaceRoot: workspace, providerRunId: "r1" });
    const started = await bridgeCall(first.socketPath, first.token, "start", {
      kind: "task",
      label: "watched node",
      executable: path.basename(process.execPath),
      args: ["--version"],
      cwd: ".",
    }) as { id: string };
    supervisor.revokeCapability(first.token);
    await expect(bridgeCall(first.socketPath, first.token, "list", {})).rejects.toThrow("invalid or expired");

    const second = supervisor.createCapability({ sessionId: "s1", workspaceRoot: workspace, providerRunId: "r2" });
    const listed = await bridgeCall(second.socketPath, second.token, "list", {}) as Array<{ id: string }>;
    expect(listed.map((item) => item.id)).toEqual([started.id]);
    const firstLogs = await supervisor.readLogs("s1", started.id);
    await expect(supervisor.readLogs("s1", started.id, firstLogs.cursor)).resolves.toMatchObject({
      stdout: "", stderr: "", cursor: firstLogs.cursor, unchanged: true,
    });
    const stopped = await Promise.all([
      bridgeCall(second.socketPath, second.token, "stop", { id: started.id }),
      bridgeCall(second.socketPath, second.token, "stop", { id: started.id }),
    ]);
    expect(stopped).toHaveLength(2);
    expect(adapter.stopCalls).toBe(1);

    const other = supervisor.createCapability({ sessionId: "s2", workspaceRoot: workspace, providerRunId: "r3" });
    await expect(bridgeCall(other.socketPath, other.token, "inspect", { id: started.id })).rejects.toThrow("not found in this session");
  });

  it("notifies deferred workspace cleanup after a managed process exits", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moebius-managed-workspace-cleanup-"));
    const workspace = path.join(root, "workspace");
    await mkdir(workspace);
    const adapter = new FakeOwnership(root);
    const supervisor = new ManagedProcessSupervisor({ adapter, socketPath: path.join(root, "bridge.sock") });
    cleanup.push(supervisor);
    const cleanupWorkspace = vi.fn(async () => undefined);
    supervisor.setWorkspaceCleanupHandler(cleanupWorkspace);
    await supervisor.init();

    const capability = supervisor.createCapability({ sessionId: "s1", workspaceRoot: workspace, providerRunId: "cleanup-run" });
    const started = await bridgeCall(capability.socketPath, capability.token, "start", {
      kind: "task",
      label: "deferred cleanup",
      executable: path.basename(process.execPath),
      args: ["--version"],
      cwd: ".",
    }) as { id: string };

    await supervisor.stop("s1", started.id);
    expect(cleanupWorkspace).toHaveBeenCalled();
  });

  it("keeps readiness distinct from spawn, tolerates transient failure, and recovers", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moebius-managed-readiness-"));
    const workspace = path.join(root, "workspace");
    await mkdir(workspace);
    const supervisor = new ManagedProcessSupervisor({ adapter: new FakeOwnership(root), socketPath: path.join(root, "bridge.sock") });
    cleanup.push(supervisor);
    await supervisor.init();
    const probe = net.createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", resolve);
    });
    const address = probe.address();
    if (address === null || typeof address === "string") throw new Error("expected TCP address");
    const capability = supervisor.createCapability({ sessionId: "s1", workspaceRoot: workspace, providerRunId: "ready-run" });
    const started = await bridgeCall(capability.socketPath, capability.token, "start", {
      kind: "service",
      label: "readiness probe",
      executable: path.basename(process.execPath),
      args: ["--version"],
      cwd: ".",
      readiness: { type: "tcp", host: "127.0.0.1", port: address.port },
    }) as { id: string; state: string; targetPid: number };
    expect(started).toMatchObject({ state: "ready", targetPid: 101 });

    await new Promise<void>((resolve, reject) => probe.close((error) => error === undefined ? resolve() : reject(error)));
    expect(await supervisor.inspect("s1", started.id)).toMatchObject({ state: "ready", targetPid: started.targetPid });
    expect(await supervisor.inspect("s1", started.id)).toMatchObject({ state: "ready", targetPid: started.targetPid });
    expect(await supervisor.inspect("s1", started.id)).toMatchObject({ state: "unhealthy", targetPid: started.targetPid });

    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(address.port, "127.0.0.1", resolve);
    });
    expect(await supervisor.inspect("s1", started.id)).toMatchObject({ state: "ready", targetPid: started.targetPid });
    await new Promise<void>((resolve) => probe.close(() => resolve()));
  });

  it("keeps cleanup failure retryable instead of releasing ownership or hiding the item", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moebius-managed-cleanup-retry-"));
    const workspace = path.join(root, "workspace");
    await mkdir(workspace);
    const adapter = new FakeOwnership(root);
    adapter.failNextStop = true;
    const supervisor = new ManagedProcessSupervisor({ adapter, socketPath: path.join(root, "bridge.sock") });
    cleanup.push(supervisor);
    await supervisor.init();
    const capability = supervisor.createCapability({ sessionId: "s1", workspaceRoot: workspace, providerRunId: "cleanup-run" });
    const started = await bridgeCall(capability.socketPath, capability.token, "start", {
      kind: "task", label: "retry cleanup", executable: path.basename(process.execPath), args: ["--version"], cwd: ".",
    }) as { id: string };

    await expect(supervisor.close()).rejects.toThrow("Managed process cleanup failed");
    expect(await supervisor.inspect("s1", started.id)).toMatchObject({ state: "running" });
    await expect(supervisor.close()).resolves.toBeUndefined();
    expect(adapter.stopCalls).toBe(2);
  });

  it("exposes managed-process and workspace tools over stdio MCP without capability text in protocol output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moebius-managed-mcp-"));
    const workspace = path.join(root, "workspace");
    await mkdir(workspace);
    const workspaceSwitch = vi.fn(async ({ sessionId, target }: { sessionId: string; target: unknown }) =>
      ({ sessionId, target } as unknown as LocalConsoleWorkspaceSwitchResult));
    const supervisor = new ManagedProcessSupervisor({
      adapter: new FakeOwnership(root),
      socketPath: path.join(root, "bridge.sock"),
      workspaceSwitch,
    });
    cleanup.push(supervisor);
    await supervisor.init();
    const capability = supervisor.createCapability({ sessionId: "s1", workspaceRoot: workspace, providerRunId: "r1" });
    const capabilityPath = path.join(root, "r1.token");
    await writeFile(capabilityPath, capability.token, { encoding: "utf8", mode: 0o600, flag: "wx" });
    let completion: { providerRunId: string; toolCallId: string; completionKind: string } | undefined;
    const clearCompletion = supervisor.onToolCompletion("r1", (event) => { completion = event; });
    const require = createRequire(import.meta.url);
    const child = spawn(process.execPath, [require.resolve("tsx/cli"), path.resolve("src/local-console/managed-process-mcp-bridge.ts"), capability.socketPath, capabilityPath], {
      cwd: path.resolve("."),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stdin.write("{invalid-json}\n");
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
    await waitForValue(() => {
      const value = output.trim().split("\n").filter(Boolean);
      return value.length >= 3 ? value : undefined;
    }, {
      describe: "MCP initialize and tool list responses",
      kind: "io",
      snapshot: () => output,
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "managed_process_list", arguments: {} } })}\n`);
    await waitForValue(() => completion, {
      describe: "bridge tool completion fact",
      kind: "io",
    });
    const managedCompletion = completion;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "moebius_switch_workspace", arguments: { target: "project-root" } } })}\n`);
    const allLines = await waitForValue(() => {
      const value = output.trim().split("\n").filter(Boolean);
      return value.some((line) => line.includes('"id":4')) ? value : undefined;
    }, {
      describe: "workspace MCP tool response",
      kind: "io",
      snapshot: () => output,
    });
    expect(workspaceSwitch).toHaveBeenCalledWith({ sessionId: "s1", target: { target: "project-root" } });
    expect(completion).toEqual(managedCompletion);
    clearCompletion();
    supervisor.revokeCapability(capability.token);
    await unlink(capabilityPath);
    const bridgeExit = await waitForValue(() => child.exitCode !== null || child.signalCode !== null
      ? { exitCode: child.exitCode, signal: child.signalCode }
      : undefined, {
      describe: "MCP bridge exit after capability revocation",
      kind: "io",
      snapshot: () => ({ pid: child.pid, output }),
    });
    const responses = allLines.map((line) => JSON.parse(line) as {
      error?: { code: number };
      result?: { tools?: Array<{ name: string; inputSchema?: unknown }> };
    });
    expect(responses).toContainEqual(expect.objectContaining({ error: { code: -32700, message: "Parse error" } }));
    expect(responses.flatMap((response) => response.result?.tools?.map((tool) => tool.name) ?? [])).toEqual([
      "managed_process_start", "managed_process_list", "managed_process_inspect", "managed_process_read_logs", "managed_process_stop", "moebius_switch_workspace",
    ]);
    const workspaceTool = responses
      .flatMap((response) => response.result?.tools ?? [])
      .find((tool) => tool.name === "moebius_switch_workspace");
    expect(workspaceTool?.inputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      oneOf: expect.arrayContaining([
        expect.objectContaining({
          required: ["target"],
          properties: { target: { const: "project-root" } },
        }),
        expect.objectContaining({
          required: ["target", "branchName"],
          properties: {
            target: { const: "branch" },
            branchName: { type: "string", minLength: 1, maxLength: 512 },
          },
        }),
      ]),
    });
    expect(output).not.toContain(capability.token);
    expect(completion).toMatchObject({ providerRunId: "r1", toolCallId: "3", completionKind: "completed" });
    expect(bridgeExit).toEqual({ exitCode: 0, signal: null });
  });
});

class FakeOwnership implements ManagedProcessOwnershipPort {
  readonly #root: string;
  readonly #statuses = new Map<string, LaunchdWrapperStatus>();
  stopCalls = 0;
  failNextStop = false;
  reconciliationBlocked: Array<{ processId: string; code: "managed-process-cleanup-blocked" }> = [];
  #sequence = 0;

  constructor(root: string) { this.#root = root; }
  async init(): Promise<void> {}
  async reconcile(): Promise<{ blocked: readonly { processId: string; code: "managed-process-cleanup-blocked" }[] }> {
    return { blocked: this.reconciliationBlocked };
  }
  async start(): Promise<LaunchdManagedProcessHandle> {
    const processId = `00000000-0000-4000-8000-${String(++this.#sequence).padStart(12, "0")}`;
    const itemRoot = path.join(this.#root, processId);
    await mkdir(itemRoot);
    const handle: LaunchdManagedProcessHandle = {
      processId,
      label: `test.${processId}`,
      serviceTarget: `gui/1/test.${processId}`,
      manifestPath: path.join(itemRoot, "manifest.json"),
      statusPath: path.join(itemRoot, "status.json"),
      stdoutPath: path.join(itemRoot, "stdout.log"),
      stderrPath: path.join(itemRoot, "stderr.log"),
      logMetadataPath: path.join(itemRoot, "logs.json"),
    };
    await Promise.all([writeFile(handle.stdoutPath, "ready\n"), writeFile(handle.stderrPath, ""), writeFile(handle.logMetadataPath, "{}")]);
    this.#statuses.set(handle.statusPath, { wrapperPid: 100, targetPid: 101, startedAt: new Date().toISOString() });
    return handle;
  }
  async readStatus(handle: Pick<LaunchdManagedProcessHandle, "statusPath">): Promise<LaunchdWrapperStatus | null> {
    return this.#statuses.get(handle.statusPath) ?? null;
  }
  async stop(): Promise<void> {
    this.stopCalls += 1;
    if (this.failNextStop) {
      this.failNextStop = false;
      throw new Error("cleanup failed once");
    }
  }
  async release(): Promise<void> { this.stopCalls += 1; }
}

async function bridgeCall(socketPath: string, token: string, method: string, params: unknown): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let response = "";
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(`${JSON.stringify({ token, method, params })}\n`));
    socket.on("data", (chunk) => { response += chunk; });
    socket.once("end", () => {
      const parsed = JSON.parse(response) as { result?: unknown; error?: { message: string } };
      if (parsed.error !== undefined) reject(new Error(parsed.error.message));
      else resolve(parsed.result);
    });
    socket.once("error", reject);
  });
}
