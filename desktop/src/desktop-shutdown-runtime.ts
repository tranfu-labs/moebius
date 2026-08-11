import {
  planBeforeQuit,
  planDesktopShutdownRequest,
  planLastWindowClosed,
} from "./desktop-shutdown-plan.js";
import {
  decideInstallShutdownIntent,
  decideRunningShutdownTasks,
  decideShutdownIntentConflict,
  resolveShutdownIntent,
  type DesktopShutdownIntent,
} from "./desktop-shutdown-intent-plan.js";
import { coordinateDesktopShutdown } from "./desktop-shutdown-coordinator.js";
import { performDesktopShutdown } from "./desktop-shutdown-execution.js";
import type {
  DesktopInstallAttemptContext,
  DesktopInstallFailure,
} from "./desktop-update-contract.js";

const noop = (): void => undefined;
const noopAsync = async (): Promise<void> => undefined;

export class DesktopShutdownRuntime {
  readonly #closeLocalConsole: () => Promise<void>;
  readonly #closeStateWorkers: () => Promise<void>;
  readonly #quit: () => void;
  readonly #reportCleanupBlocked: () => Promise<void>;
  readonly #getRunningTaskCount: () => number;
  readonly #cancelRunningTasks: () => Promise<void>;
  readonly #confirmExit: (runningTaskCount: number) => Promise<boolean>;
  readonly #confirmInstall: (runningTaskCount: number) => Promise<boolean>;
  readonly #installUpdate: (context?: DesktopInstallAttemptContext) => Promise<void>;
  readonly #getInstallVersion: () => string;
  readonly #reportInstallFailure: (failure: DesktopInstallFailure) => Promise<void>;
  readonly #stopUpdates: () => void;
  readonly #resumeUpdates: () => void;
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
    installUpdate(context?: DesktopInstallAttemptContext): Promise<void>;
    getInstallVersion?(): string;
    reportInstallFailure?(failure: DesktopInstallFailure): Promise<void>;
    stopUpdates?(): void;
    resumeUpdates?(): void;
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
    this.#getInstallVersion = input.getInstallVersion ?? (() => "unknown");
    this.#reportInstallFailure = input.reportInstallFailure ?? noopAsync;
    const { stopUpdates = noop, resumeUpdates = noop } = input;
    this.#stopUpdates = stopUpdates;
    this.#resumeUpdates = resumeUpdates;
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
      await this.#shutdown(resolveShutdownIntent(this.#intent), { hadRunningTasks: false });
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
        await this.#shutdown(intent, { hadRunningTasks: false });
      }
      return;
    }
    this.#coordinationPromise = this.#coordinate(runningTaskCount, intent).finally(() => {
      this.#coordinationPromise = null;
    });
    await this.#coordinationPromise;
  }

  async #coordinate(runningTaskCount: number, intent: DesktopShutdownIntent): Promise<void> {
    const result = await coordinateDesktopShutdown({
      intent,
      runningTaskCount,
      getRunningTaskCount: this.#getRunningTaskCount,
      confirmExit: this.#confirmExit,
      confirmInstall: this.#confirmInstall,
      cancelRunningTasks: this.#cancelRunningTasks,
      getInstallVersion: this.#getInstallVersion,
      reportCleanupBlocked: this.#reportCleanupBlocked,
      reportInstallFailure: this.#reportInstallFailure,
    });
    if (result.kind === "stay-open") {
      this.#intent = null;
      this.#isQuitting = false;
      return;
    }
    await this.#shutdown(intent, { hadRunningTasks: result.hadRunningTasks });
  }

  async #shutdown(intent: DesktopShutdownIntent, context: DesktopInstallAttemptContext): Promise<void> {
    this.#isQuitting = true;
    this.#shutdownPromise ??= performDesktopShutdown({
      intent,
      context,
      stopUpdates: this.#stopUpdates,
      resumeUpdates: this.#resumeUpdates,
      closeLocalConsole: this.#closeLocalConsole,
      closeStateWorkers: this.#closeStateWorkers,
      markShutdownComplete: () => {
        this.#shutdownComplete = true;
      },
      recoverAfterInstallFailure: () => this.recoverAfterInstallFailure(),
      installUpdate: (installContext) => this.#installUpdate(installContext),
      quit: this.#quit,
      getRunningTaskCount: this.#getRunningTaskCount,
      getInstallVersion: this.#getInstallVersion,
      reportCleanupBlocked: this.#reportCleanupBlocked,
      reportInstallFailure: this.#reportInstallFailure,
    });
    await this.#shutdownPromise;
  }
}
