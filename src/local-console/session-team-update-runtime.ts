import { formatLocalError } from "./runtime-domain.js";
import {
  decideSessionTeamSnapshotRead,
  decideSessionTeamUpdateCapability,
  decideSessionTeamUpdateInspectionCapability,
  decideSessionTeamUpdateIntent,
  decideSessionTeamUpdateProcessing,
  planSessionTeamUpdateBinding,
  projectAvailableSessionTeamUpdate,
  projectPersistedSessionTeamUpdate,
} from "./session-team-update-plan.js";
import type {
  LocalConsoleAgentTeamOwnership,
  LocalConsoleAgentTeamSnapshot,
  LocalConsoleSessionTeamUpdateRecord,
  LocalConsoleSessionTeamUpdateState,
  LocalConsoleStore,
} from "./types.js";

export interface LocalSessionTeamUpdateRuntimeInput {
  store: LocalConsoleStore;
  storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
  nowIso(): string;
  loadAgentTeamSnapshot?: (binding: { ownership: LocalConsoleAgentTeamOwnership; id: string }) => Promise<LocalConsoleAgentTeamSnapshot>;
  processPending(sessionId: string): void;
}

export class LocalSessionTeamUpdateRuntime {
  constructor(private readonly input: LocalSessionTeamUpdateRuntimeInput) {}

  async inspect(sessionId: string): Promise<LocalConsoleSessionTeamUpdateState> {
    const capability = decideSessionTeamUpdateInspectionCapability({
      load: this.input.loadAgentTeamSnapshot !== undefined,
      readSnapshot: this.input.store.listSessionAgentTeamSnapshot !== undefined,
      readRecord: this.input.store.readSessionTeamUpdateRecord !== undefined,
      writeCandidate: this.input.store.writeSessionAgentTeamCandidate !== undefined,
    });
    return await ({
      unavailable: async () => ({ status: "idle" as const, categories: [] }),
      available: async () => await this.inspectAvailable(sessionId),
    })[capability]();
  }

  private async inspectAvailable(sessionId: string): Promise<LocalConsoleSessionTeamUpdateState> {
    const existing = await this.input.storeCall("local-console-store-read-session-team-update", () =>
      this.input.store.readSessionTeamUpdateRecord!(sessionId));
    return await ({
      persisted: async () => await this.project(sessionId, existing),
      inspect: async () => await this.inspectSavedVersion(sessionId),
    })[decideSessionTeamUpdateIntent(existing.intent)]();
  }

  private async inspectSavedVersion(sessionId: string): Promise<LocalConsoleSessionTeamUpdateState> {
    const projects = await this.input.storeCall("local-console-store-list-projects", () => this.input.store.listProjects());
    const session = projects.flatMap((project) => project.sessions).find((candidate) => candidate.sessionId === sessionId);
    const binding = planSessionTeamUpdateBinding(session);
    const loadedBinding = binding as Extract<typeof binding, { kind: "load" }>;
    return await ({
      idle: async () => ({ status: "idle" as const, categories: [] }),
      load: async () => {
        const effective = await this.input.storeCall("local-console-store-list-session-agent-team-snapshot", () =>
          this.input.store.listSessionAgentTeamSnapshot!(sessionId));
        const candidate = await this.input.loadAgentTeamSnapshot!({ ownership: loadedBinding.ownership, id: loadedBinding.id });
        const projection = projectAvailableSessionTeamUpdate({ effective, candidate });
        await this.input.storeCall("local-console-store-write-session-team-candidate", () =>
          this.input.store.writeSessionAgentTeamCandidate!({ sessionId, snapshot: projection.persistedCandidate }));
        return projection.state;
      },
    })[binding.kind]();
  }

  async apply(sessionId: string, expectedUpdateToken?: string | null): Promise<LocalConsoleSessionTeamUpdateState> {
    return await this.beginAndPromote("local-console-store-begin-session-team-update", sessionId, expectedUpdateToken);
  }

  async retry(sessionId: string, expectedUpdateToken?: string | null): Promise<LocalConsoleSessionTeamUpdateState> {
    const capability = decideSessionTeamUpdateCapability(this.input.store.retrySessionTeamUpdate !== undefined);
    return await ({
      unavailable: async (): Promise<LocalConsoleSessionTeamUpdateState> => { throw new Error("session team update unavailable"); },
      available: async () => {
        await this.input.storeCall("local-console-store-retry-session-team-update", () =>
          this.input.store.retrySessionTeamUpdate!({ sessionId, expectedUpdateToken, now: this.input.nowIso() }));
        return await this.promote(sessionId);
      },
    })[capability]();
  }

  private async beginAndPromote(label: string, sessionId: string, expectedUpdateToken?: string | null) {
    const capability = decideSessionTeamUpdateCapability(this.input.store.beginSessionTeamUpdate !== undefined);
    return await ({
      unavailable: async (): Promise<LocalConsoleSessionTeamUpdateState> => { throw new Error("session team update unavailable"); },
      available: async () => {
        await this.input.storeCall(label, () => this.input.store.beginSessionTeamUpdate!({
          sessionId, expectedUpdateToken, now: this.input.nowIso(),
        }));
        return await this.promote(sessionId);
      },
    })[capability]();
  }

  async cancel(sessionId: string, expectedUpdateToken?: string | null): Promise<LocalConsoleSessionTeamUpdateState> {
    const capability = decideSessionTeamUpdateCapability(this.input.store.cancelSessionTeamUpdate !== undefined);
    return await ({
      unavailable: async (): Promise<LocalConsoleSessionTeamUpdateState> => { throw new Error("session team update unavailable"); },
      available: async () => {
        await this.input.storeCall("local-console-store-cancel-session-team-update", () =>
          this.input.store.cancelSessionTeamUpdate!({ sessionId, expectedUpdateToken, now: this.input.nowIso() }));
        this.input.processPending(sessionId);
        return await this.inspect(sessionId);
      },
    })[capability]();
  }

  private async promote(sessionId: string): Promise<LocalConsoleSessionTeamUpdateState> {
    try {
      await this.input.storeCall("local-console-store-promote-session-team-update", () =>
        this.input.store.applyPendingSessionContext({ sessionId, now: this.input.nowIso() }));
    } catch (error) {
      const capability = decideSessionTeamUpdateCapability(this.input.store.markSessionTeamUpdateFailed !== undefined);
      await ({
        unavailable: async () => undefined,
        available: async () => this.input.store.markSessionTeamUpdateFailed!({
          sessionId, code: "TEAM_UPDATE_APPLY_FAILED", summary: formatLocalError(error),
        }),
      })[capability]();
    }
    const record = await this.input.store.readSessionTeamUpdateRecord?.(sessionId);
    const state = await ({
      unavailable: async () => ({ status: "idle" as const, categories: [] }),
      available: async () => await this.project(sessionId, record!),
    })[decideSessionTeamUpdateCapability(record !== undefined)]();
    ({ process: () => this.input.processPending(sessionId), wait: () => undefined })[decideSessionTeamUpdateProcessing(state)]();
    return state;
  }

  private async project(sessionId: string, record: LocalConsoleSessionTeamUpdateRecord) {
    const effective = await ({
      empty: async () => null,
      read: async () => await this.input.store.listSessionAgentTeamSnapshot!(sessionId),
    })[decideSessionTeamSnapshotRead(this.input.store.listSessionAgentTeamSnapshot !== undefined)]();
    return projectPersistedSessionTeamUpdate({ effective, record });
  }
}
