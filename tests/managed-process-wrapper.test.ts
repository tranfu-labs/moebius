import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { waitForValue } from "../src/testing/wait.js";

const wrapperPath = fileURLToPath(new URL("../src/local-console/managed-process-wrapper.ts", import.meta.url));
const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
const roots: string[] = [];
const wrappers: ChildProcess[] = [];

afterEach(async () => {
  for (const wrapper of wrappers.splice(0)) {
    if (wrapper.exitCode === null && wrapper.signalCode === null) wrapper.kill("SIGKILL");
  }
  await Promise.all(roots.splice(0).map(async (root) => rm(root, { recursive: true, force: true })));
});

describe("managed process wrapper", () => {
  it("does not pass Electron's Node-mode marker to the target process", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moebius-managed-wrapper-"));
    roots.push(root);
    const payloadPath = path.join(root, "payload.json");
    const statusPath = path.join(root, "status.json");
    const stdoutPath = path.join(root, "stdout.log");
    const stderrPath = path.join(root, "stderr.log");
    const logMetadataPath = path.join(root, "log-metadata.json");
    const markerPath = path.join(root, "target-environment.json");
    const targetScript = `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, JSON.stringify({
      electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null,
      pathPresent: typeof process.env.PATH === "string" && process.env.PATH.length > 0,
    }));`;

    await writeFile(payloadPath, JSON.stringify({
      executable: process.execPath,
      args: ["-e", targetScript],
      cwd: root,
    }), { encoding: "utf8", mode: 0o600 });

    const wrapper = spawn(process.execPath, [tsxCli, wrapperPath,
      "--payload", payloadPath,
      "--status", statusPath,
      "--stdout", stdoutPath,
      "--stderr", stderrPath,
      "--log-metadata", logMetadataPath,
    ], {
      cwd: path.resolve("."),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      shell: false,
      stdio: "ignore",
    });
    wrappers.push(wrapper);
    const wrapperClosed = waitForChild(wrapper);

    const marker = await waitForValue(
      () => readFile(markerPath, "utf8").then((raw) => JSON.parse(raw) as { electronRunAsNode: string | null; pathPresent: boolean }).catch(() => undefined),
      {
        describe: "managed wrapper target environment marker",
        kind: "io",
        snapshot: () => ({ wrapperExitCode: wrapper.exitCode, wrapperSignal: wrapper.signalCode }),
      },
    );
    await wrapperClosed;
    const status = JSON.parse(await readFile(statusPath, "utf8")) as { exitCode: number | null; signal: NodeJS.Signals | null };

    expect(marker).toEqual({ electronRunAsNode: null, pathPresent: true });
    expect(status).toEqual(expect.objectContaining({ exitCode: 0, signal: null }));
  });
});

function waitForChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      child.off("error", onError);
      child.off("close", onClose);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onClose = (): void => {
      cleanup();
      resolve();
    };

    child.once("error", onError);
    child.once("close", onClose);
    if (child.exitCode !== null || child.signalCode !== null) onClose();
  });
}
