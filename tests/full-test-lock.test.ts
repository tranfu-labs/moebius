import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LockWaitTimeoutError,
  acquireFullTestLock,
  reclaimReason,
  releaseLock,
  type AcquireOptions,
  type LockDeps,
  type LockMeta,
} from "../src/testing/full-test-lock.js";

let root: string;
let lockDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "moebius-lock-test-"));
  lockDir = path.join(root, "full-test.lock");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

interface Harness {
  deps: LockDeps;
  logs: string[];
  advance: (ms: number) => void;
  /** 记录 sleep 被调用的次数，用来断言「确实在排队」而不是空转。 */
  sleeps: number[];
}

function harness(options: { alivePids?: number[]; startAt?: number } = {}): Harness {
  const alive = new Set(options.alivePids ?? [process.pid]);
  let clock = options.startAt ?? 1_000_000;
  const logs: string[] = [];
  const sleeps: number[] = [];
  return {
    logs,
    sleeps,
    advance: (ms) => {
      clock += ms;
    },
    deps: {
      now: () => clock,
      isProcessAlive: (pid) => alive.has(pid),
      sleep: (ms) => {
        sleeps.push(ms);
        // 让时钟随排队推进，否则等待循环永远到不了 maxWaitMs。
        clock += ms;
        return Promise.resolve();
      },
      log: (message) => logs.push(message),
    },
  };
}

function options(overrides: Partial<AcquireOptions> = {}): AcquireOptions {
  return {
    lockDir,
    workspace: "/tmp/worktree-a",
    pid: process.pid,
    maxWaitMs: 60_000,
    staleAfterMs: 45 * 60 * 1000,
    pollMs: 5_000,
    ...overrides,
  };
}

function writeHolder(meta: Partial<LockMeta> & { pid: number }): LockMeta {
  mkdirSync(lockDir, { recursive: true });
  const full: LockMeta = {
    token: meta.token ?? "holder-token",
    pid: meta.pid,
    startedAtMs: meta.startedAtMs ?? 1_000_000,
    workspace: meta.workspace ?? "/tmp/worktree-b",
  };
  writeFileSync(path.join(lockDir, "meta.json"), JSON.stringify(full), "utf8");
  return full;
}

