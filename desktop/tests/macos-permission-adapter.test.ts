import { describe, expect, it, vi } from "vitest";

interface FakeChildProcess {
  stdout: { on(event: string, listener: (chunk: Buffer) => void): void };
  stderr: { on(event: string, listener: (chunk: Buffer) => void): void };
  on(event: string, listener: (...args: unknown[]) => void): void;
  kill: ReturnType<typeof vi.fn>;
  emitStdout(value: string): void;
  emitStderr(value: string): void;
  emitClose(code: number | null): void;
  emitError(error: Error): void;
}

const childHarness = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: childHarness.spawn,
}));

import { createMacOsPermissionAdapter } from "../src/macos-permission-adapter.js";

function createFakeChild(): FakeChildProcess {
  const stdoutListeners: Array<(chunk: Buffer) => void> = [];
  const stderrListeners: Array<(chunk: Buffer) => void> = [];
  const processListeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    stdout: {
      on(_event, listener) {
        stdoutListeners.push(listener);
      },
    },
    stderr: {
      on(_event, listener) {
        stderrListeners.push(listener);
      },
    },
    on(event, listener) {
      const listeners = processListeners.get(event) ?? [];
      listeners.push(listener);
      processListeners.set(event, listeners);
    },
    kill: vi.fn(),
    emitStdout(value) {
      for (const listener of stdoutListeners) listener(Buffer.from(value));
    },
    emitStderr(value) {
      for (const listener of stderrListeners) listener(Buffer.from(value));
    },
    emitClose(code) {
      for (const listener of processListeners.get("close") ?? []) listener(code);
    },
    emitError(error) {
      for (const listener of processListeners.get("error") ?? []) listener(error);
    },
  };
}

function startBridge(
  action: "status" | "request",
  output: string,
  code = 0,
  stderr = "",
): Promise<Awaited<ReturnType<ReturnType<typeof createMacOsPermissionAdapter>["read"]>>> {
  const child = createFakeChild();
  childHarness.spawn.mockReturnValueOnce(child);
  const adapter = createMacOsPermissionAdapter({ executablePath: "/tmp/permission-bridge", timeoutMs: 100 });
  const result = action === "status" ? adapter.read() : adapter.request();
  child.emitStdout(output);
  child.emitStderr(stderr);
  child.emitClose(code);
  return result;
}

describe("macOS notification permission adapter", () => {
  it("status/request 使用白名单动作并解析授权与分项设置", async () => {
    await expect(startBridge(
      "status",
      JSON.stringify({ authorizationStatus: "authorized", alert: "enabled", sound: "disabled", badge: "notSupported" }),
    )).resolves.toEqual({
      authorizationStatus: "authorized",
      alert: "enabled",
      sound: "disabled",
      badge: "notSupported",
      error: null,
    });
    expect(childHarness.spawn).toHaveBeenLastCalledWith(
      "/tmp/permission-bridge",
      ["status"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    await expect(startBridge(
      "request",
      JSON.stringify({ authorizationStatus: "provisional", alert: "enabled", sound: "enabled", badge: "enabled" }),
    )).resolves.toMatchObject({ authorizationStatus: "provisional", error: null });
    expect(childHarness.spawn).toHaveBeenLastCalledWith(
      "/tmp/permission-bridge",
      ["request"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  });

  it("bridge error、非零退出和无效 JSON 都安全返回不可用快照", async () => {
    await expect(startBridge("status", JSON.stringify({ error: "Notifications are not allowed" }), 1))
      .resolves.toMatchObject({ authorizationStatus: "unknown", error: "macos-permission-bridge-error:Notifications are not allowed" });
    await expect(startBridge("status", "{broken", 1, "bridge failed"))
      .resolves.toMatchObject({ authorizationStatus: "unknown", error: expect.stringContaining("macos-permission-bridge-parse:") });
    const child = createFakeChild();
    childHarness.spawn.mockReturnValueOnce(child);
    const result = createMacOsPermissionAdapter({ executablePath: "/tmp/permission-bridge", timeoutMs: 100 }).read();
    child.emitError(new Error("spawn denied"));
    await expect(result).resolves.toMatchObject({
      authorizationStatus: "unknown",
      alert: "unknown",
      error: "macos-permission-bridge-spawn:Error: spawn denied",
    });
  });

  it("桥无响应时超时并终止子进程", async () => {
    vi.useFakeTimers();
    try {
      const child = createFakeChild();
      childHarness.spawn.mockReturnValueOnce(child);
      const result = createMacOsPermissionAdapter({ executablePath: "/tmp/permission-bridge", timeoutMs: 25 }).read();
      await vi.advanceTimersByTimeAsync(25);
      await expect(result).resolves.toEqual({
        authorizationStatus: "unknown",
        alert: "unknown",
        sound: "unknown",
        badge: "unknown",
        error: "macos-permission-bridge-timeout:25ms",
      });
      expect(child.kill).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
