import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createKimiProcessTransport,
  confirmRuntimeConfig,
  KimiAcpError,
  kimiClientFsCapabilities,
  resolveKimiFileRequestPath,
  runKimiAcp,
  runKimiAcpWithTransport,
  waitForKimiSpawn,
  type KimiAcpTransport,
} from "../src/kimi.js";
import { KimiExecutableError } from "../src/kimi-executable.js";
import type { KimiRuntimeHomePaths } from "../src/kimi-runtime-home.js";
import { createLocalExecutionRunner } from "../src/local-console/execution-driver.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })));
});

function configOptions(model = "kimi-for-coding", effort = "high", mode = "auto") {
  return [
    {
      id: "model",
      currentValue: model,
      options: [{ value: "kimi-for-coding" }, { value: "kimi-k2" }],
    },
    {
      id: "thinking",
      currentValue: effort,
      options: [{ value: "medium" }, { value: "high" }],
    },
    {
      id: "mode",
      currentValue: mode,
      options: [{ value: "auto" }, { value: "default" }],
    },
  ];
}

function fakeTransport(input: {
  authMethods?: unknown[];
  configUpdateOptions?: unknown[];
  sessionOptions?: unknown[];
  setResponses?: unknown[];
  waitForUpdate?: boolean;
  sessionId?: string | null;
  promptResult?: unknown;
  sessionUpdates?: unknown[];
} = {}): KimiAcpTransport & { requests: Array<{ method: string; params: unknown }> } {
  const requests: Array<{ method: string; params: unknown }> = [];
  const setResponses = [...(input.setResponses ?? [])];
  let sessionUpdateListener: ((update: unknown) => void) | null = null;
  return {
    requests,
    async request(method, params) {
      requests.push({ method, params });
      if (method === "initialize") {
        return {
          protocolVersion: 1,
          ...(input.authMethods === undefined ? {} : { authMethods: input.authMethods }),
        };
      }
      if (method === "authenticate") return {};
      if (method === "session/new") {
        return {
          ...(input.sessionId === null
            ? {}
            : { sessionId: input.sessionId ?? "kimi-session-1" }),
          configOptions: input.sessionOptions ?? configOptions(),
        };
      }
      if (method === "session/resume") {
        return {
          ...(typeof input.sessionId === "string" ? { sessionId: input.sessionId } : {}),
          configOptions: input.sessionOptions ?? configOptions(),
        };
      }
      if (method === "session/set_config_option") return setResponses.shift() ?? {};
      if (method === "session/prompt") {
        for (const update of input.sessionUpdates ?? []) {
          sessionUpdateListener?.(update);
        }
        return input.promptResult ?? { finalText: "Kimi 完成" };
      }
      throw new Error(`unexpected ${method}`);
    },
    notify: vi.fn(),
    waitForConfigUpdate: vi.fn().mockResolvedValue(
      input.configUpdateOptions !== undefined
        ? { configOptions: input.configUpdateOptions }
        : input.waitForUpdate === true
          ? { configOptions: input.sessionOptions ?? null }
        : null,
    ),
    onSessionUpdate: (listener) => {
      sessionUpdateListener = listener;
      return () => {
        sessionUpdateListener = null;
      };
    },
    close: vi.fn().mockResolvedValue(undefined),
    interrupt: vi.fn(),
    terminate: vi.fn(),
    kill: vi.fn(),
  };
}

function fakeChildProcess(): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    exitCode: number | null;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.kill = vi.fn((signal?: NodeJS.Signals | number) => {
    queueMicrotask(() => {
      if (child.exitCode !== null) return;
      child.exitCode = signal === "SIGKILL" ? 137 : 0;
      child.emit("exit", child.exitCode, typeof signal === "string" ? signal : null);
    });
    return true;
  });
  return child as unknown as ChildProcessWithoutNullStreams;
}

function signalRecordingTransport(events: string[]): ReturnType<typeof fakeTransport> {
  const transport = fakeTransport();
  let shutdownStage: "none" | "interrupt" | "terminate" | "kill" = "none";
  transport.notify = vi.fn((method, params) => {
    const sessionId = typeof params === "object"
      && params !== null
      && "sessionId" in params
      && typeof params.sessionId === "string"
      ? params.sessionId
      : "?";
    events.push(`${method}:${sessionId}`);
  });
  transport.interrupt = vi.fn(() => {
    if (shutdownStage !== "none") return;
    shutdownStage = "interrupt";
    events.push("SIGINT");
  });
  transport.terminate = vi.fn(() => {
    if (shutdownStage === "terminate" || shutdownStage === "kill") return;
    shutdownStage = "terminate";
    events.push("SIGTERM");
  });
  transport.kill = vi.fn(() => {
    if (shutdownStage === "kill") return;
    shutdownStage = "kill";
    events.push("SIGKILL");
  });
  transport.close = vi.fn(async () => {
    events.push("close");
    if (shutdownStage === "none") {
      transport.terminate();
    }
  });
  return transport;
}

async function makeRunRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-kimi-"));
  temporaryRoots.push(root);
  return root;
}

async function makeRuntimeHomes(root: string): Promise<KimiRuntimeHomePaths> {
  const sourceHome = path.join(root, "kimi-source");
  await fs.mkdir(sourceHome, { recursive: true });
  await fs.writeFile(path.join(sourceHome, "config.toml"), "[tools]\ndisabled = []\n");
  return {
    sourceHome,
    managedHome: path.join(root, "kimi-managed"),
  };
}

async function writeAcpExecutable(
  filePath: string,
  marker: string,
  auditPath: string,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, [
    `#!${process.execPath}`,
    'const fs = require("node:fs");',
    'const readline = require("node:readline");',
    `fs.writeFileSync(${JSON.stringify(auditPath)}, process.argv[1], "utf8");`,
    `const marker = ${JSON.stringify(marker)};`,
    "const configOptions = [",
    '  { id: "model", currentValue: "kimi-for-coding", options: [{ value: "kimi-for-coding" }] },',
    '  { id: "thinking", currentValue: "high", options: [{ value: "high" }] },',
    '  { id: "mode", currentValue: "auto", options: [{ value: "auto" }] },',
    "];",
    "const lines = readline.createInterface({ input: process.stdin });",
    'const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\\n`);',
    'lines.on("line", (line) => {',
    "  const request = JSON.parse(line);",
    '  if (request.method === "initialize") reply(request.id, { protocolVersion: 1 });',
    '  else if (request.method === "session/new") reply(request.id, { sessionId: "fixture-session", configOptions });',
    '  else if (request.method === "session/prompt") reply(request.id, { finalText: marker });',
    '  else reply(request.id, {});',
    "});",
    "",
  ].join("\n"), "utf8");
  await fs.chmod(filePath, 0o755);
}

