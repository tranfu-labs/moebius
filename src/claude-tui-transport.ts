export type ClaudeTuiTerminalData = string | Uint8Array;

export interface ClaudeTuiPtyExit {
  exitCode: number;
  signal?: number;
}

export interface ClaudeTuiPtySubscription {
  dispose(): void;
}

export interface ClaudeTuiPty {
  write(data: string): void;
  resize(columns: number, rows: number): void;
  kill(signal?: NodeJS.Signals): void;
  onData(listener: (data: ClaudeTuiTerminalData) => void): ClaudeTuiPtySubscription;
  onExit(listener: (event: ClaudeTuiPtyExit) => void): ClaudeTuiPtySubscription;
}

export interface ClaudeTuiPtySpawnOptions {
  executable: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  columns: number;
  rows: number;
}

export interface ClaudeTuiPtyFactory {
  spawn(options: ClaudeTuiPtySpawnOptions): ClaudeTuiPty;
}

export type ClaudeTuiTransportState = "active" | "idle" | "stopping";

export interface ClaudeTuiTransportSnapshot {
  generation: number;
  state: ClaudeTuiTransportState;
}

export type ClaudeTuiTransportEvent =
  | { type: "started"; generation: number }
  | { type: "input"; generation: number; bytes: number }
  | { type: "data"; generation: number; data: ClaudeTuiTerminalData }
  | { type: "idle"; generation: number }
  | { type: "idle-timeout"; generation: number }
  | { type: "termination-requested"; generation: number; reason: "idle" | "manual" }
  | { type: "kill-escalated"; generation: number }
  | { type: "exit"; generation: number; exitCode: number; signal?: number };

export type ClaudeTuiTransportErrorCode =
  | "claude-tui-not-running"
  | "claude-tui-already-running"
  | "claude-tui-stopping"
  | "claude-tui-empty-human-input"
  | "claude-tui-invalid-size";

export class ClaudeTuiTransportError extends Error {
  constructor(readonly code: ClaudeTuiTransportErrorCode) {
    super(code);
    this.name = "ClaudeTuiTransportError";
  }
}

interface ActivePty {
  generation: number;
  pty: ClaudeTuiPty;
  state: ClaudeTuiTransportState;
  dataSubscription: ClaudeTuiPtySubscription;
  exitSubscription: ClaudeTuiPtySubscription;
  idleTimer: NodeJS.Timeout | null;
  killTimer: NodeJS.Timeout | null;
}

export class ClaudeTuiTransport {
  private active: ActivePty | null = null;
  private nextGeneration = 1;

  constructor(private readonly options: {
    factory: ClaudeTuiPtyFactory;
    idleTimeoutMs: number;
    terminationGraceMs: number;
    onEvent?: (event: ClaudeTuiTransportEvent) => void;
  }) {}

  start(options: ClaudeTuiPtySpawnOptions): ClaudeTuiTransportSnapshot {
    if (this.active !== null) {
      throw new ClaudeTuiTransportError("claude-tui-already-running");
    }
    assertTerminalSize(options.columns, options.rows);
    const generation = this.nextGeneration;
    this.nextGeneration += 1;
    const pty = this.options.factory.spawn({
      ...options,
      args: [...options.args],
      env: { ...options.env },
    });
    const active: ActivePty = {
      generation,
      pty,
      state: "active",
      dataSubscription: { dispose() {} },
      exitSubscription: { dispose() {} },
      idleTimer: null,
      killTimer: null,
    };
    this.active = active;
    active.dataSubscription = pty.onData((data) => {
      if (this.active?.generation !== generation) return;
      this.emit({ type: "data", generation, data });
    });
    active.exitSubscription = pty.onExit((event) => {
      if (this.active?.generation !== generation) return;
      this.finish(active, event);
    });
    this.emit({ type: "started", generation });
    return { generation, state: active.state };
  }

  getSnapshot(): ClaudeTuiTransportSnapshot | null {
    if (this.active === null) return null;
    return { generation: this.active.generation, state: this.active.state };
  }

  writeHumanInput(input: string): ClaudeTuiTransportSnapshot {
    if (input.length === 0) {
      throw new ClaudeTuiTransportError("claude-tui-empty-human-input");
    }
    const active = this.requireWritable();
    this.clearIdleTimer(active);
    active.state = "active";
    active.pty.write(input);
    this.emit({
      type: "input",
      generation: active.generation,
      bytes: Buffer.byteLength(input, "utf8"),
    });
    return { generation: active.generation, state: active.state };
  }

  resize(columns: number, rows: number): void {
    assertTerminalSize(columns, rows);
    const active = this.requireWritable();
    active.pty.resize(columns, rows);
  }

  markTurnIdle(): ClaudeTuiTransportSnapshot {
    const active = this.requireWritable();
    this.clearIdleTimer(active);
    active.state = "idle";
    this.emit({ type: "idle", generation: active.generation });
    const generation = active.generation;
    active.idleTimer = setTimeout(() => {
      if (this.active?.generation !== generation || this.active.state !== "idle") return;
      this.active.idleTimer = null;
      this.emit({ type: "idle-timeout", generation });
      this.requestTermination(this.active, "idle");
    }, this.options.idleTimeoutMs);
    active.idleTimer.unref();
    return { generation: active.generation, state: active.state };
  }

  terminate(): boolean {
    if (this.active === null) return false;
    if (this.active.state === "stopping") return false;
    this.requestTermination(this.active, "manual");
    return true;
  }

  private requireWritable(): ActivePty {
    if (this.active === null) {
      throw new ClaudeTuiTransportError("claude-tui-not-running");
    }
    if (this.active.state === "stopping") {
      throw new ClaudeTuiTransportError("claude-tui-stopping");
    }
    return this.active;
  }

  private requestTermination(active: ActivePty, reason: "idle" | "manual"): void {
    this.clearIdleTimer(active);
    active.state = "stopping";
    this.emit({ type: "termination-requested", generation: active.generation, reason });
    active.pty.kill("SIGTERM");
    const generation = active.generation;
    active.killTimer = setTimeout(() => {
      if (this.active?.generation !== generation || this.active.state !== "stopping") return;
      this.active.killTimer = null;
      this.active.pty.kill("SIGKILL");
      this.emit({ type: "kill-escalated", generation });
    }, this.options.terminationGraceMs);
    active.killTimer.unref();
  }

  private finish(active: ActivePty, event: ClaudeTuiPtyExit): void {
    this.clearIdleTimer(active);
    this.clearKillTimer(active);
    active.dataSubscription.dispose();
    active.exitSubscription.dispose();
    this.active = null;
    this.emit({
      type: "exit",
      generation: active.generation,
      exitCode: event.exitCode,
      ...(event.signal === undefined ? {} : { signal: event.signal }),
    });
  }

  private clearIdleTimer(active: ActivePty): void {
    if (active.idleTimer !== null) {
      clearTimeout(active.idleTimer);
      active.idleTimer = null;
    }
  }

  private clearKillTimer(active: ActivePty): void {
    if (active.killTimer !== null) {
      clearTimeout(active.killTimer);
      active.killTimer = null;
    }
  }

  private emit(event: ClaudeTuiTransportEvent): void {
    this.options.onEvent?.(event);
  }
}

function assertTerminalSize(columns: number, rows: number): void {
  if (
    !Number.isSafeInteger(columns)
    || !Number.isSafeInteger(rows)
    || columns < 1
    || rows < 1
  ) {
    throw new ClaudeTuiTransportError("claude-tui-invalid-size");
  }
}
