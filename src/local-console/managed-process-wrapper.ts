import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { MANAGED_PROCESS_MAX_LOG_BYTES, MANAGED_PROCESS_STOP_GRACE_MS } from "../config.js";

interface StartPayload {
  executable: string;
  args: string[];
  cwd: string;
}

const parsed = parseArguments(process.argv.slice(2));
void run(parsed).catch(async (error) => {
  await writeStatus(parsed.statusPath, {
    error: error instanceof Error ? error.message : String(error),
    wrapperPid: process.pid,
  }).catch(() => undefined);
  process.exitCode = 1;
});

async function run(input: { payloadPath: string; statusPath: string; stdoutPath: string; stderrPath: string; logMetadataPath: string }): Promise<void> {
  const payload = parsePayload(await readFile(input.payloadPath, "utf8"));
  await unlink(input.payloadPath);
  const child = spawn(payload.executable, payload.args, {
    cwd: payload.cwd,
    shell: false,
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForSpawn(child);
  const startedAt = new Date().toISOString();
  await writeStatus(input.statusPath, {
    wrapperPid: process.pid,
    targetPid: child.pid,
    startedAt,
  });
  let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let stdoutTruncated = false;
  let stderrTruncated = false;
  let stdoutTail = Promise.resolve();
  let stderrTail = Promise.resolve();
  await writeStatus(input.logMetadataPath, { stdoutTruncated, stderrTruncated });
  const persist = async (target: "stdout" | "stderr", chunk: Buffer): Promise<void> => {
    if (target === "stdout") {
      const next = boundedAppend(stdout, chunk);
      stdout = next.content;
      stdoutTruncated ||= next.truncated;
      await writeFile(input.stdoutPath, stdout, { mode: 0o600 });
    } else {
      const next = boundedAppend(stderr, chunk);
      stderr = next.content;
      stderrTruncated ||= next.truncated;
      await writeFile(input.stderrPath, stderr, { mode: 0o600 });
    }
    await writeStatus(input.logMetadataPath, { stdoutTruncated, stderrTruncated });
  };
  child.stdout?.on("data", (chunk: Buffer) => { stdoutTail = stdoutTail.then(async () => persist("stdout", chunk)); });
  child.stderr?.on("data", (chunk: Buffer) => { stderrTail = stderrTail.then(async () => persist("stderr", chunk)); });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), MANAGED_PROCESS_STOP_GRACE_MS);
    timer.unref();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  const exit = await waitForExit(child);
  await Promise.all([stdoutTail, stderrTail]);
  await writeStatus(input.statusPath, {
    wrapperPid: process.pid,
    targetPid: child.pid,
    startedAt,
    exitedAt: new Date().toISOString(),
    exitCode: exit.code,
    signal: exit.signal,
  });
  process.exitCode = exit.code ?? (exit.signal === null ? 1 : 128);
}

function parseArguments(args: readonly string[]): { payloadPath: string; statusPath: string; stdoutPath: string; stderrPath: string; logMetadataPath: string } {
  const payloadIndex = args.indexOf("--payload");
  const statusIndex = args.indexOf("--status");
  const stdoutIndex = args.indexOf("--stdout");
  const stderrIndex = args.indexOf("--stderr");
  const logMetadataIndex = args.indexOf("--log-metadata");
  const payloadPath = args[payloadIndex + 1];
  const statusPath = args[statusIndex + 1];
  const stdoutPath = args[stdoutIndex + 1];
  const stderrPath = args[stderrIndex + 1];
  const logMetadataPath = args[logMetadataIndex + 1];
  if (payloadIndex < 0 || statusIndex < 0 || stdoutIndex < 0 || stderrIndex < 0 || logMetadataIndex < 0 || !payloadPath || !statusPath || !stdoutPath || !stderrPath || !logMetadataPath || !path.isAbsolute(payloadPath) || !path.isAbsolute(statusPath) || !path.isAbsolute(stdoutPath) || !path.isAbsolute(stderrPath) || !path.isAbsolute(logMetadataPath)) {
    throw new Error("managed process wrapper requires absolute payload and status paths");
  }
  return { payloadPath, statusPath, stdoutPath, stderrPath, logMetadataPath };
}

function parsePayload(raw: string): StartPayload {
  const parsed = JSON.parse(raw) as Partial<StartPayload>;
  if (!path.isAbsolute(parsed.executable ?? "") || !path.isAbsolute(parsed.cwd ?? "") || !Array.isArray(parsed.args)) {
    throw new Error("managed process start payload is invalid");
  }
  if (parsed.args.some((value) => typeof value !== "string" || value.includes("\0"))) {
    throw new Error("managed process start payload args are invalid");
  }
  return parsed as StartPayload;
}

function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
}

function waitForExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

async function writeStatus(statusPath: string, value: unknown): Promise<void> {
  const temporary = `${statusPath}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, statusPath);
}

function boundedAppend(previous: Buffer<ArrayBufferLike>, chunk: Buffer<ArrayBufferLike>): { content: Buffer<ArrayBufferLike>; truncated: boolean } {
  const combined = Buffer.concat([previous, chunk]);
  const streamLimit = Math.floor(MANAGED_PROCESS_MAX_LOG_BYTES / 2);
  return combined.byteLength <= streamLimit
    ? { content: combined, truncated: false }
    : { content: combined.subarray(combined.byteLength - streamLimit), truncated: true };
}
