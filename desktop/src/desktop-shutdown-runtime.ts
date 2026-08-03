import {
  planBeforeQuit,
  planDesktopShutdownRequest,
  planInstallerShutdownApproval,
  planLastWindowClosed,
} from "./desktop-shutdown-plan.js";
import {
  decideInstallShutdownIntent,
  decideRunningShutdownTasks,
  decideShutdownIntentConflict,
  resolveShutdownIntent,
  type DesktopShutdownIntent,
} from "./desktop-shutdown-intent-plan.js";

export class DesktopShutdownRuntime {
  readonly #closeLocalConsole: () => Promise<void>;
  readonly #closeStateWorkers: () => Promise<void>;
  readonly #quit: () => void;
  readonly #reportCleanupBlocked: () => Promise<void>;
  readonly #getRunningTaskCount: () => number;
  readonly #cancelRunningTasks: () => Promise<void>;
  readonly #confirmExit: (runningTaskCount: number) => Promise<boolean>;
  readonly #confirmInstall: (runningTaskCount: number) => Promise<boolean>;
  readonly #installUpdate: () => Promise<void>;
  #shutdownPromise: Promise<void> | null = null;
  #coordinationPromise: Promise<void> | null = null;
  #shutdownComplete = false;
  #isQuitting = false;
  #intent: DesktopShutdownIntent | null = null;

  constructor(input: {
    closeLocalConsole(): Promise<void>;
    closeStateWorkers(): Promise<void>;
    quit(): void;
    reportCleanupBlocked(): Promise<void>;
    getRunningTaskCount(): number;
    cancelRunningTasks(): Promise<void>;
    confirmExit(runningTaskCount: number): Promise<boolean>;
    confirmInstall(runningTaskCount: number): Promise<boolean>;
    installUpdate(): Promise<void>;
  }) {
    this.#closeLocalConsole = input.closeLocalConsole;
    this.#closeStateWorkers = input.closeStateWorkers;
    this.#quit = input.quit;
    this.#reportCleanupBlocked = input.reportCleanupBlocked;
    this.#getRunningTaskCount = input.getRunningTaskCount;
    this.#cancelRunningTasks = input.cancelRunningTasks;
    this.#confirmExit = input.confirmExit;
    this.#confirmInstall = input.confirmInstall;
    this.#installUpdate = input.installUpdate;
  }

  get isQuitting(): boolean {
    return this.#isQuitting;
  }

  recoverAfterInstallFailure(): void {
    this.#shutdownComplete = false;
    this.#isQuitting = false;
    this.#intent = null;
    this.#shutdownPromise = null;
  }

  hasRunningTasks(): boolean {
    return this.#getRunningTaskCount() > 0;
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
    await this.#requestIntent("exit");
  }

  async requestInstall(): Promise<void> {
    await this.#requestIntent("install-update");
  }

  async #requestIntent(intent: DesktopShutdownIntent): Promise<void> {
    if (decideShutdownIntentConflict(this.#intent, intent)) {
      await this.#coordinationPromise;
      return;
    }
    this.#intent = intent;
    const runningTaskCount = this.#getRunningTaskCount();
    const plan = planDesktopShutdownRequest({
      shutdownComplete: this.#shutdownComplete,
      shutdownPending: this.#shutdownPromise !== null,
      coordinationPending: this.#coordinationPromise !== null,
      hasRunningTasks: decideRunningShutdownTasks(runningTaskCount),
    });
    if (plan === "await-shutdown") {
      await this.#shutdown(resolveShutdownIntent(this.#intent));
      return;
    }
    if (plan === "await-coordination") {
      await this.#coordinationPromise;
      return;
    }
    if (plan === "shutdown") {
      if (decideInstallShutdownIntent(intent)) {
        this.#coordinationPromise = this.#coordinate(runningTaskCount, intent).finally(() => {
          this.#coordinationPromise = null;
        });
        await this.#coordinationPromise;
      } else {
        await this.#shutdown(intent);
      }
      return;
    }
    this.#coordinationPromise = this.#coordinate(runningTaskCount, intent).finally(() => {
      this.#coordinationPromise = null;
    });
    await this.#coordinationPromise;
  }

  async #coordinate(runningTaskCount: number, intent: DesktopShutdownIntent): Promise<void> {
    const approved = decideInstallShutdownIntent(intent)
      ? await this.#confirmInstall(runningTaskCount)
      : await this.#confirmExit(runningTaskCount);
    const approval = planInstallerShutdownApproval(approved);
    if (approval === "stay-open") {
      this.#intent = null;
      this.#isQuitting = false;
      return;
    }
    try {
      if (decideRunningShutdownTasks(runningTaskCount)) {
        await this.#cancelRunningTasks();
      }
    } catch {
      this.#intent = null;
      this.#isQuitting = false;
      await this.#reportCleanupBlocked();
      return;
    }
    await this.#shutdown(intent);
  }

  async #shutdown(intent: DesktopShutdownIntent): Promise<void> {
    this.#isQuitting = true;
    this.#shutdownPromise ??= this.#performShutdown(intent);
    await this.#shutdownPromise;
  }

  async #performShutdown(intent: DesktopShutdownIntent): Promise<void> {
    try {
      await this.#closeLocalConsole();
      await this.#closeStateWorkers();
      this.#shutdownComplete = true;
      if (decideInstallShutdownIntent(intent)) {
        await this.#installUpdate();
      } else {
        this.#quit();
      }
    } catch {
      this.recoverAfterInstallFailure();
      await this.#reportCleanupBlocked().catch(() => undefined);
    }
  }
}
