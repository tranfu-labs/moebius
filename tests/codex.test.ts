import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildCodexArgs,
  codexTimeoutKind,
  createCodexJsonlFramer,
  createRunWatchdogs,
  extractCodexThreadId,
  extractCodexOutput,
  extractFinalAssistant,
  extractVisibleAgentMarkdown,
  isInterruptedCodexRunResult,
  run,
} from "../src/codex.js";
import {
  CODEX_EXEC_OPTIONS,
  DEFAULT_CODEX_MODEL,
  buildCodexExecOptions,
  buildCodexExecOptionsBase,
  buildTeamBuilderExecOptions,
  resolveCodexModel,
  resolveCodexProviderConfig,
} from "../src/config.js";
import { parseLocalConfig } from "../src/local-config.js";

describe("extractFinalAssistant", () => {
  it("returns the final assistant text across supported event shapes", () => {
    const lines = [
      JSON.stringify({ type: "agent_message", message: "first" }),
      JSON.stringify({ type: "assistant_message", content: "second" }),
      JSON.stringify({ type: "message", role: "assistant", text: "third" }),
    ];

    expect(extractFinalAssistant(lines)).toBe("third");
  });

  it("skips invalid JSON lines", () => {
    const lines = [
      "not json",
      JSON.stringify({ type: "agent_message", message: "first" }),
      "{",
      JSON.stringify({ type: "assistant_message", text: "last" }),
    ];

    expect(extractFinalAssistant(lines)).toBe("last");
  });

  it("supports nested assistant message content arrays", () => {
    const lines = [
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [
            { type: "output_text", text: "hello" },
            { type: "output_text", text: " world" },
          ],
        },
      }),
    ];

    expect(extractFinalAssistant(lines)).toBe("hello world");
  });

  it("supports codex item.completed agent message events", () => {
    const lines = [
      JSON.stringify({ type: "thread.started", thread_id: "thread" }),
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_0",
          type: "agent_message",
          text: "final from codex",
        },
      }),
    ];

    expect(extractFinalAssistant(lines)).toBe("final from codex");
  });

  it("extracts thread id and cached input tokens from codex jsonl", () => {
    const lines = [
      JSON.stringify({ type: "thread.started", thread_id: "thread-123" }),
      JSON.stringify({
        type: "turn.completed",
        usage: {
          cached_input_tokens: 42,
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "agent_message",
          text: "final",
        },
      }),
    ];

    expect(extractCodexOutput(lines)).toEqual({
      finalText: "final",
      threadId: "thread-123",
      cachedInputTokens: 42,
    });
  });

  it("builds full and resume codex args without ephemeral mode", () => {
    expect(buildCodexArgs("hello")).toEqual(
      expect.arrayContaining([
        "exec",
        "--json",
        "-c",
        "agents.enabled=false",
        "-m",
        "gpt-5.6-sol",
        "hello",
      ]),
    );
    expect(buildCodexArgs("hello")).not.toContain("--ephemeral");

    const resumeArgs = buildCodexArgs("delta", { kind: "resume", threadId: "thread-1" });
    expect(resumeArgs).toEqual([
      "exec",
      "resume",
      ...CODEX_EXEC_OPTIONS,
      "--",
      "thread-1",
      "delta",
    ]);
    expect(resumeArgs).toEqual(expect.arrayContaining(["-c", "agents.enabled=false"]));
    expect(resumeArgs).not.toContain("multi_agent");
    expect(resumeArgs).not.toContain("--ephemeral");
  });

  it("adds image attachments to full and resume codex args", () => {
    expect(buildCodexArgs("hello", { kind: "full" }, ["/tmp/a.png", "/tmp/b.jpg"])).toEqual(
      expect.arrayContaining(["--image", "/tmp/a.png", "--image", "/tmp/b.jpg", "hello"]),
    );

    expect(buildCodexArgs("delta", { kind: "resume", threadId: "thread-1" }, ["/tmp/a.png"])).toEqual(
      expect.arrayContaining(["exec", "resume", "--image", "/tmp/a.png", "thread-1", "delta"]),
    );
  });

  // 回归：codex exec 的 --image 是贪婪多值选项，若 prompt 直接跟在 --image 之后会被
  // 吞成图片路径，codex 转而读空 stdin 并以 exit 1 退出（"No prompt provided via stdin."）。
  // 必须用 "--" 终止选项解析，且位置参数（threadId / prompt）必须排在所有选项之后。
  it("terminates option parsing with -- so greedy --image cannot swallow the prompt", () => {
    const fullArgs = buildCodexArgs("hello", { kind: "full" }, ["/tmp/a.png", "/tmp/b.jpg"]);
    expect(fullArgs.slice(-2)).toEqual(["--", "hello"]);
    expect(fullArgs[fullArgs.indexOf("--") - 1]).toBe("/tmp/b.jpg");

    const resumeArgs = buildCodexArgs("delta", { kind: "resume", threadId: "thread-1" }, ["/tmp/a.png"]);
    expect(resumeArgs.slice(-3)).toEqual(["--", "thread-1", "delta"]);
    expect(resumeArgs[resumeArgs.indexOf("--") - 1]).toBe("/tmp/a.png");

    // 无图片时同样保留 "--"，兼容以 "-" 开头的 prompt。
    expect(buildCodexArgs("-starts-with-dash").slice(-2)).toEqual(["--", "-starts-with-dash"]);
  });

  it("accepts an isolated exec option set without falling back to ordinary --yolo options", () => {
    const isolatedOptions = [
      "--json",
      "--ignore-user-config",
      "--sandbox",
      "read-only",
      "--cd",
      "/runtime/workspace",
    ];
    expect(buildCodexArgs("design a team", { kind: "full" }, [], isolatedOptions)).toEqual([
      "exec",
      ...isolatedOptions,
      "--",
      "design a team",
    ]);
    const resumeArgs = buildCodexArgs(
      "adjust",
      { kind: "resume", threadId: "team-thread" },
      [],
      isolatedOptions,
    );
    expect(resumeArgs).toEqual([
      "--sandbox",
      "read-only",
      "--cd",
      "/runtime/workspace",
      "exec",
      "resume",
      "--json",
      "--ignore-user-config",
      "--",
      "team-thread",
      "adjust",
    ]);
    expect(resumeArgs).toContain("--sandbox");
    expect(resumeArgs).toContain("--cd");
    expect(resumeArgs.indexOf("--sandbox")).toBeLessThan(resumeArgs.indexOf("resume"));
    expect(resumeArgs.indexOf("--cd")).toBeLessThan(resumeArgs.indexOf("resume"));
  });

  it("returns null when no assistant message is present", () => {
    const lines = [
      JSON.stringify({ type: "message", role: "user", content: "hello" }),
      JSON.stringify({ type: "event", text: "not an assistant message" }),
    ];

    expect(extractFinalAssistant(lines)).toBeNull();
  });

  it("runs internal invocations from a disposable Codex home", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-codex-isolation-test-"));
    const sourceCodexHome = path.join(tempDir, "user-codex");
    const binDir = path.join(tempDir, "bin");
    const runDir = path.join(tempDir, "run");
    const recordPath = path.join(tempDir, "child-env.json");
    await fs.mkdir(sourceCodexHome, { recursive: true });
    await fs.mkdir(binDir);
    await fs.writeFile(path.join(sourceCodexHome, "auth.json"), '{"access_token":"fixture"}\n', "utf8");
    const sourceConfig = "[user]\nmarker = \"unchanged\"\n";
    await fs.writeFile(path.join(sourceCodexHome, "config.toml"), sourceConfig, "utf8");
    const codexPath = path.join(binDir, "codex");
    await fs.writeFile(
      codexPath,
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
fs.writeFileSync(process.env.MOEBIUS_ISOLATION_RECORD, JSON.stringify({
  codexHome: process.env.CODEX_HOME,
  sqliteHome: process.env.CODEX_SQLITE_HOME,
  authPresent: fs.existsSync(path.join(process.env.CODEX_HOME, "auth.json")),
}));
fs.writeFileSync(path.join(process.env.CODEX_HOME, "config.toml"), "[projects.\\\"/tmp/internal\\\"]\\ntrust_level = \\\"trusted\\\"\\n");
process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "thread-isolated" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "done" } }) + "\\n");
`,
      "utf8",
    );
    await fs.chmod(codexPath, 0o755);

    const previousPath = process.env.PATH;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
    process.env.CODEX_HOME = sourceCodexHome;
    try {
      const result = await run({
        prompt: "hello",
        runDir,
        execOptions: ["--json", "--ignore-user-config"],
        isolateUserConfig: true,
        extraEnv: { MOEBIUS_ISOLATION_RECORD: recordPath },
      });

      expect(result).toMatchObject({ ok: true, finalText: "done", threadId: "thread-isolated" });
      const childEnvironment = JSON.parse(await fs.readFile(recordPath, "utf8")) as {
        codexHome: string;
        sqliteHome: string;
        authPresent: boolean;
      };
      expect(childEnvironment.codexHome).not.toBe(sourceCodexHome);
      expect(childEnvironment.sqliteHome).toContain(childEnvironment.codexHome);
      expect(childEnvironment.authPresent).toBe(true);
      await expect(fs.access(childEnvironment.codexHome)).rejects.toThrow();
      expect(await fs.readFile(path.join(sourceCodexHome, "config.toml"), "utf8")).toBe(sourceConfig);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns interrupted without parsing partial output when aborted", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-codex-test-"));
    const binDir = path.join(tempDir, "bin");
    const runDir = path.join(tempDir, "run");
    await fs.mkdir(binDir);
    const codexPath = path.join(binDir, "codex");
    await fs.writeFile(
      codexPath,
      `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "agent_message", message: "stale" }) + "\\n");
