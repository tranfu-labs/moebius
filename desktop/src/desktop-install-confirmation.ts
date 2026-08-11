import type { DesktopInstallConfirmation } from "./desktop-update-contract.js";

interface PendingConfirmation {
  request: DesktopInstallConfirmation;
  resolve: (approved: boolean) => void;
}

export class DesktopInstallConfirmationBroker {
  readonly #publish: (request: DesktopInstallConfirmation) => void;
  readonly #pending = new Map<number, PendingConfirmation>();
  #nextRequestId = 1;

  constructor(publish: (request: DesktopInstallConfirmation) => void) {
    this.#publish = publish;
  }

  request(input: { version: string; runningTaskCount: number }): Promise<boolean> {
    const request: DesktopInstallConfirmation = {
      requestId: this.#nextRequestId++,
      version: input.version,
      runningTaskCount: input.runningTaskCount,
    };
    return new Promise<boolean>((resolve) => {
      this.#pending.set(request.requestId, { request, resolve });
      this.#publish(request);
    });
  }

  respond(requestId: number, approved: boolean): boolean {
    const pending = this.#pending.get(requestId);
    if (pending === undefined) {
      return false;
    }
    this.#pending.delete(requestId);
    pending.resolve(approved);
    return true;
  }

  cancelAll(): void {
    for (const pending of this.#pending.values()) {
      pending.resolve(false);
    }
    this.#pending.clear();
  }

  get pendingCount(): number {
    return this.#pending.size;
  }
}
