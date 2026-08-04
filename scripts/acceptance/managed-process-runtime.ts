import { createRequire } from "node:module";
import { mkdtemp, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { LaunchdManagedProcessAdapter } from "../../src/local-console/managed-process-launchd-adapter.js";
import { ManagedProcessSupervisor } from "../../src/local-console/managed-process-supervisor.js";
import { waitForValue } from "../../src/testing/wait.js";

const root = await mkdtemp(path.join(os.tmpdir(), "moebius-managed-process-acceptance-"));
const workspace = path.join(root, "workspace");
await import("node:fs/promises").then((fs) => fs.mkdir(workspace));
const require = createRequire(import.meta.url);
const wrapper = {
  program: process.execPath,
  args: [require.resolve("tsx/cli"), path.resolve("src/local-console/managed-process-wrapper.ts")],
};
const evidence: Record<string, unknown> = { environment: { platform: process.platform, node: process.version }, root };

const firstPort = await freePort();
const supervisor = new ManagedProcessSupervisor({
  adapter: adapter(path.join(root, "normal")),
  socketPath: `/tmp/moebius-managed-accept-${process.pid}.sock`,
});
await supervisor.init();
try {
  const firstCapability = supervisor.createCapability({ sessionId: "acceptance-session", workspaceRoot: workspace, providerRunId: "turn-1" });
  const started = await bridgeCall(firstCapability.socketPath, firstCapability.token, "start", {
    kind: "service",
    label: "Python acceptance server",
    executable: "python3",
    args: ["-m", "http.server", String(firstPort), "--bind", "127.0.0.1"],
    cwd: ".",
    readiness: { type: "tcp", host: "127.0.0.1", port: firstPort },
    endpoint: { url: `http://127.0.0.1:${firstPort}` },
  }) as { id: string };
  supervisor.revokeCapability(firstCapability.token);
  const nextCapability = supervisor.createCapability({ sessionId: "acceptance-session", workspaceRoot: workspace, providerRunId: "turn-2" });
  const ready = await waitForValue(async () => {
    const item = await bridgeCall(nextCapability.socketPath, nextCapability.token, "inspect", { id: started.id }) as { state: string; targetPid: number | null };
    return item.state === "ready" ? item : undefined;
  }, { describe: "managed Python HTTP server readiness", kind: "io" });
  const response = await fetch(`http://127.0.0.1:${firstPort}/`);
  const listed = await bridgeCall(nextCapability.socketPath, nextCapability.token, "list", {}) as Array<{ id: string }>;
  const stopped = await bridgeCall(nextCapability.socketPath, nextCapability.token, "stop", { id: started.id }) as { state: string };
  await waitForValue(async () => await portClosed(firstPort) ? true : undefined, { describe: "managed HTTP port closure", kind: "io" });
  evidence.crossTurn = { id: started.id, ready, listedIds: listed.map((item) => item.id), httpStatus: response.status, stopped, portClosed: true };

  const closePort = await freePort();
  await bridgeCall(nextCapability.socketPath, nextCapability.token, "start", {
    kind: "service", label: "Close cleanup server", executable: "python3",
    args: ["-m", "http.server", String(closePort), "--bind", "127.0.0.1"], cwd: ".",
    readiness: { type: "tcp", host: "127.0.0.1", port: closePort }, endpoint: { url: `http://127.0.0.1:${closePort}` },
  });
  await supervisor.close();
  await waitForValue(async () => await portClosed(closePort) ? true : undefined, { describe: "normal close process cleanup", kind: "io" });
  evidence.normalClose = { port: closePort, portClosed: true };
} finally {
  await supervisor.close().catch(() => undefined);
}

const crashRoot = path.join(root, "crash");
const crashAdapter = adapter(crashRoot);
await crashAdapter.init();
const crashPort = await freePort();
const crashHandle = await crashAdapter.start({
  executable: "/usr/bin/python3",
  args: ["-m", "http.server", String(crashPort), "--bind", "127.0.0.1"],
  cwd: workspace,
  ownershipScopeHash: "a".repeat(64),
});
await waitForValue(async () => await portClosed(crashPort) ? undefined : true, { describe: "pre-reconciliation owned service", kind: "io" });
const restartedAdapter = adapter(crashRoot);
await restartedAdapter.init();
await restartedAdapter.reconcile();
await waitForValue(async () => await portClosed(crashPort) ? true : undefined, { describe: "startup reconciliation port closure", kind: "io" });
evidence.crashReconciliation = {
  processId: crashHandle.processId,
  serviceTarget: crashHandle.serviceTarget,
  port: crashPort,
  portClosed: true,
  automaticallyRestarted: !(await portClosed(crashPort)),
};

const evidencePath = path.join(root, "evidence.json");
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ ok: true, evidencePath, evidence })}\n`);

function adapter(dataRoot: string): LaunchdManagedProcessAdapter {
  return new LaunchdManagedProcessAdapter({
    dataRoot,
    wrapperProgram: wrapper.program,
    wrapperProgramArgs: wrapper.args,
    wrapperEnvironment: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
  });
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) { reject(new Error("TCP port unavailable")); return; }
      server.close((error) => error === undefined ? resolve(address.port) : reject(error));
    });
  });
}

async function portClosed(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(true));
    socket.setTimeout(500, () => { socket.destroy(); resolve(true); });
  });
}

async function bridgeCall(socketPath: string, token: string, method: string, params: unknown): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let raw = "";
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(`${JSON.stringify({ token, method, params })}\n`));
    socket.on("data", (chunk) => { raw += chunk; });
    socket.once("end", () => {
      const parsed = JSON.parse(raw) as { result?: unknown; error?: { message: string } };
      if (parsed.error !== undefined) reject(new Error(parsed.error.message)); else resolve(parsed.result);
    });
    socket.once("error", reject);
  });
}