setInterval(() => {}, 1000);
`,
      "utf8",
    );
    await fs.chmod(codexPath, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
    const controller = new AbortController();
    try {
      const pending = run({ prompt: "hello", runDir, signal: controller.signal });
      await new Promise((resolve) => setTimeout(resolve, 20));
      controller.abort("new-message");
      const result = await pending;

      expect(result.ok).toBe(false);
      expect(isInterruptedCodexRunResult(result)).toBe(true);
      if (!result.ok) {
        expect(result.reason).toBe("interrupted:new-message");
      }
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("escalates aborted codex child processes to SIGKILL when they ignore graceful signals", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-codex-test-"));
    const binDir = path.join(tempDir, "bin");
    const runDir = path.join(tempDir, "run");
    await fs.mkdir(binDir);
    const codexPath = path.join(binDir, "codex");
    await fs.writeFile(
      codexPath,
      `#!/usr/bin/env node
process.on("SIGINT", () => {});
process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
`,
      "utf8",
    );
    await fs.chmod(codexPath, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
    const controller = new AbortController();
    try {
      const pending = run({
        prompt: "hello",
        runDir,
        signal: controller.signal,
        interruptTerminationDelayMs: 10,
        interruptKillDelayMs: 10,
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      controller.abort("codex-run-timeout:20ms");
      const result = await pending;

      expect(result.ok).toBe(false);
      expect(isInterruptedCodexRunResult(result)).toBe(true);
      if (!result.ok) {
        expect(result.reason).toBe("interrupted:codex-run-timeout:20ms");
      }
    } finally {
      process.env.PATH = previousPath;
    }
  });
});

describe("Codex visible Markdown stream", () => {
  it("frames split JSONL chunks and skips malformed or unknown events", () => {
    const diagnostics: string[] = [];
    const framer = createCodexJsonlFramer({ onDiagnostic: (message) => diagnostics.push(message) });

    expect(framer.push('{"type":"item.comp')).toEqual([]);
    const events = framer.push('leted","item":{"type":"agent_message","text":"第一段"}}\nnot-json\n{"type":"turn.started"}\n');

    expect(events.map(extractVisibleAgentMarkdown)).toEqual(["第一段", null]);
    expect(diagnostics).toContain("codex-jsonl-malformed-line");
    expect(framer.finish()).toEqual([]);
  });

  it("drops an overlong line and resumes at the next newline", () => {
    const diagnostics: string[] = [];
    const framer = createCodexJsonlFramer({
      maxLineBytes: 32,
      onDiagnostic: (message) => diagnostics.push(message),
    });

    expect(framer.push("x".repeat(40))).toEqual([]);
    const events = framer.push('\n{"type":"item.completed"}\n');

    expect(events).toEqual([{ type: "item.completed" }]);
    expect(diagnostics).toEqual(["codex-jsonl-line-too-large:40+"]);
  });

  it("drops a trailing JSON fragment that never closes with a newline", () => {
    const diagnostics: string[] = [];
    const framer = createCodexJsonlFramer({ onDiagnostic: (message) => diagnostics.push(message) });

    expect(framer.push('{"type":"item.completed","item":{"type":"agent_message"')).toEqual([]);
    expect(framer.finish()).toEqual([]);
    expect(diagnostics).toEqual(["codex-jsonl-trailing-partial-line:55"]);
  });

  it("only accepts completed agent_message items as visible Markdown", () => {
    const events = [
      { type: "thread.started", thread_id: "thread" },
      { type: "item.completed", item: { type: "reasoning", text: "hidden" } },
      { type: "item.completed", item: { type: "command_execution", text: "pnpm test" } },
      { type: "item.started", item: { type: "agent_message", text: "partial" } },
      { type: "item.completed", item: { type: "agent_message", text: "  " } },
      { type: "item.completed", item: { type: "agent_message", text: "## 可见进度" } },
    ];

    expect(events.map(extractVisibleAgentMarkdown)).toEqual([null, null, null, null, null, "## 可见进度"]);
  });

  it("extracts a valid thread id and ignores unrelated events", () => {
    expect(extractCodexThreadId({ type: "thread.started", thread_id: "thread-123" })).toBe("thread-123");
    expect(extractCodexThreadId({ type: "thread.started", thread_id: "" })).toBeNull();
    expect(extractCodexThreadId({ type: "turn.started", thread_id: "thread-123" })).toBeNull();
  });

  it("delivers complete visible segments without making callback failures fatal", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-codex-test-"));
    const binDir = path.join(tempDir, "bin");
    const runDir = path.join(tempDir, "run");
    await fs.mkdir(binDir);
    const codexPath = path.join(binDir, "codex");
    await fs.writeFile(
      codexPath,
      `#!/usr/bin/env node
