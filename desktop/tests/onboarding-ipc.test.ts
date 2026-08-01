import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { checkCodex } from "../src/env-doctor.js";
import {
  ONBOARDING_IPC_CHANNELS,
  registerOnboardingIpc,
  type OnboardingIpcMain,
} from "../src/onboarding/register.js";
import { OnboardingCliInstallManager } from "../src/onboarding/cli-installer-manager.js";
import { OnboardingCliReadinessService } from "../src/onboarding/cli-readiness.js";
import {
  capabilitySnapshotId,
  type ExecutionCapabilitySnapshot,
} from "../src/team-execution-profile.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })));
});

describe("onboarding IPC boundary", () => {
  it("connects marker, Codex check, and the fixed install command through narrow handlers", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "onboarding-ipc-"));
    temporaryRoots.push(dataRoot);
    const handlers = new Map<string, (event: unknown, request?: unknown) => Promise<unknown>>();
    const writeText = vi.fn();
    const readiness = new OnboardingCliReadinessService({
      runCommand: async (command) => ({ stdout: `${command} 1.0\n` }),
      probeCapabilities: async ({ cli, knownCliVersion }) =>
        availableCapability(cli, knownCliVersion),
    });
    const ipcMain: OnboardingIpcMain = {
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
    };
    registerOnboardingIpc({
      ipcMain,
      getDataRoot: () => dataRoot,
      checkCodex: async () => ({
        status: "ok",
        message: "已找到",
        detail: "codex-cli 1.0",
      }),
      clipboard: { writeText },
      readiness,
    });

    await expect(invoke(handlers, ONBOARDING_IPC_CHANNELS.status)).resolves.toEqual({
      completed: false,
      completedAt: null,
    });
    await expect(invoke(handlers, ONBOARDING_IPC_CHANNELS.checkCodex)).resolves.toEqual({
      status: "ok",
      message: "已找到",
      detail: "codex-cli 1.0",
    });
    await expect(invoke(handlers, ONBOARDING_IPC_CHANNELS.copyInstallCommand)).resolves.toBeUndefined();
    expect(writeText).toHaveBeenCalledWith("npm install -g @openai/codex");
    await expect(invoke(
      handlers,
      ONBOARDING_IPC_CHANNELS.cliReadinessState,
    )).resolves.toMatchObject({
      codex: { cli: "codex", status: "checking", revision: 0 },
      claude: { cli: "claude", status: "checking", revision: 0 },
      kimi: { cli: "kimi", status: "checking", revision: 0 },
    });
    await expect(invoke(
      handlers,
      ONBOARDING_IPC_CHANNELS.cliInstallState,
    )).resolves.toMatchObject({
      codex: { cli: "codex", status: "idle", revision: 0 },
      claude: { cli: "claude", status: "idle", revision: 0 },
      kimi: { cli: "kimi", status: "idle", revision: 0 },
    });
    await invoke(handlers, ONBOARDING_IPC_CHANNELS.cliReadinessCheck, { cli: "codex" });
    await invoke(handlers, ONBOARDING_IPC_CHANNELS.cliReadinessCheck, { cli: "kimi" });
    await expect(invoke(
      handlers,
      ONBOARDING_IPC_CHANNELS.teamBuilderStart,
      { draftId: "onboarding-team-builder" },
    )).resolves.toMatchObject({
      ok: true,
      state: { phase: "idle" },
    });
    expect([...handlers.keys()].filter((channel) => channel.includes("team-builder")).every(
      (channel) => channel.startsWith("onboarding:"),
    )).toBe(true);

    await expect(invoke(handlers, ONBOARDING_IPC_CHANNELS.complete)).resolves.toMatchObject({
      completed: true,
      completedAt: expect.any(String),
    });
    await expect(invoke(handlers, ONBOARDING_IPC_CHANNELS.status)).resolves.toMatchObject({
      completed: true,
      completedAt: expect.any(String),
    });
  });

  it("passes the real version and safe error classifications through the existing DTO", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "onboarding-ipc-safe-"));
    temporaryRoots.push(dataRoot);
    const handlers = new Map<string, (event: unknown, request?: unknown) => Promise<unknown>>();
    const ipcMain: OnboardingIpcMain = {
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
    };
    let outcome: "ready" | "missing" | "unavailable" = "ready";
    registerOnboardingIpc({
      ipcMain,
      getDataRoot: () => dataRoot,
      checkCodex: () => checkCodex({
        runCommand: async () => {
          if (outcome === "ready") {
            return { exitCode: 0, stdout: "codex-cli 0.145.0\n", stderr: "" };
          }
          throw Object.assign(
            new Error("raw failure at /Users/example/bin/codex"),
            { code: outcome === "missing" ? "ENOENT" : "EACCES" },
          );
        },
      }),
      clipboard: { writeText: vi.fn() },
    });

    await expect(invoke(handlers, ONBOARDING_IPC_CHANNELS.checkCodex)).resolves.toEqual({
      status: "ok",
      message: "已找到",
      detail: "codex-cli 0.145.0",
    });

    outcome = "missing";
    await expect(invoke(handlers, ONBOARDING_IPC_CHANNELS.checkCodex)).resolves.toEqual({
      status: "error",
      message: "Codex 未找到",
    });

    outcome = "unavailable";
    const unavailable = await invoke(handlers, ONBOARDING_IPC_CHANNELS.checkCodex);
    expect(unavailable).toEqual({
      status: "error",
      message: "Codex 不可用",
    });
    expect(JSON.stringify(unavailable)).not.toContain("/Users/example");
  });

  it("rejects renderer command injection before starting an installer", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "onboarding-ipc-invalid-"));
    temporaryRoots.push(dataRoot);
    const handlers = new Map<string, (event: unknown, request?: unknown) => Promise<unknown>>();
    const spawnProcess = vi.fn();
    registerOnboardingIpc({
      ipcMain: {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      getDataRoot: () => dataRoot,
      clipboard: { writeText: vi.fn() },
      installer: new OnboardingCliInstallManager({
        spawnProcess: spawnProcess as never,
      }),
    });

    await expect(invoke(
      handlers,
      ONBOARDING_IPC_CHANNELS.cliInstallStart,
      {
        cli: "kimi",
        command: "bash",
        url: "https://attacker.invalid/install.sh",
        args: ["-c", "unsafe"],
      },
    )).rejects.toMatchObject({
      code: "ONBOARDING_IPC_REQUEST_INVALID",
    });
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});

function invoke(
  handlers: Map<string, (event: unknown, request?: unknown) => Promise<unknown>>,
  channel: string,
  request?: unknown,
): Promise<unknown> {
  const handler = handlers.get(channel);
  if (handler === undefined) {
    throw new Error(`Missing handler for ${channel}`);
  }
  return handler({}, request);
}

function availableCapability(
  cli: "codex" | "claude" | "kimi",
  cliVersion: string,
): ExecutionCapabilitySnapshot {
  const input = {
    cli,
    cliVersion,
    status: "available" as const,
    models: [{
      id: `${cli}-model`,
      displayName: `${cli} model`,
      efforts: ["high"],
      defaultEffort: "high",
    }],
  };
  return {
    ...input,
    snapshotId: capabilitySnapshotId(input),
    checkedAt: "2026-07-26T00:00:00.000Z",
  };
}
