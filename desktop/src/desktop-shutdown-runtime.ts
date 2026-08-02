import type { OnboardingCli } from "./onboarding/cli-readiness-contract.js";
import {
  planBeforeQuit,
  planDesktopShutdownRequest,
  planInstallerAccess,
  planInstallerShutdownApproval,
  planLastWindowClosed,
} from "./desktop-shutdown-plan.js";

export class DesktopShutdownRuntime {
  readonly #closeLocalConsole: () => Promise<void>;
  readonly #closeStateWorkers: () => Promise<void>;
  readonly #quit: () => void;
  readonly #getInstaller: () => {
    getRunningClis(): readonly OnboardingCli[];
    cancelAll(): Promise<unknown>;
  } | null;
  readonly #confirmInstallerCancellation: (running: readonly OnboardingCli[]) => Promise<boolean>;
  readonly #reportCleanupBlocked: () => Promise<void>;
  #shutdownPromise: Promise<void> | null = null;
  #coordinationPromise: Promise<void> | null = null;
  #shutdownComplete = false;
  #isQuitting = false;

  constructor(input: {
    closeLocalConsole(): Promise<void>;
    closeStateWorkers(): Promise<void>;
    quit(): void;
    getInstaller(): {
      getRunningClis(): readonly OnboardingCli[];
      cancelAll(): Promise<unknown>;
    } | null;
    confirmInstallerCancellation(running: readonly OnboardingCli[]): Promise<boolean>;
    reportCleanupBlocked(): Promise<void>;
  }) {
    this.#closeLocalConsole = input.closeLocalConsole;
    this.#closeStateWorkers = input.closeStateWorkers;
    this.#quit = input.quit;
    this.#getInstaller = input.getInstaller;
    this.#confirmInstallerCancellation = input.confirmInstallerCancellation;
    this.#reportCleanupBlocked = input.reportCleanupBlocked;
  }

  get isQuitting(): boolean {
    return this.#isQuitting;
  }

  hasRunningInstallers(): boolean {
    const installer = this.#getInstaller();
    const access = planInstallerAccess(installer !== null);
    if (access === "unavailable") {
      return false;
    }
    return installer!.getRunningClis().length > 0;
  }

  beforeQuit(preventDefault: () => void): void {
    const plan = planBeforeQuit(this.#shutdownComplete);
    if (plan === "coordinate") {
      preventDefault();
      void this.request();
    }
  }

  lastWindowClosed(): void {
    const plan = planLastWindowClosed(this.#isQuitting);
    if (plan === "coordinate") {
      void this.request();
    }
  }

  async request(): Promise<void> {
    const installer = this.#getInstaller();
    const access = planInstallerAccess(installer !== null);
    const running = access === "available" ? installer!.getRunningClis() : [];
    const plan = planDesktopShutdownRequest({
      shutdownComplete: this.#shutdownComplete,
      shutdownPending: this.#shutdownPromise !== null,
      coordinationPending: this.#coordinationPromise !== null,
      hasRunningInstallers: running.length > 0,
    });
    if (plan === "await-shutdown") {
      await this.#shutdown();
      return;
    }
    if (plan === "await-coordination") {
      await this.#coordinationPromise;
      return;
    }
    if (plan === "shutdown") {
      await this.#shutdown();
      return;
    }
    this.#coordinationPromise = this.#coordinate(running, installer!).finally(() => {
      this.#coordinationPromise = null;
    });
    await this.#coordinationPromise;
  }

  async #coordinate(
    running: readonly OnboardingCli[],
    installer: { cancelAll(): Promise<unknown> },
  ): Promise<void> {
    const approval = planInstallerShutdownApproval(
      await this.#confirmInstallerCancellation(running),
    );
    if (approval === "stay-open") {
      return;
    }
    try {
      await installer.cancelAll();
    } catch {
      await this.#reportCleanupBlocked();
      return;
    }
    await this.#shutdown();
  }

  async #shutdown(): Promise<void> {
    this.#isQuitting = true;
    this.#shutdownPromise ??= this.#performShutdown();
    await this.#shutdownPromise;
  }

  async #performShutdown(): Promise<void> {
    await this.#closeLocalConsole();
    await this.#closeStateWorkers();
    this.#shutdownComplete = true;
    this.#quit();
  }
}
