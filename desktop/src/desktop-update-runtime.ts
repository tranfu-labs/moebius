import type {
  DesktopUpdateProvider,
  DesktopUpdateReadyStore,
  DesktopUpdateState,
} from "./desktop-update-contract.js";
import {
  decideDesktopUpdateTarget,
  decidePublishLatest,
  normalizeUpdateProgress,
  planCheckAdmission,
  planInstallWatchdogAction,
  planInstallWatchdogMs,
  planInstallationAdmission,
  planProgressBaseline,
  planReadyMarker,
  planReadyMarkerVersion,
  planShouldClearInstallWatchdog,
  planStartupAdmission,
  planUpdateCheckAdmission,
  planUpdateFailureReason,
  resolveUpdateVersion,
} from "./desktop-update-plan.js";
export type { DesktopUpdateProvider, DesktopUpdateReadyStore } from "./desktop-update-contract.js";

export interface DesktopUpdateRuntimeOptions {
  platform: NodeJS.Platform;
  arch: string;
  isPackaged: boolean;
  currentVersion: string;
  provider: DesktopUpdateProvider;
  readyStore: DesktopUpdateReadyStore;
  publish(state: DesktopUpdateState): void;
  /** Re-open runtime resources if the provider silently refuses installation. */
  onInstallFailure?: () => Promise<void>;
  installWatchdogMs?: number;
}

export class DesktopUpdateRuntime {
  readonly #options: DesktopUpdateRuntimeOptions;
  readonly #listeners = new Set<(state: DesktopUpdateState) => void>();
  #state: DesktopUpdateState;
  #checkPromise: Promise<DesktopUpdateState> | null = null;
  #installInvoked = false;
  #installWatchdog: ReturnType<typeof setTimeout> | null = null;
  #started = false;

  constructor(options: DesktopUpdateRuntimeOptions) {
    this.#options = options;
    this.#state = {
      status: "idle",
      currentVersion: options.currentVersion,
    };
    this.#bindProvider();
  }

  get state(): DesktopUpdateState {
    return this.#state;
  }

  subscribe(listener: (state: DesktopUpdateState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (planStartupAdmission(this.#started) === "skip") {
      return;
    }
    this.#started = true;
    if (!decideDesktopUpdateTarget(this.#options)) {
      return;
    }
    this.#options.provider.autoDownload = true;
    this.#options.provider.autoInstallOnAppQuit = false;
    const ready = await this.#options.readyStore.read().catch(() => null);
    const readyPlan = planReadyMarker(ready, this.#options.currentVersion);
    const restoredVersion = planReadyMarkerVersion(ready, this.#options.currentVersion);
    if (restoredVersion !== undefined) {
      this.#setState({ status: "ready", latestVersion: restoredVersion });
      return;
    }
    if (readyPlan === "clear") {
      await this.#options.readyStore.clear().catch(() => undefined);
    }
    await this.check();
  }

  async check(): Promise<DesktopUpdateState> {
    if (!decideDesktopUpdateTarget(this.#options)) {
      return this.#state;
    }
    if (planUpdateCheckAdmission(this.#state) === "skip") {
      return this.#state;
    }
    if (planCheckAdmission(this.#checkPromise) === "wait") {
      return this.#checkPromise!;
    }
    this.#setState({
      status: "checking",
      latestVersion: undefined,
      progress: undefined,
      reason: undefined,
    });
    this.#checkPromise = this.#runCheck().finally(() => {
      this.#checkPromise = null;
    });
    return this.#checkPromise;
  }

  async install(): Promise<void> {
    if (!planInstallationAdmission(this.#state, this.#installInvoked)) {
      return;
    }
    this.#installInvoked = true;
    const installVersion = resolveUpdateVersion(this.#state.latestVersion, this.#options.currentVersion);
    this.#setState({ status: "installing" });
    try {
      this.#options.provider.quitAndInstall();
      const watchdogMs = planInstallWatchdogMs(this.#options.installWatchdogMs);
      this.#installWatchdog = setTimeout(() => {
        this.#installWatchdog = null;
        if (planInstallWatchdogAction(this.#installInvoked) === "recover") {
          void this.#recoverInstallFailure(installVersion);
        }
      }, watchdogMs);
      this.#installWatchdog.unref?.();
    } catch {
      await this.#recoverInstallFailure(installVersion);
    }
  }

  async #recoverInstallFailure(version: string): Promise<void> {
    if (planShouldClearInstallWatchdog(this.#installWatchdog)) {
      clearTimeout(this.#installWatchdog!);
      this.#installWatchdog = null;
    }
    this.#installInvoked = false;
    await this.#options.readyStore.write({ version }).catch(() => undefined);
    this.#setState({ status: "failed", reason: "install" });
    await this.#options.onInstallFailure?.().catch(() => undefined);
  }

  async #runCheck(): Promise<DesktopUpdateState> {
    try {
      await this.#options.provider.checkForUpdates();
      if (decidePublishLatest(this.#state)) {
        this.#setState({ status: "latest", latestVersion: this.#options.currentVersion });
      }
    } catch {
      this.#setState({ status: "failed", reason: "unavailable" });
    }
    return this.#state;
  }

  #bindProvider(): void {
    this.#options.provider.on("checking-for-update", () => {
      this.#setState({ status: "checking" });
    });
    this.#options.provider.on("update-available", (info) => {
      const latestVersion = resolveUpdateVersion(info, this.#options.currentVersion);
      this.#setState({ status: "available", latestVersion });
    });
    this.#options.provider.on("update-not-available", (info) => {
      this.#setState({ status: "latest", latestVersion: resolveUpdateVersion(info, this.#options.currentVersion) });
    });
    this.#options.provider.on("download-progress", (info) => {
      const progress = normalizeUpdateProgress(info, planProgressBaseline(this.#state.progress));
      this.#setState({
        status: "downloading",
        latestVersion: this.#state.latestVersion,
        progress,
      });
    });
    this.#options.provider.on("update-downloaded", async (info) => {
      const version = resolveUpdateVersion(
        info,
        resolveUpdateVersion(this.#state.latestVersion, this.#options.currentVersion),
      );
      try {
        await this.#options.readyStore.write({ version });
        this.#setState({ status: "ready", latestVersion: version, progress: 100 });
      } catch {
        this.#setState({ status: "failed", reason: "download" });
      }
    });
    this.#options.provider.on("error", () => {
      this.#setState({ status: "failed", reason: planUpdateFailureReason(this.#state.status) });
    });
  }

  #setState(next: Partial<DesktopUpdateState> & Pick<DesktopUpdateState, "status">): void {
    this.#state = {
      ...this.#state,
      ...next,
      currentVersion: this.#options.currentVersion,
    };
    this.#options.publish(this.#state);
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}
