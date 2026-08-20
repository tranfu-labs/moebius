import { createHash } from "node:crypto";

export interface LocalConsoleStateSnapshotCacheInput<T> {
  key: string;
  ifNoneMatch: string | undefined;
  getRevision(): string;
  shouldCache?(snapshot: T): boolean;
  load(): Promise<T>;
}

export type LocalConsoleStateSnapshotCacheResult =
  | { kind: "not-modified"; etag: string }
  | { kind: "snapshot"; etag: string; serialized: string };

interface CacheEntry {
  revision: string;
  etag: string;
  serialized: string;
}

/**
 * Reuses a completed state projection until the cheap state revision changes.
 * The in-flight map also prevents two simultaneous polls from rebuilding the
 * same large snapshot at the same time.
 */
export class LocalConsoleStateSnapshotCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<CacheEntry>>();

  constructor(private readonly maxEntries = 8) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("local console state cache requires a positive entry limit");
    }
  }

  async read<T>(input: LocalConsoleStateSnapshotCacheInput<T>): Promise<LocalConsoleStateSnapshotCacheResult> {
    for (;;) {
      const revision = input.getRevision();
      const cached = this.entries.get(input.key);
      if (cached !== undefined && cached.revision === revision) {
        this.touch(input.key, cached);
        return projectResult(cached, input.ifNoneMatch);
      }

      let pending = this.inFlight.get(input.key);
      if (pending === undefined) {
        pending = this.load(input);
        this.inFlight.set(input.key, pending);
        void pending.then(
          () => {
            if (this.inFlight.get(input.key) === pending) this.inFlight.delete(input.key);
          },
          () => {
            if (this.inFlight.get(input.key) === pending) this.inFlight.delete(input.key);
          },
        );
      }

      const loaded = await pending;
      if (loaded.revision !== input.getRevision()) continue;
      return projectResult(loaded, input.ifNoneMatch);
    }
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }

  private async load<T>(input: LocalConsoleStateSnapshotCacheInput<T>): Promise<CacheEntry> {
    const snapshot = await input.load();
    const serialized = JSON.stringify(snapshot);
    if (serialized === undefined) {
      throw new Error("local console state snapshot cannot be serialized");
    }
    const entry: CacheEntry = {
      revision: input.getRevision(),
      serialized,
      etag: `"${createHash("sha256").update(serialized).digest("base64url")}"`,
    };
    if (input.shouldCache?.(snapshot) !== false) this.touch(input.key, entry);
    return entry;
  }

  private touch(key: string, entry: CacheEntry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

function projectResult(entry: CacheEntry, ifNoneMatch: string | undefined): LocalConsoleStateSnapshotCacheResult {
  return ifNoneMatch === entry.etag
    ? { kind: "not-modified", etag: entry.etag }
    : { kind: "snapshot", etag: entry.etag, serialized: entry.serialized };
}
