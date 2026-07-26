import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OnboardingCliInstallManager,
  type InstallerProcessSpawner,
} from "../src/onboarding/cli-installer-manager.js";
import { getTrustedCliInstaller } from "../src/onboarding/cli-installer-registry.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("trusted onboarding CLI installer registry", () => {
  it("contains only fixed parameterized Codex and Kimi plans", () => {
    expect(getTrustedCliInstaller("codex")).toEqual({
      cli: "codex",
      kind: "command",
      displayCommand: "npm install -g @openai/codex",
      command: {
        command: "npm",
        args: ["install", "-g", "@openai/codex"],
      },
    });
    expect(getTrustedCliInstaller("kimi")).toEqual({
      cli: "kimi",
      kind: "pipeline",
      displayCommand: "curl -LsSf https://code.kimi.com/install.sh | bash",
      source: {
        command: "curl",
        args: ["-LsSf", "https://code.kimi.com/install.sh"],
      },
      destination: {
        command: "bash",
        args: ["-s", "--"],
      },
    });
  });
});

describe("onboarding CLI install manager", () => {
  it("deduplicates one CLI, uses safe npm argv, and verifies only that CLI", async () => {
    const harness = processHarness();
    const verified: string[] = [];
    const manager = new OnboardingCliInstallManager({
      spawnProcess: harness.spawn,
      onInstallSucceeded: (cli) => {
        verified.push(cli);
      },
    });
    const events: string[] = [];
    manager.subscribe((snapshot) => events.push(
      `${snapshot.cli}:${snapshot.status}:${snapshot.stage ?? "none"}`,
    ));

    const first = manager.start("codex");
    const duplicate = manager.start("codex");
    expect(duplicate.revision).toBe(first.revision);
    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0]).toMatchObject({
      command: "npm",
      args: ["install", "-g", "@openai/codex"],
      options: { shell: false },
    });

    harness.children[0]!.exit(0);
    await expect(manager.waitForCompletion("codex")).resolves.toMatchObject({
      cli: "codex",
      status: "succeeded",
      stage: null,
    });
    expect(verified).toEqual(["codex"]);
    expect(events).toContain("codex:running:verifying");
    expect(manager.getRunningClis()).toEqual([]);
  });

  it("runs Kimi as curl piped to bash without a shell command", async () => {
    const harness = processHarness();
    const manager = new OnboardingCliInstallManager({ spawnProcess: harness.spawn });
    manager.start("kimi");

    expect(harness.calls).toHaveLength(2);
    expect(harness.calls[0]).toMatchObject({
      command: "curl",
      args: ["-LsSf", "https://code.kimi.com/install.sh"],
      options: { shell: false },
    });
    expect(harness.calls[1]).toMatchObject({
      command: "bash",
      args: ["-s", "--"],
      options: { shell: false },
    });
    const received: Buffer[] = [];
    harness.children[1]!.stdin.on("data", (chunk: Buffer) => received.push(chunk));
    harness.children[0]!.stdout.end("trusted script");
    harness.children[0]!.exit(0);
    harness.children[1]!.exit(0);

    await expect(manager.waitForCompletion("kimi")).resolves.toMatchObject({
      status: "succeeded",
    });
    expect(Buffer.concat(received).toString("utf8")).toBe("trusted script");
  });

  it("allows Codex and Kimi to run concurrently while keeping their snapshots independent", async () => {
    const harness = processHarness();
    const manager = new OnboardingCliInstallManager({ spawnProcess: harness.spawn });
    manager.start("codex");
    manager.start("kimi");

    expect(manager.getRunningClis()).toEqual(["codex", "kimi"]);
    expect(harness.calls.map((call) => call.command)).toEqual(["npm", "curl", "bash"]);
    harness.children[0]!.exit(0);
    harness.children[1]!.exit(0);
    harness.children[2]!.exit(1);

    await expect(manager.waitForCompletion("codex")).resolves.toMatchObject({
      status: "succeeded",
    });
    await expect(manager.waitForCompletion("kimi")).resolves.toMatchObject({
      status: "failed",
    });
    expect(manager.getSnapshot("codex").status).toBe("succeeded");
    expect(manager.getSnapshot("kimi").status).toBe("failed");
  });

  it("cancels idempotently and returns a safe terminal snapshot", async () => {
    const harness = processHarness();
    const terminate = vi.fn((child: ChildProcess, signal: NodeJS.Signals) => {
      if (signal === "SIGTERM") {
        (child as FakeChild).exit(null, "SIGTERM");
      }
    });
    const manager = new OnboardingCliInstallManager({
      spawnProcess: harness.spawn,
      terminateProcess: terminate,
    });
    manager.start("codex");

    const cancelled = await manager.cancel("codex");
    await expect(manager.cancel("codex")).resolves.toEqual(cancelled);
    expect(cancelled).toMatchObject({
      status: "cancelled",
      stage: null,
    });
    expect(terminate).toHaveBeenCalledWith(harness.children[0], "SIGTERM");
    expect(JSON.stringify(cancelled)).not.toMatch(/stderr|pid|token|Users/u);
  });

  it("times out, escalates to SIGKILL, and settles only after the child really closes", async () => {
    vi.useFakeTimers();
    const harness = processHarness();
    const terminate = vi.fn();
    const manager = new OnboardingCliInstallManager({
      spawnProcess: harness.spawn,
      terminateProcess: terminate,
      timeoutMs: 100,
      heartbeatMs: 25,
      terminateGraceMs: 20,
      killGraceMs: 10,
    });
    manager.start("codex");
    const completion = manager.waitForCompletion("codex");

    let settled = false;
    void completion.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(121);
    expect(settled).toBe(false);
    expect(manager.getRunningClis()).toEqual(["codex"]);
    expect(terminate.mock.calls.map((call) => call[1])).toEqual(["SIGTERM", "SIGKILL"]);

    harness.children[0]!.exit(null, "SIGKILL");
    await vi.runAllTicks();
    await expect(completion).resolves.toMatchObject({
      status: "timed-out",
      stage: null,
    });
    expect(manager.getRunningClis()).toEqual([]);
  });

  it("rejects cleanup coordination instead of claiming success when SIGKILL is not reaped", async () => {
    vi.useFakeTimers();
    const harness = processHarness();
    const manager = new OnboardingCliInstallManager({
      spawnProcess: harness.spawn,
      terminateProcess: vi.fn(),
      timeoutMs: 100,
      heartbeatMs: 25,
      terminateGraceMs: 20,
      killGraceMs: 10,
    });
    manager.start("codex");
    const completion = manager.waitForCompletion("codex");

    await vi.advanceTimersByTimeAsync(131);
    await expect(completion).rejects.toMatchObject({
      code: "ONBOARDING_CLI_INSTALL_REAP_UNCONFIRMED",
    });
    expect(manager.getRunningClis()).toEqual(["codex"]);
    expect(manager.getSnapshot("codex").status).toBe("running");
  });

  it("cancelAll waits for both CLI tasks and every pipeline child to close", async () => {
    const harness = processHarness();
    const manager = new OnboardingCliInstallManager({
      spawnProcess: harness.spawn,
      terminateProcess: vi.fn(),
      terminateGraceMs: 10_000,
    });
    manager.start("codex");
    manager.start("kimi");

    let settled = false;
    const cancellation = manager.cancelAll().then((snapshots) => {
      settled = true;
      return snapshots;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    harness.children[0]!.exit(null, "SIGTERM");
    harness.children[1]!.exit(null, "SIGTERM");
    await Promise.resolve();
    expect(settled).toBe(false);

    harness.children[2]!.exit(null, "SIGTERM");
    await expect(cancellation).resolves.toEqual([
      expect.objectContaining({ cli: "codex", status: "cancelled" }),
      expect.objectContaining({ cli: "kimi", status: "cancelled" }),
    ]);
    expect(manager.getRunningClis()).toEqual([]);
  });
});

interface FakeChild extends ChildProcess {
  stdout: PassThrough;
  stdin: PassThrough;
  stderr: PassThrough;
  exit(code: number | null, signal?: NodeJS.Signals | null): void;
}

function processHarness(): {
  spawn: InstallerProcessSpawner;
  calls: Array<{ command: string; args: readonly string[]; options: SpawnOptions }>;
  children: FakeChild[];
} {
  const calls: Array<{ command: string; args: readonly string[]; options: SpawnOptions }> = [];
  const children: FakeChild[] = [];
  const spawnProcess: InstallerProcessSpawner = (command, args, options) => {
    const child = new EventEmitter() as FakeChild;
    Object.defineProperty(child, "pid", {
      value: 10_000 + children.length,
      configurable: true,
    });
    child.stdout = new PassThrough();
    child.stdin = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn(() => true);
    child.exit = (code, signal = null) => {
      child.emit("exit", code, signal);
      child.emit("close", code, signal);
    };
    calls.push({ command, args: [...args], options });
    children.push(child);
    return child;
  };
  return { spawn: spawnProcess, calls, children };
}
