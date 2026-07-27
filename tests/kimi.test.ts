import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  confirmRuntimeConfig,
  kimiClientFsCapabilities,
  resolveKimiFileRequestPath,
  runKimiAcp,
  runKimiAcpWithTransport,
  type KimiAcpTransport,
} from "../src/kimi.js";
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
  sessionOptions?: unknown[];
  setResponses?: unknown[];
  waitForUpdate?: boolean;
  sessionId?: string;
} = {}): KimiAcpTransport & { requests: Array<{ method: string; params: unknown }> } {
  const requests: Array<{ method: string; params: unknown }> = [];
  const setResponses = [...(input.setResponses ?? [])];
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
      if (method === "session/new" || method === "session/resume") {
        return {
          sessionId: input.sessionId ?? "kimi-session-1",
          configOptions: input.sessionOptions ?? configOptions(),
        };
      }
      if (method === "session/set_config_option") return setResponses.shift() ?? {};
      if (method === "session/prompt") return { finalText: "Kimi 完成" };
      throw new Error(`unexpected ${method}`);
    },
    notify: vi.fn(),
    waitForConfigUpdate: vi.fn().mockResolvedValue(input.waitForUpdate ?? false),
    onSessionUpdate: () => () => undefined,
    close: vi.fn().mockResolvedValue(undefined),
    interrupt: vi.fn(),
    terminate: vi.fn(),
    kill: vi.fn(),
  };
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

describe("Kimi ACP driver", () => {
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

  it("accepts a setting response that explicitly confirms both changed values", async () => {
    const root = await makeRunRoot();
    const transport = fakeTransport({
      sessionOptions: configOptions("kimi-k2", "medium"),
      setResponses: [
        { id: "model", currentValue: "kimi-for-coding" },
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

  it("does not invoke Codex when Kimi fails", async () => {
    const root = await makeRunRoot();
    const codex = vi.fn();
    const kimi = vi.fn().mockResolvedValue({
      ok: false,
      reason: "Kimi unavailable",
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
      message: trigger === "abort" ? "Kimi 执行已中止。" : "Kimi 执行超时。",
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
      reason: expect.stringContaining("Kimi 执行已中止"),
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
});