const events = [
  { type: "thread.started", thread_id: "thread-live" },
  { type: "item.completed", item: { type: "agent_message", text: "第一段" } },
  { type: "item.completed", item: { type: "command_execution", text: "noise" } },
  { type: "item.completed", item: { type: "agent_message", text: "最终段" } }
];
for (const event of events) process.stdout.write(JSON.stringify(event) + "\\n");
`,
      "utf8",
    );
    await fs.chmod(codexPath, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
    const visible: string[] = [];
    try {
      const result = await run({
        prompt: "hello",
        runDir,
        onVisibleAgentMarkdown(text) {
          visible.push(text);
          if (text === "第一段") {
            throw new Error("consumer unavailable");
          }
        },
      });

      expect(result).toMatchObject({ ok: true, finalText: "最终段", threadId: "thread-live" });
      expect(visible).toEqual(["第一段", "最终段"]);
      expect(await fs.readFile(path.join(runDir, "stderr.log"), "utf8")).toContain(
        "codex-visible-markdown-callback-failed:consumer unavailable",
      );
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("delivers thread.started exactly once before returning a successful run", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-codex-test-"));
    const binDir = path.join(tempDir, "bin");
    const runDir = path.join(tempDir, "run");
    await fs.mkdir(binDir);
    const codexPath = path.join(binDir, "codex");
    await fs.writeFile(
      codexPath,
      `#!/usr/bin/env node
