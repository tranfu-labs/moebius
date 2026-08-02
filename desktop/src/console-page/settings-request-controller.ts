import { decideSettingsRequestAdmission } from "./settings-state.js";

export class SingleInFlightSettingsRequest {
  private inFlight: Promise<void> | null = null;

  get isRunning(): boolean {
    return this.inFlight !== null;
  }

  start(run: () => Promise<void>, onAccepted: () => void = () => undefined): boolean {
    const admission = decideSettingsRequestAdmission(this.inFlight !== null);
    if (admission.kind === "skip") return false;
    onAccepted();
    const request = Promise.resolve().then(run);
    this.inFlight = request.finally(() => {
      this.inFlight = null;
    });
    void this.inFlight.catch(() => undefined);
    return true;
  }
}
