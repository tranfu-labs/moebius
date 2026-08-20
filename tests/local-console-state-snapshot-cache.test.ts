import { describe, expect, it } from "vitest";

import { LocalConsoleStateSnapshotCache } from "../src/local-console/state-snapshot-cache.js";

describe("local console state snapshot cache", () => {
  it("coalesces concurrent loads and answers an unchanged ETag without loading again", async () => {
    const cache = new LocalConsoleStateSnapshotCache();
    let revision = "1";
    let loadCount = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const load = async () => {
      loadCount += 1;
      await gate;
      return { revisionAtLoad: revision };
    };

    const firstRead = cache.read({ key: "default", ifNoneMatch: undefined, getRevision: () => revision, load });
    const concurrentRead = cache.read({ key: "default", ifNoneMatch: undefined, getRevision: () => revision, load });
    release();
    const [first, concurrent] = await Promise.all([firstRead, concurrentRead]);

    expect(loadCount).toBe(1);
    expect(first).toEqual(concurrent);
    expect(first.kind).toBe("snapshot");
    if (first.kind !== "snapshot") throw new Error("expected a snapshot");

    await expect(cache.read({
      key: "default",
      ifNoneMatch: first.etag,
      getRevision: () => revision,
      load,
    })).resolves.toEqual({ kind: "not-modified", etag: first.etag });
    expect(loadCount).toBe(1);

    revision = "2";
    const changed = await cache.read({
      key: "default",
      ifNoneMatch: first.etag,
      getRevision: () => revision,
      load,
    });
    expect(loadCount).toBe(2);
    expect(changed.kind).toBe("snapshot");
    expect(changed).not.toEqual(first);
  });

  it("bounds retained selections with least-recently-used eviction", async () => {
    const cache = new LocalConsoleStateSnapshotCache(2);
    let revision = "1";
    let loadCount = 0;
    const load = async () => ({ value: ++loadCount });

    await cache.read({ key: "a", ifNoneMatch: undefined, getRevision: () => revision, load });
    await cache.read({ key: "b", ifNoneMatch: undefined, getRevision: () => revision, load });
    await cache.read({ key: "a", ifNoneMatch: undefined, getRevision: () => revision, load });
    await cache.read({ key: "c", ifNoneMatch: undefined, getRevision: () => revision, load });
    await cache.read({ key: "b", ifNoneMatch: undefined, getRevision: () => revision, load });

    expect(loadCount).toBe(4);
  });

  it("does not retain a live projection that the caller marks as volatile", async () => {
    const cache = new LocalConsoleStateSnapshotCache();
    let loadCount = 0;
    const input = {
      key: "live",
      ifNoneMatch: undefined,
      getRevision: () => "1",
      shouldCache: () => false,
      load: async () => ({ live: ++loadCount }),
    };

    await cache.read(input);
    await cache.read(input);

    expect(loadCount).toBe(2);
  });
});