const thread = JSON.stringify({ type: "thread.started", thread_id: "thread-live" }) + "\\n";
process.stdout.write(thread.slice(0, 17));
process.stdout.write(thread.slice(17));
process.stdout.write(thread);
process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "done" } }) + "\\n");
`,
      "utf8",
    );
    await fs.chmod(codexPath, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
    const observed: string[] = [];
    try {
      const result = await run({
        prompt: "hello",
        runDir,
        async onThreadStarted(threadId) {
          await Promise.resolve();
          observed.push(threadId);
        },
      });
      expect(result).toMatchObject({ ok: true, threadId: "thread-live" });
      expect(observed).toEqual(["thread-live"]);
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("fails the Agent run when thread.started cannot be persisted", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-codex-test-"));
    const binDir = path.join(tempDir, "bin");
    const runDir = path.join(tempDir, "run");
    await fs.mkdir(binDir);
    const codexPath = path.join(binDir, "codex");
    await fs.writeFile(
      codexPath,
      `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "thread-live" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "done" } }) + "\\n");
`,
      "utf8",
    );
    await fs.chmod(codexPath, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
    try {
      const result = await run({
        prompt: "hello",
        runDir,
        onThreadStarted() {
          throw new Error("session fact unavailable");
        },
      });
      expect(result).toMatchObject({
        ok: false,
        reason: "thread-start-callback-failed:session fact unavailable",
        threadId: "thread-live",
      });
      expect(await fs.readFile(result.stderrPath, "utf8")).toContain(
        "codex-thread-link-unavailable:session fact unavailable",
      );
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("persists thread.started before reporting a later Codex failure", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-codex-test-"));
    const binDir = path.join(tempDir, "bin");
    const runDir = path.join(tempDir, "run");
    await fs.mkdir(binDir);
    const codexPath = path.join(binDir, "codex");
    await fs.writeFile(
      codexPath,
      `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "thread-failed" }) + "\\n");
process.exitCode = 7;
`,
      "utf8",
    );
    await fs.chmod(codexPath, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
    const observed: string[] = [];
    try {
      const result = await run({
        prompt: "hello",
        runDir,
        onThreadStarted(threadId) {
          observed.push(threadId);
        },
      });
      expect(observed).toEqual(["thread-failed"]);
      expect(result).toMatchObject({ ok: false, reason: "exit-code-7" });
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("classifies a Codex upgrade requirement without persisting the raw provider error as the reason", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-codex-test-"));
    const binDir = path.join(tempDir, "bin");
    const runDir = path.join(tempDir, "run");
    await fs.mkdir(binDir);
    const codexPath = path.join(binDir, "codex");
    await fs.writeFile(
      codexPath,
      `#!/usr/bin/env node
