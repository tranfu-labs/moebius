/**
 * 跨 worktree 的全量测试互斥锁。
 *
 * 为什么需要：本仓库的全量测试是串行的（`--maxWorkers=1 --no-file-parallelism`），
 * 且有大量等待真实 I/O 的断言。多个 worktree 同时跑全量测试时，彼此抢 CPU 会让这些
 * 断言直接撞上 deadline——表现不是「慢一点」而是「随机变红」。红了就重跑，重跑又加剧
 * 竞争，形成正反馈。锁把这个正反馈掐断：同一时刻只有一套全量测试在跑。
 *
 * 锁放在系统临时目录而非仓库内，因为每个 worktree 有各自的工作区路径，仓库内的锁互相看不见。
 *
 * 等待发生在这里（一个阻塞的 node 进程里），而不是让上层 agent 每分钟醒来轮询一次——
 * 后者每轮都要烧一次模型调用。
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** 锁持有者写在锁目录里的信息。 */
export interface LockMeta {
  /** 一次持有的唯一标识。pid 会被系统复用，所以释放时校验的是它而不是 pid。 */
  token: string;
  pid: number;
  startedAtMs: number;
  /** 持有者所在的工作区，等待方打印出来好知道是谁占着。 */
  workspace: string;
}

export interface LockDeps {
  now: () => number;
  /** 探测进程是否存活，用来识别持有者已经死掉的僵尸锁。 */
  isProcessAlive: (pid: number) => boolean;
  sleep: (ms: number) => Promise<void>;
  log: (message: string) => void;
}

export interface AcquireOptions {
  lockDir: string;
  workspace: string;
  pid: number;
  /** 等不到锁的上限。超时不是测试失败，调用方要按「没拿到锁」区别对待。 */
  maxWaitMs: number;
  /** 持有者还活着、但持有超过这个时长就抢占，避免被卡死的进程永久堵住。 */
  staleAfterMs: number;
  /** 等待期两次探测的间隔。 */
  pollMs: number;
}

export interface LockHandle {
  meta: LockMeta;
  release: () => void;
}

/** 等不到锁时抛这个，调用方据此区分「排队超时」和「测试失败」。 */
export class LockWaitTimeoutError extends Error {
  constructor(
    readonly waitedMs: number,
    readonly holder: LockMeta | null,
  ) {
    const held = holder
      ? `pid ${String(holder.pid)} @ ${holder.workspace}`
      : "unknown holder";
    super(
      `waited ${String(Math.round(waitedMs / 1000))}s for the full-test lock without acquiring it ` +
        `(current holder: ${held})`,
    );
    this.name = "LockWaitTimeoutError";
  }
}

export const DEFAULT_LOCK_DIR = path.join(tmpdir(), "moebius-full-test.lock");

/** 单套全量测试实测约 10–20 分钟，45 分钟仍未释放基本可以判定是卡死而非正常运行。 */
export const DEFAULT_STALE_AFTER_MS = 45 * 60 * 1000;
export const DEFAULT_MAX_WAIT_MS = 60 * 60 * 1000;
export const DEFAULT_POLL_MS = 5_000;

const META_FILE = "meta.json";

export function defaultLockDeps(): LockDeps {
  return {
    now: () => Date.now(),
    isProcessAlive: (pid) => {
      try {
        // signal 0 不发信号，只做存在性与权限探测。
        process.kill(pid, 0);
        return true;
      } catch (error) {
        // EPERM 说明进程存在但不属于当前用户，仍算存活。
        return (error as NodeJS.ErrnoException).code === "EPERM";
      }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (message) => {
      process.stderr.write(`${message}\n`);
    },
  };
}

function readMeta(lockDir: string): LockMeta | null {
  try {
    const raw = readFileSync(path.join(lockDir, META_FILE), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as LockMeta).token !== "string" ||
      typeof (parsed as LockMeta).pid !== "number"
    ) {
      return null;
    }
    return parsed as LockMeta;
  } catch {
    // 锁目录存在但 meta 读不出来（刚创建还没写完、或被写坏），当作无法识别的持有者。
    return null;
  }
}

/** 尝试拿一次锁，不等待。拿到返回 meta，没拿到返回 null。 */
function tryAcquireOnce(options: AcquireOptions, deps: LockDeps): LockMeta | null {
  try {
    mkdirSync(options.lockDir, { recursive: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return null;
  }

  const meta: LockMeta = {
    token: randomUUID(),
    pid: options.pid,
    startedAtMs: deps.now(),
    workspace: options.workspace,
  };
  writeFileSync(path.join(options.lockDir, META_FILE), JSON.stringify(meta), "utf8");
  return meta;
}

/**
 * 判断能不能抢占当前持有者。两种情形：持有者进程已经不在了（僵尸锁），
 * 或者持有者活着但持有时间超过 staleAfterMs（卡死）。
 */
export function reclaimReason(
  holder: LockMeta | null,
  options: Pick<AcquireOptions, "staleAfterMs">,
  deps: LockDeps,
): "dead-holder" | "stale" | "unreadable" | null {
  if (holder === null) return "unreadable";
  if (!deps.isProcessAlive(holder.pid)) return "dead-holder";
  if (deps.now() - holder.startedAtMs > options.staleAfterMs) return "stale";
  return null;
}

/**
 * 释放锁。只有 token 对得上才真正删除——如果我们的锁已经被别人当成 stale 抢占，
 * 此时删掉的就是别人的锁，会让两套测试同时跑起来。
 */
export function releaseLock(lockDir: string, token: string): boolean {
  const current = readMeta(lockDir);
  if (current === null || current.token !== token) return false;
  rmSync(lockDir, { recursive: true, force: true });
  return true;
}

/**
 * 取锁；被占用则阻塞等待，直到拿到、可抢占，或超过 maxWaitMs。
 * 超过上限抛 `LockWaitTimeoutError`。
 */
export async function acquireFullTestLock(
  options: AcquireOptions,
  deps: LockDeps,
): Promise<LockHandle> {
  const startedAt = deps.now();
  let announcedHolder = false;

  for (;;) {
    const meta = tryAcquireOnce(options, deps);
    if (meta !== null) {
      return { meta, release: () => void releaseLock(options.lockDir, meta.token) };
    }

    const holder = readMeta(options.lockDir);
    const reclaim = reclaimReason(holder, options, deps);
    if (reclaim !== null) {
      deps.log(
        `[full-test-lock] 抢占锁（原因：${reclaim}${
          holder ? `，原持有者 pid ${String(holder.pid)}` : ""
        }）`,
      );
      rmSync(options.lockDir, { recursive: true, force: true });
      continue;
    }

    const waitedMs = deps.now() - startedAt;
    if (waitedMs >= options.maxWaitMs) {
      throw new LockWaitTimeoutError(waitedMs, holder);
    }

    if (!announcedHolder && holder) {
      deps.log(
        `[full-test-lock] 另一套全量测试正在运行（pid ${String(holder.pid)} @ ${holder.workspace}），排队等待中……`,
      );
      announcedHolder = true;
    } else if (holder) {
      deps.log(
        `[full-test-lock] 仍在等待（已等 ${String(Math.round(waitedMs / 1000))}s，持有者 pid ${String(holder.pid)}）`,
      );
    }

    await deps.sleep(options.pollMs);
  }
}
