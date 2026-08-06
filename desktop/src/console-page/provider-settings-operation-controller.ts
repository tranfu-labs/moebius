import type { ProviderProfileIpcResult } from "../provider-profile-contract.js";
import type { ProviderSettingsListController } from "./provider-settings-list-controller.js";
import type { ProviderSettingsPort } from "./provider-settings-port.js";

export class ProviderSettingsOperationController {
  private active = false;
  private generation = 0;
  private readonly activeOperations = new Map<string, string>();

  constructor(
    private readonly getPort: () => ProviderSettingsPort | undefined,
    private readonly list: ProviderSettingsListController,
    private readonly publishBusyProfileId: (profileId: string | null) => void,
    private readonly publishError: (message: string | null) => void,
    private readonly getOperationFailedMessage: () => string,
  ) {}

  mount(): void {
    this.active = true;
  }

  unmount(): void {
    for (const operationId of this.activeOperations.values()) {
      void this.getPort()?.cancelProviderProfileOperation({ operationId });
    }
    this.activeOperations.clear();
    this.active = false;
    this.generation += 1;
  }

  cancel(): void {
    this.generation += 1;
    if (this.active) {
      this.publishBusyProfileId(null);
      this.publishError(null);
    }
  }

  async run<T>(profileId: string, operation: () => Promise<ProviderProfileIpcResult<T>>): Promise<boolean> {
    return (await this.runResult(profileId, operation)).ok;
  }

  private async runResult<T>(
    profileId: string,
    operation: () => Promise<ProviderProfileIpcResult<T>>,
  ): Promise<{ ok: boolean; code: string | null }> {
    const generation = ++this.generation;
    this.publishBusyProfileId(profileId);
    this.publishError(null);
    try {
      const result = await operation();
      if (!this.active || generation !== this.generation) return { ok: false, code: null };
      if (!result.ok) {
        this.publishError(result.message);
        return { ok: false, code: result.code };
      }
      return { ok: await this.list.load(), code: null };
    } catch {
      if (!this.active || generation !== this.generation) return { ok: false, code: null };
      this.publishError(this.getOperationFailedMessage());
      return { ok: false, code: null };
    } finally {
      if (this.active && generation === this.generation) this.publishBusyProfileId(null);
    }
  }

  async runCancellableResult<T>(
    profileId: string,
    operationId: string,
    operation: (operationId: string) => Promise<ProviderProfileIpcResult<T>>,
  ): Promise<{ ok: boolean; code: string | null }> {
    this.activeOperations.set(profileId, operationId);
    try {
      return await this.runResult(profileId, async () => await operation(operationId));
    } finally {
      if (this.activeOperations.get(profileId) === operationId) {
        this.activeOperations.delete(profileId);
      }
    }
  }

  async runCancellable<T>(
    profileId: string,
    operation: (operationId: string) => Promise<ProviderProfileIpcResult<T>>,
  ): Promise<boolean> {
    const operationId = globalThis.crypto.randomUUID();
    return (await this.runCancellableResult(profileId, operationId, operation)).ok;
  }

  cancelBackend(profileId: string): void {
    const operationId = this.activeOperations.get(profileId);
    if (operationId === undefined) return;
    this.activeOperations.delete(profileId);
    this.cancel();
    void this.getPort()?.cancelProviderProfileOperation({ operationId });
  }
}
