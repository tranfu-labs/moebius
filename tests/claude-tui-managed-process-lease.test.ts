import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ClaudeTuiManagedProcessLease } from "../src/local-console/claude-tui-managed-process-lease.js";
import {
  ManagedProcessSupervisor,
  type ManagedProcessOwnershipPort,
} from "../src/local-console/managed-process-supervisor.js";
import type {
  LaunchdManagedProcessHandle,
  LaunchdWrapperStatus,
} from "../src/local-console/managed-process-launchd-adapter.js";
import { waitForValue } from "../src/testing/wait.js";

const roots: string[] = [];
const supervisors: ManagedProcessSupervisor[] = [];
const relays: ChildProcessWithoutNullStreams[] = [];

afterEach(async () => {
  for (const relay of relays.splice(0)) {
    if (relay.exitCode === null && relay.signalCode === null) relay.kill("SIGKILL");
  }
  await Promise.all(supervisors.splice(0).map(async (supervisor) => await supervisor.close().catch(() => undefined)));
  await Promise.all(roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })));
});

describe("ClaudeTuiManagedProcessLease", () => {
  it("preserves the generic bridge's environment-capability invocation without a token file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moebius-managed-bridge-environment-"));
    roots.push(root);
    const workspace = path.join(root, "workspace");
    await mkdir(workspace);
    const supervisor = new ManagedProcessSupervisor({
      adapter: new FakeOwnership(),
      socketPath: path.join(root, "managed.sock"),
    });
    supervisors.push(supervisor);
    await supervisor.init();
    const capability = supervisor.createCapability({ sessionId: "session-1", providerRunId: "run-1", workspaceRoot: workspace });
    const require = createRequire(import.meta.url);
    const relay = spawn(process.execPath, [
      require.resolve("tsx/cli"),
      path.resolve("src/local-console/managed-process-mcp-bridge.ts"),
      capability.socketPath,
    ], {
      cwd: path.resolve("."),
      env: { ...process.env, MOEBIUS_MANAGED_PROCESS_CAPABILITY: capability.token },
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    relays.push(relay);
    let output = "";
    let stderr = "";
    relay.stdout.setEncoding("utf8");
    relay.stderr.setEncoding("utf8");
    relay.stdout.on("data", (chunk) => { output += chunk; });
    relay.stderr.on("data", (chunk) => { stderr += chunk; });

    relay.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "managed_process_list", arguments: {} } })}\n`);
    expect((await responseFor(1, () => output, () => stderr)).result?.isError).toBe(false);
    expect(output).not.toContain(capability.token);
    relay.stdin.end();
    await waitForValue(
      () => relay.exitCode !== null || relay.signalCode !== null
        ? { exitCode: relay.exitCode, signal: relay.signalCode }
        : undefined,
      {
        describe: "environment-capability bridge shutdown after stdin closes",
        kind: "io",
        snapshot: () => ({ output, stderr }),
      },
    );
  });

  it("keeps one relay alive while capabilities rotate per turn and are revoked on every owner close", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moebius-claude-tui-lease-"));
    roots.push(root);
    const workspace = path.join(root, "workspace");
    await mkdir(workspace);
    const supervisor = new ManagedProcessSupervisor({
      adapter: new FakeOwnership(),
      socketPath: path.join(root, "managed.sock"),
    });
    supervisors.push(supervisor);
    await supervisor.init();
    const require = createRequire(import.meta.url);
    const capabilityPath = path.join(root, "claude-tui-managed-process.token");
    const lease = new ClaudeTuiManagedProcessLease({
      supervisor,
      sessionId: "session-1",
      workspaceRoot: workspace,
      capabilityPath,
      relayProgram: {
        command: process.execPath,
        bridgeArgs: [require.resolve("tsx/cli"), path.resolve("src/local-console/managed-process-mcp-bridge.ts")],
        environment: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      },
    });

    const first = await lease.acquireTurn({ providerRunId: "run-1" });
    const firstToken = await readFile(capabilityPath, "utf8");
    expect((await stat(capabilityPath)).mode & 0o777).toBe(0o600);
    expect(first.args).toContain("--lease-file");
    expect(first.args).not.toContain(firstToken);
    expect(Object.values(first.env)).not.toContain(firstToken);

    const relay = spawn(first.command, [...first.args], {
      cwd: path.resolve("."),
      env: { ...process.env, ...first.env },
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    relays.push(relay);
    let output = "";
    let stderr = "";
    relay.stdout.setEncoding("utf8");
    relay.stderr.setEncoding("utf8");
    relay.stdout.on("data", (chunk) => { output += chunk; });
    relay.stderr.on("data", (chunk) => { stderr += chunk; });

    relay.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
    relay.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
    await responseFor(1, () => output, () => stderr);
    const listed = await responseFor(2, () => output, () => stderr);
    expect(listed.result?.tools).toHaveLength(6);

    const firstCompletions: string[] = [];
    const stopFirstCompletion = first.onToolCompletion?.((event) => firstCompletions.push(event.providerRunId)) ?? (() => undefined);
    relay.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "managed_process_list", arguments: {} } })}\n`);
    expect((await responseFor(3, () => output, () => stderr)).result?.isError).toBe(false);
    await waitForValue(() => firstCompletions.length === 1 ? firstCompletions : undefined, {
      describe: "first Claude turn managed-process completion",
      kind: "io",
      snapshot: () => ({ output, stderr }),
    });
    stopFirstCompletion();

    const second = await lease.acquireTurn({ providerRunId: "run-2" });
    const secondToken = await readFile(capabilityPath, "utf8");
    expect(secondToken).not.toBe(firstToken);
    expect(second.args).toEqual(first.args);
    await first.close();
    expect(await readFile(capabilityPath, "utf8")).toBe(secondToken);

    const secondCompletions: string[] = [];
    const stopSecondCompletion = second.onToolCompletion?.((event) => secondCompletions.push(event.providerRunId)) ?? (() => undefined);
    relay.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "managed_process_list", arguments: {} } })}\n`);
    expect((await responseFor(4, () => output, () => stderr)).result?.isError).toBe(false);
    await waitForValue(() => secondCompletions.length === 1 ? secondCompletions : undefined, {
      describe: "second Claude turn managed-process completion",
      kind: "io",
      snapshot: () => ({ output, stderr }),
    });
    expect(secondCompletions).toEqual(["run-2"]);
    stopSecondCompletion();

    await second.close();
    await expect(readFile(capabilityPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await second.preflight?.();
    relay.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "managed_process_list", arguments: {} } })}\n`);
    const inactive = await responseFor(5, () => output, () => stderr);
    expect(inactive.result).toMatchObject({ isError: true });
    expect(inactive.result?.content?.[0]?.text).toContain("unavailable for this Claude turn");
    expect(relay.exitCode).toBeNull();

    const third = await lease.acquireTurn({ providerRunId: "run-3" });
    const thirdToken = await readFile(capabilityPath, "utf8");
    await lease.close();
    await expect(readFile(capabilityPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(third.args).toEqual(first.args);
    expect(thirdToken).not.toBe(secondToken);
    relay.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "managed_process_list", arguments: {} } })}\n`);
    expect((await responseFor(6, () => output, () => stderr)).result).toMatchObject({ isError: true });
    expect(output).not.toContain(firstToken);
    expect(output).not.toContain(secondToken);
    expect(output).not.toContain(thirdToken);

    relay.stdin.end();
    await waitForValue(
      () => relay.exitCode !== null || relay.signalCode !== null
        ? { exitCode: relay.exitCode, signal: relay.signalCode }
        : undefined,
      {
        describe: "persistent Claude managed-process relay shutdown after stdin closes",
        kind: "io",
        snapshot: () => ({ output, stderr }),
      },
    );
  }, 15_000);
});

class FakeOwnership implements ManagedProcessOwnershipPort {
  async init(): Promise<void> {}
  async reconcile(): Promise<void> { return undefined; }
  async start(): Promise<LaunchdManagedProcessHandle> {
    throw new Error("managed process start is not expected in this relay test");
  }
  async readStatus(): Promise<LaunchdWrapperStatus | null> { return null; }
  async stop(): Promise<void> {}
  async release(): Promise<void> {}
}

type McpResponse = {
  id?: unknown;
  result?: {
    isError?: boolean;
    tools?: Array<{ name: string }>;
    content?: Array<{ text?: string }>;
  };
};

async function responseFor(
  id: number,
  currentOutput: () => string,
  currentStderr: () => string,
): Promise<McpResponse> {
  return await waitForValue(() => {
    for (const line of currentOutput().split("\n")) {
      if (line.trim() === "") continue;
      try {
        const response = JSON.parse(line) as McpResponse;
        if (response.id === id) return response;
      } catch {
        // The relay only writes JSONL; retain a defensive parse guard for diagnostics.
      }
    }
    return undefined;
  }, {
    describe: `MCP response ${String(id)}`,
    kind: "io",
    snapshot: () => ({ output: currentOutput(), stderr: currentStderr() }),
  });
}