const providerError = JSON.stringify({
  type: "error",
  status: 400,
  error: {
    type: "invalid_request_error",
    message: "The 'gpt-5.6-sol' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again."
  }
});
process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "thread-upgrade-required" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "error", message: providerError }) + "\\n");
process.stdout.write(JSON.stringify({ type: "turn.failed", error: { message: providerError } }) + "\\n");
process.exitCode = 1;
`,
      "utf8",
    );
    await fs.chmod(codexPath, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
    try {
      const result = await run({ prompt: "hello", runDir });
      expect(result).toMatchObject({
        ok: false,
        reason: "codex-cli-upgrade-required",
        failure: {
          code: "codex-cli-upgrade-required",
          message: "Codex 版本过旧，无法运行模型 gpt-5.6-sol。请升级当前 Codex 后再重试。",
        },
      });
      if (result.ok) throw new Error("expected a classified Codex failure");
      expect(result.reason).not.toContain("invalid_request_error");
    } finally {
      process.env.PATH = previousPath;
    }
  });
});

describe("codex provider override", () => {
  it("builds a dedicated team-builder profile without ordinary --yolo or user configuration", () => {
    const common = {
      schemaPath: "/runtime/schema.json",
      isolatedCwd: "/runtime/workspace",
      developerInstructions: "Only design a team.",
      providerConfig: null,
      model: DEFAULT_CODEX_MODEL,
      effort: "high",
    };
    const full = buildTeamBuilderExecOptions({ ...common, mode: "full" });
    const resume = buildTeamBuilderExecOptions({ ...common, mode: "resume" });

    expect(full).toEqual(expect.arrayContaining([
      "--json",
      "--ignore-user-config",
      "--ignore-rules",
      "--output-schema",
      "/runtime/schema.json",
      "--sandbox",
      "read-only",
      "--cd",
      "/runtime/workspace",
      "--skip-git-repo-check",
    ]));
    expect(full).not.toContain("--yolo");
    expect(full).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(resume).toContain("--sandbox");
    expect(resume).toContain("read-only");
    expect(resume).toContain("--cd");
    expect(resume).toContain("/runtime/workspace");
    expect(resume).toContain("--skip-git-repo-check");
    expect(resume).not.toContain("--yolo");

    const resumeArgs = buildCodexArgs(
      "adjust the team",
      { kind: "resume", threadId: "team-thread" },
      [],
      resume,
    );
    expect(resumeArgs).toContain("--sandbox");
    expect(resumeArgs).toContain("--cd");
    expect(resumeArgs.indexOf("--sandbox")).toBeLessThan(resumeArgs.indexOf("resume"));
    expect(resumeArgs.indexOf("--cd")).toBeLessThan(resumeArgs.indexOf("resume"));
  });

  it("subscription baseline: null provider returns byte-for-byte equal to base flags with default model", () => {
    const baseline = [
      "--yolo",
      "--json",
      "-c",
      "agents.enabled=false",
      "-m",
      "gpt-5.6-sol",
      "-c",
      'service_tier="fast"',
      "-c",
      "features.fast_mode=true",
      "-c",
      'model_reasoning_effort="high"',
      "-c",
      'model_reasoning_summary="detailed"',
    ];
    expect(buildCodexExecOptionsBase(DEFAULT_CODEX_MODEL)).toEqual(baseline);
    expect(buildCodexExecOptions(null, DEFAULT_CODEX_MODEL)).toEqual(baseline);
    expect(resolveCodexProviderConfig({}, {})).toBeNull();
    expect(resolveCodexProviderConfig({ codex: {} }, {})).toBeNull();
    expect(resolveCodexProviderConfig({ codex: { provider: "" } }, {})).toBeNull();
    expect(resolveCodexProviderConfig({ codex: { provider: "   " } }, {})).toBeNull();
  });

  it("api mode appends exactly five provider overrides in order with literal base_url", () => {
    const cfg = resolveCodexProviderConfig(
      { codex: { provider: "tranfu" } },
      { TRANFU_API_KEY: "sk-xxx", TRANFU_BASE_URL: "https://api.tranfu.com/v1" },
    );
    expect(cfg).toEqual({ provider: "tranfu", baseUrl: "https://api.tranfu.com/v1" });

    const base = buildCodexExecOptionsBase(DEFAULT_CODEX_MODEL);
    const options = buildCodexExecOptions(cfg, DEFAULT_CODEX_MODEL);
    expect(options.slice(0, base.length)).toEqual(base);
    expect(options.slice(base.length)).toEqual([
      "-c",
      "model_provider=tranfu",
      "-c",
      "model_providers.tranfu.name=tranfu",
      "-c",
      "model_providers.tranfu.base_url=https://api.tranfu.com/v1",
      "-c",
      "model_providers.tranfu.env_key=TRANFU_API_KEY",
      "-c",
      "model_providers.tranfu.wire_api=responses",
    ]);
    // NEVER 允许把 key 值本身写进任何 argv 项。
    expect(options.every((entry) => !entry.includes("sk-xxx"))).toBe(true);
    // base_url MUST 是字面 URL，不能是 shell 变量占位符。
    expect(options.some((entry) => entry.includes("${TRANFU_BASE_URL}"))).toBe(false);
  });

  it("throws a visible error naming missing env variables and never returns", () => {
    expect(() =>
      resolveCodexProviderConfig({ codex: { provider: "tranfu" } }, { TRANFU_API_KEY: "sk-xxx" }),
    ).toThrow(/TRANFU_BASE_URL/);
    expect(() =>
      resolveCodexProviderConfig({ codex: { provider: "tranfu" } }, { TRANFU_BASE_URL: "https://api.tranfu.com/v1" }),
    ).toThrow(/TRANFU_API_KEY/);
    expect(() => resolveCodexProviderConfig({ codex: { provider: "tranfu" } }, {})).toThrow(
      /TRANFU_API_KEY.*TRANFU_BASE_URL/,
    );
    // 命名约定：provider name uppercase 得到 env 变量前缀。
    expect(() => resolveCodexProviderConfig({ codex: { provider: "derouter" } }, {})).toThrow(
      /DEROUTER_API_KEY.*DEROUTER_BASE_URL/,
    );
  });
});

describe("codex model override", () => {
  it("defaults to gpt-5.6-sol when [codex] is absent or model is unset/blank", () => {
    expect(DEFAULT_CODEX_MODEL).toBe("gpt-5.6-sol");
    expect(resolveCodexModel({})).toBe("gpt-5.6-sol");
    expect(resolveCodexModel({ codex: {} })).toBe("gpt-5.6-sol");
    expect(resolveCodexModel({ codex: { model: "" } })).toBe("gpt-5.6-sol");
    expect(resolveCodexModel({ codex: { model: "   " } })).toBe("gpt-5.6-sol");
  });

  it("uses the trimmed non-empty [codex].model literal as the -m value", () => {
    expect(resolveCodexModel({ codex: { model: "gpt-5.6-sol-preview" } })).toBe("gpt-5.6-sol-preview");
    expect(resolveCodexModel({ codex: { model: "  gpt-5.5  " } })).toBe("gpt-5.5");
    const options = buildCodexExecOptions(null, "gpt-5.6-sol-preview");
    const mIndex = options.indexOf("-m");
    expect(mIndex).toBeGreaterThanOrEqual(0);
    expect(options[mIndex + 1]).toBe("gpt-5.6-sol-preview");
  });

  it("provider and model are independent: both apply without interaction", () => {
    const cfg = resolveCodexProviderConfig(
      { codex: { provider: "tranfu", model: "gpt-5.6-sol-preview" } },
      { TRANFU_API_KEY: "sk-xxx", TRANFU_BASE_URL: "https://api.tranfu.com/v1" },
    );
    const model = resolveCodexModel({ codex: { provider: "tranfu", model: "gpt-5.6-sol-preview" } });
    expect(model).toBe("gpt-5.6-sol-preview");
    const options = buildCodexExecOptions(cfg, model);
    const base = buildCodexExecOptionsBase("gpt-5.6-sol-preview");
    expect(options.slice(0, base.length)).toEqual(base);
    expect(options.slice(base.length)).toEqual([
      "-c",
      "model_provider=tranfu",
      "-c",
      "model_providers.tranfu.name=tranfu",
      "-c",
      "model_providers.tranfu.base_url=https://api.tranfu.com/v1",
      "-c",
      "model_providers.tranfu.env_key=TRANFU_API_KEY",
      "-c",
      "model_providers.tranfu.wire_api=responses",
    ]);
  });

  it("parseLocalConfig rejects non-string [codex].model", () => {
    expect(() => parseLocalConfig(`[codex]\nmodel = 123\n`, "test")).toThrow(/Invalid local config shape/);
    expect(() => parseLocalConfig(`[codex]\nmodel = true\n`, "test")).toThrow(/Invalid local config shape/);
  });

  it("parseLocalConfig rejects unknown keys under [codex] (regression on shape whitelist)", () => {
    expect(() => parseLocalConfig(`[codex]\nextra = "x"\n`, "test")).toThrow(/Invalid local config shape/);
  });

  it("parseLocalConfig accepts model alone, provider alone, and both together", () => {
    const modelOnly = parseLocalConfig(`[codex]\nmodel = "gpt-5.6-sol-preview"\n`, "test");
    expect(modelOnly.codex).toEqual({ model: "gpt-5.6-sol-preview" });

    const providerOnly = parseLocalConfig(`[codex]\nprovider = "tranfu"\n`, "test");
    expect(providerOnly.codex).toEqual({ provider: "tranfu" });

    const both = parseLocalConfig(`[codex]\nprovider = "tranfu"\nmodel = "gpt-5.6-sol-preview"\n`, "test");
    expect(both.codex).toEqual({ provider: "tranfu", model: "gpt-5.6-sol-preview" });
  });
});

describe("createRunWatchdogs", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires idle once after the idle window elapses without activity", () => {
    vi.useFakeTimers();
    const fired: string[] = [];
    createRunWatchdogs({ idleTimeoutMs: 1_000, onTimeout: (kind) => fired.push(kind) });

    vi.advanceTimersByTime(999);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(fired).toEqual(["idle"]);
    vi.advanceTimersByTime(10_000);
    expect(fired).toEqual(["idle"]);
  });

  it("resets the idle countdown on every activity", () => {
    vi.useFakeTimers();
    const fired: string[] = [];
    const watchdogs = createRunWatchdogs({ idleTimeoutMs: 1_000, onTimeout: (kind) => fired.push(kind) });

    for (let i = 0; i < 5; i += 1) {
      vi.advanceTimersByTime(900);
      watchdogs.recordActivity();
    }
    expect(fired).toEqual([]);

    vi.advanceTimersByTime(1_000);
    expect(fired).toEqual(["idle"]);
  });

  it("uses a wider tool deadline in flight and restarts idle after it finishes", () => {
    vi.useFakeTimers();
    const fired: string[] = [];
    const watchdogs = createRunWatchdogs({
      idleTimeoutMs: 1_000,
      toolTimeoutMs: 5_000,
      onTimeout: (kind) => fired.push(kind),
    });

    vi.advanceTimersByTime(900);
    watchdogs.setToolInFlight(true);
    vi.advanceTimersByTime(4_000);
    expect(fired).toEqual([]);

    watchdogs.setToolInFlight(false);
    vi.advanceTimersByTime(999);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(fired).toEqual(["idle"]);
  });

  it("fires the dedicated tool deadline when an in-flight tool never finishes", () => {
    vi.useFakeTimers();
    const fired: string[] = [];
    const watchdogs = createRunWatchdogs({
      idleTimeoutMs: 1_000,
      toolTimeoutMs: 5_000,
      onTimeout: (kind) => fired.push(kind),
    });

    watchdogs.setToolInFlight(true);
    vi.advanceTimersByTime(4_999);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(fired).toEqual(["tool"]);
  });

  it("fires max-duration regardless of activity", () => {
    vi.useFakeTimers();
    const fired: string[] = [];
    const watchdogs = createRunWatchdogs({
      idleTimeoutMs: 1_000,
      maxDurationMs: 3_000,
      onTimeout: (kind) => fired.push(kind),
    });

    for (let i = 0; i < 6; i += 1) {
      vi.advanceTimersByTime(500);
      watchdogs.recordActivity();
    }
    expect(fired).toEqual(["max-duration"]);
  });

  it("never fires after clear", () => {
    vi.useFakeTimers();
    const fired: string[] = [];
    const watchdogs = createRunWatchdogs({
      idleTimeoutMs: 1_000,
      maxDurationMs: 3_000,
      onTimeout: (kind) => fired.push(kind),
    });

    watchdogs.clear();
    vi.advanceTimersByTime(10_000);
    expect(fired).toEqual([]);
  });
});

describe("codexTimeoutKind", () => {
  it("classifies watchdog reasons and rejects everything else", () => {
    expect(codexTimeoutKind("idle-timeout:600000ms")).toBe("idle");
    expect(codexTimeoutKind("tool-timeout:1800000ms")).toBe("tool");
    expect(codexTimeoutKind("max-duration-timeout:7200000ms")).toBe("max-duration");
    expect(codexTimeoutKind("interrupted:new-message")).toBeNull();
    expect(codexTimeoutKind("exit-code-1")).toBeNull();
  });
});

describe("run watchdogs", () => {
  it("does not idle-timeout a command that runs longer than the idle window", async () => {
    // These compressed timings assert ordering, not wall-clock performance:
    // the tool outlives the 2s idle deadline but finishes before the 5s tool deadline.
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-codex-test-"));
    const binDir = path.join(tempDir, "bin");
    const runDir = path.join(tempDir, "run");
    await fs.mkdir(binDir);
    const codexPath = path.join(binDir, "codex");
    await fs.writeFile(
      codexPath,
      `#!/usr/bin/env node
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
emit({ type: "thread.started", thread_id: "long-tool-thread" });
emit({ type: "item.started", item: { id: "command-1", type: "command_execution" } });
setTimeout(() => {
  emit({ type: "item.completed", item: { id: "command-1", type: "command_execution" } });
  emit({ type: "item.completed", item: { type: "agent_message", text: "LONG_TOOL_SUCCESS" } });
  emit({ type: "turn.completed", usage: { cached_input_tokens: 0 } });
}, 2_500);
`,
      "utf8",
    );
    await fs.chmod(codexPath, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
    try {
      const result = await run({
        prompt: "run a long tool",
        runDir,
        idleTimeoutMs: 2_000,
        toolTimeoutMs: 5_000,
        interruptTerminationDelayMs: 10,
        interruptKillDelayMs: 10,
      });
      expect(result).toMatchObject({
        ok: true,
        finalText: "LONG_TOOL_SUCCESS",
      });
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("settles a dropped overlong command completion at turn.completed and still returns the final message", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-codex-test-"));
    const binDir = path.join(tempDir, "bin");
    const runDir = path.join(tempDir, "run");
    await fs.mkdir(binDir);
    const codexPath = path.join(binDir, "codex");
    await fs.writeFile(
      codexPath,
      `#!/usr/bin/env node
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
emit({ type: "thread.started", thread_id: "overlong-tool-thread" });
emit({ type: "item.started", item: { id: "overlong-command", type: "command_execution", command: "acceptance-overlong-tool" } });
setTimeout(() => {
  process.stdout.write(JSON.stringify({
    type: "item.completed",
    item: {
      id: "overlong-command",
      type: "command_execution",
      command: "acceptance-overlong-tool",
      output: "x".repeat(1024 * 1024)
    }
  }) + "\\n");
  emit({ type: "item.completed", item: { type: "agent_message", text: "OVERLONG_TOOL_SUCCESS" } });
  emit({ type: "turn.completed" });
  setTimeout(() => {}, 1_000);
}, 50);
`,
      "utf8",
    );
    await fs.chmod(codexPath, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
    const progressKinds: string[] = [];
    try {
      const result = await run({
        prompt: "run an overlong command and continue",
        runDir,
        idleTimeoutMs: 2_000,
        toolTimeoutMs: 500,
        interruptTerminationDelayMs: 10,
        interruptKillDelayMs: 10,
        onExecutionProgress: (event) => progressKinds.push(event.kind),
      });
      expect(result).toMatchObject({
        ok: true,
        finalText: "OVERLONG_TOOL_SUCCESS",
      });
      if (!result.ok) throw new Error("expected the overlong command run to complete");
      expect(progressKinds.filter((kind) => kind === "tool-finished")).toEqual([]);
      await expect(fs.readFile(result.stderrPath, "utf8")).resolves.toContain(
        "codex-jsonl-line-too-large",
      );
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("does not treat an empty turn.completed body as a successful run", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-codex-test-"));
    const binDir = path.join(tempDir, "bin");
    const runDir = path.join(tempDir, "run");
    await fs.mkdir(binDir);
    const codexPath = path.join(binDir, "codex");
    await fs.writeFile(
      codexPath,
      `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "empty-turn-thread" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "turn.completed" }) + "\\n");
