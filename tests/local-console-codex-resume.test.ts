import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { waitForValue } from "../src/testing/wait.js";
import type { CodexRunOptions, CodexRunResult } from "../src/codex.js";
import {
  readLocalCodexRecoveryFacts,
} from "../src/local-console/codex-resume.js";
import { buildLocalResumePrompt } from "../src/local-console/prompt.js";
import { startLocalConsoleServer, type StartedLocalConsoleServer } from "../src/local-console/server.js";
import type { LocalConsoleMessage, LocalConsoleRunSnapshot } from "../src/local-console/types.js";

const cleanupRoots: string[] = [];
const cleanupServers: StartedLocalConsoleServer[] = [];

afterEach(async () => {
  await Promise.all(cleanupServers.splice(0).map((server) => server.close().catch(() => undefined)));
  await Promise.all(cleanupRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("local Codex recovery compatibility prompt", () => {
  it("renders edit-and-resend as an overriding correction delta", () => {
    const prompt = buildLocalResumePrompt({
      reason: "edit-resend",
      correctionBody: "不要改配置，改成只更新测试。",
    });
    expect(prompt).toContain("覆盖与原指令冲突的部分");
    expect(prompt).toContain("不要改配置，改成只更新测试。");
  });
});

describe("local Codex recovery runtime", { timeout: 15_000 }, () => {
  it("resumes the same provider session for Retry and persists cached input usage", async () => {
    const root = await fixtureRoot();
    let call = 0;
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      call += 1;
      await options.onThreadStarted?.("thread-retry");
      if (call === 1) {
        return failed(options, "idle-timeout:10ms");
      }
      return {
        ok: true,
        finalText: "resumed",
        threadId: "thread-retry",
        cachedInputTokens: 321,
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "stdout.jsonl"),
        stderrPath: path.join(options.runDir, "stderr.log"),
      };
    });
    const server = await startFixtureServer(root, runCodex);

    await postSessionMessage(server.url, "default", "@dev implement");
    const stuck = await waitForState(server.url, (messages) =>
      messages.find((message) => message.systemEventKind === "run-stuck") ?? null);
    expect(stuck.runId).not.toBeNull();

    const retry = await fetch(new URL(
      `/api/local-console/sessions/default/runs/${encodeURIComponent(stuck.runId!)}/retry`,
      server.url,
    ), { method: "POST" });
    expect(retry.status).toBe(202);
    await waitForState(server.url, (messages) =>
      messages.find((message) => message.speaker === "agent" && message.body === "resumed") ?? null);

    expect(runCodex).toHaveBeenCalledTimes(2);
    expect(runCodex.mock.calls[1]?.[0].mode).toEqual({
      kind: "resume",
      threadId: "thread-retry",
    });
    const facts = await fs.readFile(server.runtime.getSessionFactLogPath("default"), "utf8");
    expect(facts).toContain('"reason":"retry"');
    expect(facts).toContain('"mode":"resume"');
    expect(facts).toContain('"cachedInputTokens":321');
  });

  it("persists a graceful intent before shutdown and auto-resumes after restart", async () => {
    const root = await fixtureRoot();
    let confirmThreadStarted!: () => void;
    const threadStarted = new Promise<void>((resolve) => {
      confirmThreadStarted = resolve;
    });
    const firstRun = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      await options.onThreadStarted?.("thread-shutdown");
      confirmThreadStarted();
      return await new Promise<CodexRunResult>((resolve) => {
        options.signal?.addEventListener("abort", () => resolve(failed(
          options,
          `interrupted:${String(options.signal?.reason)}`,
        )), { once: true });
      });
    });
    const first = await startFixtureServer(root, firstRun);
    await postSessionMessage(first.url, "default", "@dev keep working");
    const firstActiveRun = await waitForActiveRun(first.url);
    await threadStarted;
    await first.close();
    cleanupServers.splice(cleanupServers.indexOf(first), 1);

    const recoveryFacts = await readLocalCodexRecoveryFacts(
      first.runtime.getSessionFactLogPath("default"),
      "default",
    );
    expect(recoveryFacts.intents).toContainEqual(expect.objectContaining({
      reason: "graceful-shutdown",
      role: "dev",
    }));

    const secondRun = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      await options.onThreadStarted?.("thread-shutdown");
      return {
        ok: true,
        finalText: "continued after restart",
        threadId: "thread-shutdown",
        cachedInputTokens: 99,
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "stdout.jsonl"),
        stderrPath: path.join(options.runDir, "stderr.log"),
      };
    });
    const second = await startFixtureServer(root, secondRun);
    await waitForState(second.url, (messages) =>
      messages.find((message) => message.speaker === "agent" && message.body === "continued after restart") ?? null);
    expect(secondRun.mock.calls[0]?.[0].mode).toEqual({ kind: "resume", threadId: "thread-shutdown" });
    const messages = await getMessages(second.url);
    expect(messages.some((message) => message.systemEventKind === "run-stuck")).toBe(false);
    expect(messages.some((message) => message.systemEventKind === "user-stopped")).toBe(false);
    const continued = messages.find((message) => message.body === "continued after restart");
    expect(continued?.runId).toBe(firstActiveRun.runId);
    expect(continued?.runTiming).toMatchObject({
      attempt: firstActiveRun.attempt,
      status: "completed",
    });
    const lifecycleFacts = (await fs.readFile(
      second.runtime.getSessionFactLogPath("default"),
      "utf8",
    )).split("\n").filter(Boolean).map((line) => JSON.parse(line) as {
      type?: string;
      payload?: { runId?: string; phase?: string };
    });
    const sameRunLifecycle = lifecycleFacts.filter((fact) =>
      fact.type === "run_lifecycle" && fact.payload?.runId === firstActiveRun.runId);
    expect(sameRunLifecycle.filter((fact) => fact.payload?.phase === "created")).toHaveLength(1);
    const invocationFacts = (await fs.readFile(
      second.runtime.getSessionFactLogPath("default"),
      "utf8",
    )).split("\n").filter(Boolean).map((line) => JSON.parse(line) as {
      type?: string;
      payload?: { runId?: string; phase?: string; mode?: string };
    }).filter((fact) =>
      fact.type === "provider_invocation" && fact.payload?.runId === firstActiveRun.runId);
    const startedInvocations = invocationFacts.filter((fact) => fact.payload?.phase === "started");
    expect(startedInvocations.filter((fact) => fact.payload?.mode === "full")).toHaveLength(1);
    expect(startedInvocations.filter((fact) => fact.payload?.mode === "resume")).toHaveLength(1);
  });

  it("resumes a direct worker before draining its persisted same-role FIFO", async () => {
    const root = await fixtureRoot();
    const agents = [
      { name: "dev-manager", agentMarkdown: "# Dev Manager\n\nROLE:dev-manager" },
      { name: "qa", agentMarkdown: "# QA\n\nROLE:qa" },
    ];
    const firstRun = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      await options.onThreadStarted?.("thread-direct-qa");
      return await new Promise<CodexRunResult>((resolve) => {
        options.signal?.addEventListener("abort", () => resolve(failed(
          options,
          `interrupted:${String(options.signal?.reason)}`,
        )), { once: true });
      });
    });
    const first = await startFixtureServer(root, firstRun, async () => true, agents);
    await postSessionMessage(first.url, "default", "@qa first direct");
    const firstActive = await waitForActiveWorker(first.url, "qa");
    await postSessionMessage(first.url, "default", "@qa second queued");
    const beforeRestart = await getSnapshot(first.url);
    expect(beforeRestart.pendingDispatchMessages).toEqual([
      expect.objectContaining({ targetRole: "qa", targetLane: "worker" }),
    ]);
    await first.close();
    cleanupServers.splice(cleanupServers.indexOf(first), 1);

    let releaseRecovered!: () => void;
    let secondCall = 0;
    const secondRun = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      secondCall += 1;
      await options.onThreadStarted?.("thread-direct-qa");
      if (secondCall === 1) {
        return await new Promise<CodexRunResult>((resolve) => {
          releaseRecovered = () => resolve({
            ok: true,
            finalText: "first recovered",
            threadId: "thread-direct-qa",
            cachedInputTokens: 10,
            runDir: options.runDir,
            stdoutPath: path.join(options.runDir, "stdout.jsonl"),
            stderrPath: path.join(options.runDir, "stderr.log"),
          });
        });
      }
      const isQaRun = options.prompt.includes("ROLE:qa")
        || options.prompt.includes("不是你自己 <qa>");
      return {
        ok: true,
        finalText: isQaRun ? "second drained" : "primary closeout",
        threadId: "thread-direct-qa",
        cachedInputTokens: 10,
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "stdout.jsonl"),
        stderrPath: path.join(options.runDir, "stderr.log"),
      };
    });
    const second = await startFixtureServer(root, secondRun, async () => true, agents);
    const recoveredActive = await waitForActiveWorker(second.url, "qa");
    expect(recoveredActive.runId).toBe(firstActive.runId);
    await vi.waitFor(() => expect(secondRun).toHaveBeenCalled(), { timeout: 2_000 });
    expect(secondRun.mock.calls[0]?.[0].mode).toEqual({
      kind: "resume",
      threadId: "thread-direct-qa",
    });
    const duringRecovery = await getSnapshot(second.url);
    expect(duringRecovery.pendingDispatchMessages).toEqual([
      expect.objectContaining({ targetRole: "qa", targetLane: "worker" }),
    ]);

    releaseRecovered();
    await waitForState(second.url, (messages) =>
      messages.find((message) => message.speaker === "agent" && message.body === "second drained") ?? null);
    const resumedCalls = secondRun.mock.calls.filter(([options]) => options.mode?.kind === "resume");
    expect(resumedCalls.slice(0, 2).map(([options]) => options.mode)).toEqual([
      { kind: "resume", threadId: "thread-direct-qa" },
      { kind: "resume", threadId: "thread-direct-qa" },
    ]);
    expect(secondRun.mock.calls
      .filter(([options]) => options.mode?.kind === "full")
      .some(([options]) => options.prompt.includes("ROLE:qa"))).toBe(false);
  }, 20_000);

  it("resumes an Agent handoff source after clean shutdown with the same run and provider identity", async () => {
    const root = await fixtureRoot();
    const agents = [
      { name: "dev-manager", agentMarkdown: "# Dev Manager\n\nROLE:dev-manager" },
      { name: "qa", agentMarkdown: "# QA\n\nROLE:qa" },
    ];
    let qaThreadStarted!: () => void;
    const qaStarted = new Promise<void>((resolve) => {
      qaThreadStarted = resolve;
    });
    const firstRun = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      if (options.prompt.includes("ROLE:qa")) {
        await options.onThreadStarted?.("thread-handoff-qa");
        qaThreadStarted();
        return await new Promise<CodexRunResult>((resolve) => {
          options.signal?.addEventListener("abort", () => resolve(failed(
            options,
            `interrupted:${String(options.signal?.reason)}`,
          )), { once: true });
        });
      }
      await options.onThreadStarted?.("thread-handoff-manager");
      return {
        ok: true,
        finalText: "@qa 请完成关闭恢复复核",
        threadId: "thread-handoff-manager",
        cachedInputTokens: 4,
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "stdout.jsonl"),
        stderrPath: path.join(options.runDir, "stderr.log"),
      };
    });
    const first = await startFixtureServer(root, firstRun, async () => true, agents);
    await postSessionMessage(first.url, "default", "请主理人派给 QA");
    const handoffActive = await waitForActiveWorker(first.url, "qa");
    await qaStarted;
    const sourceBeforeClose = (await getMessages(first.url)).find((message) =>
      message.speaker === "agent" && message.body === "@qa 请完成关闭恢复复核");
    expect(sourceBeforeClose).toMatchObject({
      speaker: "agent",
      role: "dev-manager",
      status: "displayed",
    });

    await first.close();
    cleanupServers.splice(cleanupServers.indexOf(first), 1);
    const recoveryFactsAfterClose = await readLocalCodexRecoveryFacts(
      first.runtime.getSessionFactLogPath("default"),
      "default",
    );
    expect(recoveryFactsAfterClose.intents).toContainEqual(expect.objectContaining({
      targetRunId: handoffActive.runId,
      sourceMessageId: sourceBeforeClose!.id,
      role: "qa",
      reason: "graceful-shutdown",
      sourceDisposition: "agent-handoff",
    }));
    const persistedSource = (await fs.readFile(
      first.runtime.getSessionFactLogPath("default"),
      "utf8",
    )).trimEnd().split("\n").flatMap((line) => {
      const event = JSON.parse(line) as { messageUpserts?: LocalConsoleMessage[] };
      return event.messageUpserts ?? [];
    }).filter((message) => message.id === sourceBeforeClose!.id).at(-1);
    expect(persistedSource).toMatchObject({
      speaker: "agent",
      status: "displayed",
    });
    const relocatedRoot = await fixtureRoot();
    await fs.cp(root, relocatedRoot, { recursive: true });

    const restartedCalls: CodexRunOptions[] = [];
    let releaseQaResume!: () => void;
    let qaResumeStarted!: () => void;
    const qaResumeReady = new Promise<void>((resolve) => {
      qaResumeStarted = resolve;
    });
    const restartedRun = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      restartedCalls.push(options);
      if (options.mode?.kind === "resume" && options.mode.threadId === "thread-handoff-qa") {
        await options.onThreadStarted?.("thread-handoff-qa");
        qaResumeStarted();
        await new Promise<void>((resolve) => {
          releaseQaResume = resolve;
        });
        return {
          ok: true,
          finalText: "QA 从原 handoff 恢复完成",
          threadId: "thread-handoff-qa",
          cachedInputTokens: 8,
          runDir: options.runDir,
          stdoutPath: path.join(options.runDir, "stdout.jsonl"),
          stderrPath: path.join(options.runDir, "stderr.log"),
        };
      }
      await options.onThreadStarted?.("thread-handoff-manager");
      return {
        ok: true,
        finalText: "主理人已接回",
        threadId: "thread-handoff-manager",
        cachedInputTokens: 6,
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "stdout.jsonl"),
        stderrPath: path.join(options.runDir, "stderr.log"),
      };
    });
    const second = await startFixtureServer(relocatedRoot, restartedRun, async () => true, agents);
    await qaResumeReady;
    const resumedActive = await waitForActiveWorker(second.url, "qa");
    expect(resumedActive).toMatchObject({
      runId: handoffActive.runId,
      role: "qa",
      stepId: handoffActive.stepId,
      attempt: handoffActive.attempt,
    });
    await postSessionMessage(second.url, "default", "继续");
    const managerRecovered = await waitForState(second.url, (messages) =>
      messages.find((message) =>
        message.speaker === "agent" && message.body === "主理人已接回") ?? null);
    const continueSource = (await getMessages(second.url)).find((message) =>
      message.speaker === "user" && message.body === "继续")!;
    expect(continueSource.runId).not.toBe(handoffActive.runId);
    expect(managerRecovered.runId).toBe(continueSource.runId);
    releaseQaResume();
    const recovered = await waitForState(second.url, (messages) =>
      messages.find((message) =>
        message.speaker === "agent" && message.body === "QA 从原 handoff 恢复完成") ?? null);
    expect(recovered.runId).toBe(handoffActive.runId);
    const qaResumeCalls = restartedCalls.filter((options) =>
      options.mode?.kind === "resume" && options.mode.threadId === "thread-handoff-qa");
    expect(qaResumeCalls).toHaveLength(1);
    expect(restartedCalls.some((options) =>
      options.mode?.kind === "full" && options.prompt.includes("ROLE:qa"))).toBe(false);
    const finalFacts = (await fs.readFile(
      second.runtime.getSessionFactLogPath("default"),
      "utf8",
    )).trimEnd().split("\n").map((line) => JSON.parse(line) as {
      type?: string;
      payload?: { runId?: string; sourceMessageId?: number; role?: string };
    });
    expect(finalFacts.filter((fact) =>
      fact.type === "run_execution_context"
      && fact.payload?.runId === continueSource.runId)).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          sourceMessageId: continueSource.id,
          role: "dev-manager",
        }),
      }),
    ]);
    expect((await getMessages(second.url)).some((message) =>
      message.body.includes("conflicting run_execution_context")
      || message.systemEventKind === "run-not-started")).toBe(false);
  }, 20_000);

  it("repairs the unique legacy Agent handoff footprint once before resuming it", async () => {
    const root = await fixtureRoot();
    const agents = [
      { name: "dev-manager", agentMarkdown: "# Dev Manager\n\nROLE:dev-manager" },
      { name: "qa", agentMarkdown: "# QA\n\nROLE:qa" },
    ];
    let qaStarted!: () => void;
    const qaReady = new Promise<void>((resolve) => {
      qaStarted = resolve;
    });
    const firstRun = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      if (options.prompt.includes("ROLE:qa")) {
        await options.onThreadStarted?.("thread-legacy-handoff");
        qaStarted();
        return await new Promise<CodexRunResult>((resolve) => {
          options.signal?.addEventListener("abort", () => resolve(failed(
            options,
            `interrupted:${String(options.signal?.reason)}`,
          )), { once: true });
        });
      }
      await options.onThreadStarted?.("thread-legacy-manager");
      return {
        ok: true,
        finalText: "@qa legacy handoff",
        threadId: "thread-legacy-manager",
        cachedInputTokens: 4,
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "stdout.jsonl"),
        stderrPath: path.join(options.runDir, "stderr.log"),
      };
    });
    const first = await startFixtureServer(root, firstRun, async () => true, agents);
    await postSessionMessage(first.url, "default", "create legacy handoff");
    const originalActive = await waitForActiveWorker(first.url, "qa");
    await qaReady;
    const handoffSource = (await getMessages(first.url)).find((message) =>
      message.speaker === "agent" && message.body === "@qa legacy handoff")!;
    const factLogPath = first.runtime.getSessionFactLogPath("default");
    await first.close();
    cleanupServers.splice(cleanupServers.indexOf(first), 1);
    await rewriteAsLegacyAgentHandoffFootprint({
      factLogPath,
      sessionId: "default",
      sourceMessageId: handoffSource.id,
      targetRunId: originalActive.runId,
    });
    const relocatedRoot = await fixtureRoot();
    await fs.cp(root, relocatedRoot, { recursive: true });
    const relocatedFactLogPath = path.join(
      relocatedRoot,
      "sessions",
      path.basename(factLogPath),
    );

    const resumedRun = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      const isQaRun = options.mode?.kind === "resume"
        && options.mode.threadId === "thread-legacy-handoff";
      const threadId = isQaRun ? "thread-legacy-handoff" : "thread-legacy-manager";
      await options.onThreadStarted?.(threadId);
      return {
        ok: true,
        finalText: isQaRun ? "legacy QA recovered" : "legacy manager closeout",
        threadId,
        cachedInputTokens: 8,
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "stdout.jsonl"),
        stderrPath: path.join(options.runDir, "stderr.log"),
      };
    });
    const second = await startFixtureServer(relocatedRoot, resumedRun, async () => true, agents);
    const recovered = await waitForState(second.url, (messages) =>
      messages.find((message) =>
        message.speaker === "agent" && message.body === "legacy QA recovered") ?? null);
    expect(recovered.runId).toBe(originalActive.runId);
    await waitForState(second.url, (messages) =>
      messages.find((message) =>
        message.speaker === "agent" && message.body === "legacy manager closeout") ?? null);
    expect(resumedRun).toHaveBeenCalledTimes(2);
    expect(resumedRun.mock.calls[0]?.[0].mode).toEqual({
      kind: "resume",
      threadId: "thread-legacy-handoff",
    });
    const firstRepairFacts = (await fs.readFile(relocatedFactLogPath, "utf8"))
      .trimEnd().split("\n").map((line) => JSON.parse(line) as {
        type?: string;
        payload?: { intentId?: string; sourceMessageId?: number; targetRunId?: string };
      }).filter((event) => event.type === "repair_agent_handoff_resume_source");
    expect(firstRepairFacts).toHaveLength(1);
    expect(firstRepairFacts[0]?.payload).toMatchObject({
      sourceMessageId: handoffSource.id,
      targetRunId: originalActive.runId,
    });
    await waitForValue(async () => {
      const snapshot = await getSnapshot(second.url);
      return snapshot.activeRuns.length === 0 && snapshot.pendingDispatchMessages.length === 0
        ? true
        : undefined;
    }, {
      describe: "recovered legacy handoff to finish before restart",
      kind: "io",
      timeoutMs: 8_000,
    });
    await second.close();
    cleanupServers.splice(cleanupServers.indexOf(second), 1);

    const unexpectedRun = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> =>
      failed(options, "unexpected provider call"));
    const third = await startFixtureServer(relocatedRoot, unexpectedRun, async () => true, agents);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(unexpectedRun).not.toHaveBeenCalled();
    const repeatedRepairFacts = (await fs.readFile(relocatedFactLogPath, "utf8"))
      .trimEnd().split("\n").map((line) => JSON.parse(line) as { type?: string })
      .filter((event) => event.type === "repair_agent_handoff_resume_source");
    expect(repeatedRepairFacts).toHaveLength(1);
    await third.close();
    cleanupServers.splice(cleanupServers.indexOf(third), 1);
  }, 20_000);

  it("fails closed for ambiguous or incompatible legacy Agent handoff facts", async () => {
    const root = await fixtureRoot();
    const agents = [
      { name: "dev-manager", agentMarkdown: "# Dev Manager\n\nROLE:dev-manager" },
      { name: "qa", agentMarkdown: "# QA\n\nROLE:qa" },
    ];
    let qaStarted!: () => void;
    const qaReady = new Promise<void>((resolve) => {
      qaStarted = resolve;
    });
    const first = await startFixtureServer(root, async (options) => {
      if (options.prompt.includes("ROLE:qa")) {
        await options.onThreadStarted?.("thread-repair-reject");
        qaStarted();
        return await new Promise<CodexRunResult>((resolve) => {
          options.signal?.addEventListener("abort", () => resolve(failed(options, "closed")), { once: true });
        });
      }
      await options.onThreadStarted?.("thread-repair-reject-manager");
      return {
        ok: true,
        finalText: "@qa reject matrix",
        threadId: "thread-repair-reject-manager",
        cachedInputTokens: 3,
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "stdout.jsonl"),
        stderrPath: path.join(options.runDir, "stderr.log"),
      };
    }, async () => true, agents);
    await postSessionMessage(first.url, "default", "create reject fixture");
    const originalActive = await waitForActiveWorker(first.url, "qa");
    await qaReady;
    const source = (await getMessages(first.url)).find((message) =>
      message.speaker === "agent" && message.body === "@qa reject matrix")!;
    const baseFactLogPath = first.runtime.getSessionFactLogPath("default");
    await first.close();
    cleanupServers.splice(cleanupServers.indexOf(first), 1);

    const variants = [
      "consumed-intent",
      "non-graceful-intent",
      "duplicate-intent",
      "missing-context",
      "conflicting-context",
      "non-agent-source",
      "invalid-source-status",
      "conflicting-disposition",
    ] as const;
    for (const variant of variants) {
      const variantRoot = await fs.mkdtemp(path.join(os.tmpdir(), `moebius-repair-reject-${variant}-`));
      cleanupRoots.push(variantRoot);
      await fs.cp(root, variantRoot, { recursive: true });
      const variantFactLogPath = path.join(
        variantRoot,
        "sessions",
        path.basename(baseFactLogPath),
      );
      await rewriteAsLegacyAgentHandoffFootprint({
        factLogPath: variantFactLogPath,
        sessionId: "default",
        sourceMessageId: source.id,
        targetRunId: originalActive.runId,
      });
      await mutateLegacyRepairRejection(variantFactLogPath, variant);
      const provider = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> =>
        failed(options, "provider must not run for rejected repair"));
      const server = await startFixtureServer(variantRoot, provider, async () => true, agents);
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(provider, variant).not.toHaveBeenCalled();
      const repairFacts = (await fs.readFile(variantFactLogPath, "utf8"))
        .trimEnd().split("\n").map((line) => JSON.parse(line) as { type?: string })
        .filter((event) => event.type === "repair_agent_handoff_resume_source");
      expect(repairFacts, variant).toHaveLength(0);
      await server.close();
      cleanupServers.splice(cleanupServers.indexOf(server), 1);
    }
  }, 60_000);

  it("does not rerun automatically when graceful recovery is unavailable", async () => {
    const root = await fixtureRoot();
    let confirmThreadStarted!: () => void;
    const threadStarted = new Promise<void>((resolve) => {
      confirmThreadStarted = resolve;
    });
    const firstRun = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      await options.onThreadStarted?.("thread-unavailable");
      confirmThreadStarted();
      return await new Promise<CodexRunResult>((resolve) => {
        options.signal?.addEventListener("abort", () => resolve(failed(
          options,
          `interrupted:${String(options.signal?.reason)}`,
        )), { once: true });
      });
    });
    const first = await startFixtureServer(root, firstRun);
    await postSessionMessage(first.url, "default", "@dev keep working");
    const firstActiveRun = await waitForActiveRun(first.url);
    await threadStarted;
    await first.close();
    cleanupServers.splice(cleanupServers.indexOf(first), 1);

    const replacementRun = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => ({
      ok: true,
      finalText: "restarted explicitly",
      threadId: "thread-replacement",
      cachedInputTokens: 0,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));
    const second = await startFixtureServer(root, replacementRun, async () => false);
    const unavailable = await waitForState(second.url, (messages) =>
      messages.find((message) => message.systemEventKind === "resume-unavailable") ?? null);
    expect(replacementRun).not.toHaveBeenCalled();
    expect(unavailable.runId).toBe(firstActiveRun.runId);
    expect(unavailable.runTiming).toMatchObject({
      attempt: firstActiveRun.attempt,
      status: "failed",
    });

    const retry = await fetch(new URL(
      `/api/local-console/sessions/default/runs/${encodeURIComponent(unavailable.runId!)}/retry`,
      second.url,
    ), { method: "POST" });
    expect(retry.status).toBe(202);
    const retriedUnavailable = await waitForState(second.url, (messages) =>
      messages.find((message) =>
        message.runId !== unavailable.runId
        && message.systemEventKind === "resume-unavailable") ?? null);
    expect(retriedUnavailable.error).toContain("resume-unavailable");
    expect(replacementRun).not.toHaveBeenCalled();
  });

  it("continues an interrupted thread with the edited resend as an overriding delta", async () => {
    const root = await fixtureRoot();
    let call = 0;
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      call += 1;
      await options.onThreadStarted?.("thread-edit");
      if (call === 1) {
        return failed(options, "interrupted:user-interrupted");
      }
      return {
        ok: true,
        finalText: "edited instruction applied",
        threadId: "thread-edit",
        cachedInputTokens: 77,
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "stdout.jsonl"),
        stderrPath: path.join(options.runDir, "stderr.log"),
      };
    });
    const server = await startFixtureServer(root, runCodex);
    await postSessionMessage(server.url, "default", "@dev 修改配置");
    const stopped = await waitForState(server.url, (messages) =>
      messages.find((message) => message.systemEventKind === "user-stopped") ?? null);

    const resend = await fetch(new URL("/api/local-console/sessions/default/messages", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "@dev 不要改配置，只更新测试",
        resumeRunId: stopped.runId,
      }),
    });
    expect(resend.status).toBe(202);
    await waitForState(server.url, (messages) =>
      messages.find((message) => message.speaker === "agent" && message.body === "edited instruction applied") ?? null);

    expect(runCodex.mock.calls[1]?.[0].mode).toEqual({ kind: "resume", threadId: "thread-edit" });
    expect(runCodex.mock.calls[1]?.[0].prompt).toContain("覆盖与原指令冲突的部分");
    expect(runCodex.mock.calls[1]?.[0].prompt).toContain("不要改配置，只更新测试");
  });

  it("fails closed without a full prompt when the linked rollout is unavailable", async () => {
    const root = await fixtureRoot();
    let call = 0;
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      call += 1;
      await options.onThreadStarted?.("thread-missing");
      if (call === 1) {
        return failed(options, "interrupted:user-interrupted");
      }
      return {
        ok: true,
        finalText: "full fallback completed",
        threadId: "thread-replacement",
        cachedInputTokens: 0,
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "stdout.jsonl"),
        stderrPath: path.join(options.runDir, "stderr.log"),
      };
    });
    const server = await startFixtureServer(root, runCodex, async () => false);
    await postSessionMessage(server.url, "default", "@dev 修改配置");
    const stopped = await waitForState(server.url, (messages) =>
      messages.find((message) => message.systemEventKind === "user-stopped") ?? null);

    const resend = await fetch(new URL("/api/local-console/sessions/default/messages", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "@dev 改成只更新测试",
        resumeRunId: stopped.runId,
      }),
    });
    expect(resend.status).toBe(202);
    await waitForState(server.url, (messages) =>
      messages.find((message) =>
        message.runId !== stopped.runId
        && message.systemEventKind === "resume-unavailable") ?? null);

    expect(runCodex).toHaveBeenCalledTimes(1);
    const facts = await fs.readFile(server.runtime.getSessionFactLogPath("default"), "utf8");
    expect(facts).toContain('"reason":"rollout-unavailable"');
    expect(facts).not.toContain('"mode":"full-fallback"');
  });
});

