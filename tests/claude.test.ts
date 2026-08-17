import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildClaudeArgs,
  buildClaudeEnvironment,
  CLAUDE_INTERNAL_AGENT_TOOLS,
  classifyClaudeResult,
  runClaude,
} from "../src/claude.js";
import {
  isClaudeThinkingDisplaySupported,
  isSupportedClaudeCliVersion,
  parseClaudeCliVersion,
} from "../src/claude-cli-version.js";
import {
  resolveClaudeExecutable,
} from "../src/claude-executable.js";
import { createLocalExecutionRunner } from "../src/local-console/execution-driver.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })));
});

describe("Claude CLI version and executable contracts", () => {
  it("parses the official version output and applies the 2.1.170 floor", () => {
    expect(parseClaudeCliVersion("2.1.220 (Claude Code)")).toEqual({
      major: 2,
      minor: 1,
      patch: 220,
    });
    expect(isSupportedClaudeCliVersion("2.1.170 (Claude Code)")).toBe(true);
    expect(isSupportedClaudeCliVersion("2.1.169 (Claude Code)")).toBe(false);
    expect(isSupportedClaudeCliVersion("not-a-version")).toBe(false);
  });

  it("gates the thinking-display flag on its own measured floor without raising the global minimum", () => {
    expect(isClaudeThinkingDisplaySupported("2.1.222 (Claude Code)")).toBe(true);
    expect(isClaudeThinkingDisplaySupported("2.1.221 (Claude Code)")).toBe(false);
    expect(isClaudeThinkingDisplaySupported("2.1.170 (Claude Code)")).toBe(false);
    expect(isClaudeThinkingDisplaySupported("not-a-version")).toBe(false);
  });

  it("keeps PATH-first resolution and only falls back when PATH has no candidate", async () => {
    const root = await makeTempRoot();
    const first = path.join(root, "first");
    const fallback = path.join(root, "home", ".local", "bin");
    await fs.mkdir(first, { recursive: true });
    await fs.mkdir(fallback, { recursive: true });
    await executable(path.join(first, "claude"), "#!/bin/sh\nexit 0\n");
    await executable(path.join(fallback, "claude"), "#!/bin/sh\nexit 0\n");

    await expect(resolveClaudeExecutable({
      pathValue: first,
      cwd: root,
      homeDir: path.join(root, "home"),
    })).resolves.toBe(path.join(first, "claude"));
    await fs.rm(path.join(first, "claude"));
    await expect(resolveClaudeExecutable({
      pathValue: first,
      cwd: root,
      homeDir: path.join(root, "home"),
    })).resolves.toBe(path.join(fallback, "claude"));
  });

  it("does not skip a present but non-executable PATH candidate", async () => {
    const root = await makeTempRoot();
    const first = path.join(root, "first");
    const second = path.join(root, "second");
    await fs.mkdir(first, { recursive: true });
    await fs.mkdir(second, { recursive: true });
    await fs.writeFile(path.join(first, "claude"), "blocked", { mode: 0o644 });
    await executable(path.join(second, "claude"), "#!/bin/sh\nexit 0\n");

    await expect(resolveClaudeExecutable({
      pathValue: [first, second].join(path.delimiter),
      cwd: root,
      homeDir: path.join(root, "home"),
    })).rejects.toMatchObject({
      code: "claude-cli-not-executable",
    });
  });
});

