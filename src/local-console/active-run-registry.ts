import type { ActiveLocalRun } from "./active-run.js";

export class LocalActiveRunRegistry {
  private readonly runs = new Map<string, ActiveLocalRun>();
  private revision = 0;

  getRevision(): number {
    return this.revision;
  }

  get(runId: string): ActiveLocalRun | undefined {
    return this.runs.get(runId);
  }

  set(runId: string, active: ActiveLocalRun): void {
    this.runs.set(runId, active);
    this.revision += 1;
  }

  delete(runId: string): void {
    if (!this.runs.delete(runId)) return;
    this.revision += 1;
  }

  touch(runId: string): void {
    if (!this.runs.has(runId)) return;
    this.revision += 1;
  }

  keys(): IterableIterator<string> {
    return this.runs.keys();
  }

  values(): IterableIterator<ActiveLocalRun> {
    return this.runs.values();
  }
}
