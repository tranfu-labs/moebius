import type {
  DesktopUpdateProvider,
  DesktopUpdateReadyStore,
  DesktopUpdateSkipStore,
  DesktopInstallAttemptContext,
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
  planDesktopUpdateState,
  planReadyUpdateVersion,
  planUpdateCheckAdmission,
  planUpdateFailureReason,
  resolveUpdateVersion,
} from "./desktop-update-plan.js";
import { startDesktopUpdateRuntime } from "./desktop-update-startup.js";
export type {
  DesktopUpdateProvider,
  DesktopUpdateReadyStore,
  DesktopUpdateSkipStore,
} from "./desktop-update-contract.js";

export interface DesktopUpdateRuntimeOptions {
  platform: NodeJS.Platform;
  arch: string;
  isPackaged: boolean;
  currentVersion: string;
  provider: DesktopUpdateProvider;
  readyStore: DesktopUpdateReadyStore;
  skipStore?: DesktopUpdateSkipStore;
  publish(state: DesktopUpdateState): void;
  /** Re-open runtime resources if the provider silently refuses installation. */
  onInstallFailure?: (input: {
    version: string;
    context: DesktopInstallAttemptContext;
  }) => Promise<void>;
  installWatchdogMs?: number;
}

export class DesktopUpdateRuntime {
  readonly #options: DesktopUpdateRuntimeOptions;
  readonly #listeners = new Set<(state: DesktopUpdateState) => void>();
  #state: DesktopUpdateState;
  #checkPromise: Promise<DesktopUpdateState> | null = null;
  #installInvoked = false;
  #installWatchdog: ReturnType<typeof setTimeout> | null = null;
  #installContext: DesktopInstallAttemptContext = { hadRunningTasks: false };
  #started = false;
  #skippedVersion: string | null = null;
  #remindLaterVersion: string | null = null;

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
    const result = await startDesktopUpdateRuntime({
      started: this.#started,
      isSupportedTarget: decideDesktopUpdateTarget(this.#options),
      currentVersion: this.#options.currentVersion,
      provider: this.#options.provider,
      readyStore: this.#options.readyStore,
      skipStore: this.#options.skipStore,
      skippedVersion: this.#skippedVersion,
      onReady: (version, skippedVersion) => {
        this.#skippedVersion = skippedVersion;
        this.#setState({ status: "ready", latestVersion: version });
      },
      check: () => this.check(),
    });
    this.#started = result.started;
    this.#skippedVersion = result.skippedVersion;
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

  async install(context: DesktopInstallAttemptContext = { hadRunningTasks: false }): Promise<void> {
    if (!planInstallationAdmission(this.#state, this.#installInvoked)) {
      return;
    }
    this.#installInvoked = true;
    this.#installContext = context;
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

  async remindLater(): Promise<DesktopUpdateState> {
    const version = this.#readyVersion();
    if (version !== undefined) {
      this.#remindLaterVersion = version;
      this.#setState({ status: "ready", latestVersion: version });
    }
    return this.#state;
  }

  async skipVersion(): Promise<DesktopUpdateState> {
    const version = this.#readyVersion();
    if (version === undefined) {
      return this.#state;
    }
    await this.#options.skipStore?.write({ version });
    this.#skippedVersion = version;
    this.#remindLaterVersion = null;
    this.#setState({ status: "ready", latestVersion: version });
    return this.#state;
  }

  async markInstallFailure(): Promise<void> {
    const version = this.#readyVersion()
      ?? resolveUpdateVersion(this.#state.latestVersion, this.#options.currentVersion);
    this.#installInvoked = false;
    this.#installContext = { hadRunningTasks: false };
    this.#remindLaterVersion = version;
    await this.#options.readyStore.write({ version }).catch(() => undefined);
    this.#setState({ status: "failed", latestVersion: version, reason: "install" });
  }

  async #recoverInstallFailure(version: string): Promise<void> {
    clearTimeout(this.#installWatchdog!);
    this.#installWatchdog = null;
    this.#installInvoked = false;
    const context = this.#installContext;
    this.#installContext = { hadRunningTasks: false };
    this.#remindLaterVersion = version;
    await this.#options.readyStore.write({ version }).catch(() => undefined);
    this.#setState({ status: "failed", reason: "install" });
    await this.#options.onInstallFailure?.({ version, context }).catch(() => undefined);
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
    this.#state = planDesktopUpdateState({
      currentState: this.#state,
      next,
      currentVersion: this.#options.currentVersion,
      skippedVersion: this.#skippedVersion,
      remindLaterVersion: this.#remindLaterVersion,
    });
    this.#options.publish(this.#state);
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }

  #readyVersion(): string | undefined {
    return planReadyUpdateVersion(this.#state);
  }
}
