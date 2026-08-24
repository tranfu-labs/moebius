import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildClaudeArgs,
  buildClaudeEnvironment,
  CLAUDE_INTERNAL_AGENT_TOOLS,
  ClaudeTuiRuntime,
  createClaudeTuiRunner,
  runClaude,
  type ClaudeTuiRuntimeOptions,
} from "../src/claude.js";
import {
  type ClaudeTuiLifecycleEvent,
  type ClaudeTuiLifecycleHandle,
} from "../src/claude-tui-lifecycle.js";
import type {
  ClaudeTuiPty,
  ClaudeTuiPtyExit,
  ClaudeTuiPtyFactory,
  ClaudeTuiPtySpawnOptions,
  ClaudeTuiTerminalData,
} from "../src/claude-tui-transport.js";
import { createLocalExecutionRunner } from "../src/local-console/execution-driver.js";
import { inspectTrustedJsonlCandidate } from "../src/trusted-jsonl.js";
import { waitForCondition, waitForValue } from "../src/testing/wait.js";

const roots: string[] = [];
const runtimes: ClaudeTuiRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(async (runtime) => await runtime.close()));
  await Promise.all(roots.splice(0).map(async (root) => await fs.rm(root, { recursive: true, force: true })));
});

describe("Claude interactive TUI adapter", () => {
  it("builds interactive native-config argv without print or stream-json flags", () => {
    const args = buildClaudeArgs({
      prompt: "must not become argv",
      runDir: "/tmp/run",
      profile: { cli: "claude", model: "sonnet", effort: "high" },
      mode: { kind: "full" },
    }, {
      sessionId: "11111111-1111-4111-8111-111111111111",
      settingsPath: "/tmp/run/lifecycle.json",
      mcpConfigPath: "/tmp/run/managed.json",
      cliVersion: "2.1.222 (Claude Code)",
    });

    expect(args).toEqual(expect.arrayContaining([
      "--session-id", "11111111-1111-4111-8111-111111111111",
      "--model", "sonnet",
      "--effort", "high",
      "--permission-mode", "auto",
      "--disallowedTools", CLAUDE_INTERNAL_AGENT_TOOLS.join(","),
      "--settings", "/tmp/run/lifecycle.json",
      "--mcp-config", "/tmp/run/managed.json",
      "--thinking-display", "summarized",
    ]));
    for (const forbidden of [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--",
      "must not become argv",
      "--safe-mode",
      "--setting-sources",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--tools",
    ]) {
      expect(args).not.toContain(forbidden);
    }

    const env = buildClaudeEnvironment({
      CLAUDE_CODE_EFFORT_LEVEL: "low",
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      CLAUDE_AUTO_BACKGROUND_TASKS: "1",
      CLAUDE_CODE_FORWARD_SUBAGENT_TEXT: "1",
      KEEP_ME: "yes",
    });
    expect(env).toMatchObject({ KEEP_ME: "yes", CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1" });
    expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
    expect(env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBeUndefined();
    expect(env.CLAUDE_AUTO_BACKGROUND_TASKS).toBeUndefined();
    expect(env.CLAUDE_CODE_FORWARD_SUBAGENT_TEXT).toBeUndefined();
    expect(CLAUDE_INTERNAL_AGENT_TOOLS).not.toContain("TeamCreate");
    expect(CLAUDE_INTERNAL_AGENT_TOOLS).not.toContain("TeamDelete");
  });

  it("hard-routes a frozen Claude profile without invoking Codex or Kimi", async () => {
    const codex = vi.fn();
    const kimi = vi.fn();
    const claude = vi.fn(async (options) => {
      await options.onSessionStarted?.("11111111-1111-4111-8111-111111111111");
      return {
        ok: true as const,
        finalText: "done",
        threadId: "11111111-1111-4111-8111-111111111111",
        cachedInputTokens: null,
        runDir: options.runDir,
        stdoutPath: `${options.runDir}/stdout`,
        stderrPath: `${options.runDir}/stderr`,
      };
    });
    const runner = createLocalExecutionRunner({ runCodex: codex, runClaude: claude, runKimi: kimi });
    const sessions: unknown[] = [];
    const result = await runner({
      prompt: "work",
      runDir: "/tmp/run",
      cwd: "/tmp",
      profile: { cli: "claude", model: "fable", effort: "xhigh" },
      mode: { kind: "full" },
      onSessionStarted: (session) => { sessions.push(session); },
    });

    expect(result).toMatchObject({ ok: true, finalText: "done" });
    expect(claude).toHaveBeenCalledOnce();
    expect(codex).not.toHaveBeenCalled();
    expect(kimi).not.toHaveBeenCalled();
    expect(sessions).toEqual([{
      engine: "claude",
      externalSessionId: "11111111-1111-4111-8111-111111111111",
    }]);
  });

  it("keeps one live PTY, writes only human input, and resolves final text only after Stop", async () => {
    const fixture = await createRuntimeFixture();
    const transcript = vi.fn(async () => fixture.nextTranscript());
    const runtime = fixture.runtime({ resolveTranscript: transcript });
    const runner = createClaudeTuiRunner(runtime);
    const onSessionStarted = vi.fn();
    const onProcessStarted = vi.fn();
    const onTerminalData = vi.fn();
    const runVersion = vi.fn(async () => "2.1.239 (Claude Code)");
    const firstRun = runner(fixture.options({
      prompt: "first human input",
      runVersion,
      onSessionStarted,
      onProcessStarted,
      onTerminalData,
    }));

    const first = await fixture.factory.firstPty();
    const sessionId = readArg(first.options.args, "--session-id");
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/iu);
    expect(first.options.args).not.toContain("-p");
    expect(first.options.args).not.toContain("--output-format");
    await waitForValue(() => first.writes.length === 1 ? first.writes : undefined, {
      describe: "first human input waits for the interactive Claude prompt",
      kind: "logic",
      snapshot: () => ({ writes: first.writes }),
    });
    expect(first.writes).toEqual(["first human input\r"]);
    expect(transcript).not.toHaveBeenCalled();
    expect(onProcessStarted).toHaveBeenCalledOnce();
    expect(onSessionStarted).toHaveBeenCalledWith(sessionId);
    onTerminalData.mockClear();
    const rawTerminalBytes = new Uint8Array([0x1b, 0x5b, 0x32, 0x4a, 0xff]);
    first.emitData(rawTerminalBytes);
    expect(onTerminalData).toHaveBeenCalledWith(rawTerminalBytes);
    expect(transcript).not.toHaveBeenCalled();

    fixture.lifecycle.emit(sessionId!, "turn-submitted");
    fixture.lifecycle.emit(sessionId!, "turn-stopped");
    await expect(firstRun).resolves.toMatchObject({
      ok: true,
      finalText: "FIRST_FINAL",
      threadId: sessionId,
    });
    expect(transcript).toHaveBeenCalledOnce();
    expect(first.kills).toEqual([]);

    const secondRun = runner(fixture.options({
      prompt: "second human input",
      mode: { kind: "resume", externalSessionId: sessionId! },
      runVersion,
      onSessionStarted,
      onProcessStarted,
    }));
    await waitForValue(() => first.writes.length === 2 ? first.writes : undefined, {
      describe: "second human input reaches the existing Claude PTY",
      kind: "logic",
      snapshot: () => ({ writes: first.writes, spawns: fixture.factory.spawnCalls.length }),
    });
    expect(first.writes).toEqual(["first human input\r", "second human input\r"]);
    expect(fixture.factory.spawnCalls).toHaveLength(1);
    expect(runVersion).toHaveBeenCalledOnce();
    fixture.lifecycle.emit(sessionId!, "turn-stopped");
    await expect(secondRun).resolves.toMatchObject({
      ok: true,
      finalText: "SECOND_FINAL",
      threadId: sessionId,
    });
    expect(transcript).toHaveBeenCalledTimes(2);
    expect(onProcessStarted).toHaveBeenCalledTimes(2);
  });

  it("follows persisted Claude activity before Stop and publishes no later records after Stop", async () => {
    const fixture = await createRuntimeFixture();
    let transcriptPath = "";
    let sourceReady = false;
    let sourceError: unknown = null;
    const sourceResolver = vi.fn(async ({ sessionId, cwd }: { sessionId: string; cwd: string }) => {
      try {
        const source = await createFollowerSource(fixture.root, sessionId, cwd);
        transcriptPath = source.filePath;
        sourceReady = true;
        return source.resolution;
      } catch (error) {
        sourceError = error;
        throw error;
      }
    });
    const structured = vi.fn();
    const progress = vi.fn();
    const runtime = fixture.runtime({ resolveTranscriptFollowerSource: sourceResolver });
    const running = createClaudeTuiRunner(runtime)(fixture.options({
      onStructuredActivity: structured,
      onExecutionProgress: progress,
    }));
    const pty = await fixture.factory.firstPty();
    const sessionId = readArg(pty.options.args, "--session-id")!;
    await waitForCondition(() => sourceReady, {
      describe: "Claude transcript follower resolves after the human task write",
      kind: "io",
      snapshot: () => ({
        resolverCalls: sourceResolver.mock.calls.length,
        sourceError: sourceError instanceof Error ? sourceError.message : sourceError,
        writes: pty.writes,
      }),
    });

    await appendTranscriptRecords(transcriptPath, [
      transcriptRecord(sessionId, fixture.root, "assistant", [
        { type: "thinking", thinking: "inspect the workspace" },
      ]),
      transcriptRecord(sessionId, fixture.root, "assistant", [
        { type: "tool_use", id: "runtime-tool-1", name: "Read", input: { file_path: "README.md" } },
      ]),
      transcriptRecord(sessionId, fixture.root, "user", [
        { type: "tool_result", tool_use_id: "runtime-tool-1", content: "done" },
      ]),
      transcriptRecord(sessionId, fixture.root, "assistant", [
        { type: "tool_use", id: "runtime-tool-2", name: "Bash", input: { command: "pnpm test" } },
      ]),
      transcriptRecord(sessionId, fixture.root, "user", [
        { type: "tool_result", tool_use_id: "runtime-tool-2", content: "done" },
      ]),
    ]);
    await waitForCondition(() => progress.mock.calls.length === 5, {
      describe: "Claude transcript thinking and tool lifecycle reach both live channels",
      kind: "io",
      snapshot: () => ({
        structured: structured.mock.calls.length,
        progress: progress.mock.calls.map(([event]) => (event as { kind: string }).kind),
      }),
    });
    expect(structured.mock.calls).toHaveLength(5);
    expect(progress.mock.calls.map(([event]) => (event as { kind: string }).kind)).toEqual([
      "reasoning-output",
      "tool-started",
      "tool-finished",
      "tool-started",
      "tool-finished",
    ]);
    expect(progress.mock.calls.map(([event]) => (event as { delta?: string }).delta)).toEqual([
      "inspect the workspace",
      undefined,
      undefined,
      undefined,
      undefined,
    ]);

    let settled = false;
    void running.then(() => { settled = true; });
    expect(settled).toBe(false);
    fixture.lifecycle.emit(sessionId, "turn-stopped");
    await expect(running).resolves.toMatchObject({ ok: true, finalText: "FIRST_FINAL" });

    const structuredCountAfterStop = structured.mock.calls.length;
    await appendTranscriptRecords(transcriptPath, [
      transcriptRecord(sessionId, fixture.root, "assistant", [
        { type: "thinking", thinking: "must not be observed after Stop" },
      ]),
    ]);
    const afterStopAt = Date.now();
    await waitForCondition(
      () => Date.now() - afterStopAt >= 250 && structured.mock.calls.length === structuredCountAfterStop,
      {
        describe: "stopped Claude transcript follower emits no later records",
        kind: "logic",
        timeoutMs: 1_000,
        snapshot: () => ({
          elapsedMs: Date.now() - afterStopAt,
          structured: structured.mock.calls.length,
        }),
      },
    );
  });

  it("keeps retrying a transcript source that appears after the PTY starts", async () => {
    const fixture = await createRuntimeFixture();
    let transcriptPath = "";
    let attempts = 0;
    const sourceResolver = vi.fn(async ({ sessionId, cwd }: { sessionId: string; cwd: string }) => {
      attempts += 1;
      if (attempts === 1) return { status: "unavailable" as const, reason: "not-found" as const };
      if (attempts === 2) return { status: "unavailable" as const, reason: "context-mismatch" as const };
      const source = await createFollowerSource(fixture.root, sessionId, cwd);
      transcriptPath = source.filePath;
      return source.resolution;
    });
    const structured = vi.fn();
    const runtime = fixture.runtime({ resolveTranscriptFollowerSource: sourceResolver });
    const running = createClaudeTuiRunner(runtime)(fixture.options({ onStructuredActivity: structured }));
    const pty = await fixture.factory.firstPty();
    const sessionId = readArg(pty.options.args, "--session-id")!;

    await waitForCondition(() => attempts >= 3 && transcriptPath.length > 0, {
      describe: "Claude follower retries until the delayed transcript appears",
      kind: "io",
      snapshot: () => ({ attempts, transcriptPath }),
    });
    await appendTranscriptRecords(transcriptPath, [
      transcriptRecord(sessionId, fixture.root, "assistant", [
        { type: "thinking", thinking: "appeared after startup" },
      ]),
    ]);
    await waitForCondition(() => structured.mock.calls.length === 1, {
      describe: "Claude follower observes a record after delayed source resolution",
      kind: "io",
      snapshot: () => ({ structured: structured.mock.calls.length }),
    });

    fixture.lifecycle.emit(sessionId, "turn-stopped");
    await expect(running).resolves.toMatchObject({ ok: true, finalText: "FIRST_FINAL" });
  });

  it("keeps the final result independent when the transcript follower loses its file", async () => {
    const fixture = await createRuntimeFixture();
    let transcriptPath = "";
    let sourceReady = false;
    let sourceError: unknown = null;
    const sourceResolver = vi.fn(async ({ sessionId, cwd }: { sessionId: string; cwd: string }) => {
      try {
        const source = await createFollowerSource(fixture.root, sessionId, cwd);
        transcriptPath = source.filePath;
        sourceReady = true;
        return source.resolution;
      } catch (error) {
        sourceError = error;
        throw error;
      }
    });
    const structured = vi.fn();
    const runtime = fixture.runtime({ resolveTranscriptFollowerSource: sourceResolver });
    const running = createClaudeTuiRunner(runtime)(fixture.options({
      onStructuredActivity: structured,
    }));
    const pty = await fixture.factory.firstPty();
    const sessionId = readArg(pty.options.args, "--session-id")!;
    await waitForCondition(() => sourceReady, {
      describe: "Claude transcript follower is ready before its source failure",
      kind: "io",
      snapshot: () => ({
        resolverCalls: sourceResolver.mock.calls.length,
        sourceError: sourceError instanceof Error ? sourceError.message : sourceError,
      }),
    });
    await appendTranscriptRecords(transcriptPath, [
      transcriptRecord(sessionId, fixture.root, "assistant", [
        { type: "thinking", thinking: "before source failure" },
      ]),
    ]);
    await waitForCondition(() => structured.mock.calls.length === 1, {
      describe: "Claude follower observes one record before replacement",
      kind: "io",
      snapshot: () => ({ structured: structured.mock.calls.length }),
    });

    const replacement = `${transcriptPath}.replacement`;
    await fs.rename(transcriptPath, replacement);
    await fs.writeFile(transcriptPath, "", "utf8");
    await appendTranscriptRecords(transcriptPath, [
      transcriptRecord(sessionId, fixture.root, "assistant", [
        { type: "thinking", thinking: "replacement must not be followed" },
      ]),
    ]);
    const structuredCountAfterFailure = structured.mock.calls.length;
    const afterFailureAt = Date.now();
    await waitForCondition(
      () => Date.now() - afterFailureAt >= 250 && structured.mock.calls.length === structuredCountAfterFailure,
      {
        describe: "failed Claude transcript follower stops without switching files",
        kind: "logic",
        timeoutMs: 1_000,
        snapshot: () => ({
          elapsedMs: Date.now() - afterFailureAt,
          structured: structured.mock.calls.length,
        }),
      },
    );

    fixture.lifecycle.emit(sessionId, "turn-stopped");
    await expect(running).resolves.toMatchObject({ ok: true, finalText: "FIRST_FINAL" });
  });

  it("submits a multiline human prompt with a separate PTY Enter key", async () => {
    const fixture = await createRuntimeFixture({ autoTerminalPrompt: false });
    const runtime = fixture.runtime();
    const runner = createClaudeTuiRunner(runtime);
    const running = runner(fixture.options({
      prompt: "first human line\nsecond human line",
    }));
    const pty = await fixture.factory.firstPty();
    const sessionId = readArg(pty.options.args, "--session-id")!;
    pty.emitData("\n❯ ");

    await waitForValue(() => pty.writes.length === 1 ? pty.writes : undefined, {
      describe: "multiline Claude prompt text reaches the same PTY before its submit key",
      kind: "logic",
      snapshot: () => ({ writes: pty.writes }),
    });
    expect(pty.writes).toEqual(["first human line\nsecond human line"]);
    pty.emitData("Claude rendered the multiline input");
    await waitForValue(() => pty.writes.length === 2 ? pty.writes : undefined, {
      describe: "multiline Claude prompt Enter follows the TUI redraw on the same PTY",
      kind: "logic",
      snapshot: () => ({ writes: pty.writes }),
    });
    expect(pty.writes).toEqual(["first human line\nsecond human line", "\r"]);

    fixture.lifecycle.emit(sessionId, "turn-stopped");
    await expect(running).resolves.toMatchObject({ ok: true, finalText: "FIRST_FINAL" });
  });

  it("submits a multiline resume prompt when terminal-ready is the only redraw", async () => {
    const fixture = await createRuntimeFixture();
    const runtime = fixture.runtime();
    const runner = createClaudeTuiRunner(runtime);
    const running = runner(fixture.options({
      prompt: "first human line\nsecond human line",
    }));
    const pty = await fixture.factory.firstPty();
    const sessionId = readArg(pty.options.args, "--session-id")!;

    await waitForValue(() => pty.writes.length === 2 ? pty.writes : undefined, {
      describe: "terminal-ready redraw submits a multiline Claude prompt without another data event",
      kind: "logic",
      snapshot: () => ({ writes: pty.writes }),
    });
    expect(pty.writes).toEqual(["first human line\nsecond human line", "\r"]);

    fixture.lifecycle.emit(sessionId, "turn-stopped");
    await expect(running).resolves.toMatchObject({ ok: true, finalText: "FIRST_FINAL" });
  });

  it("retries a transient transcript write gap only after Claude Stop", async () => {
    const fixture = await createRuntimeFixture();
    let attempts = 0;
    const transcript = vi.fn(async () => {
      attempts += 1;
      return attempts === 1
        ? { status: "unavailable" as const, reason: "no-final-assistant-message" as const }
        : fixture.nextTranscript();
    });
    const runtime = fixture.runtime({ resolveTranscript: transcript });
    const running = createClaudeTuiRunner(runtime)(fixture.options());
    const pty = await fixture.factory.firstPty();
    const sessionId = readArg(pty.options.args, "--session-id")!;
    await waitForValue(() => pty.writes.length === 1 ? pty.writes : undefined, {
      describe: "Claude prompt starts before its transient transcript retry",
      kind: "logic",
      snapshot: () => ({ writes: pty.writes }),
    });

    fixture.lifecycle.emit(sessionId, "turn-stopped");
    await expect(running).resolves.toMatchObject({ ok: true, finalText: "FIRST_FINAL", threadId: sessionId });
    expect(transcript).toHaveBeenCalledTimes(2);
  });

  it("does not retry a transcript identity or trusted-path failure after Stop", async () => {
    const fixture = await createRuntimeFixture();
    const transcript = vi.fn(async () => ({ status: "unavailable" as const, reason: "context-mismatch" as const }));
    const runtime = fixture.runtime({ resolveTranscript: transcript });
    const running = createClaudeTuiRunner(runtime)(fixture.options());
    const pty = await fixture.factory.firstPty();
    const sessionId = readArg(pty.options.args, "--session-id")!;
    await waitForValue(() => pty.writes.length === 1 ? pty.writes : undefined, {
      describe: "Claude prompt starts before its trusted-path failure",
      kind: "logic",
      snapshot: () => ({ writes: pty.writes }),
    });

    fixture.lifecycle.emit(sessionId, "turn-stopped");
    await expect(running).resolves.toMatchObject({ ok: false, reason: "claude-protocol-invalid" });
    expect(transcript).toHaveBeenCalledOnce();
  });

  it("uses exact --resume only after the idle generation has exited", async () => {
    const fixture = await createRuntimeFixture({ autoExitOnKill: true });
    const runtime = fixture.runtime({ terminationGraceMs: 1 });
    const runner = createClaudeTuiRunner(runtime);
    const firstRun = runner(fixture.options({ idleTimeoutMs: 5 }));
    const first = await fixture.factory.firstPty();
    const sessionId = readArg(first.options.args, "--session-id")!;
    await waitForValue(() => first.writes.length === 1 ? first.writes : undefined, {
      describe: "initial Claude task waits for the terminal prompt",
      kind: "logic",
      snapshot: () => ({ writes: first.writes }),
    });
    fixture.lifecycle.emit(sessionId, "turn-stopped");
    await expect(firstRun).resolves.toMatchObject({ ok: true, finalText: "FIRST_FINAL" });
    await waitForValue(() => first.kills.includes("SIGTERM") ? first.kills : undefined, {
      describe: "idle Claude PTY receives bounded termination",
      kind: "logic",
      snapshot: () => ({ kills: first.kills, spawnCount: fixture.factory.spawnCalls.length }),
    });

    const resumed = runner(fixture.options({
      prompt: "after idle",
      mode: { kind: "resume", externalSessionId: sessionId },
      idleTimeoutMs: 5,
    }));
    const second = await fixture.factory.ptyAt(1);
    expect(second.options.args).toEqual(expect.arrayContaining(["--resume", sessionId]));
    expect(second.options.args).not.toContain("--session-id");
    await waitForValue(() => second.writes.length === 1 ? second.writes : undefined, {
      describe: "resumed Claude task waits for the terminal prompt",
      kind: "logic",
      snapshot: () => ({ writes: second.writes }),
    });
    expect(second.writes).toEqual(["after idle\r"]);
    fixture.lifecycle.emit(sessionId, "turn-stopped");
    await expect(resumed).resolves.toMatchObject({ ok: true, finalText: "SECOND_FINAL" });
  });

  it("rotates the persistent managed-process lease at Stop without restarting the relay", async () => {
    const fixture = await createRuntimeFixture();
    const acquireTurn = vi.fn(async ({ providerRunId }: { providerRunId: string }) => ({
      command: "/usr/bin/node",
      args: ["/tmp/managed-bridge.js", "/tmp/managed.sock", "/tmp/lease.token", "--lease-file"],
      env: { PATH: "/usr/bin:/bin" },
      preflight: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      providerRunId,
    }));
    const closeLease = vi.fn(async () => undefined);
    const runtime = fixture.runtime({
      createManagedProcessLease: () => ({ acquireTurn, close: closeLease }),
    });
    const runner = createClaudeTuiRunner(runtime);
    const firstRun = runner(fixture.options({
      managedProcess: { sessionId: "local-session", providerRunId: "run-1" },
    }));
    const first = await fixture.factory.firstPty();
    const sessionId = readArg(first.options.args, "--session-id")!;
    const mcpConfigPath = readArg(first.options.args, "--mcp-config");
    expect(mcpConfigPath).toBeDefined();
    const config = JSON.parse(await fs.readFile(mcpConfigPath!, "utf8")) as { mcpServers: { moebius_managed: { args: string[] } } };
    expect(config.mcpServers.moebius_managed.args).toContain("--lease-file");
    await waitForValue(() => first.writes.length === 1 ? first.writes : undefined, {
      describe: "first managed Claude human input reaches its PTY",
      kind: "logic",
      snapshot: () => ({ writes: first.writes }),
    });
    fixture.lifecycle.emit(sessionId, "turn-submitted");
    fixture.lifecycle.emit(sessionId, "turn-stopped");
    await firstRun;

    const secondRun = runner(fixture.options({
      mode: { kind: "resume", externalSessionId: sessionId },
      managedProcess: { sessionId: "local-session", providerRunId: "run-2" },
    }));
    await waitForValue(() => acquireTurn.mock.calls.length === 2 ? acquireTurn.mock.calls : undefined, {
      describe: "second turn receives a fresh managed-process lease",
      kind: "logic",
      snapshot: () => ({ acquireCalls: acquireTurn.mock.calls.length, spawnCalls: fixture.factory.spawnCalls.length }),
    });
    expect(fixture.factory.spawnCalls).toHaveLength(1);
    await waitForValue(() => first.writes.length === 2 ? first.writes : undefined, {
      describe: "second managed Claude human input reaches the existing PTY",
      kind: "logic",
      snapshot: () => ({ writes: first.writes }),
    });
    fixture.lifecycle.emit(sessionId, "turn-submitted");
    fixture.lifecycle.emit(sessionId, "turn-stopped");
    await secondRun;
    expect(acquireTurn).toHaveBeenNthCalledWith(1, { providerRunId: "run-1" });
    expect(acquireTurn).toHaveBeenNthCalledWith(2, { providerRunId: "run-2" });
    const invocations = acquireTurn.mock.results.map((result) => result.value) as Array<Promise<{ close: ReturnType<typeof vi.fn> }>>;
    await Promise.all(invocations);
    expect(closeLease).not.toHaveBeenCalled();
  });

  it("cancels by terminating the PTY and never falls back to a print-mode child", async () => {
    const fixture = await createRuntimeFixture({ autoExitOnKill: true });
    const runtime = fixture.runtime();
    const controller = new AbortController();
    const running = createClaudeTuiRunner(runtime)(fixture.options({ signal: controller.signal }));
    const pty = await fixture.factory.firstPty();
    controller.abort("user");
    await expect(running).resolves.toMatchObject({ ok: false, reason: "claude-cancelled" });
    expect(pty.kills).toContain("SIGTERM");
    expect(pty.options.args).not.toContain("-p");
  });

  it("automatically confirms the native workspace trust prompt once and then uses the same PTY", async () => {
    const fixture = await createRuntimeFixture({ autoTerminalPrompt: false });
    const runtime = fixture.runtime();
    const runner = createClaudeTuiRunner(runtime);
    const running = runner(fixture.options({
      managedProcess: { sessionId: "local-session", providerRunId: "run-trust" },
    }));
    const pty = await fixture.factory.firstPty();
    const sessionId = readArg(pty.options.args, "--session-id")!;

    pty.emitData("\u001b[2JQuick safety check: Is this a project you created or one you trust?\r\n❯ 1. Yes, I trust this folder\r\n  2. No, exit\r\n");
    await waitForValue(() => pty.writes.length === 1 ? pty.writes : undefined, {
      describe: "native Claude workspace trust prompt receives one automatic Enter",
      kind: "logic",
      snapshot: () => ({ writes: pty.writes }),
    });
    expect(pty.writes).toEqual(["\r"]);

    // Native terminal redraw after Enter must not emit a second confirmation.
    pty.emitData("Quick safety check: Is this a project you created or one you trust?\r\n1. Yes, I trust this folder\r\n2. No, exit\r\n");
    expect(pty.writes).toEqual(["\r"]);

    pty.emitData("\r\n❯ ");
    await waitForValue(() => pty.writes.length === 2 ? pty.writes : undefined, {
      describe: "original task enters the same PTY only after automatic trust",
      kind: "logic",
      snapshot: () => ({ writes: pty.writes }),
    });
    expect(pty.writes).toEqual(["\r", "first human input\r"]);

    // After the first task is written, output is opaque and cannot spoof a
    // second trust request.
    pty.emitData("Quick safety check: Yes, I trust this folder. No, exit.");
    fixture.lifecycle.emit(sessionId, "turn-stopped");
    await expect(running).resolves.toMatchObject({ ok: true, threadId: sessionId });
  });

  it("selects full-session resume exactly once before sending the preserved task", async () => {
    const fixture = await createRuntimeFixture({ autoTerminalPrompt: false });
    const runtime = fixture.runtime();
    const running = createClaudeTuiRunner(runtime)(fixture.options({
      mode: { kind: "resume", externalSessionId: "resume-session" },
    }));
    const pty = await fixture.factory.firstPty();

    pty.emitData("Resume Claude Code session?\r\n1. Resume from summary (recommended)\r\n2. Resume full session as-is\r\n3. Don't ask me again\r\n");
    await waitForValue(() => pty.writes.length === 1 ? pty.writes : undefined, {
      describe: "resume native prompt selects full session as-is",
      kind: "logic",
      snapshot: () => ({ writes: pty.writes }),
    });
    expect(pty.writes).toEqual(["2"]);
    pty.emitData("\r\n❯ ");
    await waitForValue(() => pty.writes.length === 2 ? pty.writes : undefined, {
      describe: "preserved task follows the resume native prompt",
      kind: "logic",
      snapshot: () => ({ writes: pty.writes }),
    });
    expect(pty.writes).toEqual(["2", "first human input\r"]);

    fixture.lifecycle.emit("resume-session", "turn-stopped");
    await expect(running).resolves.toMatchObject({ ok: true, threadId: "resume-session" });
  });

  it("selects one-time managed MCP authorization and writes the verified waiver setting", async () => {
    const fixture = await createRuntimeFixture({ autoTerminalPrompt: false });
    const runtime = fixture.runtime();
    const running = createClaudeTuiRunner(runtime)(fixture.options({
      mcpServer: {
        command: "/usr/bin/node",
        args: ["/tmp/managed-bridge.js"],
        env: { PATH: "/usr/bin:/bin" },
        close: async () => undefined,
      },
    }));
    const pty = await fixture.factory.firstPty();

    pty.emitData("New MCP server found: moebius_managed\r\n1. Use this MCP server\r\n2. Use this and all future MCP servers in this project\r\n3. Continue without using this MCP server\r\n");
    await waitForValue(() => pty.writes.length === 1 ? pty.writes : undefined, {
      describe: "managed MCP native prompt selects one-time use",
      kind: "logic",
      snapshot: () => ({ writes: pty.writes }),
    });
    expect(pty.writes).toEqual(["1"]);
    expect(fixture.lifecycle.settings).toEqual([{ enabledMcpjsonServers: ["moebius_managed"] }]);
    pty.emitData("\r\n❯ ");
    await waitForValue(() => pty.writes.length === 2 ? pty.writes : undefined, {
      describe: "preserved task follows managed MCP authorization",
      kind: "logic",
      snapshot: () => ({ writes: pty.writes }),
    });
    expect(pty.writes).toEqual(["1", "first human input\r"]);

    const sessionId = readArg(pty.options.args, "--session-id")!;
    fixture.lifecycle.emit(sessionId, "turn-stopped");
    await expect(running).resolves.toMatchObject({ ok: true, threadId: sessionId });
  });

  it("publishes an unknown menu as one pending decision and writes only the selected option number", async () => {
    const fixture = await createRuntimeFixture({ autoTerminalPrompt: false });
    const runtime = fixture.runtime({ nativePromptStallMs: 100 });
    let decision: import("../src/claude.js").ClaudeTuiNativePromptDecision | undefined;
    const running = createClaudeTuiRunner(runtime)(fixture.options({
      onNativePrompt: (next) => { decision = next; },
    }));
    const pty = await fixture.factory.firstPty();
    const sessionId = readArg(pty.options.args, "--session-id")!;

    pty.emitData("A new Claude confirmation\r\n1. Keep the change\r\n2. Revert the change\r\n");
    await waitForValue(() => decision, {
      describe: "unknown native menu becomes a pending decision",
      kind: "io",
      snapshot: () => ({ decision, writes: pty.writes }),
    });
    expect(decision).toMatchObject({
      sessionId,
      options: [
        { number: 1, label: "Keep the change", raw: "1. Keep the change" },
        { number: 2, label: "Revert the change", raw: "2. Revert the change" },
      ],
    });
    expect(pty.writes).toEqual([]);

    expect(runtime.selectNativePrompt({
      sessionId,
      decisionId: decision!.decisionId,
      optionNumber: 99,
    })).toEqual({ kind: "rejected", reason: "option-not-found" });
    expect(runtime.selectNativePrompt({
      sessionId,
      decisionId: decision!.decisionId,
      optionNumber: 2,
    })).toEqual({ kind: "accepted" });
    expect(pty.writes).toEqual(["2"]);
    expect(runtime.selectNativePrompt({
      sessionId,
      decisionId: decision!.decisionId,
      optionNumber: 2,
    })).toEqual({ kind: "accepted", replayed: true });

    pty.emitData("\r\n❯ ");
    await waitForValue(() => pty.writes.length === 2 ? pty.writes : undefined, {
      describe: "preserved task follows the selected unknown native option",
      kind: "logic",
      snapshot: () => ({ writes: pty.writes }),
    });
    expect(pty.writes).toEqual(["2", "first human input\r"]);
    fixture.lifecycle.emit(sessionId, "turn-stopped");
    await expect(running).resolves.toMatchObject({ ok: true, threadId: sessionId });
  });

  it("fails safely with a trusted diagnostic when an unknown wait has no options", async () => {
    const fixture = await createRuntimeFixture({ autoExitOnKill: false, autoTerminalPrompt: false });
    const runtime = fixture.runtime({ nativePromptStallMs: 100 });
    const running = createClaudeTuiRunner(runtime)(fixture.options());
    const pty = await fixture.factory.firstPty();
    pty.emitData("Claude is waiting for an unsupported confirmation.");

    await expect(running).resolves.toMatchObject({
      ok: false,
      reason: "claude-native-prompt-unresolved",
      failure: {
        code: "claude-native-prompt-unresolved",
        diagnostic: "Claude is waiting for an unsupported confirmation.",
      },
      terminal: { kind: "crashed", partialText: "" },
    });
    expect(pty.writes).toEqual([]);
    expect(pty.kills).toContain("SIGTERM");
  });

  it("rejects a native choice after the waiting turn is stopped", async () => {
    const fixture = await createRuntimeFixture({ autoTerminalPrompt: false });
    const runtime = fixture.runtime({ nativePromptStallMs: 100 });
    const controller = new AbortController();
    let decision: import("../src/claude.js").ClaudeTuiNativePromptDecision | undefined;
    const running = createClaudeTuiRunner(runtime)(fixture.options({
      signal: controller.signal,
      onNativePrompt: (next) => { decision = next; },
    }));
    const pty = await fixture.factory.firstPty();
    const sessionId = readArg(pty.options.args, "--session-id")!;
    pty.emitData("A new Claude confirmation\r\n1. Keep the change\r\n2. Revert the change\r\n");
    await waitForValue(() => decision, {
      describe: "native choice is published before the stop",
      kind: "io",
      snapshot: () => ({ decision, writes: pty.writes }),
    });

    controller.abort();
    await expect(running).resolves.toMatchObject({ ok: false, reason: "claude-cancelled" });
    expect(runtime.selectNativePrompt({
      sessionId,
      decisionId: decision!.decisionId,
      optionNumber: 1,
    })).toEqual({ kind: "rejected", reason: "no-pending-decision" });
    expect(pty.writes).toEqual([]);
  });

  it("uses the existing abnormal-exit classification when the PTY dies before the first task", async () => {
    const fixture = await createRuntimeFixture({ autoTerminalPrompt: false });
    const runtime = fixture.runtime();
    const running = createClaudeTuiRunner(runtime)(fixture.options());
    const pty = await fixture.factory.firstPty();

    pty.emitExit({ exitCode: 17 });
    await expect(running).resolves.toMatchObject({
      ok: false,
      reason: "claude-cli-spawn-failed",
      terminal: { kind: "crashed" },
    });
    expect(pty.writes).toEqual([]);
  });

  it("fails closed when direct callers do not provide a LocalConsole-owned TUI runtime", async () => {
    await expect(runClaude({
      prompt: "hello",
      runDir: "/tmp/run",
      cwd: "/tmp",
      profile: { cli: "claude", model: "sonnet", effort: "high" },
      mode: { kind: "full" },
    })).resolves.toMatchObject({ ok: false, reason: "claude-cli-spawn-failed" });
  });
});

async function createRuntimeFixture(options: { autoExitOnKill?: boolean; autoTerminalPrompt?: boolean } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-claude-tui-test-"));
  roots.push(root);
  const factory = new FakePtyFactory(options.autoExitOnKill ?? false, options.autoTerminalPrompt ?? true);
  const lifecycle = new FakeLifecycleReceiver(root);
  let transcriptIndex = 0;
  const transcriptValues = ["FIRST_FINAL", "SECOND_FINAL", "THIRD_FINAL"];
  return {
    root,
    factory,
    lifecycle,
    nextTranscript: () => ({
      status: "available" as const,
      finalText: transcriptValues[transcriptIndex++]!,
      cachedInputTokens: null,
      usage: null,
      filePath: path.join(root, "transcript.jsonl"),
    }),
    runtime: (overrides: Omit<ClaudeTuiRuntimeOptions, "lifecycleReceiver" | "createPtyFactory"> = {}) => {
      const runtime = new ClaudeTuiRuntime({
        lifecycleReceiver: lifecycle,
        createPtyFactory: async () => factory,
        resolveTranscript: async () => ({
          status: "available",
          finalText: transcriptValues[transcriptIndex++]!,
          cachedInputTokens: null,
          usage: null,
          filePath: path.join(root, "transcript.jsonl"),
        }),
        ...overrides,
      });
      runtimes.push(runtime);
      return runtime;
    },
    options: (overrides: Partial<Parameters<ReturnType<typeof createClaudeTuiRunner>>[0]> = {}) => ({
      prompt: "first human input",
      runDir: path.join(root, `run-${Math.random().toString(16).slice(2)}`),
      cwd: root,
      profile: { cli: "claude" as const, model: "sonnet", effort: "high" },
      mode: { kind: "full" as const },
      executablePath: "/trusted/claude",
      runVersion: async () => "2.1.239 (Claude Code)",
      ...overrides,
    }),
  };
}

async function createFollowerSource(
  root: string,
  sessionId: string,
  cwd: string,
): Promise<{
  filePath: string;
  resolution: {
    status: "available";
    file: Extract<Awaited<ReturnType<typeof inspectTrustedJsonlCandidate>>, { status: "available" }>['file'];
    startOffset: number;
  };
}> {
  const filePath = path.join(root, "claude-projects", "project", `${sessionId}.jsonl`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const initial = transcriptRecord(sessionId, cwd, "user", [{ type: "text", text: "previous turn" }]);
  const initialLine = `${JSON.stringify(initial)}\n`;
  await fs.writeFile(filePath, initialLine, "utf8");
  const inspected = await inspectTrustedJsonlCandidate(await fs.realpath(root), filePath);
  if (inspected.status !== "available") {
    throw new Error(`follower fixture transcript unavailable: ${inspected.reason}`);
  }
  return {
    filePath,
    resolution: {
      status: "available",
      file: inspected.file,
      startOffset: Buffer.byteLength(initialLine, "utf8"),
    },
  };
}

async function appendTranscriptRecords(filePath: string, records: unknown[]): Promise<void> {
  await fs.appendFile(
    filePath,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
}

function transcriptRecord(
  sessionId: string,
  cwd: string,
  role: "user" | "assistant",
  content: unknown[],
): Record<string, unknown> {
  return {
    type: role,
    sessionId,
    cwd: path.resolve(cwd),
    isSidechain: false,
    message: { role, content },
  };
}

class FakeLifecycleReceiver {
  private readonly registrations = new Map<string, { onEvent?: (event: ClaudeTuiLifecycleEvent) => void }>();
  readonly settings: unknown[] = [];

  constructor(private readonly root: string) {}

  createSession(input: {
    sessionId: string;
    runDir: string;
    onEvent?: (event: ClaudeTuiLifecycleEvent) => void;
  }): ClaudeTuiLifecycleHandle {
    this.registrations.set(input.sessionId, { onEvent: input.onEvent });
    return {
      sessionId: input.sessionId,
      settingsPath: path.join(this.root, `${input.sessionId}.settings.json`),
      writeSettings: async (settings) => {
        this.settings.push(settings);
      },
      markSessionStarted: () => input.onEvent?.({ type: "session-started", sessionId: input.sessionId }),
      dispose: async () => {
        this.registrations.delete(input.sessionId);
      },
    };
  }

  emit(sessionId: string, type: Extract<ClaudeTuiLifecycleEvent["type"], "turn-submitted" | "turn-stopped" | "session-ended">): void {
    this.registrations.get(sessionId)?.onEvent?.({ type, sessionId } as ClaudeTuiLifecycleEvent);
  }
}

class FakePtyFactory implements ClaudeTuiPtyFactory {
  readonly spawnCalls: ClaudeTuiPtySpawnOptions[] = [];
  readonly ptys: FakePty[] = [];

  constructor(
    private readonly autoExitOnKill: boolean,
    private readonly autoTerminalPrompt: boolean,
  ) {}

  spawn(options: ClaudeTuiPtySpawnOptions): ClaudeTuiPty {
    const pty = new FakePty(options, this.autoExitOnKill, this.autoTerminalPrompt);
    this.spawnCalls.push(options);
    this.ptys.push(pty);
    return pty;
  }

  async firstPty(): Promise<FakePty> {
    return await this.ptyAt(0);
  }

  async ptyAt(index: number): Promise<FakePty> {
    return await waitForValue(() => this.ptys[index], {
      describe: `Claude PTY spawn ${String(index + 1)}`,
      kind: "logic",
      snapshot: () => ({ spawnCount: this.ptys.length }),
    });
  }
}

class FakePty implements ClaudeTuiPty {
  readonly writes: string[] = [];
  readonly kills: NodeJS.Signals[] = [];
  private readonly dataListeners = new Set<(data: ClaudeTuiTerminalData) => void>();
  private readonly exitListeners = new Set<(event: ClaudeTuiPtyExit) => void>();

  private emittedAutoTerminalPrompt = false;

  constructor(
    readonly options: ClaudeTuiPtySpawnOptions,
    private readonly autoExitOnKill: boolean,
    private readonly autoTerminalPrompt: boolean,
  ) {}

  write(data: string): void {
    this.writes.push(data);
  }

  resize(): void {}

  kill(signal?: NodeJS.Signals): void {
    const next = signal ?? "SIGTERM";
    this.kills.push(next);
    if (this.autoExitOnKill && (next === "SIGTERM" || next === "SIGKILL")) {
      queueMicrotask(() => this.emitExit({ exitCode: 0 }));
    }
  }

  onData(listener: (data: ClaudeTuiTerminalData) => void) {
    this.dataListeners.add(listener);
    if (this.autoTerminalPrompt && !this.emittedAutoTerminalPrompt) {
      this.emittedAutoTerminalPrompt = true;
      queueMicrotask(() => listener("\n❯ "));
    }
    return { dispose: () => this.dataListeners.delete(listener) };
  }

  onExit(listener: (event: ClaudeTuiPtyExit) => void) {
    this.exitListeners.add(listener);
    return { dispose: () => this.exitListeners.delete(listener) };
  }

  emitData(data: ClaudeTuiTerminalData): void {
    for (const listener of this.dataListeners) listener(data);
  }

  emitExit(event: ClaudeTuiPtyExit): void {
    for (const listener of this.exitListeners) listener(event);
  }
}

function readArg(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}