describe("Kimi ACP driver", () => {
  it("does not expose the process transport before spawn and preserves an early exit", async () => {
    const root = await makeRunRoot();
    const binDir = path.join(root, "bin");
    const executable = path.join(binDir, "kimi");
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(executable, "#!/bin/sh\nexit 0\n");
    await fs.chmod(executable, 0o755);
    const child = fakeChildProcess();
    const spawnProcess = vi.fn(() => child) as unknown as typeof import("node:child_process").spawn;
    let settled = false;
    const factory = createKimiProcessTransport({
      cwd: root,
      readRoots: [root],
      stdoutPath: path.join(root, "stdout.jsonl"),
      stderrPath: path.join(root, "stderr.log"),
      env: { PATH: binDir },
      allowWrites: true,
      homeDir: path.join(root, "home"),
      spawnProcess,
    }).finally(() => {
      settled = true;
    });

    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);
    expect(spawnProcess).toHaveBeenCalledWith(
      path.resolve(executable),
      ["acp"],
      expect.objectContaining({ shell: false }),
    );

    child.emit("spawn");
    const transport = await factory;
    const writes: string[] = [];
    child.stdin.on("data", (chunk: Buffer) => writes.push(chunk.toString("utf8")));
    const request = transport.request("initialize", { protocolVersion: 1 });
    expect(writes.join("")).toContain('"method":"initialize"');

    (child as unknown as { exitCode: number | null }).exitCode = 42;
    child.emit("exit", 42, null);
    await expect(request).rejects.toMatchObject({
      code: "KIMI_CLI_EXITED",
      safeMessage: expect.stringContaining("启动后提前退出"),
    });
    expect(writes.join("")).not.toContain("KIMI_ACP_CLOSED");
    await transport.close();
  });

  it("preserves a spawn error instead of exposing a closed ACP transport", async () => {
    const root = await makeRunRoot();
    const binDir = path.join(root, "bin");
    const executable = path.join(binDir, "kimi");
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(executable, "#!/bin/sh\nexit 0\n");
    await fs.chmod(executable, 0o755);
    const child = fakeChildProcess();
    const spawnProcess = vi.fn(() => child) as unknown as typeof import("node:child_process").spawn;
    const factory = createKimiProcessTransport({
      cwd: root,
      readRoots: [root],
      stdoutPath: path.join(root, "stdout.jsonl"),
      stderrPath: path.join(root, "stderr.log"),
      env: { PATH: binDir },
      allowWrites: true,
      homeDir: path.join(root, "home"),
      spawnProcess,
    });

    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1));
    child.emit("error", Object.assign(new Error("raw ENOENT path"), { code: "ENOENT" }));

    await expect(factory).rejects.toMatchObject({
      code: "KIMI_CLI_SPAWN_FAILED",
      safeMessage: expect.stringContaining("启动失败"),
    });
  });

  it("preserves JSON-RPC error code, message, and data in run-local diagnostics", async () => {
    const root = await makeRunRoot();
    const executable = path.join(root, "bin", "kimi");
    await fs.mkdir(path.dirname(executable), { recursive: true });
    await fs.writeFile(executable, "#!/bin/sh\nexit 0\n");
    await fs.chmod(executable, 0o755);
    const child = fakeChildProcess();
    const spawnProcess = vi.fn(() => child) as unknown as typeof import("node:child_process").spawn;
    const factory = createKimiProcessTransport({
      cwd: root,
      readRoots: [root],
      stdoutPath: path.join(root, "stdout.jsonl"),
      stderrPath: path.join(root, "stderr.log"),
      env: { PATH: path.dirname(executable) },
      allowWrites: true,
      homeDir: path.join(root, "home"),
      spawnProcess,
    });
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1));
    child.emit("spawn");
    const transport = await factory;
    const pending = transport.request("session/prompt", {});
    (child.stdout as PassThrough).write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: 403,
        message: "billing cycle usage limit reached",
        data: { retryable: false, privateDetail: "diagnostic only" },
      },
    })}\n`);

    await expect(pending).rejects.toMatchObject({
      code: "KIMI_ACP_REQUEST_FAILED",
      diagnostics: {
        jsonRpcCode: 403,
        jsonRpcMessage: "billing cycle usage limit reached",
        jsonRpcData: { retryable: false, privateDetail: "diagnostic only" },
      },
    });
    await transport.close();
  });

  it("bounds a spawn handshake that emits no authoritative event", async () => {
    vi.useFakeTimers();
    const child = fakeChildProcess();
    const pending = waitForKimiSpawn(child, 5_000).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toMatchObject({
      code: "KIMI_CLI_SPAWN_FAILED",
    });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("runs a real ACP fixture from the default Kimi location by absolute path", async () => {
    const root = await makeRunRoot();
    const homeDir = path.join(root, "host-home");
    const executable = path.join(homeDir, ".kimi-code", "bin", "kimi");
    const auditPath = path.join(root, "default-audit.txt");
    await writeAcpExecutable(executable, "DEFAULT_KIMI_SELECTED", auditPath);
    const transport = await createKimiProcessTransport({
      cwd: root,
      readRoots: [root],
      stdoutPath: path.join(root, "stdout.jsonl"),
      stderrPath: path.join(root, "stderr.log"),
      env: { ...process.env, PATH: path.join(root, "empty-bin") },
      allowWrites: true,
      homeDir,
    });
    try {
      await expect(runKimiAcpWithTransport(transport, {
        prompt: "run fixture",
        runDir: root,
        cwd: root,
        profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
        mode: { kind: "full" },
      })).resolves.toMatchObject({
        ok: true,
        finalText: "DEFAULT_KIMI_SELECTED",
      });
      await expect(fs.readFile(auditPath, "utf8")).resolves.toBe(path.resolve(executable));
    } finally {
      await transport.close();
    }
  });

  it("runs the PATH Kimi fixture instead of an available default fixture", async () => {
    const root = await makeRunRoot();
    const binDir = path.join(root, "path-bin");
    const homeDir = path.join(root, "host-home");
    const pathExecutable = path.join(binDir, "kimi");
    const defaultExecutable = path.join(homeDir, ".kimi-code", "bin", "kimi");
    const pathAudit = path.join(root, "path-audit.txt");
    const defaultAudit = path.join(root, "default-audit.txt");
    await writeAcpExecutable(pathExecutable, "PATH_KIMI_SELECTED", pathAudit);
    await writeAcpExecutable(defaultExecutable, "DEFAULT_KIMI_SELECTED", defaultAudit);
    const transport = await createKimiProcessTransport({
      cwd: root,
      readRoots: [root],
      stdoutPath: path.join(root, "stdout.jsonl"),
      stderrPath: path.join(root, "stderr.log"),
      env: { ...process.env, PATH: binDir },
      allowWrites: true,
      homeDir,
    });
    try {
      await expect(runKimiAcpWithTransport(transport, {
        prompt: "run fixture",
        runDir: root,
        cwd: root,
        profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
        mode: { kind: "full" },
      })).resolves.toMatchObject({
        ok: true,
        finalText: "PATH_KIMI_SELECTED",
      });
      await expect(fs.readFile(pathAudit, "utf8")).resolves.toBe(path.resolve(pathExecutable));
      await expect(fs.access(defaultAudit)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await transport.close();
    }
  });

  it.each([
    {
      error: new KimiExecutableError(
        "kimi-cli-not-found",
        "没有找到 Kimi CLI。请先安装 Kimi，然后重试。",
      ),
      code: "kimi-cli-not-found",
    },
    {
      error: new KimiExecutableError(
        "kimi-cli-not-executable",
        "找到 Kimi CLI，但它不可执行。请修复文件执行权限后重试。",
      ),
      code: "kimi-cli-not-executable",
    },
    {
      error: new KimiAcpError(
        "KIMI_CLI_SPAWN_FAILED",
        "Kimi CLI 启动失败。请确认安装完整后重试。",
      ),
      code: "kimi-cli-spawn-failed",
    },
    {
      error: new KimiAcpError(
        "KIMI_CLI_EXITED",
        "Kimi CLI 启动后提前退出。请先在终端运行 Kimi 检查登录或配置，然后重试。",
      ),
      code: "kimi-cli-exited",
    },
  ])("returns stable failure $code without raw machine text", async ({ error, code }) => {
    const root = await makeRunRoot();
    const runtimeHomePaths = await makeRuntimeHomes(root);
    const result = await runKimiAcp({
      prompt: "must not run",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
      runtimeHomePaths,
      transportFactory: async () => {
        throw error;
      },
    });

    expect(result).toMatchObject({
      ok: false,
      reason: code,
      failure: {
        code,
        message: error.message,
      },
    });
    if (result.ok) {
      throw new Error("expected a classified Kimi failure");
    }
    expect(result.reason).not.toContain(root);
  });

  it("keeps raw spawn diagnostics in the local stderr log but outside the result", async () => {
    const root = await makeRunRoot();
    const runtimeHomePaths = await makeRuntimeHomes(root);
    const rawMessage = `spawn ENOENT at ${path.join(root, "private-kimi")}`;
    const result = await runKimiAcp({
      prompt: "must not run",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
      runtimeHomePaths,
      transportFactory: async () => {
        throw new KimiAcpError(
          "KIMI_CLI_SPAWN_FAILED",
          "Kimi CLI 启动失败。请确认安装完整后重试。",
          { errorCode: "ENOENT", errorMessage: rawMessage },
        );
      },
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "kimi-cli-spawn-failed",
      failure: {
        code: "kimi-cli-spawn-failed",
        message: "Kimi CLI 启动失败。请确认安装完整后重试。",
      },
    });
    expect(JSON.stringify(result)).not.toContain(rawMessage);
    await expect(fs.readFile(path.join(root, "kimi-stderr.log"), "utf8"))
      .resolves.toContain(rawMessage);
  });

  it("returns a stable ACP timeout failure and completes bounded cleanup", async () => {
    vi.useFakeTimers();
    const root = await makeRunRoot();
    const runtimeHomePaths = await makeRuntimeHomes(root);
    const transport = fakeTransport();
    let initializeStarted!: () => void;
    const initializeReady = new Promise<void>((resolve) => {
      initializeStarted = resolve;
    });
    transport.request = vi.fn(async (method) => {
      if (method === "initialize") {
        initializeStarted();
        return await new Promise(() => undefined);
      }
      throw new Error(`unexpected ${method}`);
    });
    const run = runKimiAcp({
      prompt: "must time out",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
      idleTimeoutMs: 100,
      runtimeHomePaths,
      transportFactory: vi.fn().mockResolvedValue(transport),
    });

    await initializeReady;
    await vi.advanceTimersByTimeAsync(100);
    expect(transport.interrupt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(run).resolves.toMatchObject({
      ok: false,
      reason: "kimi-acp-timeout",
      failure: {
        code: "kimi-acp-timeout",
        message: expect.stringContaining("没有及时响应"),
      },
    });
    expect(transport.terminate).toHaveBeenCalledTimes(1);
    expect(transport.kill).toHaveBeenCalledTimes(1);
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it("keeps the requested canonical id when resume does not echo a session id", async () => {
    const root = await makeRunRoot();
    const transport = fakeTransport();
    const onSessionStarted = vi.fn();

    await expect(runKimiAcpWithTransport(transport, {
      prompt: "continue",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "resume", externalSessionId: "canonical-session" },
      onSessionStarted,
    })).resolves.toMatchObject({
      ok: true,
      threadId: "canonical-session",
      finalText: "Kimi 完成",
    });
    expect(onSessionStarted).toHaveBeenCalledWith("canonical-session");
    expect(transport.requests).toEqual(expect.arrayContaining([
      {
        method: "session/resume",
        params: expect.objectContaining({ sessionId: "canonical-session" }),
      },
      {
        method: "session/prompt",
        params: expect.objectContaining({ sessionId: "canonical-session" }),
      },
    ]));
    expect(transport.requests.some((request) => request.method === "session/new")).toBe(false);
  });

  it("still requires session/new to return a session id", async () => {
    const root = await makeRunRoot();
    const transport = fakeTransport({ sessionId: null });

    await expect(runKimiAcpWithTransport(transport, {
      prompt: "must not run",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
    })).rejects.toThrow("没有返回 session id");
    expect(transport.requests.map((request) => request.method)).toEqual([
      "initialize",
      "session/new",
    ]);
  });

  it("rejects a resume response with a different exact session id before prompting", async () => {
    const root = await makeRunRoot();
    const transport = fakeTransport({ sessionId: "replacement-session" });
    await expect(runKimiAcpWithTransport(transport, {
      prompt: "must not run",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "resume", externalSessionId: "original-session" },
    })).rejects.toThrow("不一致");
    expect(transport.requests.map((request) => request.method)).toEqual([
      "initialize",
      "session/resume",
    ]);
  });

  it("advertises no write capability and confirms a non-auto mode for read-only sessions", async () => {
    const root = await makeRunRoot();
    const transport = fakeTransport({
      sessionOptions: configOptions("kimi-for-coding", "high", "default"),
    });
    await expect(runKimiAcpWithTransport(transport, {
      prompt: "design only",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
      workspaceAccess: "read-only",
      permissionMode: "default",
    })).resolves.toMatchObject({ ok: true });
    expect(kimiClientFsCapabilities("read-only")).toEqual({
      readTextFile: true,
      writeTextFile: false,
    });
    expect(transport.requests[0]).toMatchObject({
      method: "initialize",
      params: {
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: false },
          terminal: false,
        },
      },
    });
    expect(transport.requests.some((request) =>
      request.method === "session/set_config_option")).toBe(false);
  });

  it("passes a fail-closed write flag into the real Kimi transport factory", async () => {
    const root = await makeRunRoot();
    const runtimeHomePaths = await makeRuntimeHomes(root);
    const transport = fakeTransport({
      sessionOptions: configOptions("kimi-for-coding", "high", "default"),
    });
    const transportFactory = vi.fn(async () => transport);
    await expect(runKimiAcp({
      prompt: "design only",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
      workspaceAccess: "read-only",
      permissionMode: "default",
      runtimeHomePaths,
      transportFactory,
    })).resolves.toMatchObject({ ok: true });
    expect(transportFactory).toHaveBeenCalledWith(expect.objectContaining({
      allowWrites: false,
    }));
  });

  it("authenticates the advertised Kimi login method before opening a session", async () => {
    const root = await makeRunRoot();
    const transport = fakeTransport({
      authMethods: [{ id: "login", name: "Kimi login" }],
    });
    await expect(runKimiAcpWithTransport(transport, {
      prompt: "implement",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
    })).resolves.toMatchObject({ ok: true });
    expect(transport.requests.map((request) => request.method)).toEqual([
      "initialize",
      "authenticate",
      "session/new",
      "session/prompt",
    ]);
    expect(transport.requests[1]?.params).toEqual({ methodId: "login" });
  });

  it("passes the snapshotted Codex model and effort to full and resume", async () => {
    const root = await makeRunRoot();
    const codex = vi.fn(async (options) => ({
      ok: true as const,
      finalText: "Codex completed",
      threadId: "thread-a",
      cachedInputTokens: 0,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));
    const runner = createLocalExecutionRunner({ runCodex: codex });
    const profile = { cli: "codex", model: "gpt-profile", effort: "medium" } as const;
    await runner({
      prompt: "full",
      runDir: root,
      cwd: root,
      profile,
      mode: { kind: "full" },
    });
    await runner({
      prompt: "resume",
      runDir: root,
      cwd: root,
      profile,
      mode: { kind: "resume", externalSessionId: "thread-a" },
    });
    for (const [options] of codex.mock.calls) {
      expect(options.execOptions).toEqual(expect.arrayContaining([
        "-m",
        "gpt-profile",
        "-c",
        'model_reasoning_effort="medium"',
      ]));
    }
    expect(codex.mock.calls[1]?.[0].mode).toEqual({
      kind: "resume",
      threadId: "thread-a",
    });
  });

  it("allows prompt only after session values exactly match the saved profile", async () => {
    const root = await makeRunRoot();
    const transport = fakeTransport();
    const started = vi.fn();
    const result = await runKimiAcpWithTransport(transport, {
      prompt: "implement",
      runDir: root,
      cwd: root,
      profile: {
        cli: "kimi",
        model: "kimi-for-coding",
        effort: "high",
      },
      mode: { kind: "full" },
      onSessionStarted: started,
    });
    expect(result).toMatchObject({ ok: true, finalText: "Kimi 完成", threadId: "kimi-session-1" });
    expect(started).toHaveBeenCalledWith("kimi-session-1");
    expect(transport.requests.map((request) => request.method)).toEqual([
      "initialize",
      "session/new",
      "session/prompt",
    ]);
  });

  it("rejects a bare end_turn with a stable empty-response error after preserving session identity", async () => {
    const root = await makeRunRoot();
    const transport = fakeTransport({ promptResult: { stopReason: "end_turn" } });
    const observed = vi.fn();
    const traceReady = vi.fn();

    await expect(runKimiAcpWithTransport(transport, {
      prompt: "无需回答",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
      onSessionStarted: observed,
      onExecutionTraceReady: traceReady,
    })).rejects.toMatchObject({
      code: "KIMI_EMPTY_RESPONSE",
      safeMessage: "Kimi 没有返回可用回复。请在终端直接运行 kimi 查看详细错误，然后重试。",
      diagnostics: {
        stopReason: "end_turn",
        visibleTextBytes: 0,
        terminalToolCount: 0,
      },
    });
    expect(observed).toHaveBeenCalledWith("kimi-session-1");
    expect(traceReady).not.toHaveBeenCalled();
  });

  it("does not treat whitespace, thought, plan, usage, config or an unfinished tool as terminal evidence", async () => {
    const root = await makeRunRoot();
    const transport = fakeTransport({
      promptResult: { stopReason: "end_turn" },
      sessionUpdates: [
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "  \n " } },
        { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "thinking" } },
        { sessionUpdate: "plan", entries: [] },
        { sessionUpdate: "usage_update", used: 1, size: 10 },
        { sessionUpdate: "config_option_update", configId: "mode", value: "auto" },
        { sessionUpdate: "unrecognized_update", _meta: { terminal: true } },
        {
          sessionUpdate: "tool_call_update",
          toolCallId: "pending-tool",
          status: "in_progress",
        },
      ],
    });

    await expect(runKimiAcpWithTransport(transport, {
      prompt: "inspect",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
    })).rejects.toMatchObject({ code: "KIMI_EMPTY_RESPONSE" });
  });

  it.each(["completed", "failed"] as const)(
    "accepts a %s terminal tool result as a legal textless completion",
    async (status) => {
      const root = await makeRunRoot();
      const traceReady = vi.fn();
      const transport = fakeTransport({
        promptResult: { stopReason: "end_turn" },
        sessionUpdates: [
          {
            sessionUpdate: "tool_call",
            toolCallId: "tool-1",
            title: "Write file",
            status,
          },
          {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-1",
            status,
          },
        ],
      });

      await expect(runKimiAcpWithTransport(transport, {
        prompt: "write the file",
        runDir: root,
        cwd: root,
        profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
        mode: { kind: "full" },
        onExecutionTraceReady: traceReady,
      })).resolves.toMatchObject({
        ok: true,
        finalText: "",
        completionKind: "terminal-tool-result",
        threadId: "kimi-session-1",
      });
      expect(traceReady).toHaveBeenCalledTimes(1);
      expect(traceReady).toHaveBeenCalledWith("kimi-session-1");
    },
  );

  it("accepts non-empty streamed Agent text and marks the trace ready once", async () => {
    const root = await makeRunRoot();
    const traceReady = vi.fn();
    const transport = fakeTransport({
      promptResult: { stopReason: "end_turn" },
      sessionUpdates: [
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Kimi streamed" },
        },
      ],
    });

    await expect(runKimiAcpWithTransport(transport, {
      prompt: "answer",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
      onExecutionTraceReady: traceReady,
    })).resolves.toMatchObject({
      ok: true,
      finalText: "Kimi streamed",
      completionKind: "visible-text",
    });
    expect(traceReady).toHaveBeenCalledTimes(1);
  });

  it("preserves whitespace-only chunks so accumulated Agent text matches the full chunk concatenation", async () => {
    const root = await makeRunRoot();
    const visible = vi.fn();
    // Real-wire shape: kimi streams markdown boundary whitespace as standalone
    // chunks ("##" + " " + text, "-" + " " + item, "\n\n" paragraph breaks).
    const chunks = [
      "##",
      " ",
      "QA 复核意见",
      "\n\n",
      "-",
      " ",
      "环境、main 同步",
      "\n",
      "-",
      " ",
      "门禁：`install --frozen-lockfile`",
    ];
    const transport = fakeTransport({
      promptResult: { stopReason: "end_turn" },
      sessionUpdates: chunks.map((text) => ({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      })),
    });
    const expected = chunks.join("");

    await expect(runKimiAcpWithTransport(transport, {
      prompt: "answer",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
      onVisibleAgentMarkdown: visible,
    })).resolves.toMatchObject({
      ok: true,
      finalText: expected,
      completionKind: "visible-text",
    });
    expect(visible).toHaveBeenLastCalledWith(expected);
  });

  it("keeps prompt-result text verbatim and drops a whitespace-suffixed echo of streamed text", async () => {
    const root = await makeRunRoot();
    const transport = fakeTransport({
      promptResult: { stopReason: "end_turn", finalText: "Kimi 完成\n\n- 已同步\n" },
    });

    await expect(runKimiAcpWithTransport(transport, {
      prompt: "answer",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
    })).resolves.toMatchObject({
      ok: true,
      finalText: "Kimi 完成\n\n- 已同步\n",
    });

    const echoRoot = await makeRunRoot();
    const echoTransport = fakeTransport({
      promptResult: { stopReason: "end_turn", finalText: "Kimi 完成\n" },
      sessionUpdates: [
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Kimi 完成" },
        },
      ],
    });

    await expect(runKimiAcpWithTransport(echoTransport, {
      prompt: "answer",
      runDir: echoRoot,
      cwd: echoRoot,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
    })).resolves.toMatchObject({
      ok: true,
      finalText: "Kimi 完成",
    });

    const trailingRoot = await makeRunRoot();
    const trailingTransport = fakeTransport({
      promptResult: { stopReason: "end_turn", finalText: "Kimi 完成" },
      sessionUpdates: [
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Kimi 完成\n" },
        },
      ],
    });

    await expect(runKimiAcpWithTransport(trailingTransport, {
      prompt: "answer",
      runDir: trailingRoot,
      cwd: trailingRoot,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
    })).resolves.toMatchObject({
      ok: true,
      finalText: "Kimi 完成\n",
    });
  });

  it("fails closed when trace readiness cannot be persisted", async () => {
    const root = await makeRunRoot();
    const transport = fakeTransport({
      promptResult: { stopReason: "end_turn" },
      sessionUpdates: [
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Kimi streamed" },
        },
      ],
    });

    await expect(runKimiAcpWithTransport(transport, {
      prompt: "answer",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
      onExecutionTraceReady: async () => {
        throw new Error("trace store unavailable");
      },
    })).rejects.toThrow("trace store unavailable");
  });

  it("returns the safe public failure while keeping bounded empty-response diagnostics local", async () => {
    const root = await makeRunRoot();
    const runtimeHomePaths = await makeRuntimeHomes(root);
    const transport = fakeTransport({ promptResult: { stopReason: "end_turn" } });
    const result = await runKimiAcp({
      prompt: "answer",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
      runtimeHomePaths,
      transportFactory: vi.fn().mockResolvedValue(transport),
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "kimi-empty-response",
      failure: {
        code: "kimi-empty-response",
        message: "Kimi 没有返回可用回复。请在终端直接运行 kimi 查看详细错误，然后重试。",
      },
    });
    expect(JSON.stringify(result)).not.toContain("HTTP 403");
    const diagnostic = await fs.readFile(path.join(root, "kimi-stderr.log"), "utf8");
    expect(diagnostic).toContain('"code":"KIMI_EMPTY_RESPONSE"');
    expect(diagnostic).toContain('"stopReason":"end_turn"');
  });

  it("accepts a setting response that explicitly confirms both changed values", async () => {
    const root = await makeRunRoot();
    const transport = fakeTransport({
      sessionOptions: configOptions("kimi-k2", "medium"),
      setResponses: [
        { configOptions: configOptions("kimi-for-coding", "medium") },
        { id: "thinking", currentValue: "high" },
      ],
    });
    const result = await runKimiAcpWithTransport(transport, {
      prompt: "implement",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
    });
    expect(result.ok).toBe(true);
    expect(transport.requests.map((request) => request.method)).toEqual([
      "initialize",
      "session/new",
      "session/set_config_option",
      "session/set_config_option",
      "session/prompt",
    ]);
  });

  it("applies the full Kimi CLI alias and its model-specific effort before prompting", async () => {
    const root = await makeRunRoot();
    const refreshedOptions = [
      {
        id: "model",
        currentValue: "kimi-code/kimi-for-coding",
        options: [
          { value: "kimi-code/k3" },
          { value: "kimi-code/kimi-for-coding" },
        ],
      },
      {
        id: "thinking",
        currentValue: "on",
        options: [{ value: "on" }],
      },
      {
        id: "mode",
        currentValue: "auto",
        options: [{ value: "auto" }, { value: "default" }],
      },
    ];
    const transport = fakeTransport({
      sessionOptions: [
        {
          id: "model",
          currentValue: "kimi-code/k3",
          options: [
            { value: "kimi-code/k3" },
            { value: "kimi-code/kimi-for-coding" },
          ],
        },
        {
          id: "thinking",
          currentValue: "high",
          options: [{ value: "low" }, { value: "high" }, { value: "max" }],
        },
        {
          id: "mode",
          currentValue: "auto",
          options: [{ value: "auto" }, { value: "default" }],
        },
      ],
      setResponses: [
        { configOptions: refreshedOptions },
      ],
    });
    const result = await runKimiAcpWithTransport(transport, {
      prompt: "identify the selected runtime",
      runDir: root,
      cwd: root,
      profile: {
        cli: "kimi",
        model: "kimi-code/kimi-for-coding",
        effort: "on",
      },
      mode: { kind: "full" },
    });

    expect(result.ok).toBe(true);
    expect(transport.requests.slice(2)).toEqual([
      {
        method: "session/set_config_option",
        params: {
          sessionId: "kimi-session-1",
          configId: "model",
          value: "kimi-code/kimi-for-coding",
        },
      },
      expect.objectContaining({ method: "session/prompt" }),
    ]);
    expect(transport.requests.at(-1)?.method).toBe("session/prompt");
  });

  it("uses a model config update when the setting response has no refreshed effort list", async () => {
    const root = await makeRunRoot();
    const refreshedOptions = [
      {
        id: "model",
        currentValue: "kimi-code/kimi-for-coding",
        options: [{ value: "kimi-code/kimi-for-coding" }],
      },
      {
        id: "thinking",
        currentValue: "on",
        options: [{ value: "on" }],
      },
      {
        id: "mode",
        currentValue: "auto",
        options: [{ value: "auto" }],
      },
    ];
    const transport = fakeTransport({
      sessionOptions: [
        {
          id: "model",
          currentValue: "kimi-code/k3",
          options: [
            { value: "kimi-code/k3" },
            { value: "kimi-code/kimi-for-coding" },
          ],
        },
        {
          id: "thinking",
          currentValue: "high",
          options: [{ value: "low" }, { value: "high" }, { value: "max" }],
        },
        {
          id: "mode",
          currentValue: "auto",
          options: [{ value: "auto" }],
        },
      ],
      setResponses: [
        { id: "model", currentValue: "kimi-code/kimi-for-coding" },
      ],
      configUpdateOptions: refreshedOptions,
    });

    await expect(runKimiAcpWithTransport(transport, {
      prompt: "run after linked config confirmation",
      runDir: root,
      cwd: root,
      profile: {
        cli: "kimi",
        model: "kimi-code/kimi-for-coding",
        effort: "on",
      },
      mode: { kind: "full" },
    })).resolves.toMatchObject({ ok: true });
    expect(transport.waitForConfigUpdate).toHaveBeenCalledWith(
      "kimi-session-1",
      "model",
      "kimi-code/kimi-for-coding",
      2_000,
    );
    expect(transport.requests.at(-1)?.method).toBe("session/prompt");
  });

  it.each([
    {
      name: "missing model option",
      options: configOptions().slice(1),
    },
    {
      name: "unsupported saved model",
      options: configOptions("kimi-k2", "high"),
      profileModel: "removed-model",
    },
  ])("fails before prompt for $name", async ({ options, profileModel }) => {
    const root = await makeRunRoot();
    const transport = fakeTransport({ sessionOptions: options });
    await expect(runKimiAcpWithTransport(transport, {
      prompt: "must not run",
      runDir: root,
      cwd: root,
      profile: {
        cli: "kimi",
        model: profileModel ?? "kimi-for-coding",
        effort: "high",
      },
      mode: { kind: "full" },
    })).rejects.toThrow();
    expect(transport.requests.some((request) => request.method === "session/prompt")).toBe(false);
  });

  it("fails before prompt when a set response and config update cannot confirm the value", async () => {
    const root = await makeRunRoot();
    const transport = fakeTransport({
      sessionOptions: configOptions("kimi-k2", "high"),
      setResponses: [{}],
      waitForUpdate: false,
    });
    await expect(runKimiAcpWithTransport(transport, {
      prompt: "must not run",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
    })).rejects.toThrow("没有确认");
    expect(transport.requests.some((request) => request.method === "session/prompt")).toBe(false);
  });

  it.each([
    "kimi-cli-not-found",
    "kimi-cli-not-executable",
    "kimi-cli-spawn-failed",
    "kimi-cli-exited",
    "kimi-acp-timeout",
  ] as const)("does not invoke Codex when Kimi fails with %s", async (reason) => {
    const root = await makeRunRoot();
    const codex = vi.fn();
    const kimi = vi.fn().mockResolvedValue({
      ok: false,
      reason,
      failure: { code: reason, message: "safe Kimi failure" },
      runDir: root,
      stdoutPath: path.join(root, "out"),
      stderrPath: path.join(root, "err"),
    });
    const runner = createLocalExecutionRunner({ runCodex: codex, runKimi: kimi });
    const result = await runner({
      prompt: "implement",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
    });
    expect(result.ok).toBe(false);
    expect(kimi).toHaveBeenCalledTimes(1);
    expect(codex).not.toHaveBeenCalled();
  });

  it("derives the managed Kimi home from the injected local-console data root", async () => {
    const root = await makeRunRoot();
    const dataRoot = path.join(root, "desktop-data");
    const codex = vi.fn();
    const kimi = vi.fn(async (options: Parameters<typeof runKimiAcp>[0]) => ({
      ok: false as const,
      reason: "expected test stop",
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "out"),
      stderrPath: path.join(options.runDir, "err"),
    }));
    const runner = createLocalExecutionRunner({ dataRoot, runCodex: codex, runKimi: kimi });

    await runner({
      prompt: "implement",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
    });

    expect(kimi).toHaveBeenCalledWith(expect.objectContaining({
      runtimeHomePaths: expect.objectContaining({
        managedHome: path.join(dataRoot, ".state", "kimi-runtime-home"),
      }),
    }));
    expect(codex).not.toHaveBeenCalled();
  });

  it("rejects an unsupported image before prompt and still closes the transport", async () => {
    const root = await makeRunRoot();
    const runtimeHomePaths = await makeRuntimeHomes(root);
    const image = path.join(root, "image.bmp");
    await fs.writeFile(image, "not an image");
    const transport = fakeTransport();
    const transportFactory = vi.fn(async () => transport);
    const codex = vi.fn();
    const runner = createLocalExecutionRunner({
      runCodex: codex,
      runKimi: async (options) => runKimiAcp({
        ...options,
        runtimeHomePaths,
        transportFactory,
      }),
    });
    const result = await runner({
      prompt: "inspect",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
      imagePaths: [image],
    });
    expect(result).toMatchObject({ ok: false, reason: "Kimi 无法读取这张图片的格式。" });
    expect(transport.requests.some((request) => request.method === "session/prompt")).toBe(false);
    expect(transport.close).toHaveBeenCalledTimes(1);
    expect(codex).not.toHaveBeenCalled();
    expect(transportFactory).toHaveBeenCalledWith(expect.objectContaining({
      env: expect.objectContaining({
        KIMI_CODE_HOME: runtimeHomePaths.managedHome,
      }),
    }));
  });

  it("requires authoritative model and effort options", async () => {
    const transport = fakeTransport();
    await expect(confirmRuntimeConfig(
      transport,
      "session",
      [],
      "kimi-for-coding",
      "high",
    )).rejects.toThrow("可核验");
    expect(transport.requests).toHaveLength(0);
  });

  it("sends supported images as ACP blocks while ordinary files stay in the prompt manifest", async () => {
    const root = await makeRunRoot();
    const image = path.join(root, "preview.png");
    await fs.writeFile(image, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const transport = fakeTransport();
    const result = await runKimiAcpWithTransport(transport, {
      prompt: [
        "inspect",
        "本轮本地附件（路径仅在当前 runDir 内有效）：",
        `- timeline[0] file "spec.pdf"; path="${path.join(root, "spec.pdf")}"`,
      ].join("\n"),
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
      imagePaths: [image],
    });
    expect(result.ok).toBe(true);
    const prompt = transport.requests.find((request) => request.method === "session/prompt");
    expect(prompt?.params).toMatchObject({
      prompt: [
        { type: "text", text: expect.stringContaining("spec.pdf") },
        { type: "image", mimeType: "image/png", data: expect.any(String) },
      ],
    });
  });

  it("allows managed attachment reads but fails closed for writes or paths outside trusted roots", async () => {
    const root = await makeRunRoot();
    const workspace = path.join(root, "workspace");
    const attachments = path.join(root, "run", "input-attachments");
    const outside = path.join(root, "outside");
    await Promise.all([
      fs.mkdir(workspace, { recursive: true }),
      fs.mkdir(attachments, { recursive: true }),
      fs.mkdir(outside, { recursive: true }),
    ]);
    const managedFile = path.join(attachments, "spec.txt");
    const outsideFile = path.join(outside, "secret.txt");
    const newWorkspaceFile = path.join(workspace, "new.txt");
    await Promise.all([
      fs.writeFile(managedFile, "managed"),
      fs.writeFile(outsideFile, "secret"),
    ]);

    await expect(resolveKimiFileRequestPath({
      cwd: workspace,
      readRoots: [workspace, attachments],
      rawPath: managedFile,
      write: false,
    })).resolves.toBe(managedFile);
    await expect(resolveKimiFileRequestPath({
      cwd: workspace,
      readRoots: [workspace, attachments],
      rawPath: managedFile,
      write: true,
    })).rejects.toThrow("outside workspace");
    await expect(resolveKimiFileRequestPath({
      cwd: workspace,
      readRoots: [workspace, attachments],
      rawPath: outsideFile,
      write: false,
    })).rejects.toThrow("outside workspace");
    await expect(resolveKimiFileRequestPath({
      cwd: workspace,
      readRoots: [workspace, attachments],
      rawPath: newWorkspaceFile,
      write: true,
    })).resolves.toBe(newWorkspaceFile);
  });

  it("rejects writing through an existing file symlink that escapes the workspace", async () => {
    const root = await makeRunRoot();
    const workspace = path.join(root, "workspace");
    const outside = path.join(root, "outside");
    await Promise.all([
      fs.mkdir(workspace, { recursive: true }),
      fs.mkdir(outside, { recursive: true }),
    ]);
    const outsideFile = path.join(outside, "secret.txt");
    const linkedFile = path.join(workspace, "linked.txt");
    await fs.writeFile(outsideFile, "secret");
    await fs.symlink(outsideFile, linkedFile);

    await expect(resolveKimiFileRequestPath({
      cwd: workspace,
      readRoots: [workspace],
      rawPath: linkedFile,
      write: true,
    })).rejects.toThrow("outside workspace");
  });

  it("rejects creating a file through a directory symlink that escapes the workspace", async () => {
    const root = await makeRunRoot();
    const workspace = path.join(root, "workspace");
    const outside = path.join(root, "outside");
    await Promise.all([
      fs.mkdir(workspace, { recursive: true }),
      fs.mkdir(outside, { recursive: true }),
    ]);
    const linkedDirectory = path.join(workspace, "linked-directory");
    await fs.symlink(outside, linkedDirectory);

    await expect(resolveKimiFileRequestPath({
      cwd: workspace,
      readRoots: [workspace],
      rawPath: path.join(linkedDirectory, "new.txt"),
      write: true,
    })).rejects.toThrow("outside workspace");
  });

  it("cancels and escalates an unresponsive Kimi prompt through bounded process signals", async () => {
    vi.useFakeTimers();
    const root = await makeRunRoot();
    let promptStarted!: () => void;
    const promptReady = new Promise<void>((resolve) => {
      promptStarted = resolve;
    });
    const transport = fakeTransport();
    transport.request = vi.fn(async (method, params) => {
      transport.requests.push({ method, params });
      if (method === "initialize") return { protocolVersion: 1 };
      if (method === "session/new") {
        return { sessionId: "kimi-session-1", configOptions: configOptions() };
      }
      if (method === "session/prompt") {
        promptStarted();
        return await new Promise(() => undefined);
      }
      throw new Error(`unexpected ${method}`);
    });
    transport.interrupt = vi.fn();
    transport.terminate = vi.fn();
    transport.kill = vi.fn();
    const controller = new AbortController();
    const run = runKimiAcpWithTransport(transport, {
      prompt: "long task",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
      signal: controller.signal,
    });
    const settled = run.then(
      () => null,
      (error: unknown) => error,
    );
    await promptReady;
    controller.abort("user-stop");
    expect(transport.notify).toHaveBeenCalledWith("session/cancel", {
      sessionId: "kimi-session-1",
    });
    expect(transport.interrupt).toHaveBeenCalledTimes(1);
    expect(transport.terminate).not.toHaveBeenCalled();
    expect(transport.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(transport.terminate).toHaveBeenCalledTimes(1);
    expect(transport.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await settled).toEqual(expect.objectContaining({ message: "Kimi 执行已中止。" }));
    expect(transport.interrupt).toHaveBeenCalledTimes(1);
    expect(transport.terminate).toHaveBeenCalledTimes(1);
    expect(transport.kill).toHaveBeenCalledTimes(1);
  });

  it("bounds a Kimi turn that hangs after a managed process tool completed", async () => {
    vi.useFakeTimers();
    const root = await makeRunRoot();
    let promptStarted!: () => void;
    const promptReady = new Promise<void>((resolve) => { promptStarted = resolve; });
    const transport = fakeTransport();
    let reportCompletion = (): void => undefined;
    transport.request = vi.fn(async (method) => {
      if (method === "initialize") return { protocolVersion: 1 };
      if (method === "session/new") return { sessionId: "kimi-managed-hang", configOptions: configOptions() };
      if (method === "session/prompt") { promptStarted(); return await new Promise(() => undefined); }
      throw new Error(`unexpected ${method}`);
    });
    const run = runKimiAcpWithTransport(transport, {
      prompt: "start managed service",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
      mcpServer: {
        command: "/usr/bin/node",
        args: [],
        env: {},
        onToolCompletion: (listener) => {
          reportCompletion = () => listener({ providerRunId: "run-1", toolCallId: "rpc-3", completionKind: "completed", completedAt: new Date().toISOString() });
          return () => { reportCompletion = (): void => undefined; };
        },
        close: () => undefined,
      },
    }).catch((error: unknown) => error);
    await promptReady;
    reportCompletion();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(transport.interrupt).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.notify).toHaveBeenCalledWith("session/cancel", { sessionId: "kimi-managed-hang" });
    expect(transport.interrupt).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(run).resolves.toMatchObject({
      code: "KIMI_ACP_TIMEOUT",
      safeMessage: "Kimi 的托管进程工具已完成，但本轮没有正常结束。",
    });
  });

  it("arms managed settlement when a real bridge tool name completes via session updates", async () => {
    vi.useFakeTimers();
    const root = await makeRunRoot();
    let promptStarted!: () => void;
    const promptReady = new Promise<void>((resolve) => { promptStarted = resolve; });
    let emitUpdate = (_update: unknown): void => undefined;
    const transport = fakeTransport();
    transport.onSessionUpdate = vi.fn((next) => {
      emitUpdate = next;
      return () => { emitUpdate = (_update: unknown): void => undefined; };
    });
    transport.request = vi.fn(async (method) => {
      if (method === "initialize") return { protocolVersion: 1 };
      if (method === "session/new") return { sessionId: "kimi-managed-title", configOptions: configOptions() };
      if (method === "session/prompt") { promptStarted(); return await new Promise(() => undefined); }
      throw new Error(`unexpected ${method}`);
    });
    const run = runKimiAcpWithTransport(transport, {
      prompt: "start managed service",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
      mcpServer: { command: "/usr/bin/node", args: [], env: {}, close: () => undefined },
    }).catch((error: unknown) => error);
    await promptReady;
    emitUpdate({ update: { sessionUpdate: "tool_call", toolCallId: "managed-1", title: "mcp__moebius_managed__managed_process_start" } });
    emitUpdate({ update: { sessionUpdate: "tool_call_update", toolCallId: "managed-1", status: "completed" } });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(transport.interrupt).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.notify).toHaveBeenCalledWith("session/cancel", { sessionId: "kimi-managed-title" });
    expect(transport.interrupt).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(run).resolves.toMatchObject({
      code: "KIMI_ACP_TIMEOUT",
      safeMessage: "Kimi 的托管进程工具已完成，但本轮没有正常结束。",
    });
  });

  it("does not treat unknown tools or foreign servers as managed", async () => {
    vi.useFakeTimers();
    const root = await makeRunRoot();
    let promptStarted!: () => void;
    const promptReady = new Promise<void>((resolve) => { promptStarted = resolve; });
    let emitUpdate = (_update: unknown): void => undefined;
    const transport = fakeTransport();
    transport.onSessionUpdate = vi.fn((next) => {
      emitUpdate = next;
      return () => { emitUpdate = (_update: unknown): void => undefined; };
    });
    transport.request = vi.fn(async (method) => {
      if (method === "initialize") return { protocolVersion: 1 };
      if (method === "session/new") return { sessionId: "kimi-managed-bogus", configOptions: configOptions() };
      if (method === "session/prompt") { promptStarted(); return await new Promise(() => undefined); }
      throw new Error(`unexpected ${method}`);
    });
    let settled = false;
    const run = runKimiAcpWithTransport(transport, {
      prompt: "verify no settlement",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
      mcpServer: { command: "/usr/bin/node", args: [], env: {}, close: () => undefined },
    }).then(
      () => { settled = true; },
      () => { settled = true; },
    );
    await promptReady;
    emitUpdate({ update: { sessionUpdate: "tool_call", toolCallId: "bogus-1", title: "mcp__moebius_managed__managed_process_bogus" } });
    emitUpdate({ update: { sessionUpdate: "tool_call_update", toolCallId: "bogus-1", status: "completed" } });
    emitUpdate({ update: { sessionUpdate: "tool_call", toolCallId: "other-1", title: "mcp__other_server__managed_process_start" } });
    emitUpdate({ update: { sessionUpdate: "tool_call_update", toolCallId: "other-1", status: "completed" } });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(transport.interrupt).not.toHaveBeenCalled();
    expect(transport.notify).not.toHaveBeenCalledWith("session/cancel", { sessionId: "kimi-managed-bogus" });
    expect(settled).toBe(false);
  });

  it("pauses managed settlement for a later tool and rearms after each real progress event", async () => {
    vi.useFakeTimers();
    const root = await makeRunRoot();
    let promptStarted!: () => void;
    const promptReady = new Promise<void>((resolve) => { promptStarted = resolve; });
    let emitUpdate = (_update: unknown): void => undefined;
    let reportCompletion = (): void => undefined;
    const transport = fakeTransport();
    transport.onSessionUpdate = vi.fn((next) => {
      emitUpdate = next;
      return () => { emitUpdate = (_update: unknown): void => undefined; };
    });
    transport.request = vi.fn(async (method) => {
      if (method === "initialize") return { protocolVersion: 1 };
      if (method === "session/new") return { sessionId: "kimi-managed-progress", configOptions: configOptions() };
      if (method === "session/prompt") { promptStarted(); return await new Promise(() => undefined); }
      throw new Error(`unexpected ${method}`);
    });
    const run = runKimiAcpWithTransport(transport, {
      prompt: "start managed service and verify it",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
      mcpServer: {
        command: "/usr/bin/node",
        args: [],
        env: {},
        onToolCompletion: (listener) => {
          reportCompletion = () => listener({ providerRunId: "run-1", toolCallId: "managed-1", completionKind: "completed", completedAt: new Date().toISOString() });
          return () => { reportCompletion = (): void => undefined; };
        },
        close: () => undefined,
      },
    }).catch((error: unknown) => error);
    await promptReady;
    reportCompletion();
    await vi.advanceTimersByTimeAsync(14_000);
    emitUpdate({ update: { sessionUpdate: "tool_call", toolCallId: "curl-1", title: "curl localhost" } });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(transport.interrupt).not.toHaveBeenCalled();

    emitUpdate({ update: { sessionUpdate: "tool_call_update", toolCallId: "curl-1", status: "completed" } });
    await vi.advanceTimersByTimeAsync(14_000);
    emitUpdate({ update: { sessionUpdate: "agent_thought_chunk", content: { text: "verified, preparing reply" } } });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(transport.interrupt).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.interrupt).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(run).resolves.toMatchObject({ code: "KIMI_ACP_TIMEOUT" });
  });

  it("does not let config chatter refresh idle but does refresh on reasoning progress", async () => {
    vi.useFakeTimers();
    const root = await makeRunRoot();
    let promptStarted!: () => void;
    const promptReady = new Promise<void>((resolve) => {
      promptStarted = resolve;
    });
    let emitUpdate = (_update: unknown): void => undefined;
    const transport = fakeTransport();
    transport.onSessionUpdate = vi.fn((next) => {
      emitUpdate = next;
      return () => {
        emitUpdate = (_update: unknown): void => undefined;
      };
    });
    transport.request = vi.fn(async (method) => {
      if (method === "initialize") return { protocolVersion: 1 };
      if (method === "session/new") {
        return { sessionId: "kimi-session-1", configOptions: configOptions() };
      }
      if (method === "session/prompt") {
        promptStarted();
        return await new Promise(() => undefined);
      }
      throw new Error(`unexpected ${method}`);
    });
    const run = runKimiAcpWithTransport(transport, {
      prompt: "semantic idle",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
      idleTimeoutMs: 100,
      toolTimeoutMs: 1_500,
    }).catch((error: unknown) => error);
    await promptReady;

    await vi.advanceTimersByTimeAsync(80);
    emitUpdate({ update: { sessionUpdate: "config_option_update" } });
    await vi.advanceTimersByTimeAsync(19);
    emitUpdate({
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { text: "still reasoning" },
      },
    });
    await vi.advanceTimersByTimeAsync(80);
    emitUpdate({ update: { sessionUpdate: "config_option_update" } });
    expect(transport.interrupt).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    expect(transport.interrupt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(run).resolves.toMatchObject({
      code: "KIMI_ACP_TIMEOUT",
      diagnostics: { partialText: "" },
    });
  });

  it("does not time out while a tool call is still running", async () => {
    vi.useFakeTimers();
    const root = await makeRunRoot();
    let promptStarted!: () => void;
    const promptReady = new Promise<void>((resolve) => {
      promptStarted = resolve;
    });
    let resolvePrompt!: (value: unknown) => void;
    const promptResult = new Promise<unknown>((resolve) => {
      resolvePrompt = resolve;
    });
    let emitUpdate = (_update: unknown): void => undefined;
    const transport = fakeTransport();
    transport.onSessionUpdate = vi.fn((next) => {
      emitUpdate = next;
      return () => {
        emitUpdate = (_update: unknown): void => undefined;
      };
    });
    transport.request = vi.fn(async (method) => {
      if (method === "initialize") return { protocolVersion: 1 };
      if (method === "session/new") {
        return { sessionId: "kimi-session-1", configOptions: configOptions() };
      }
      if (method === "session/prompt") {
        promptStarted();
        return await promptResult;
      }
      throw new Error(`unexpected ${method}`);
    });
    const run = runKimiAcpWithTransport(transport, {
      prompt: "run a slow tool",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
      idleTimeoutMs: 100,
    });
    await promptReady;

    emitUpdate({
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "slow-tool",
        title: "run tests",
      },
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(transport.interrupt).not.toHaveBeenCalled();

    emitUpdate({
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "slow-tool",
        status: "completed",
      },
    });
    resolvePrompt({ stopReason: "end_turn", finalText: "LONG_TOOL_SUCCESS" });
    await expect(run).resolves.toMatchObject({
      ok: true,
      finalText: "LONG_TOOL_SUCCESS",
    });
    expect(transport.interrupt).not.toHaveBeenCalled();
  });

  it("stops a tool call that remains in flight past its dedicated deadline", async () => {
    vi.useFakeTimers();
    const root = await makeRunRoot();
    let promptStarted!: () => void;
    const promptReady = new Promise<void>((resolve) => {
      promptStarted = resolve;
    });
    let emitUpdate = (_update: unknown): void => undefined;
    const transport = fakeTransport();
    transport.onSessionUpdate = vi.fn((next) => {
      emitUpdate = next;
      return () => {
        emitUpdate = (_update: unknown): void => undefined;
      };
    });
    transport.request = vi.fn(async (method) => {
      if (method === "initialize") return { protocolVersion: 1 };
      if (method === "session/new") {
        return { sessionId: "kimi-session-1", configOptions: configOptions() };
      }
      if (method === "session/prompt") {
        promptStarted();
        return await new Promise(() => undefined);
      }
      throw new Error(`unexpected ${method}`);
    });
    const run = runKimiAcpWithTransport(transport, {
      prompt: "run a hung tool",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
      idleTimeoutMs: 50,
      toolTimeoutMs: 100,
    }).catch((error: unknown) => error);
    await promptReady;

    emitUpdate({
      update: {
        sessionUpdate: "tool_call",
        title: "git push",
      },
    });
    await vi.advanceTimersByTimeAsync(99);
    expect(transport.interrupt).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.interrupt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(run).resolves.toMatchObject({
      code: "KIMI_ACP_TIMEOUT",
      diagnostics: { timeoutBasis: "tool" },
    });
  });

  it("exposes provider retries and stops a sustained busy phase after five minutes", async () => {
    vi.useFakeTimers();
    const root = await makeRunRoot();
    let promptStarted!: () => void;
    const promptReady = new Promise<void>((resolve) => {
      promptStarted = resolve;
    });
    let emitUpdate = (_update: unknown): void => undefined;
    const progress = vi.fn();
    const transport = fakeTransport();
    transport.onSessionUpdate = vi.fn((next) => {
      emitUpdate = next;
      return () => {
        emitUpdate = (_update: unknown): void => undefined;
      };
    });
    transport.request = vi.fn(async (method) => {
      if (method === "initialize") return { protocolVersion: 1 };
      if (method === "session/new") {
        return { sessionId: "kimi-session-1", configOptions: configOptions() };
      }
      if (method === "session/prompt") {
        promptStarted();
        return await new Promise(() => undefined);
      }
      throw new Error(`unexpected ${method}`);
    });
    const run = runKimiAcpWithTransport(transport, {
      prompt: "busy provider",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
      onExecutionProgress: progress,
    }).catch((error: unknown) => error);
    await promptReady;

    emitUpdate({
      update: {
        sessionUpdate: "status",
        message: "engine overloaded, retry attempt 3",
      },
    });
    expect(progress).toHaveBeenCalledWith({
      kind: "provider-retry",
      retryKind: "service",
      attempt: 3,
      sequence: expect.any(Number),
    });
    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000 - 1);
    expect(transport.interrupt).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.interrupt).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(run).resolves.toMatchObject({
      code: "KIMI_ACP_BUSY_TIMEOUT",
      diagnostics: { partialText: "" },
    });
  });

  it.each([
    { phase: "initialize", trigger: "abort" },
    { phase: "authenticate", trigger: "max" },
    { phase: "config", trigger: "abort" },
  ] as const)("bounds a hung $phase phase with $trigger and escalates exactly once", async ({
    phase,
    trigger,
  }) => {
    vi.useFakeTimers();
    const root = await makeRunRoot();
    let phaseStarted!: () => void;
    const phaseReady = new Promise<void>((resolve) => {
      phaseStarted = resolve;
    });
    const transport = fakeTransport();
    transport.request = vi.fn(async (method, params) => {
      transport.requests.push({ method, params });
      if (method === "initialize") {
        if (phase === "initialize") {
          phaseStarted();
          return await new Promise(() => undefined);
        }
        return {
          protocolVersion: 1,
          ...(phase === "authenticate" ? { authMethods: [{ id: "login" }] } : {}),
        };
      }
      if (method === "authenticate") {
        phaseStarted();
        return await new Promise(() => undefined);
      }
      if (method === "session/new") {
        return {
          sessionId: "kimi-session-1",
          configOptions: phase === "config"
            ? configOptions("kimi-k2", "high")
            : configOptions(),
        };
      }
      if (method === "session/set_config_option") {
        phaseStarted();
        return await new Promise(() => undefined);
      }
      throw new Error(`unexpected ${method}`);
    });
    transport.interrupt = vi.fn();
    transport.terminate = vi.fn();
    transport.kill = vi.fn();
    const controller = new AbortController();
    const run = runKimiAcpWithTransport(transport, {
      prompt: "must not reach prompt",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
      signal: controller.signal,
      ...(trigger === "max" ? { maxDurationMs: 100 } : {}),
    });
    const settled = run.then(
      () => null,
      (error: unknown) => error,
    );
    await phaseReady;
    if (trigger === "abort") {
      controller.abort("test-abort");
    } else {
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(transport.interrupt).toHaveBeenCalledTimes(1);
    expect(transport.terminate).not.toHaveBeenCalled();
    expect(transport.notify).toHaveBeenCalledTimes(phase === "config" ? 1 : 0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(transport.terminate).toHaveBeenCalledTimes(1);
    expect(transport.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await settled).toEqual(expect.objectContaining({
      message: trigger === "abort"
        ? "Kimi 执行已中止。"
        : "Kimi CLI 启动后没有及时响应。请检查 Kimi 状态后重试。",
    }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(transport.interrupt).toHaveBeenCalledTimes(1);
    expect(transport.terminate).toHaveBeenCalledTimes(1);
    expect(transport.kill).toHaveBeenCalledTimes(1);
    expect(transport.requests.some((request) => request.method === "session/prompt")).toBe(false);
  });

  it.each([
    { phase: "before-session", expectCancel: false },
    { phase: "after-session", expectCancel: true },
  ] as const)("runs the real wrapper shutdown sequence once when aborting $phase", async ({
    phase,
    expectCancel,
  }) => {
    vi.useFakeTimers();
    const root = await makeRunRoot();
    const runtimeHomePaths = await makeRuntimeHomes(root);
    const events: string[] = [];
    const transport = signalRecordingTransport(events);
    const defaultRequest = transport.request.bind(transport);
    let phaseStarted!: () => void;
    const phaseReady = new Promise<void>((resolve) => {
      phaseStarted = resolve;
    });
    transport.request = vi.fn(async (method, params) => {
      if (
        (phase === "before-session" && method === "initialize")
        || (phase === "after-session" && method === "session/prompt")
      ) {
        phaseStarted();
        return await new Promise(() => undefined);
      }
      return defaultRequest(method, params);
    });
    const controller = new AbortController();
    const run = runKimiAcp({
      prompt: "bounded wrapper",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
      signal: controller.signal,
      runtimeHomePaths,
      transportFactory: vi.fn().mockResolvedValue(transport),
    });

    await phaseReady;
    controller.abort("wrapper-abort");
    controller.abort("duplicate-abort");
    expect(events).toEqual(expectCancel
      ? ["session/cancel:kimi-session-1", "SIGINT"]
      : ["SIGINT"]);

    await vi.advanceTimersByTimeAsync(999);
    expect(events).not.toContain("SIGTERM");
    await vi.advanceTimersByTimeAsync(1);
    expect(events.at(-1)).toBe("SIGTERM");
    await vi.advanceTimersByTimeAsync(999);
    expect(events).not.toContain("SIGKILL");
    await vi.advanceTimersByTimeAsync(1);

    await expect(run).resolves.toMatchObject({
      ok: false,
      reason: "kimi-acp-interrupted",
      terminal: { kind: "interrupted", actor: "user" },
    });
    expect(events).toEqual(expectCancel
      ? ["session/cancel:kimi-session-1", "SIGINT", "SIGTERM", "SIGKILL", "close"]
      : ["SIGINT", "SIGTERM", "SIGKILL", "close"]);
    expect(transport.notify).toHaveBeenCalledTimes(expectCancel ? 1 : 0);
    expect(transport.interrupt).toHaveBeenCalledTimes(1);
    expect(transport.terminate).toHaveBeenCalledTimes(1);
    expect(transport.kill).toHaveBeenCalledTimes(1);
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it("classifies an empty end_turn as the stable empty-response failure", async () => {
    const root = await makeRunRoot();
    const transport = fakeTransport();
    const request = transport.request.bind(transport);
    transport.request = vi.fn(async (method, params) =>
      method === "session/prompt"
        ? { stopReason: "end_turn" }
        : request(method, params));

    await expect(runKimiAcpWithTransport(transport, {
      prompt: "empty terminal",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
    })).rejects.toMatchObject({
      code: "KIMI_EMPTY_RESPONSE",
      diagnostics: {
        stopReason: "end_turn",
        visibleTextBytes: 0,
        terminalToolCount: 0,
      },
    });
  });

  it("uses a reliable non-retryable 403 signal for quota classification", async () => {
    const root = await makeRunRoot();
    const runtimeHomePaths = await makeRuntimeHomes(root);
    const transport = fakeTransport();
    const request = transport.request.bind(transport);
    transport.request = vi.fn(async (method, params) => {
      if (method === "session/prompt") {
        throw new KimiAcpError(
          "KIMI_ACP_REQUEST_FAILED",
          "Kimi ACP 请求失败。",
          {
            jsonRpcCode: 403,
            jsonRpcMessage: "billing cycle usage limit reached",
            jsonRpcData: { retryable: false },
          },
        );
      }
      return request(method, params);
    });

    await expect(runKimiAcp({
      prompt: "quota",
      runDir: root,
      cwd: root,
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      mode: { kind: "full" },
      runtimeHomePaths,
      transportFactory: vi.fn().mockResolvedValue(transport),
    })).resolves.toMatchObject({
      ok: false,
      reason: "kimi-quota-exhausted",
      failure: { message: expect.stringContaining("已确认") },
      terminal: {
        kind: "quota-exhausted",
        retryable: false,
        safeCode: "kimi-quota-exhausted",
      },
    });
  });
});
