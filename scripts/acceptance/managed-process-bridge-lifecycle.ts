import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { waitForValue } from "../../src/testing/wait.js";

const root = await mkdtemp(path.join(os.tmpdir(), "moebius-managed-bridge-evidence-"));
const electron = path.resolve("desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const bridge = path.resolve("desktop/dist/managed-process-mcp-bridge.js");
const evidence: Record<string, unknown> = { environment: "packaged Electron executable with ELECTRON_RUN_AS_NODE", cases: {} };

await exercise("stdin-eof", async (child, capabilityPath) => {
  child.stdin.end();
  await unlink(capabilityPath);
});
await exercise("capability-revoked", async (_child, capabilityPath) => {
  await unlink(capabilityPath);
});

const evidencePath = path.join(root, "evidence.json");
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ ok: true, evidencePath })}\n`);

async function exercise(
  name: string,
  terminate: (child: ReturnType<typeof spawn>, capabilityPath: string) => Promise<void>,
): Promise<void> {
  const capabilityPath = path.join(root, `${name}.token`);
  await writeFile(capabilityPath, "test-capability", { encoding: "utf8", mode: 0o600, flag: "wx" });
  const child = spawn(electron, [bridge, path.join(root, "unused-supervisor.sock"), capabilityPath], {
    detached: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
  await waitForValue(() => stdout.split("\n").filter(Boolean).length >= 2 ? true : undefined, {
    describe: `${name} packaged bridge MCP responses`, kind: "io", timeoutMs: 10_000,
    snapshot: () => ({ stdout, stderr, exitCode: child.exitCode }),
  });
  const during = await processGroup(child.pid!);
  assert.equal(during.some((entry) => entry.command.includes("Electron Helper")), false, JSON.stringify(during));
  await terminate(child, capabilityPath);
  const exit = await waitForValue(() => child.exitCode !== null || child.signalCode !== null
    ? { exitCode: child.exitCode, signal: child.signalCode }
    : undefined, {
    describe: `${name} packaged bridge exit`, kind: "io", timeoutMs: 10_000,
    snapshot: () => ({ stdout, stderr, pid: child.pid }),
  });
  await waitForValue(async () => (await processGroup(child.pid!)).length === 0 ? true : undefined, {
    describe: `${name} packaged bridge process group cleanup`, kind: "io", timeoutMs: 10_000,
  });
  (evidence.cases as Record<string, unknown>)[name] = { pid: child.pid, during, exit, helperCountAfter: 0, capabilityRemoved: true };
}

async function processGroup(pgid: number): Promise<Array<{ pid: number; ppid: number; pgid: number; command: string }>> {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn("/bin/ps", ["-axo", "pid=,ppid=,pgid=,command="], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
  });
  return output.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/u.exec(line);
    if (match === null || Number(match[3]) !== pgid) return [];
    return [{ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), command: match[4]! }];
  });
}