async function fixtureRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-resume-"));
  cleanupRoots.push(root);
  return root;
}

async function rewriteAsLegacyAgentHandoffFootprint(input: {
  factLogPath: string;
  sessionId: string;
  sourceMessageId: number;
  targetRunId: string;
}): Promise<void> {
  const events = (await fs.readFile(input.factLogPath, "utf8"))
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as TestFactEvent);
  const intent = events.find((event) =>
    event.type === "codex_resume_intent"
    && event.payload?.targetRunId === input.targetRunId
    && event.payload?.sourceMessageId === input.sourceMessageId);
  if (intent?.payload === undefined) {
    throw new Error("graceful resume intent fixture not found");
  }
  delete intent.payload.sourceDisposition;
  events.push({
    version: 1,
    eventId: "legacy-agent-handoff-retry-sibling",
    sessionId: input.sessionId,
    type: "codex_resume_intent",
    recordedAt: "2026-07-30T00:00:00.000Z",
    payload: {
      ...intent.payload,
      intentId: "legacy-agent-handoff-retry",
      reason: "retry",
    },
    messageUpserts: [],
  });
  const source = events.flatMap((event) => event.messageUpserts)
    .filter((message) => message.id === input.sourceMessageId)
    .at(-1);
  if (source === undefined) {
    throw new Error("Agent handoff source fixture not found");
  }
  events.push({
    version: 1,
    eventId: "legacy-agent-handoff-pollution",
    sessionId: input.sessionId,
    type: "release_message_for_resume",
    recordedAt: "2026-07-30T00:00:00.000Z",
    payload: {
      kind: "local-release-message-for-resume",
      sessionId: input.sessionId,
      userMessageId: input.sourceMessageId,
      now: "2026-07-30T00:00:00.000Z",
    },
    messageUpserts: [{
      ...source,
      status: "pending",
      runId: null,
      runDir: null,
      error: null,
      updatedAt: "2026-07-30T00:00:00.000Z",
    }],
  });
  await fs.writeFile(
    input.factLogPath,
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    "utf8",
  );
}

