import { describe, expect, it, vi } from "vitest";
import type { ClaudeRunOptions } from "../../src/claude.js";

import {
  claudeStaticModels,
  parseClaudeAuthStatus,
  probeClaudeCapabilities,
} from "../src/execution-capabilities.js";
import { AiTeamBuilderClaudeSpawner } from "../src/ai-team-builder/claude-spawner.js";
import { OnboardingCliInstallManager } from "../src/onboarding/cli-installer-manager.js";
import { OnboardingCliReadinessService } from "../src/onboarding/cli-readiness.js";
import {
  ONBOARDING_IPC_CHANNELS,
  registerOnboardingIpc,
  type OnboardingIpcMain,
} from "../src/onboarding/ipc.js";

describe("Claude readiness capabilities", () => {
  it("uses the static official registry only after a valid logged-in auth response", async () => {
    const runCommand = vi.fn(async (_command: string, args: readonly string[]) => ({
      stdout: args[0] === "--version"
        ? "2.1.220 (Claude Code)\n"
        : JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }),
    }));
    const snapshot = await probeClaudeCapabilities({ runCommand });
    expect(snapshot).toMatchObject({
      cli: "claude",
      status: "available",
      cliVersion: "2.1.220 (Claude Code)",
      models: claudeStaticModels(),
    });
    expect(runCommand).toHaveBeenNthCalledWith(2, "claude", ["auth", "status", "--json"], 5_000);
  });

  it("stops before auth on an old version and safely classifies malformed auth", async () => {
    const oldRun = vi.fn(async () => ({ stdout: "2.1.169 (Claude Code)\n" }));
    await expect(probeClaudeCapabilities({ runCommand: oldRun })).resolves.toMatchObject({
      status: "unavailable",
      failureCode: "CLI_VERSION_UNSUPPORTED",
    });
    expect(oldRun).toHaveBeenCalledOnce();

    const malformedRun = vi.fn(async (_command: string, args: readonly string[]) => ({
      stdout: args[0] === "--version" ? "2.1.220 (Claude Code)\n" : "{broken",
    }));
    await expect(probeClaudeCapabilities({ runCommand: malformedRun })).resolves.toMatchObject({
      status: "unavailable",
      failureCode: "CAPABILITY_PROTOCOL_UNAVAILABLE",
    });
    expect(() => parseClaudeAuthStatus({ loggedIn: "yes" })).toThrow();
  });
});

describe("Claude AI team builder isolation", () => {
  it("freezes the isolated safe-mode argv contract and resumes the same session", async () => {
    const run = vi.fn(async (options: ClaudeRunOptions) => {
      const sessionId = options.mode.kind === "resume"
        ? options.mode.externalSessionId
        : "11111111-1111-4111-8111-111111111111";
      await options.onSessionStarted?.(sessionId);
      return {
        ok: true as const,
        finalText: "{}",
        threadId: sessionId,
        cachedInputTokens: null,
        runDir: options.runDir,
        stdoutPath: `${options.runDir}/stdout`,
        stderrPath: `${options.runDir}/stderr`,
      };
    });
    const spawner = new AiTeamBuilderClaudeSpawner({ run });
    const first = await spawner.execute({
      dataRoot: "/tmp/moebius-builder",
      draftId: "draft-1",
      prompt: "build",
      profile: { cli: "claude", model: "sonnet", effort: "high" },
      externalSessionId: null,
    });
    expect(first).toMatchObject({
      ok: true,
      externalSessionId: "11111111-1111-4111-8111-111111111111",
    });
    const firstOptions = run.mock.calls[0]![0];
    expect(firstOptions.permissionMode).toBe("dontAsk");
    expect(firstOptions.expectedInitTools).toEqual(["Read", "Glob", "Grep"]);
    expect(firstOptions.extraArgs).toEqual(expect.arrayContaining([
      "--safe-mode",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--tools", "Read,Glob,Grep",
      "--json-schema",
    ]));

    await spawner.execute({
      dataRoot: "/tmp/moebius-builder",
      draftId: "draft-1",
      prompt: "adjust",
      profile: { cli: "claude", model: "sonnet", effort: "high" },
      externalSessionId: "11111111-1111-4111-8111-111111111111",
    });
    expect(run.mock.calls[1]![0].mode).toEqual({
      kind: "resume",
      externalSessionId: "11111111-1111-4111-8111-111111111111",
    });
  });
});

describe("trusted Claude updater", () => {
  it("spawns only the backend-provided absolute executable with update and shell false", async () => {
    const process = fakeSuccessfulChild();
    const spawnProcess = vi.fn(() => process.child);
    const manager = new OnboardingCliInstallManager({ spawnProcess });
    manager.startClaudeUpdate("/trusted/bin/claude");
    process.close();
    await manager.waitForCompletion("claude");

    expect(spawnProcess).toHaveBeenCalledWith(
      "/trusted/bin/claude",
      ["update"],
      expect.objectContaining({ shell: false }),
    );
    expect(() => manager.startClaudeUpdate("claude")).toThrow();
  });

  it("accepts no renderer path, command, or args across IPC", async () => {
    const process = fakeSuccessfulChild();
    const spawnProcess = vi.fn(() => process.child);
    const installer = new OnboardingCliInstallManager({ spawnProcess });
    const readiness = new OnboardingCliReadinessService({
      resolveClaudeExecutable: async () => "/trusted/bin/claude",
      runCommand: async () => ({ stdout: "2.1.169 (Claude Code)\n" }),
    });
    await readiness.check("claude");
    const handlers = new Map<string, (event: unknown, request?: unknown) => Promise<unknown>>();
    registerOnboardingIpc({
      ipcMain: {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      } satisfies OnboardingIpcMain,
      getDataRoot: () => "/tmp/moebius",
      clipboard: { writeText: vi.fn() },
      readiness,
      installer,
    });
    const update = handlers.get(ONBOARDING_IPC_CHANNELS.claudeUpdateStart)!;
    await expect(update({}, {
      path: "/tmp/attacker",
      command: "bash",
      args: ["-c", "bad"],
    })).rejects.toMatchObject({ code: "ONBOARDING_IPC_REQUEST_INVALID" });
    expect(spawnProcess).not.toHaveBeenCalled();

    await expect(update({})).resolves.toMatchObject({
      cli: "claude",
      status: "running",
    });
    process.close();
    await installer.waitForCompletion("claude");
    expect(spawnProcess).toHaveBeenCalledWith(
      "/trusted/bin/claude",
      ["update"],
      expect.objectContaining({ shell: false }),
    );
  });
});

function fakeSuccessfulChild() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const child = {
    once(event: string, listener: (...args: unknown[]) => void) {
      listeners.set(event, listener);
      return child;
    },
    off() {
      return child;
    },
  };
  return {
    child: child as never,
    close() {
      queueMicrotask(() => listeners.get("close")?.(0, null));
    },
  };
}
