import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";

import type {
  OnboardingCliInstallSnapshot,
  OnboardingCliInstallStage,
  OnboardingCliInstallState,
  OnboardingCliInstallStatus,
} from "./cli-installer-contract.js";
import {
  getTrustedCliInstaller,
  type TrustedCliInstaller,
  type TrustedInstallerCommand,
} from "./cli-installer-registry.js";
import type { OnboardingCli } from "./cli-readiness-contract.js";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_HEARTBEAT_MS = 1_000;
const DEFAULT_TERMINATE_GRACE_MS = 1_000;
const DEFAULT_KILL_GRACE_MS = 1_000;

export type InstallerProcessSpawner = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export type InstallerProcessTerminator = (
  child: ChildProcess,
  signal: NodeJS.Signals,
) => void;

export interface OnboardingCliInstallManagerOptions {
  spawnProcess?: InstallerProcessSpawner;
  terminateProcess?: InstallerProcessTerminator;
  installerForCli?: (cli: OnboardingCli) => TrustedCliInstaller;
  onInstallSucceeded?: (cli: OnboardingCli) => void | Promise<void>;
  now?: () => Date;
  timeoutMs?: number;
  heartbeatMs?: number;
  terminateGraceMs?: number;
  killGraceMs?: number;
}

interface RunningInstall {
  cli: OnboardingCli;
  startedAt: string;
  children: Set<ChildProcess>;
  completion: Promise<OnboardingCliInstallSnapshot>;
  resolveCompletion: (snapshot: OnboardingCliInstallSnapshot) => void;
  rejectCompletion: (error: Error) => void;
  timeout: NodeJS.Timeout | null;
  heartbeat: NodeJS.Timeout | null;
  escalation: NodeJS.Timeout | null;
  reapDeadline: NodeJS.Timeout | null;
  terminalIntent: Exclude<OnboardingCliInstallStatus, "idle" | "running" | "succeeded"> | null;
  settled: boolean;
  completionRejected: boolean;
}

export class OnboardingCliInstallManager {
  private readonly spawnProcess: InstallerProcessSpawner;
  private readonly terminateProcess: InstallerProcessTerminator;
  private readonly installerForCli: (cli: OnboardingCli) => TrustedCliInstaller;
  private readonly onInstallSucceeded: (cli: OnboardingCli) => void | Promise<void>;
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private readonly heartbeatMs: number;
  private readonly terminateGraceMs: number;
  private readonly killGraceMs: number;
  private readonly listeners = new Set<(snapshot: OnboardingCliInstallSnapshot) => void>();
  private readonly running = new Map<OnboardingCli, RunningInstall>();
  private readonly state: OnboardingCliInstallState;

  constructor(options: OnboardingCliInstallManagerOptions = {}) {
    this.spawnProcess = options.spawnProcess ?? ((command, args, spawnOptions) =>
      spawn(command, [...args], spawnOptions));
    this.terminateProcess = options.terminateProcess ?? terminateInstallerProcess;
    this.installerForCli = options.installerForCli ?? getTrustedCliInstaller;
    this.onInstallSucceeded = options.onInstallSucceeded ?? (() => undefined);
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.terminateGraceMs = options.terminateGraceMs ?? DEFAULT_TERMINATE_GRACE_MS;
    this.killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    this.state = {
      codex: this.initialSnapshot("codex"),
      kimi: this.initialSnapshot("kimi"),
    };
  }

  getSnapshot(cli: OnboardingCli): OnboardingCliInstallSnapshot {
    return { ...this.state[cli] };
  }

  getState(): OnboardingCliInstallState {
    return {
      codex: this.getSnapshot("codex"),
      kimi: this.getSnapshot("kimi"),
    };
  }

  getRunningClis(): OnboardingCli[] {
    return (["codex", "kimi"] as const).filter((cli) => this.running.has(cli));
  }

