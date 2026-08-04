import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  LaunchdManagedProcessAdapter,
  ManagedProcessUnsupportedError,
  type LaunchdManagedProcessHandle,
} from "../src/local-console/managed-process-launchd-adapter.js";
import { waitForCondition, waitForValue } from "../src/testing/wait.js";

const describeDarwin = process.platform === "darwin" ? describe : describe.skip;
const wrapperPath = fileURLToPath(new URL("../src/local-console/managed-process-wrapper.ts", import.meta.url));
const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");

describeDarwin("launchd managed-process ownership", () => {
  const roots: string[] = [];
  const adapters: LaunchdManagedProcessAdapter[] = [];
  const unrelated: ChildProcess[] = [];

  afterEach(async () => {
    for (const adapter of adapters.splice(0)) await adapter.reconcile().catch(() => undefined);
    for (const child of unrelated.splice(0)) child.kill("SIGKILL");
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  });

  it("lets launchd clean the target group when the wrapper is killed", async () => {
    const { adapter, root } = await createHarness();
    const pidPath = path.join(root, "target.pid");
    const descendantPidPath = path.join(root, "descendant.pid");
    const descendantBody = `const {spawn}=require("node:child_process");spawn(process.execPath,["-e",${JSON.stringify(targetScript())},${JSON.stringify(descendantPidPath)},"setInterval(() => {}, 1000)"],{stdio:"ignore"});setInterval(() => {}, 1000);`;
    const handle = await adapter.start(nodeTarget(pidPath, descendantBody));
    const status = await waitForValue(() => adapter.readStatus(handle).then((value) => value ?? undefined), {
      describe: "launchd wrapper status",
      kind: "io",
    });
    expect(await adapter.isRegistered(handle)).toBe(true);
    const descendantPid = await readPid(descendantPidPath);

    await launchctl(["kill", "SIGKILL", handle.serviceTarget]);
    await waitForCondition(() => !isAlive(status.targetPid!), {
      describe: "target process to die with killed wrapper",
      kind: "io",
      snapshot: () => ({ wrapperPid: status.wrapperPid, targetPid: status.targetPid }),
    });
    await waitForCondition(() => !isAlive(descendantPid), {
      describe: "descendant process to die with killed wrapper",
      kind: "io",
      snapshot: () => ({ descendantPid }),
    });
    await adapter.stop(handle);
    expect(await adapter.isRegistered(handle)).toBe(false);
  });

  it("records a forged manifest, leaves its target alone, and continues cleaning valid jobs", async () => {
    const { adapter, root } = await createHarness();
    const pidPath = path.join(root, "forged.pid");
    const handle = await adapter.start(nodeTarget(pidPath, "setInterval(() => {}, 1000)"));
    const targetPid = await readPid(pidPath);
    const validPidPath = path.join(root, "valid.pid");
    const valid = await adapter.start(nodeTarget(validPidPath, "setInterval(() => {}, 1000)"));
    const validPid = await readPid(validPidPath);
    const original = await readFile(handle.manifestPath, "utf8");
    const forged = JSON.parse(original) as Record<string, unknown>;
    forged.ownershipScopeHash = "0".repeat(64);
    await writeFile(handle.manifestPath, JSON.stringify(forged), { mode: 0o600 });

    const reconciliation = await adapter.reconcile();
    expect(reconciliation.blocked).toContainEqual({
      processId: handle.processId,
      code: "managed-process-cleanup-blocked",
    });
    expect(reconciliation.cleanedProcessIds).toContain(valid.processId);
    expect(isAlive(targetPid)).toBe(true);
    await waitForCondition(() => !isAlive(validPid), {
      describe: "valid target after neighboring forged manifest to stop",
      kind: "io",
    });
    expect(await adapter.isRegistered(valid)).toBe(false);

    await writeFile(handle.manifestPath, original, { mode: 0o600 });
    await adapter.stop(handle);
  });

  it("records a missing plist without blocking startup or signaling the target", async () => {
    const { adapter, root } = await createHarness();
    const pidPath = path.join(root, "missing-plist.pid");
    const handle = await adapter.start(nodeTarget(pidPath, "setInterval(() => {}, 1000)"));
    const targetPid = await readPid(pidPath);
    const plistPath = path.join(root, ".state", "managed-processes", "runtime", handle.processId, "job.plist");
    const plist = await readFile(plistPath, "utf8");
    await rm(plistPath);

    const reconciliation = await adapter.reconcile();
    expect(reconciliation.blocked).toContainEqual({
      processId: handle.processId,
      code: "managed-process-cleanup-blocked",
    });
    expect(isAlive(targetPid)).toBe(true);

    await writeFile(plistPath, plist, { mode: 0o600 });
    await adapter.stop(handle);
  });

  it("bootouts only the exact service and leaves an unrelated same executable alive", async () => {
    const { adapter, root } = await createHarness();
    const managedPidPath = path.join(root, "managed.pid");
    const unrelatedPidPath = path.join(root, "unrelated.pid");
    const handle = await adapter.start(nodeTarget(managedPidPath, "setInterval(() => {}, 1000)"));
    const other = spawn(process.execPath, ["-e", targetScript(), unrelatedPidPath, "setInterval(() => {}, 1000)"], {
      shell: false,
      stdio: "ignore",
    });
    unrelated.push(other);
    const managedPid = await readPid(managedPidPath);
    const unrelatedPid = await readPid(unrelatedPidPath);

    await adapter.stop(handle);
    await waitForCondition(() => !isAlive(managedPid), {
      describe: "managed target to stop",
      kind: "io",
    });
    expect(isAlive(unrelatedPid)).toBe(true);
  });

  it("starts a RunAtLoad job once and never restarts it after natural exit", async () => {
    const { adapter, root } = await createHarness();
    const pidPath = path.join(root, "finite.pid");
    const countPath = path.join(root, "count.txt");
    await writeFile(countPath, "0", "utf8");
    const handle = await adapter.start(nodeTarget(
      pidPath,
      `const fs=require("node:fs");const p=${JSON.stringify(countPath)};fs.writeFileSync(p,String(Number(fs.readFileSync(p,"utf8"))+1));setTimeout(()=>process.exit(0),100);`,
    ));
    const pid = await readPid(pidPath);
    await waitForCondition(() => !isAlive(pid), {
      describe: "finite target to exit",
      kind: "io",
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await readFile(countPath, "utf8")).toBe("1");
    expect(await adapter.isRegistered(handle)).toBe(true);
    await adapter.stop(handle);
  });

  async function createHarness(): Promise<{ adapter: LaunchdManagedProcessAdapter; root: string }> {
    const root = await mkdtemp(path.join(os.tmpdir(), "moebius-launchd-test-"));
    roots.push(root);
    const adapter = new LaunchdManagedProcessAdapter({
      dataRoot: root,
      wrapperProgram: process.execPath,
      wrapperProgramArgs: [tsxCli, wrapperPath],
    });
    adapters.push(adapter);
    await adapter.init();
    return { adapter, root };
  }
});

describe("managed-process unsupported ownership", () => {
  it("fails closed without spawning a target outside Darwin", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moebius-launchd-unsupported-"));
    const marker = path.join(root, "spawned.txt");
    const adapter = new LaunchdManagedProcessAdapter({
      dataRoot: root,
      wrapperProgram: process.execPath,
      wrapperProgramArgs: [],
      platform: "linux",
      uid: 501,
    });
    await adapter.init();
    await expect(adapter.start({
      executable: process.execPath,
      args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "spawned")`],
      cwd: root,
      ownershipScopeHash: "a".repeat(64),
    })).rejects.toBeInstanceOf(ManagedProcessUnsupportedError);
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
    await rm(root, { recursive: true, force: true });
  });
});

function nodeTarget(pidPath: string, body: string): { executable: string; args: string[]; cwd: string; ownershipScopeHash: string } {
  return {
    executable: process.execPath,
    args: ["-e", targetScript(), pidPath, body],
    cwd: path.dirname(pidPath),
    ownershipScopeHash: "a".repeat(64),
  };
}

function targetScript(): string {
  return "const fs=require('node:fs');fs.writeFileSync(process.argv[1],String(process.pid));eval(process.argv[2]);";
}

async function readPid(filePath: string): Promise<number> {
  return await waitForValue(async () => {
    try {
      const value = Number(await readFile(filePath, "utf8"));
      return Number.isInteger(value) && value > 0 ? value : undefined;
    } catch {
      return undefined;
    }
  }, {
    describe: `pid file ${filePath}`,
    kind: "io",
  });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function launchctl(args: readonly string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("/bin/launchctl", [...args], { shell: false, stdio: "ignore" });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`launchctl exited ${String(code)}`)));
  });
}