type LegacyRepairRejection =
  | "consumed-intent"
  | "non-graceful-intent"
  | "duplicate-intent"
  | "missing-context"
  | "conflicting-context"
  | "non-agent-source"
  | "invalid-source-status"
  | "conflicting-disposition";

interface TestFactEvent {
  version: number;
  eventId: string;
  sessionId: string;
  type: string;
  recordedAt: string;
  payload?: Record<string, unknown>;
  messageUpserts: LocalConsoleMessage[];
}

async function mutateLegacyRepairRejection(
  factLogPath: string,
  variant: LegacyRepairRejection,
): Promise<void> {
  let events = (await fs.readFile(factLogPath, "utf8"))
    .trimEnd().split("\n").map((line) => JSON.parse(line) as TestFactEvent);
  const intent = events.find((event) => event.type === "codex_resume_intent");
  if (intent?.payload === undefined) {
    throw new Error("legacy rejection intent not found");
  }
  if (variant === "consumed-intent") {
    events.push({
      version: 1,
      eventId: "legacy-rejection-consumed",
      sessionId: intent.sessionId,
      type: "codex_resume_consumed",
      recordedAt: "2026-07-30T00:00:01.000Z",
      payload: {
        sessionId: intent.sessionId,
        intentId: intent.payload.intentId,
        resumedByRunId: intent.payload.targetRunId,
        mode: "unavailable",
        reason: "fixture",
        consumedAt: "2026-07-30T00:00:01.000Z",
      },
      messageUpserts: [],
    });
  } else if (variant === "non-graceful-intent") {
    intent.payload.reason = "retry";
  } else if (variant === "duplicate-intent") {
    events.push({
      ...intent,
      eventId: "legacy-rejection-duplicate-intent",
      payload: {
        ...intent.payload,
        intentId: "legacy-rejection-duplicate",
      },
      messageUpserts: [],
    });
  } else if (variant === "missing-context") {
    events = events.filter((event) =>
      event.type !== "run_execution_context"
      || event.payload?.runId !== intent.payload!.targetRunId);
  } else if (variant === "conflicting-context") {
    const context = events.find((event) =>
      event.type === "run_execution_context"
      && event.payload?.runId === intent.payload!.targetRunId);
    if (context?.payload === undefined) {
      throw new Error("legacy rejection context not found");
    }
    events.push({
      ...context,
      eventId: "legacy-rejection-conflicting-context",
      payload: {
        ...context.payload,
        role: "dev",
      },
      messageUpserts: [],
    });
  } else if (variant === "conflicting-disposition") {
    intent.payload.sourceDisposition = "user-direct";
  } else {
    const pollution = [...events].reverse().find((event) =>
      event.eventId === "legacy-agent-handoff-pollution");
    const source = pollution?.messageUpserts[0];
    if (source === undefined) {
      throw new Error("legacy rejection source not found");
    }
    if (variant === "non-agent-source") {
      source.speaker = "user";
      source.status = "displayed";
    } else {
      source.status = "failed";
    }
  }
  await fs.writeFile(
    factLogPath,
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    "utf8",
  );
}

