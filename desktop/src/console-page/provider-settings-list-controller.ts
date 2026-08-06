import type { ProviderSettingsController, ProviderSettingsProfile } from "@moebius/console-ui";

import type { ProviderProfileListResult } from "../provider-profile-contract.js";

export interface ProviderSettingsListPort {
  listProviderProfiles(): Promise<ProviderProfileListResult>;
}

export interface ProviderSettingsListMessages {
  bridgeUnavailable: string;
  listFailed: string;
}

export class ProviderSettingsListController {
  private active = false;
  private generation = 0;

  constructor(
    private readonly getPort: () => ProviderSettingsListPort | undefined,
    private readonly publish: (state: ProviderSettingsController["state"]) => void,
    private readonly getMessages: () => ProviderSettingsListMessages,
  ) {}

  mount(): void {
    this.active = true;
  }

  unmount(): void {
    this.active = false;
    this.generation += 1;
  }

  refresh(): void {
    void this.load();
  }

  async load(): Promise<boolean> {
    const generation = ++this.generation;
    this.publish({ status: "loading" });
    const port = this.getPort();
    if (port === undefined) {
      this.publish({ status: "error", message: this.getMessages().bridgeUnavailable });
      return false;
    }
    try {
      const result = await port.listProviderProfiles();
      if (!this.active || generation !== this.generation) return false;
      this.publish(result.ok
        ? { status: "ready", profiles: result.value as ProviderSettingsProfile[] }
        : { status: "error", message: result.message });
      return result.ok;
    } catch {
      if (!this.active || generation !== this.generation) return false;
      this.publish({ status: "error", message: this.getMessages().listFailed });
      return false;
    }
  }
}
