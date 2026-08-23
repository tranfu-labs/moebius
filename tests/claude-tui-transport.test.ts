import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ClaudeTuiTransport,
  ClaudeTuiTransportError,
  type ClaudeTuiPty,
  type ClaudeTuiPtyExit,
  type ClaudeTuiPtyFactory,
  type ClaudeTuiPtySpawnOptions,
  type ClaudeTuiTerminalData,
} from "../src/claude-tui-transport.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("ClaudeTuiTransport", () => {
  it("keeps one PTY, writes only the supplied human input, and forwards ordered raw data", () => {
    const factory = new FakePtyFactory();
    const events: unknown[] = [];
    const transport = createTransport(factory, events);

    expect(transport.start(spawnOptions())).toEqual({ generation: 1, state: "active" });
    expect(factory.spawnCalls).toHaveLength(1);
    expect(factory.spawnCalls[0]).toMatchObject({
      executable: "/tmp/claude",
      args: ["--session-id", "S"],
      cwd: "/tmp/workspace",
      columns: 120,
      rows: 36,
    });

    transport.writeHumanInput("human input\r");
    factory.latest.emitData(new Uint8Array([0x1b, 0x5b, 0x33, 0x31, 0x6d]));
    factory.latest.emitData("done\r\n");

    expect(factory.latest.writes).toEqual(["human input\r"]);
    expect(events).toEqual([
      { type: "started", generation: 1 },
      { type: "input", generation: 1, bytes: 12 },
      { type: "data", generation: 1, data: new Uint8Array([0x1b, 0x5b, 0x33, 0x31, 0x6d]) },
      { type: "data", generation: 1, data: "done\r\n" },
    ]);
    expectTransportError(
      () => transport.start(spawnOptions()),
      "claude-tui-already-running",
    );
  });

  it("rejects empty or unavailable input without writing a synthetic terminal command", () => {
    const factory = new FakePtyFactory();
    const transport = createTransport(factory, []);

    expectTransportError(
      () => transport.writeHumanInput("input"),
      "claude-tui-not-running",
    );
    transport.start(spawnOptions());
    expectTransportError(
      () => transport.writeHumanInput(""),
      "claude-tui-empty-human-input",
    );
    expect(factory.latest.writes).toEqual([]);
  });

  it("cancels idle shutdown when the same PTY receives the next human input", () => {
    vi.useFakeTimers();
    const factory = new FakePtyFactory();
    const transport = createTransport(factory, [], { idleTimeoutMs: 20 });
    transport.start(spawnOptions());

    expect(transport.markTurnIdle()).toEqual({ generation: 1, state: "idle" });
    vi.advanceTimersByTime(10);
    expect(transport.writeHumanInput("next\r")).toEqual({ generation: 1, state: "active" });
    vi.advanceTimersByTime(20);

    expect(factory.latest.kills).toEqual([]);
    expect(factory.latest.writes).toEqual(["next\r"]);
  });

  it("exits only after idle threshold and escalates a stuck PTY once", () => {
    vi.useFakeTimers();
    const factory = new FakePtyFactory();
    const events: unknown[] = [];
    const transport = createTransport(factory, events, { idleTimeoutMs: 20, terminationGraceMs: 5 });
    transport.start(spawnOptions());
    transport.markTurnIdle();

    vi.advanceTimersByTime(19);
    expect(factory.latest.kills).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(factory.latest.kills).toEqual(["SIGTERM"]);
    expect(transport.getSnapshot()).toEqual({ generation: 1, state: "stopping" });
    vi.advanceTimersByTime(5);
    expect(factory.latest.kills).toEqual(["SIGTERM", "SIGKILL"]);

    factory.latest.emitExit({ exitCode: 0, signal: 9 });
    expect(transport.getSnapshot()).toBeNull();
    expect(events).toContainEqual({ type: "idle-timeout", generation: 1 });
    expect(events).toContainEqual({ type: "kill-escalated", generation: 1 });
    expect(events).toContainEqual({ type: "exit", generation: 1, exitCode: 0, signal: 9 });
  });

  it("releases a nonzero-exit PTY and permits one later generation", () => {
    const factory = new FakePtyFactory();
    const events: unknown[] = [];
    const transport = createTransport(factory, events);
    transport.start(spawnOptions());

    factory.latest.emitExit({ exitCode: 17 });
    expect(transport.getSnapshot()).toBeNull();
    expect(transport.start(spawnOptions())).toEqual({ generation: 2, state: "active" });
    expect(factory.spawnCalls).toHaveLength(2);
    expect(events).toContainEqual({ type: "exit", generation: 1, exitCode: 17 });
  });

  it("validates terminal dimensions and refuses writes while termination is in flight", () => {
    const factory = new FakePtyFactory();
    const transport = createTransport(factory, []);

    expect(() => transport.start({ ...spawnOptions(), columns: 0 })).toThrow(ClaudeTuiTransportError);
    transport.start(spawnOptions());
    expectTransportError(
      () => transport.resize(120.5, 30),
      "claude-tui-invalid-size",
    );
    expect(transport.terminate()).toBe(true);
    expect(transport.terminate()).toBe(false);
    expectTransportError(
      () => transport.writeHumanInput("later\r"),
      "claude-tui-stopping",
    );
  });
});

function createTransport(
  factory: ClaudeTuiPtyFactory,
  events: unknown[],
  overrides: Partial<ConstructorParameters<typeof ClaudeTuiTransport>[0]> = {},
): ClaudeTuiTransport {
  return new ClaudeTuiTransport({
    factory,
    idleTimeoutMs: 100,
    terminationGraceMs: 20,
    onEvent: (event) => events.push(event),
    ...overrides,
  });
}

function spawnOptions(): ClaudeTuiPtySpawnOptions {
  return {
    executable: "/tmp/claude",
    args: ["--session-id", "S"],
    cwd: "/tmp/workspace",
    env: { PATH: "/tmp/bin" },
    columns: 120,
    rows: 36,
  };
}

function expectTransportError(
  operation: () => unknown,
  code: ConstructorParameters<typeof ClaudeTuiTransportError>[0],
): void {
  let observed: unknown = null;
  try {
    operation();
  } catch (error) {
    observed = error;
  }
  expect(observed).toBeInstanceOf(ClaudeTuiTransportError);
  expect(observed).toMatchObject({ code });
}

class FakePtyFactory implements ClaudeTuiPtyFactory {
  readonly spawnCalls: ClaudeTuiPtySpawnOptions[] = [];
  readonly terminals: FakePty[] = [];

  get latest(): FakePty {
    const terminal = this.terminals.at(-1);
    if (terminal === undefined) throw new Error("fake-pty-not-started");
    return terminal;
  }

  spawn(options: ClaudeTuiPtySpawnOptions): ClaudeTuiPty {
    this.spawnCalls.push(options);
    const terminal = new FakePty();
    this.terminals.push(terminal);
    return terminal;
  }
}

class FakePty implements ClaudeTuiPty {
  readonly writes: string[] = [];
  readonly kills: Array<NodeJS.Signals | undefined> = [];
  readonly sizes: Array<{ columns: number; rows: number }> = [];
  private dataListeners = new Set<(data: ClaudeTuiTerminalData) => void>();
  private exitListeners = new Set<(event: ClaudeTuiPtyExit) => void>();

  write(data: string): void {
    this.writes.push(data);
  }

  resize(columns: number, rows: number): void {
    this.sizes.push({ columns, rows });
  }

  kill(signal?: NodeJS.Signals): void {
    this.kills.push(signal);
  }

  onData(listener: (data: ClaudeTuiTerminalData) => void) {
    this.dataListeners.add(listener);
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
