import { randomBytes } from "node:crypto";
import { chmod, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ManagedProcessMcpInvocation,
  ManagedProcessToolCompletion,
} from "./execution-driver.js";
import { preflightManagedProcessMcpServer } from "./managed-process-mcp-preflight.js";
import type {
  ManagedProcessCapability,
  ManagedProcessSupervisor,
} from "./managed-process-supervisor.js";

type ManagedProcessSupervisorPort = Pick<
  ManagedProcessSupervisor,
  "createCapability" | "revokeCapability" | "onToolCompletion"
>;

export interface ClaudeTuiManagedProcessRelayProgram {
  command: string;
  bridgeArgs: readonly string[];
  environment: Readonly<Record<string, string>>;
}

export interface ClaudeTuiManagedProcessLeaseOptions {
  supervisor: ManagedProcessSupervisorPort;
  sessionId: string;
  workspaceRoot: string;
  capabilityPath: string;
  relayProgram: ClaudeTuiManagedProcessRelayProgram;
}

interface ActiveLease {
  id: number;
  capability: ManagedProcessCapability;
  providerRunId: string;
}

/**
 * Owns one persistent Claude TUI relay's mutable, per-turn authorization.
 * The relay receives only this file path; the capability text is created for
 * an active provider run and removed again before the next turn can use it.
 */
export class ClaudeTuiManagedProcessLease {
  readonly #supervisor: ManagedProcessSupervisorPort;
  readonly #sessionId: string;
  readonly #workspaceRoot: string;
  readonly #capabilityPath: string;
  readonly #relayProgram: ClaudeTuiManagedProcessRelayProgram;
  #active: ActiveLease | null = null;
  #operation = Promise.resolve();
  #nextLeaseId = 0;
  #closed = false;
  #closePromise: Promise<void> | null = null;

  constructor(input: ClaudeTuiManagedProcessLeaseOptions) {
    this.#supervisor = input.supervisor;
    this.#sessionId = input.sessionId;
    this.#workspaceRoot = input.workspaceRoot;
    this.#capabilityPath = path.resolve(input.capabilityPath);
    this.#relayProgram = input.relayProgram;
  }

  async acquireTurn(input: { providerRunId: string }): Promise<ManagedProcessMcpInvocation> {
    let active: ActiveLease | null = null;
    await this.#enqueue(async () => {
      if (this.#closed) throw new Error("Claude TUI managed-process relay is closed.");
      await this.#revokeActiveLease();
      const capability = this.#supervisor.createCapability({
        sessionId: this.#sessionId,
        providerRunId: input.providerRunId,
        workspaceRoot: this.#workspaceRoot,
      });
      const next: ActiveLease = {
        id: ++this.#nextLeaseId,
        capability,
        providerRunId: input.providerRunId,
      };
      try {
        await this.#writeCapability(capability.token);
      } catch (error) {
        this.#supervisor.revokeCapability(capability.token);
        throw error;
      }
      this.#active = next;
      active = next;
    });
    if (active === null) throw new Error("Claude TUI managed-process lease was not created.");
    return this.#invocationFor(active);
  }

  async close(): Promise<void> {
    if (this.#closePromise !== null) return await this.#closePromise;
    this.#closed = true;
    this.#closePromise = this.#enqueue(async () => {
      await this.#revokeActiveLease();
      await this.#unlinkCapability().catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    });
    return await this.#closePromise;
  }

  #invocationFor(active: ActiveLease): ManagedProcessMcpInvocation {
    const relay = {
      command: this.#relayProgram.command,
      args: [
        ...this.#relayProgram.bridgeArgs,
        active.capability.socketPath,
        this.#capabilityPath,
        "--lease-file",
      ],
      env: this.#relayProgram.environment,
    };
    return {
      ...relay,
      preflight: async () => await preflightManagedProcessMcpServer(relay),
      onToolCompletion: (listener) => this.#listenForCompletion(active, listener),
      close: async () => await this.#releaseIfCurrent(active.id),
    };
  }

  #listenForCompletion(
    active: ActiveLease,
    listener: (event: ManagedProcessToolCompletion) => void,
  ): () => void {
    return this.#supervisor.onToolCompletion(active.providerRunId, listener);
  }

  async #releaseIfCurrent(leaseId: number): Promise<void> {
    await this.#enqueue(async () => {
      if (this.#active?.id !== leaseId) return;
      await this.#revokeActiveLease();
    });
  }

  async #revokeActiveLease(): Promise<void> {
    const active = this.#active;
    this.#active = null;
    if (active === null) return;
    this.#supervisor.revokeCapability(active.capability.token);
    await this.#unlinkCapability();
  }

  async #writeCapability(token: string): Promise<void> {
    const directory = path.dirname(this.#capabilityPath);
    const temporaryPath = path.join(directory, `.${path.basename(this.#capabilityPath)}.${randomBytes(12).toString("hex")}.tmp`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(temporaryPath, token, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, this.#capabilityPath);
      await chmod(this.#capabilityPath, 0o600);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }

  async #unlinkCapability(): Promise<void> {
    await unlink(this.#capabilityPath);
  }

  async #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operation.then(operation, operation);
    this.#operation = result.then(
      () => undefined,
      () => undefined,
    );
    return await result;
  }
}