  subscribe(listener: (snapshot: OnboardingCliInstallSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(cli: OnboardingCli): OnboardingCliInstallSnapshot {
    if (this.running.has(cli)) {
      return this.getSnapshot(cli);
    }

    const startedAt = this.now().toISOString();
    let resolveCompletion!: (snapshot: OnboardingCliInstallSnapshot) => void;
    let rejectCompletion!: (error: Error) => void;
    const completion = new Promise<OnboardingCliInstallSnapshot>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    // A background timeout may hit the bounded reap deadline before a caller starts waiting.
    // Keep the original promise rejectable for callers without creating an unhandled rejection.
    void completion.catch(() => undefined);
    const task: RunningInstall = {
      cli,
      startedAt,
      children: new Set(),
      completion,
      resolveCompletion,
      rejectCompletion,
      timeout: null,
      heartbeat: null,
      escalation: null,
      reapDeadline: null,
      terminalIntent: null,
      settled: false,
      completionRejected: false,
    };
    this.running.set(cli, task);
    this.publish(cli, "running", "starting", startedAt);
    task.timeout = setTimeout(() => {
      this.stop(task, "timed-out");
    }, this.timeoutMs);
    task.heartbeat = setInterval(() => {
      if (!task.settled) {
        this.publish(cli, "running", this.state[cli].stage, startedAt);
      }
    }, this.heartbeatMs);
    void this.execute(task);
    return this.getSnapshot(cli);
  }

  waitForCompletion(cli: OnboardingCli): Promise<OnboardingCliInstallSnapshot> {
    return this.running.get(cli)?.completion ?? Promise.resolve(this.getSnapshot(cli));
  }

  async cancel(cli: OnboardingCli): Promise<OnboardingCliInstallSnapshot> {
    const task = this.running.get(cli);
    if (task === undefined) {
      return this.getSnapshot(cli);
    }
    this.stop(task, "cancelled");
    return task.completion;
  }

  async cancelAll(): Promise<OnboardingCliInstallSnapshot[]> {
    return Promise.all(this.getRunningClis().map((cli) => this.cancel(cli)));
  }

  private async execute(task: RunningInstall): Promise<void> {
    try {
      const installer = this.installerForCli(task.cli);
      if (installer.cli !== task.cli) {
        throw new Error("trusted installer registry returned the wrong CLI");
      }
      if (installer.kind === "command") {
        await this.executeCommand(task, installer.command, "installing");
      } else {
        await this.executePipeline(task, installer);
      }
      if (task.terminalIntent !== null || task.settled) {
        this.finish(task, task.terminalIntent ?? "failed");
        return;
      }
      this.publish(task.cli, "running", "verifying", task.startedAt);
      await Promise.resolve(this.onInstallSucceeded(task.cli)).catch(() => undefined);
      this.finish(task, "succeeded");
    } catch {
      if (task.settled) {
        return;
      }
      if (task.terminalIntent === null) {
        this.stop(task, "failed");
      } else if (task.children.size === 0) {
        this.finish(task, task.terminalIntent);
      }
    }
  }

  private async executeCommand(
    task: RunningInstall,
    command: TrustedInstallerCommand,
    stage: OnboardingCliInstallStage,
  ): Promise<void> {
    this.publish(task.cli, "running", stage, task.startedAt);
    const child = this.spawnTrusted(command, {
      stdio: ["ignore", "ignore", "ignore"],
      shell: false,
      detached: process.platform !== "win32",
    });
    task.children.add(child);
    await waitForSuccessfulClose(child).finally(() => this.releaseChild(task, child));
  }

  private async executePipeline(
    task: RunningInstall,
    installer: Extract<TrustedCliInstaller, { kind: "pipeline" }>,
  ): Promise<void> {
    this.publish(task.cli, "running", "downloading", task.startedAt);
    const source = this.spawnTrusted(installer.source, {
      stdio: ["ignore", "pipe", "ignore"],
      shell: false,
      detached: process.platform !== "win32",
    });
    task.children.add(source);

    this.publish(task.cli, "running", "installing", task.startedAt);
    const destination = this.spawnTrusted(installer.destination, {
      stdio: ["pipe", "ignore", "ignore"],
      shell: false,
      detached: process.platform !== "win32",
    });
    task.children.add(destination);
    if (source.stdout === null || destination.stdin === null) {
      throw new Error("trusted installer pipeline streams are unavailable");
    }
    source.stdout.pipe(destination.stdin);
    await Promise.all([
      waitForSuccessfulClose(source).finally(() => this.releaseChild(task, source)),
      waitForSuccessfulClose(destination).finally(() => this.releaseChild(task, destination)),
    ]);
  }

  private spawnTrusted(command: TrustedInstallerCommand, options: SpawnOptions): ChildProcess {
    return this.spawnProcess(command.command, [...command.args], options);
  }

  private releaseChild(task: RunningInstall, child: ChildProcess): void {
    task.children.delete(child);
    if (
      task.children.size === 0
      && task.terminalIntent !== null
      && !task.settled
    ) {
      this.finish(task, task.terminalIntent);
    }
  }

  private stop(
    task: RunningInstall,
    status: Exclude<OnboardingCliInstallStatus, "idle" | "running" | "succeeded">,
  ): void {
    if (task.settled || task.terminalIntent !== null) {
      return;
    }
    task.terminalIntent = status;
    for (const child of task.children) {
      this.tryTerminate(child, "SIGTERM");
    }
    if (task.children.size === 0) {
      this.finish(task, status);
      return;
    }
    task.escalation = setTimeout(() => {
      for (const child of task.children) {
        this.tryTerminate(child, "SIGKILL");
      }
      task.reapDeadline = setTimeout(() => {
        if (task.children.size > 0 && !task.completionRejected) {
          task.completionRejected = true;
          task.rejectCompletion(new OnboardingCliInstallReapError(task.cli));
        }
      }, this.killGraceMs);
    }, this.terminateGraceMs);
  }

  private finish(
    task: RunningInstall,
    status: Exclude<OnboardingCliInstallStatus, "idle" | "running">,
  ): void {
    if (task.settled) {
      return;
    }
    task.settled = true;
    if (task.timeout !== null) clearTimeout(task.timeout);
    if (task.heartbeat !== null) clearInterval(task.heartbeat);
    if (task.escalation !== null) clearTimeout(task.escalation);
    if (task.reapDeadline !== null) clearTimeout(task.reapDeadline);
    if (task.children.size !== 0) {
      throw new Error("Cannot finish an installer task before every child process closes.");
    }
    this.running.delete(task.cli);
    const snapshot = this.publish(task.cli, status, null, task.startedAt);
    task.resolveCompletion(snapshot);
  }

  private tryTerminate(child: ChildProcess, signal: NodeJS.Signals): void {
    try {
      this.terminateProcess(child, signal);
    } catch {
      // The bounded reap deadline rejects shutdown coordination instead of claiming cleanup.
    }
  }

  private initialSnapshot(cli: OnboardingCli): OnboardingCliInstallSnapshot {
    return {
      cli,
      status: "idle",
      stage: null,
      revision: 0,
      displayCommand: this.installerForCli(cli).displayCommand,
      startedAt: null,
      updatedAt: this.now().toISOString(),
    };
  }

  private publish(
    cli: OnboardingCli,
    status: OnboardingCliInstallStatus,
    stage: OnboardingCliInstallStage | null,
    startedAt: string | null,
  ): OnboardingCliInstallSnapshot {
    const snapshot: OnboardingCliInstallSnapshot = {
      cli,
      status,
      stage,
      revision: this.state[cli].revision + 1,
      displayCommand: this.installerForCli(cli).displayCommand,
      startedAt,
      updatedAt: this.now().toISOString(),
    };
    this.state[cli] = snapshot;
    for (const listener of this.listeners) {
      listener({ ...snapshot });
    }
    return { ...snapshot };
  }
}

function waitForSuccessfulClose(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      child.off("error", onError);
      child.off("close", onClose);
      if (error === undefined) resolve();
      else reject(error);
    };
    const onError = (): void => finish(new Error("trusted installer failed to start"));
    const onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (code === 0) {
        finish();
      } else {
        finish(new Error(signal === null ? "trusted installer failed" : "trusted installer stopped"));
      }
    };
    child.once("error", onError);
    child.once("close", onClose);
  });
}

export class OnboardingCliInstallReapError extends Error {
  readonly code = "ONBOARDING_CLI_INSTALL_REAP_UNCONFIRMED";

  constructor(cli: OnboardingCli) {
    super(`Installer cleanup for ${cli} could not be confirmed.`);
    this.name = "OnboardingCliInstallReapError";
  }
}

function terminateInstallerProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The child may have exited between the task snapshot and the signal.
    }
  }
  child.kill(signal);
}