async function startFixtureServer(
  root: string,
  runCodex: (options: CodexRunOptions) => Promise<CodexRunResult>,
  isCodexThreadAvailable: (threadId: string) => Promise<boolean> = async () => true,
  agents: Array<{ name: string; agentMarkdown: string }> = [
    { name: "dev", agentMarkdown: "# Dev\n\nImplement." },
  ],
): Promise<StartedLocalConsoleServer> {
  const server = await startLocalConsoleServer({
    projectRoot: root,
    sqlitePath: path.join(root, ".state", "local-console.sqlite"),
    sessionLogRoot: path.join(root, "sessions"),
    listAgentFiles: async () => agents,
    runCodex,
    isCodexThreadAvailable,
    codexIdleTimeoutMs: 5_000,
    codexMaxDurationMs: 10_000,
  });
  cleanupServers.push(server);
  return server;
}

async function getSnapshot(url: string): Promise<{
  pendingDispatchMessages: Array<{
    targetLane: "primary" | "worker" | "awaiting-team";
    targetRole: string | null;
  }>;
  activeRuns: LocalConsoleRunSnapshot[];
}> {
  const response = await fetch(new URL("/api/local-console/messages", url));
  return await response.json() as {
    pendingDispatchMessages: Array<{
      targetLane: "primary" | "worker" | "awaiting-team";
      targetRole: string | null;
    }>;
    activeRuns: LocalConsoleRunSnapshot[];
  };
}

