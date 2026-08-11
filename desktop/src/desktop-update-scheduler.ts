import {
  DESKTOP_UPDATE_CHECK_INTERVAL_MS,
  planUpdateSchedulerStart,
} from "./desktop-update-plan.js";

export interface DesktopUpdatePowerMonitor {
  on(event: "resume", listener: () => void): this;
  off(event: "resume", listener: () => void): this;
}

export interface DesktopUpdateSchedulerOptions {
  check(): Promise<unknown>;
  powerMonitor: DesktopUpdatePowerMonitor;
  intervalMs?: number;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
}

export class DesktopUpdateScheduler {
  readonly #check: () => Promise<unknown>;
  readonly #powerMonitor: DesktopUpdatePowerMonitor;
  readonly #intervalMs: number;
  readonly #setInterval: typeof setInterval;
  readonly #clearInterval: typeof clearInterval;
  readonly #onResume = (): void => {
    void this.#runCheck();
  };
  #timer: ReturnType<typeof setInterval> | null = null;
  #started = false;

  constructor(options: DesktopUpdateSchedulerOptions) {
    this.#check = options.check;
    this.#powerMonitor = options.powerMonitor;
    this.#intervalMs = options.intervalMs ?? DESKTOP_UPDATE_CHECK_INTERVAL_MS;
    this.#setInterval = options.setInterval ?? setInterval;
    this.#clearInterval = options.clearInterval ?? clearInterval;
  }

  start(): void {
    if (planUpdateSchedulerStart(this.#started) === "skip") {
      return;
    }
    this.#started = true;
    this.#timer = this.#setInterval(() => {
      void this.#runCheck();
    }, this.#intervalMs);
    this.#timer.unref?.();
    this.#powerMonitor.on("resume", this.#onResume);
  }

  stop(): void {
    if (!this.#started) {
      return;
    }
    this.#started = false;
    if (this.#timer !== null) {
      this.#clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#powerMonitor.off("resume", this.#onResume);
  }

  get started(): boolean {
    return this.#started;
  }

  async #runCheck(): Promise<void> {
    await this.#check().catch(() => undefined);
  }
}