describe("Claude ordinary Agent protocol", () => {
  it("hard-routes a frozen Claude profile without invoking Codex or Kimi", async () => {
    const codex = vi.fn();
    const kimi = vi.fn();
    const claude = vi.fn(async (options: Parameters<typeof runClaude>[0]) => {
      const sessionId = options.mode.kind === "resume"
        ? options.mode.externalSessionId
        : "11111111-1111-4111-8111-111111111111";
      await options.onSessionStarted?.(sessionId);
      return {
        ok: true as const,
        finalText: "done",
        threadId: sessionId,
        cachedInputTokens: null,
        runDir: options.runDir,
        stdoutPath: `${options.runDir}/stdout`,
        stderrPath: `${options.runDir}/stderr`,
      };
    });
    const runner = createLocalExecutionRunner({
      runCodex: codex,
      runClaude: claude,
      runKimi: kimi,
    });
    const sessions: unknown[] = [];
    const result = await runner({
      prompt: "work",
      runDir: "/tmp/run",
      cwd: "/tmp",
      profile: { cli: "claude", model: "fable", effort: "xhigh" },
      mode: { kind: "full" },
      onSessionStarted: (session) => {
        sessions.push(session);
      },
    });
    expect(result).toMatchObject({ ok: true, finalText: "done" });
    expect(claude).toHaveBeenCalledOnce();
    expect(claude.mock.calls[0]![0]).toMatchObject({
      profile: { cli: "claude", model: "fable", effort: "xhigh" },
      mode: { kind: "full" },
    });
    expect(codex).not.toHaveBeenCalled();
    expect(kimi).not.toHaveBeenCalled();
    expect(sessions).toEqual([{
      engine: "claude",
      externalSessionId: "11111111-1111-4111-8111-111111111111",
    }]);
  });

  it("builds the exact native-config argv and strips team/effort environment overrides", () => {
    const args = buildClaudeArgs({
      prompt: "hello",
      runDir: "/tmp/run",
      profile: { cli: "claude", model: "sonnet", effort: "high" },
      mode: { kind: "full" },
    }, "11111111-1111-4111-8111-111111111111");
    expect(args).toEqual(expect.arrayContaining([
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--session-id", "11111111-1111-4111-8111-111111111111",
      "--model", "sonnet",
      "--effort", "high",
      "--permission-mode", "auto",
      "--disallowedTools", CLAUDE_INTERNAL_AGENT_TOOLS.join(","),
    ]));
    for (const forbiddenFlag of [
      "--safe-mode",
      "--setting-sources",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--tools",
      "--continue",
      "--forward-subagent-text",
    ]) {
      expect(args).not.toContain(forbiddenFlag);
    }
    expect(args.at(-2)).toBe("--");
    expect(args.at(-1)).toBe("hello");

    const env = buildClaudeEnvironment({
      CLAUDE_CODE_EFFORT_LEVEL: "low",
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      CLAUDE_AUTO_BACKGROUND_TASKS: "1",
      CLAUDE_CODE_FORWARD_SUBAGENT_TEXT: "1",
      KEEP_ME: "yes",
    });
    expect(env).toMatchObject({
      KEEP_ME: "yes",
      CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
    });
    expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
    expect(env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBeUndefined();
    expect(env.CLAUDE_AUTO_BACKGROUND_TASKS).toBeUndefined();
    expect(env.CLAUDE_CODE_FORWARD_SUBAGENT_TEXT).toBeUndefined();
  });

  it("classifies only machine-readable error codes into safe public failures", () => {
    expect(classifyClaudeResult({
      type: "result",
      subtype: "error",
      is_error: true,
      error: { code: "authentication_required" },
    })).toMatchObject({ code: "claude-auth-required" });
    expect(classifyClaudeResult({
      type: "result",
      subtype: "error",
      is_error: true,
      errors: [{ type: "rate_limit_error" }],
    })).toMatchObject({ code: "claude-rate-limited" });
    expect(classifyClaudeResult({
      type: "result",
      subtype: "error",
      is_error: true,
      code: "invalid_model",
    })).toMatchObject({ code: "claude-profile-invalid" });
    expect(classifyClaudeResult({
      type: "result",
      subtype: "error",
      is_error: true,
      error: { code: "permission_denied" },
    })).toMatchObject({ code: "claude-permission-denied" });
    expect(classifyClaudeResult({
      type: "result",
      subtype: "error",
      is_error: true,
      error: { code: "billing_error" },
    })).toMatchObject({ code: "claude-billing-unavailable" });
    expect(classifyClaudeResult({
      type: "result",
      subtype: "error",
      is_error: true,
      error: { code: "session_not_found" },
    })).toMatchObject({ code: "claude-resume-unavailable" });
    expect(classifyClaudeResult({
      type: "result",
      subtype: "error",
      is_error: true,
      result: "secret raw provider text",
    })).toEqual({
      code: "claude-service-unavailable",
      message: "Claude Code 本次执行失败，请稍后重试。",
    });
  });

  it("streams only text deltas after a matching init and preserves the session on resume", async () => {
    const fixture = await makeFakeClaude(`
const args = process.argv.slice(2);
const read = (flag) => args[args.indexOf(flag) + 1];
const session = args.includes("--resume") ? read("--resume") : read("--session-id");
console.log(JSON.stringify({type:"system",subtype:"init",session_id:session,tools:["Read","Glob"]}));
console.log(JSON.stringify({type:"stream_event",event:{type:"content_block_delta",delta:{type:"thinking_delta",thinking:"secret"}}}));
console.log(JSON.stringify({type:"stream_event",parent_tool_use_id:"agent-1",event:{type:"content_block_delta",delta:{type:"text_delta",text:"hidden"}}}));
console.log(JSON.stringify({type:"stream_event",event:{type:"content_block_delta",delta:{type:"text_delta",text:"Hello"}}}));
console.log(JSON.stringify({type:"stream_event",event:{type:"content_block_delta",delta:{type:"text_delta",text:" world"}}}));
console.log(JSON.stringify({type:"result",subtype:"success",session_id:session,result:"Hello world"}));
`);
    const visible: string[] = [];
    const sessions: string[] = [];
    const full = await runFixture(fixture, {
      onVisibleAgentMarkdown: (text) => visible.push(text),
      onSessionStarted: (sessionId) => {
        sessions.push(sessionId);
      },
    });
    expect(full).toMatchObject({ ok: true, finalText: "Hello world" });
    expect(visible).toEqual(["Hello", "Hello world"]);
    expect(sessions).toHaveLength(1);

    const sessionId = sessions[0]!;
    const resumed = await runFixture(fixture, {
      mode: { kind: "resume", externalSessionId: sessionId },
    });
    expect(resumed).toMatchObject({
      ok: true,
      threadId: sessionId,
      finalText: "Hello world",
    });
  });

  it("keeps idle suspended from tool_use through the later tool_result", async () => {
    const fixture = await makeFakeClaude(`
const session = process.argv[process.argv.indexOf("--session-id")+1];
const emit = (value) => console.log(JSON.stringify(value));
emit({type:"system",subtype:"init",session_id:session,tools:["Bash"]});
emit({type:"stream_event",event:{type:"content_block_start",index:0,content_block:{type:"tool_use",id:"tool-long",name:"Bash"}}});
emit({type:"stream_event",event:{type:"content_block_stop",index:0}});
setTimeout(() => {
  emit({type:"user",message:{content:[{type:"tool_result",tool_use_id:"tool-long",content:"done"}]}});
  emit({type:"result",subtype:"success",session_id:session,result:"LONG_TOOL_SUCCESS"});
}, 2200);
`);
    const progress: Array<{ kind: string }> = [];
    const result = await runFixture(fixture, {
      idleTimeoutMs: 1_500,
      toolTimeoutMs: 3_000,
      interruptTerminationDelayMs: 10,
      interruptKillDelayMs: 10,
      onExecutionProgress: (event) => progress.push(event),
    });
    expect(result).toMatchObject({
      ok: true,
      finalText: "LONG_TOOL_SUCCESS",
    });
    expect(progress.map((event) => event.kind)).toContain("tool-started");
    expect(progress.map((event) => event.kind)).toContain("tool-finished");
  });

  it("stops a tool_use that never produces a tool_result", async () => {
    const fixture = await makeFakeClaude(`
const session = process.argv[process.argv.indexOf("--session-id")+1];
const emit = (value) => console.log(JSON.stringify(value));
emit({type:"system",subtype:"init",session_id:session,tools:["Bash"]});
emit({type:"stream_event",event:{type:"content_block_start",index:0,content_block:{type:"tool_use",id:"tool-hung",name:"Bash"}}});
emit({type:"stream_event",event:{type:"content_block_stop",index:0}});
setInterval(() => {}, 1000);
`);
    await expect(runFixture(fixture, {
      idleTimeoutMs: 1_500,
      toolTimeoutMs: 2_000,
      interruptTerminationDelayMs: 10,
      interruptKillDelayMs: 10,
    })).resolves.toMatchObject({
      ok: false,
      reason: "claude-timeout",
      terminal: { kind: "timeout", basis: "tool" },
    });
  });

  it("fails closed before a session link for forbidden tools or a mismatched id", async () => {
    const forbidden = await makeFakeClaude(`
console.log(JSON.stringify({type:"system",subtype:"init",session_id:process.argv[process.argv.indexOf("--session-id")+1],tools:["Read","Agent"]}));
setTimeout(() => {}, 10000);
`);
    const onSessionStarted = vi.fn();
    const forbiddenResult = await runFixture(forbidden, {
      onSessionStarted,
      interruptTerminationDelayMs: 5,
      interruptKillDelayMs: 5,
    });
    expect(forbiddenResult).toMatchObject({
      ok: false,
      reason: "claude-protocol-invalid",
    });
    expect(onSessionStarted).not.toHaveBeenCalled();

    const mismatch = await makeFakeClaude(`
console.log(JSON.stringify({type:"system",subtype:"init",session_id:"wrong",tools:["Read"]}));
setTimeout(() => {}, 10000);
`);
    const mismatchResult = await runFixture(mismatch, {
      interruptTerminationDelayMs: 5,
      interruptKillDelayMs: 5,
    });
    expect(mismatchResult).toMatchObject({
      ok: false,
      reason: "claude-protocol-invalid",
    });
    expect(mismatchResult).not.toHaveProperty("threadId");
  });

  it("requires a verifiable init inventory and exact terminal session id", async () => {
    const missingInventory = await makeFakeClaude(`
const session = process.argv[process.argv.indexOf("--session-id")+1];
console.log(JSON.stringify({type:"system",subtype:"init",session_id:session}));
setTimeout(() => {}, 10000);
`);
    await expect(runFixture(missingInventory, {
      interruptTerminationDelayMs: 5,
      interruptKillDelayMs: 5,
    })).resolves.toMatchObject({
      ok: false,
      reason: "claude-protocol-invalid",
    });

    const terminalMismatch = await makeFakeClaude(`
const session = process.argv[process.argv.indexOf("--session-id")+1];
console.log(JSON.stringify({type:"system",subtype:"init",session_id:session,tools:["Read"]}));
console.log(JSON.stringify({type:"result",subtype:"success",session_id:"wrong",result:"hidden"}));
setTimeout(() => {}, 10000);
`);
    await expect(runFixture(terminalMismatch, {
      interruptTerminationDelayMs: 5,
      interruptKillDelayMs: 5,
    })).resolves.toMatchObject({
      ok: false,
      reason: "claude-protocol-invalid",
    });
  });

  it("fails closed on malformed and oversized JSONL without publishing provider output", async () => {
    const malformed = await makeFakeClaude(`
process.stdout.write("{broken}\\n");
setTimeout(() => {}, 10000);
`);
    const malformedVisible = vi.fn();
    await expect(runFixture(malformed, {
      onVisibleAgentMarkdown: malformedVisible,
      interruptTerminationDelayMs: 5,
      interruptKillDelayMs: 5,
    })).resolves.toMatchObject({
      ok: false,
      reason: "claude-protocol-invalid",
    });
    expect(malformedVisible).not.toHaveBeenCalled();

    const oversized = await makeFakeClaude(`
process.stdout.write("x".repeat(1024 * 1024 + 1));
setTimeout(() => {}, 10000);
`);
    const oversizedVisible = vi.fn();
    await expect(runFixture(oversized, {
      onVisibleAgentMarkdown: oversizedVisible,
      interruptTerminationDelayMs: 5,
      interruptKillDelayMs: 5,
    })).resolves.toMatchObject({
      ok: false,
      reason: "claude-protocol-invalid",
    });
    expect(oversizedVisible).not.toHaveBeenCalled();
  });

  it("hard-gates 2.1.169 before spawning print mode or linking a session", async () => {
    const spawnProcess = vi.fn();
    const onSessionStarted = vi.fn();
    const root = await makeTempRoot();
    const result = await runClaude({
      prompt: "never sent",
      runDir: path.join(root, "run"),
      cwd: root,
      profile: { cli: "claude", model: "fable", effort: "high" },
      mode: { kind: "full" },
      executablePath: "/trusted/claude",
      runVersion: async () => "2.1.169 (Claude Code)",
      spawnProcess,
      onSessionStarted,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "claude-cli-unsupported-version",
      failure: { action: "update-claude" },
    });
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(onSessionStarted).not.toHaveBeenCalled();
  });

  it("passes --thinking-display summarized only on CLIs at or above the measured floor", async () => {
    const root = await makeTempRoot();
    const argvLog = path.join(root, "argv.json");
    const fixture = await makeFakeClaude(`
const fs = require("node:fs");
const session = process.argv[process.argv.indexOf("--session-id")+1];
fs.writeFileSync(process.env.MOEBIUS_TEST_ARGV_LOG, JSON.stringify(process.argv));
console.log(JSON.stringify({type:"system",subtype:"init",session_id:session,tools:["Read"]}));
console.log(JSON.stringify({type:"result",session_id:session,result:"done",subtype:"success"}));
`);
    const previous = process.env.MOEBIUS_TEST_ARGV_LOG;
    process.env.MOEBIUS_TEST_ARGV_LOG = argvLog;
    try {
      await runClaude({
        prompt: "hello",
        runDir: path.join(root, "run-new"),
        cwd: root,
        profile: { cli: "claude", model: "sonnet", effort: "high" },
        mode: { kind: "full" },
        executablePath: fixture.executablePath,
        runVersion: async () => "2.1.222 (Claude Code)",
      });
      const newArgs = JSON.parse(await fs.readFile(argvLog, "utf8")) as string[];
      expect(newArgs).toContain("--thinking-display");
      expect(newArgs[newArgs.indexOf("--thinking-display") + 1]).toBe("summarized");

      await runClaude({
        prompt: "hello",
        runDir: path.join(root, "run-old"),
        cwd: root,
        profile: { cli: "claude", model: "sonnet", effort: "high" },
        mode: { kind: "full" },
        executablePath: fixture.executablePath,
        runVersion: async () => "2.1.170 (Claude Code)",
      });
      const oldArgs = JSON.parse(await fs.readFile(argvLog, "utf8")) as string[];
      expect(oldArgs).not.toContain("--thinking-display");
    } finally {
      if (previous === undefined) {
        delete process.env.MOEBIUS_TEST_ARGV_LOG;
      } else {
        process.env.MOEBIUS_TEST_ARGV_LOG = previous;
      }
    }
  });

  it("settles cancellation through bounded signal escalation", async () => {
    const fixture = await makeFakeClaude(`
const session = process.argv[process.argv.indexOf("--session-id")+1];
console.log(JSON.stringify({type:"system",subtype:"init",session_id:session,tools:["Read"]}));
setInterval(() => {}, 1000);
`);
    const controller = new AbortController();
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const run = runFixture(fixture, {
      signal: controller.signal,
      onSessionStarted: () => resolveStarted(),
      interruptTerminationDelayMs: 10,
      interruptKillDelayMs: 10,
    });
    await started;
    controller.abort();
    await expect(run).resolves.toMatchObject({
      ok: false,
      reason: "claude-cancelled",
    });
  });

  it("escalates an ignored cancellation from SIGINT through SIGTERM to SIGKILL", async () => {
    const fixture = await makeFakeClaude(`
const fs = require("node:fs");
const path = require("node:path");
const session = process.argv[process.argv.indexOf("--session-id")+1];
const signalLog = path.join(process.cwd(), "signals.log");
process.on("SIGINT", () => fs.appendFileSync(signalLog, "SIGINT\\n"));
process.on("SIGTERM", () => fs.appendFileSync(signalLog, "SIGTERM\\n"));
console.log(JSON.stringify({type:"system",subtype:"init",session_id:session,tools:["Read"]}));
setInterval(() => {}, 1000);
`);
    const controller = new AbortController();
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const run = runFixture(fixture, {
      signal: controller.signal,
      onSessionStarted: () => resolveStarted(),
      interruptTerminationDelayMs: 30,
      interruptKillDelayMs: 30,
    });
    await started;
    controller.abort();
    await expect(run).resolves.toMatchObject({
      ok: false,
      reason: "claude-cancelled",
    });
    await expect(fs.readFile(path.join(fixture.root, "signals.log"), "utf8"))
      .resolves.toBe("SIGINT\nSIGTERM\n");
  });
});

async function runFixture(
  fixture: { root: string; executablePath: string },
  overrides: Partial<Parameters<typeof runClaude>[0]> = {},
) {
  return runClaude({
    prompt: "hello",
    runDir: path.join(fixture.root, `run-${Math.random().toString(16).slice(2)}`),
    cwd: fixture.root,
    profile: { cli: "claude", model: "sonnet", effort: "high" },
    mode: { kind: "full" },
    executablePath: fixture.executablePath,
    runVersion: async () => "2.1.220 (Claude Code)",
    ...overrides,
  });
}

async function makeFakeClaude(source: string): Promise<{ root: string; executablePath: string }> {
  const root = await makeTempRoot();
  const executablePath = path.join(root, "claude");
  await executable(executablePath, `#!/usr/bin/env node\n${source}`);
  return { root, executablePath };
}

async function executable(target: string, source: string): Promise<void> {
  await fs.writeFile(target, source, { mode: 0o755 });
  await fs.chmod(target, 0o755);
}

async function makeTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-claude-test-"));
  temporaryRoots.push(root);
  return root;
}
