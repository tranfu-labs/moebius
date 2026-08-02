import type { OnboardingCli } from "./onboarding/cli-readiness-contract.js";
import {
  planBeforeQuit,
  planDesktopShutdownRequest,
  planInstallerShutdownApproval,
  planLastWindowClosed,
} from "./desktop-shutdown-plan.js";

export class DesktopShutdownRuntime {
  readonly #closeLocalConsole: () => Promise<void>;
  readonly #closeStateWorkers: () => Promise<void>;
  readonly #quit: () => void;
  readonly #getRunningInstallers: () => readonly OnboardingCli[];
  readonly #confirmInstallerCancellation: (running: readonly OnboardingCli[]) => Promise<boolean>;
  readonly #cancelInstallers: () => Promise<void>;
  readonly #reportCleanupBlocked: () => Promise<void>;
  #shutdownPromise: Promise<void> | null = null;
  #coordinationPromise: Promise<void> | null = null;
  #shutdownComplete = false;
  #isQuitting = false;

  constructor(input: {
    closeLocalConsole(): Promise<void>;
    closeStateWorkers(): Promise<void>;
    quit(): void;
    getRunningInstallers(): readonly OnboardingCli[];
    confirmInstallerCancellation(running: readonly OnboardingCli[]): Promise<boolean>;
    cancelInstallers(): Promise<void>;
    reportCleanupBlocked(): Promise<void>;
  }) {
    this.#closeLocalConsole = input.closeLocalConsole;
    this.#closeStateWorkers = input.closeStateWorkers;
    this.#quit = input.quit;
    this.#getRunningInstallers = input.getRunningInstallers;
    this.#confirmInstallerCancellation = input.confirmInstallerCancellation;
    this.#cancelInstallers = input.cancelInstallers;
    this.#reportCleanupBlocked = input.reportCleanupBlocked;
  }

  get isQuitting(): boolean {
    return this.#isQuitting;
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
    const running = this.#getRunningInstallers();
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
    this.#coordinationPromise = this.#coordinate(running).finally(() => {
      this.#coordinationPromise = null;
    });
    await this.#coordinationPromise;
  }

  async #coordinate(running: readonly OnboardingCli[]): Promise<void> {
    const approval = planInstallerShutdownApproval(
      await this.#confirmInstallerCancellation(running),
    );
    if (approval === "stay-open") {
      return;
    }
    try {
      await this.#cancelInstallers();
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