describe("acquireFullTestLock", () => {
  it("空闲时立即取得，并写下可供他人识别的持有者信息", async () => {
    const h = harness();
    const handle = await acquireFullTestLock(options(), h.deps);

    expect(handle.meta.pid).toBe(process.pid);
    expect(handle.meta.workspace).toBe("/tmp/worktree-a");
    expect(existsSync(lockDir)).toBe(true);

    const onDisk: LockMeta = JSON.parse(readFileSync(path.join(lockDir, "meta.json"), "utf8"));
    expect(onDisk.token).toBe(handle.meta.token);
    expect(h.sleeps).toEqual([]);
  });

  it("被活跃持有者占用时排队等待，直到超过上限才放弃", async () => {
    writeHolder({ pid: 4242, startedAtMs: 1_000_000 });
    const h = harness({ alivePids: [4242] });

    await expect(
      acquireFullTestLock(options({ maxWaitMs: 12_000, pollMs: 5_000 }), h.deps),
    ).rejects.toBeInstanceOf(LockWaitTimeoutError);

    // 确实在排队（而不是立刻失败），且把持有者身份告诉了用户。
    expect(h.sleeps.length).toBeGreaterThan(0);
    expect(h.logs.join("\n")).toContain("pid 4242");
  });

  it("排队超时携带持有者信息，方便直接定位是谁占着", async () => {
    writeHolder({ pid: 4242, workspace: "/tmp/worktree-b" });
    const h = harness({ alivePids: [4242] });

    await acquireFullTestLock(options({ maxWaitMs: 1 }), h.deps).then(
      () => expect.unreachable("不该取得锁"),
      (error: unknown) => {
        expect(error).toBeInstanceOf(LockWaitTimeoutError);
        expect((error as LockWaitTimeoutError).holder?.pid).toBe(4242);
        expect((error as Error).message).toContain("/tmp/worktree-b");
      },
    );
  });

  it("持有者进程已死时抢占僵尸锁——否则一次崩溃会把机器堵到 stale 超时", async () => {
    writeHolder({ pid: 999_999 });
    const h = harness({ alivePids: [process.pid] });

    const handle = await acquireFullTestLock(options(), h.deps);

    expect(handle.meta.pid).toBe(process.pid);
    expect(h.logs.join("\n")).toContain("dead-holder");
  });

  it("持有者还活着但持有超时时抢占，避免被卡死的进程永久堵塞", async () => {
    writeHolder({ pid: 4242, startedAtMs: 1_000_000 });
    // 时钟已经走过 staleAfterMs。
    const h = harness({ alivePids: [4242], startAt: 1_000_000 + 46 * 60 * 1000 });

    const handle = await acquireFullTestLock(options({ staleAfterMs: 45 * 60 * 1000 }), h.deps);

    expect(handle.meta.pid).toBe(process.pid);
    expect(h.logs.join("\n")).toContain("stale");
  });

  it("锁目录存在但 meta 不可读时抢占，不被半个锁堵死", async () => {
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(path.join(lockDir, "meta.json"), "{ not json", "utf8");
    const h = harness();

    const handle = await acquireFullTestLock(options(), h.deps);

    expect(handle.meta.pid).toBe(process.pid);
    expect(h.logs.join("\n")).toContain("unreadable");
  });

  it("持有者中途释放后，排队者拿到锁", async () => {
    const holder = writeHolder({ pid: 4242 });
    const h = harness({ alivePids: [4242] });

    // 第一次 sleep 时模拟持有者释放。
    let released = false;
    const deps: LockDeps = {
      ...h.deps,
      sleep: (ms) => {
        if (!released) {
          releaseLock(lockDir, holder.token);
          released = true;
        }
        return h.deps.sleep(ms);
      },
    };

    const handle = await acquireFullTestLock(options({ maxWaitMs: 60_000 }), deps);
    expect(handle.meta.pid).toBe(process.pid);
  });
});

describe("releaseLock", () => {
  it("持有者释放后锁目录消失", async () => {
    const h = harness();
    const handle = await acquireFullTestLock(options(), h.deps);

    handle.release();

    expect(existsSync(lockDir)).toBe(false);
  });

  it("token 不匹配时拒绝释放——不能删掉别人的锁", () => {
    writeHolder({ pid: 4242, token: "someone-else" });

    expect(releaseLock(lockDir, "my-token")).toBe(false);
    expect(existsSync(lockDir)).toBe(true);
  });

  it("锁已被抢占后，原持有者的释放是空操作", async () => {
    const h = harness();
    const handle = await acquireFullTestLock(options(), h.deps);
    // 模拟我们的锁被判为 stale 后被别人接管。
    writeHolder({ pid: 4242, token: "new-owner" });

    handle.release();

    expect(existsSync(lockDir)).toBe(true);
    const onDisk: LockMeta = JSON.parse(readFileSync(path.join(lockDir, "meta.json"), "utf8"));
    expect(onDisk.token).toBe("new-owner");
  });

  it("释放后可以再次取得", async () => {
    const h = harness();
    const first = await acquireFullTestLock(options(), h.deps);
    first.release();

    const second = await acquireFullTestLock(options(), h.deps);
    expect(second.meta.token).not.toBe(first.meta.token);
  });
});

describe("reclaimReason", () => {
  const h = harness({ alivePids: [4242] });

  it("活跃且未超时的持有者不可抢占", () => {
    expect(
      reclaimReason(
        { token: "t", pid: 4242, startedAtMs: h.deps.now(), workspace: "/tmp/b" },
        { staleAfterMs: 1_000 },
        h.deps,
      ),
    ).toBeNull();
  });

  it("meta 读不出来算 unreadable", () => {
    expect(reclaimReason(null, { staleAfterMs: 1_000 }, h.deps)).toBe("unreadable");
  });
});
