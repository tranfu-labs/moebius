import type { ActiveLocalRun } from "./active-run.js";

export class LocalActiveRunRegistry {
  private readonly runs = new Map<string, ActiveLocalRun>();

  get(runId: string): ActiveLocalRun | undefined {
    return this.runs.get(runId);
  }

  set(runId: string, active: ActiveLocalRun): void {
    this.runs.set(runId, active);
  }

  delete(runId: string): void {
    this.runs.delete(runId);
  }

  keys(): IterableIterator<string> {
    return this.runs.keys();
  }

  values(): IterableIterator<ActiveLocalRun> {
    return this.runs.values();
  }
}
