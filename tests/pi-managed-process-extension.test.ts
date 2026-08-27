import { createRequire } from "node:module";
import { mkdtemp, mkdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

import { createPiManagedProcessExtension } from "../src/pi-managed-process-extension.js";
import { MOEBIUS_MCP_TOOL_NAMES } from "../src/local-console/managed-process-tools.js";
import {
  ManagedProcessSupervisor,
  type ManagedProcessOwnershipPort,
} from "../src/local-console/managed-process-supervisor.js";
import type { LaunchdManagedProcessHandle, LaunchdWrapperStatus } from "../src/local-console/managed-process-launchd-adapter.js";

interface RegisteredPiTool {
  name: string;
  description: string;
  parameters: unknown;
  execute(toolCallId: string, args: unknown, signal: AbortSignal): Promise<{
    content: Array<{ type: string; text: string }>;
    details: { isError: boolean };
  }>;
}

function createPiMock() {
  const tools: RegisteredPiTool[] = [];
  const shutdownHandlers: Array<() => void> = [];
  const api = {
    tools,
    shutdownHandlers,
    registerTool: (tool: ToolDefinition<any, any, any>): void => {
      tools.push({
        name: tool.name,
        description: tool.description ?? "",
        parameters: tool.parameters,
        execute: tool.execute as RegisteredPiTool["execute"],
      });
    },
    on: (event: string, handler: () => void): void => {
      if (event === "session_shutdown") shutdownHandlers.push(handler);
    },
  };
  return api;
}

const cleanup: ManagedProcessSupervisor[] = [];
const childProcesses: ChildProcessWithoutNullStreams[] = [];
afterEach(async () => {
  for (const child of childProcesses.splice(0)) child.kill();
  await Promise.all(cleanup.splice(0).map(async (supervisor) => supervisor.close().catch(() => undefined)));
});

function installExtension(options: {
  command: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  cwd: string;
}, pi: ReturnType<typeof createPiMock>): void {
  const extension = createPiManagedProcessExtension(options);
  if ("factory" in extension) {
    extension.factory(pi as never);
  } else {
    extension(pi as never);
  }
}

describe("Pi managed-process extension tool face", () => {
  it("registers the managed-process and workspace tool names and descriptions as the shared capability face", () => {
    const pi = createPiMock();
    installExtension({
      command: "/usr/bin/node",
      args: [],
      env: {},
      cwd: "/tmp/workspace",
    }, pi);

    expect(pi.tools.map((tool) => tool.name)).toEqual([...MOEBIUS_MCP_TOOL_NAMES]);
    for (const tool of pi.tools) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.parameters).toBeTypeOf("object");
    }
  });

  it("fails honestly when the bridge cannot be reached", async () => {
    const pi = createPiMock();
    installExtension({
      command: "/nonexistent/moebius-bridge",
      args: [],
      env: {},
      cwd: "/tmp/workspace",
    }, pi);
    const listTool = pi.tools.find((tool) => tool.name === "managed_process_list")!;
    await expect(listTool.execute("call-1", {}, new AbortController().signal)).rejects.toThrow();
  });

  it("forwards managed-process tools to a real bridge and returns supervised results", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moebius-pi-extension-"));
    const workspace = path.join(root, "workspace");
    await mkdir(workspace);
    const supervisor = new ManagedProcessSupervisor({ adapter: new FakeOwnership(root), socketPath: path.join(root, "bridge.sock") });
    cleanup.push(supervisor);
    await supervisor.init();
    const capability = supervisor.createCapability({ sessionId: "s1", workspaceRoot: workspace, providerRunId: "r1" });
    const capabilityPath = path.join(root, "r1.token");
    await writeFile(capabilityPath, capability.token, { encoding: "utf8", mode: 0o600, flag: "wx" });
    const require = createRequire(import.meta.url);
    const bridgeEntry = path.resolve("src/local-console/managed-process-mcp-bridge.ts");
    const child = spawn(process.execPath, [require.resolve("tsx/cli"), bridgeEntry, capability.socketPath, capabilityPath], {
      cwd: path.resolve("."),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    childProcesses.push(child);

    const pi = createPiMock();
    installExtension({
      command: process.execPath,
      args: [require.resolve("tsx/cli"), bridgeEntry, capability.socketPath, capabilityPath],
      env: Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
      cwd: path.resolve("."),
    }, pi);
    const byName = new Map(pi.tools.map((tool) => [tool.name, tool]));
    const signal = new AbortController().signal;

    const listEmpty = await byName.get("managed_process_list")!.execute("call-1", {}, signal);
    expect(listEmpty.details).toEqual({ isError: false });
    expect(JSON.parse(listEmpty.content[0]!.text)).toEqual([]);

    const started = await byName.get("managed_process_start")!.execute("call-2", {
      kind: "task",
      label: "watched node",
      executable: path.basename(process.execPath),
      args: ["--version"],
      cwd: ".",
    }, signal);
    expect(started.details).toEqual({ isError: false });
    const startedBody = JSON.parse(started.content[0]!.text) as { id: string; state: string };
    expect(startedBody.id.length).toBeGreaterThan(0);
    expect(startedBody.state).toBe("running");

    const listed = await byName.get("managed_process_list")!.execute("call-3", {}, signal);
    expect(JSON.parse(listed.content[0]!.text) as Array<{ id: string }>).toEqual([
      expect.objectContaining({ id: startedBody.id }),
    ]);

    const inspected = await byName.get("managed_process_inspect")!.execute("call-4", { id: startedBody.id }, signal);
    expect(inspected.details).toEqual({ isError: false });
    expect(JSON.parse(inspected.content[0]!.text) as { id: string }).toMatchObject({ id: startedBody.id });

    const logs = await byName.get("managed_process_read_logs")!.execute("call-5", { id: startedBody.id }, signal);
    expect(logs.details).toEqual({ isError: false });
    expect(JSON.parse(logs.content[0]!.text) as { stdout: string }).toMatchObject({ stdout: expect.any(String) });

    const stopped = await byName.get("managed_process_stop")!.execute("call-6", { id: startedBody.id }, signal);
    expect(stopped.details).toEqual({ isError: false });
    expect(JSON.parse(stopped.content[0]!.text) as { id: string }).toMatchObject({ id: startedBody.id });

    supervisor.revokeCapability(capability.token);
    await unlink(capabilityPath);
  });
});

class FakeOwnership implements ManagedProcessOwnershipPort {
  readonly #root: string;
  readonly #statuses = new Map<string, LaunchdWrapperStatus>();
  #sequence = 0;

  constructor(root: string) { this.#root = root; }
  async init(): Promise<void> {}
  async reconcile(): Promise<{ blocked: readonly { processId: string; code: "managed-process-cleanup-blocked" }[] }> {
    return { blocked: [] };
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
  async stop(): Promise<void> {}
  async release(): Promise<void> {}
}
