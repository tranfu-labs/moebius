import { mkdir, mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startLocalConsoleServer, type StartedLocalConsoleServer } from "../src/local-console/start.js";
import { waitForValue } from "../src/testing/wait.js";

const describeDarwin = process.platform === "darwin" ? describe : describe.skip;
const servers: StartedLocalConsoleServer[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close().catch(() => undefined);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describeDarwin("managed process HTTP projection", () => {
  it("projects active work into state, blocks archive, stops, and removes the final acknowledged item", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moebius-managed-http-"));
    roots.push(root);
    await mkdir(path.join(root, "agents"));
    const started = await startLocalConsoleServer({ projectRoot: root, dataRoot: root, port: 0 });
    servers.push(started);
    const session = await started.runtime.createSession("Managed process HTTP");
    const capability = started.managedProcessSupervisor.createCapability({
      sessionId: session.sessionId,
      workspaceRoot: root,
      providerRunId: "http-test-run",
    });
    const managed = await bridgeCall(capability.socketPath, capability.token, "start", {
      kind: "task",
      label: "finite test task",
      executable: path.basename(process.execPath),
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: ".",
    }) as { id: string };
    started.managedProcessSupervisor.revokeCapability(capability.token);

    const listResponse = await fetch(new URL(`/api/local-console/sessions/${session.sessionId}/managed-processes`, started.url));
    expect(listResponse.status).toBe(200);
    expect((await listResponse.json() as { processes: Array<{ id: string }> }).processes.map((item) => item.id)).toEqual([managed.id]);

    const state = await fetch(new URL(`/api/local-console/state?sessionId=${session.sessionId}`, started.url)).then(async (response) => await response.json()) as {
      project: { sessions: Array<{ sessionId: string; runningCount: number; managedRunningCount: number }> };
    };
    expect(state.project.sessions.find((item) => item.sessionId === session.sessionId)).toMatchObject({
      runningCount: 0,
      managedRunningCount: 1,
    });

    const archiveWhileRunning = await fetch(new URL(`/api/local-console/sessions/${session.sessionId}/archive`, started.url), { method: "POST" });
    expect(archiveWhileRunning.status).toBe(409);
    expect(await archiveWhileRunning.json()).toMatchObject({ code: "managed-process-running" });

    const stopResponse = await fetch(new URL(`/api/local-console/sessions/${session.sessionId}/managed-processes/${managed.id}/stop`, started.url), { method: "POST" });
    expect(stopResponse.status).toBe(200);
    expect(await stopResponse.json()).toMatchObject({ process: { id: managed.id, state: "exited" } });

    const acknowledgeResponse = await fetch(new URL(`/api/local-console/sessions/${session.sessionId}/managed-processes/acknowledge-exited`, started.url), { method: "POST" });
    expect(acknowledgeResponse.status).toBe(204);
    const finalList = await fetch(new URL(`/api/local-console/sessions/${session.sessionId}/managed-processes`, started.url)).then(async (response) => await response.json()) as { processes: unknown[] };
    expect(finalList.processes).toEqual([]);
  });

  it("bounds and sanitizes a flooded log response while continuing to supervise the task", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moebius-managed-logs-"));
    roots.push(root);
    await mkdir(path.join(root, "agents"));
    const started = await startLocalConsoleServer({ projectRoot: root, dataRoot: root, port: 0 });
    servers.push(started);
    const session = await started.runtime.createSession("Managed log flood");
    const capability = started.managedProcessSupervisor.createCapability({ sessionId: session.sessionId, workspaceRoot: root, providerRunId: "log-test-run" });
    const managed = await bridgeCall(capability.socketPath, capability.token, "start", {
      kind: "task",
      label: "log flood",
      executable: path.basename(process.execPath),
      args: ["-e", "process.stdout.write('x'.repeat(3*1024*1024));process.stdout.write('\\u001b[31mTAIL\\u0000');setInterval(()=>{},1000)"],
      cwd: ".",
    }) as { id: string };
    started.managedProcessSupervisor.revokeCapability(capability.token);

    const logs = await waitForValue(async () => {
      const response = await fetch(new URL(`/api/local-console/sessions/${session.sessionId}/managed-processes/${managed.id}/logs`, started.url));
      const value = await response.json() as { stdout: string; stderr: string; truncated: boolean };
      return value.truncated && value.stdout.includes("TAIL") ? value : undefined;
    }, { describe: "bounded managed process log tail", kind: "io" });
    expect(Buffer.byteLength(logs.stdout) + Buffer.byteLength(logs.stderr)).toBeLessThanOrEqual(256 * 1024);
    expect(logs.stdout).toContain("\\u001b[31mTAIL\\u0000");
    expect(logs.stdout).not.toContain("\u001b");
    expect(logs.stdout).not.toContain("\u0000");

    await fetch(new URL(`/api/local-console/sessions/${session.sessionId}/managed-processes/${managed.id}/stop`, started.url), { method: "POST" });
  });
});

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