`,
      "utf8",
    );
    await fs.chmod(codexPath, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
    try {
      await expect(run({ prompt: "return no final message", runDir })).resolves.toMatchObject({
        ok: false,
        reason: "no-final-message",
        terminal: { kind: "crashed", safeCode: "codex-no-complete-result" },
      });
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("does not settle an in-flight tool when the provider emits turn.failed", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-codex-test-"));
    const binDir = path.join(tempDir, "bin");
    const runDir = path.join(tempDir, "run");
    await fs.mkdir(binDir);
    const codexPath = path.join(binDir, "codex");
    await fs.writeFile(
      codexPath,
      `#!/usr/bin/env node
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
emit({ type: "thread.started", thread_id: "failed-turn-thread" });
emit({ type: "item.started", item: { id: "failed-command", type: "command_execution", command: "acceptance-failed-tool" } });
emit({ type: "turn.failed", error: { message: "provider failed" } });
setInterval(() => {}, 1_000);
`,
      "utf8",
    );
    await fs.chmod(codexPath, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
    try {
      await expect(run({
        prompt: "run a failed tool",
        runDir,
        idleTimeoutMs: 1_000,
        toolTimeoutMs: 100,
        interruptTerminationDelayMs: 10,
        interruptKillDelayMs: 10,
      })).resolves.toMatchObject({
        ok: false,
        reason: "tool-timeout:100ms",
        terminal: { kind: "timeout", basis: "tool" },
      });
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("stops a command that remains in flight past the tool deadline", async () => {
    // This fake tool never completes, so it must outlive the 3s tool deadline
    // after idle supervision has been suspended.
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-codex-test-"));
    const binDir = path.join(tempDir, "bin");
    const runDir = path.join(tempDir, "run");
    await fs.mkdir(binDir);
    const codexPath = path.join(binDir, "codex");
    await fs.writeFile(
      codexPath,
      `#!/usr/bin/env node
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
emit({ type: "thread.started", thread_id: "hung-tool-thread" });
emit({ type: "item.started", item: { type: "command_execution", command: "git push" } });
setInterval(() => {}, 1000);
`,
      "utf8",
    );
    await fs.chmod(codexPath, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
    try {
      await expect(run({
        prompt: "run a hung tool",
        runDir,
        idleTimeoutMs: 2_000,
        toolTimeoutMs: 3_000,
        interruptTerminationDelayMs: 10,
        interruptKillDelayMs: 10,
      })).resolves.toMatchObject({
        ok: false,
        reason: "tool-timeout:3000ms",
        terminal: { kind: "timeout", basis: "tool" },
      });
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("kills a silent codex process and returns idle-timeout", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-codex-test-"));
    const binDir = path.join(tempDir, "bin");
    const runDir = path.join(tempDir, "run");
    await fs.mkdir(binDir);
    const codexPath = path.join(binDir, "codex");
    await fs.writeFile(
      codexPath,
      `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "agent_message", message: "warming up" }) + "\\n");