async function waitForActiveWorker(
  url: string,
  role: string,
): Promise<Pick<LocalConsoleRunSnapshot, "runId" | "role" | "stepId" | "attempt">> {
  return waitForValue(
    async () => (await getSnapshot(url)).activeRuns.find((run) => run.role === role),
    { describe: `active worker ${role}`, kind: "io", timeoutMs: 8_000 },
  );
}

async function postSessionMessage(url: string, sessionId: string, body: string): Promise<void> {
  const response = await fetch(new URL(
    `/api/local-console/sessions/${encodeURIComponent(sessionId)}/messages`,
    url,
  ), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
  expect(response.status).toBe(202);
}

async function getMessages(url: string): Promise<LocalConsoleMessage[]> {
  const response = await fetch(new URL("/api/local-console/messages", url));
  const body = await response.json() as { messages: LocalConsoleMessage[] };
  return body.messages;
}

async function waitForState<T>(
  url: string,
  select: (messages: LocalConsoleMessage[]) => T | null,
): Promise<T> {
  let latest: LocalConsoleMessage[] = [];
  return waitForValue(
    async () => {
      latest = await getMessages(url);
      return select(latest) ?? undefined;
    },
    { describe: "local console state", kind: "io", timeoutMs: 8_000, snapshot: () => latest },
  );
}

async function waitForActiveRun(url: string): Promise<{ runId: string; attempt: number }> {
  return waitForValue(
    async () => {
      const response = await fetch(new URL("/api/local-console/messages", url));
      const body = await response.json() as {
        activeRun: { runId: string; attempt: number } | null;
      };
      return body.activeRun ?? undefined;
    },
    { describe: "active run", kind: "io", timeoutMs: 8_000 },
  );
}

function failed(options: CodexRunOptions, reason: string): CodexRunResult {
  return {
    ok: false,
    reason,
    runDir: options.runDir,
    stdoutPath: path.join(options.runDir, "stdout.jsonl"),
    stderrPath: path.join(options.runDir, "stderr.log"),
  };
}