setInterval(() => {}, 1000);
`,
      "utf8",
    );
    await fs.chmod(codexPath, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
    try {
      const result = await run({
        prompt: "hello",
        runDir,
        idleTimeoutMs: 100,
        interruptTerminationDelayMs: 10,
        interruptKillDelayMs: 10,
      });

      expect(result.ok).toBe(false);
      expect(isInterruptedCodexRunResult(result)).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("idle-timeout:100ms");
      }
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("caps a still-running process with max-duration before the idle deadline", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-codex-test-"));
    const binDir = path.join(tempDir, "bin");
    const runDir = path.join(tempDir, "run");
    await fs.mkdir(binDir);
    const codexPath = path.join(binDir, "codex");
    await fs.writeFile(
      codexPath,
      `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "command_execution" } }) + "\\n");
setInterval(() => {
  process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "command_execution" } }) + "\\n");
}, 50);
`,
      "utf8",
    );
    await fs.chmod(codexPath, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
    try {
      const result = await run({
        prompt: "hello",
        runDir,
        idleTimeoutMs: 2_000,
        maxDurationMs: 800,
        interruptTerminationDelayMs: 10,
        interruptKillDelayMs: 10,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("max-duration-timeout:800ms");
      }
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("settles in bounded time even when a grandchild keeps the stdio pipes open", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-codex-test-"));
    const binDir = path.join(tempDir, "bin");
    const runDir = path.join(tempDir, "run");
    await fs.mkdir(binDir);
    const codexPath = path.join(binDir, "codex");
    // codex 假进程无视温和信号，并派生一个持有继承 stdio 管道的孙进程：
    // SIGKILL 杀掉 codex 后 close 事件因孙进程持管道而不触发，验证强制 settle 兜底。
    await fs.writeFile(
      codexPath,
      `#!/usr/bin/env node
const { spawn } = require("node:child_process");
spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 3000)"], {
  stdio: ["ignore", "inherit", "inherit"],
  detached: true,
});
process.on("SIGINT", () => {});
process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
`,
      "utf8",
    );
    await fs.chmod(codexPath, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
    try {
      const startedAt = Date.now();
      const result = await run({
        prompt: "hello",
        runDir,
        idleTimeoutMs: 100,
        interruptTerminationDelayMs: 10,
        interruptKillDelayMs: 10,
      });

      expect(Date.now() - startedAt).toBeLessThan(2_000);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("idle-timeout:100ms");
      }
    } finally {
      process.env.PATH = previousPath;
    }
  });
});
