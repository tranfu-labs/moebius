#!/usr/bin/env tsx
/**
 * 测试入口。三种形态见 `src/testing/test-plan.ts`：
 *
 *   pnpm test                  完整闸门（跨 worktree 互斥，同机同时只跑一套）
 *   pnpm test --scope          只跑受未提交改动影响的测试
 *   pnpm test --scope <base>   只跑受 <base>..工作区 影响的测试
 *   pnpm test <files...>       直通给 vitest
 *
 * 逃逸口：MOEBIUS_FULL_TEST_LOCK=0 跳过互斥（确认独占机器时用）。
 *
 * 这个文件只放 spawn 与信号处理这类不可测的胶水；「跑什么、要不要加锁、怎么抢占」
 * 都在 src/testing/ 下，有单测覆盖。
 */

import { spawn, spawnSync } from "node:child_process";

import {
  DEFAULT_LOCK_DIR,
  DEFAULT_MAX_WAIT_MS,
  DEFAULT_POLL_MS,
  DEFAULT_STALE_AFTER_MS,
  LockWaitTimeoutError,
  acquireFullTestLock,
  defaultLockDeps,
  type LockHandle,
} from "../src/testing/full-test-lock.js";
import {
  countProbedFiles,
  parseTestPlan,
  scopeOutcome,
  type TestCommand,
} from "../src/testing/test-plan.js";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

/**
 * 异步 spawn 而不是 spawnSync：spawnSync 会阻塞事件循环，导致进程收到 SIGINT 时
 * 信号处理器根本没机会执行，锁就被留在磁盘上，后来者只能等 stale 超时才抢得到。
 */
function run(command: TestCommand): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(pnpm, command.args, { stdio: "inherit", shell: false });
    child.on("error", (error) => {
      console.error(error.message);
      resolve(1);
    });
    child.on("exit", (code, signal) => {
      resolve(signal !== null ? 130 : code ?? 1);
    });
  });
}

/** 探测某个 workspace 有几个受影响的测试文件；探测失败时按「有」处理，宁可多跑也不漏。 */
function probe(command: TestCommand): number {
  if (!command.probeArgs) return 1;
  const result = spawnSync(pnpm, command.probeArgs, { encoding: "utf8", shell: false });
  if (result.error || result.status !== 0) return 1;
  return countProbedFiles(result.stdout);
}

function lockEnabled(): boolean {
  return process.env.MOEBIUS_FULL_TEST_LOCK !== "0";
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function main(): Promise<number> {
  const plan = parseTestPlan(process.argv.slice(2));

  let lock: LockHandle | null = null;
  if (plan.requiresLock && lockEnabled()) {
    const deps = defaultLockDeps();
    try {
      lock = await acquireFullTestLock(
        {
          lockDir: process.env.MOEBIUS_FULL_TEST_LOCK_DIR ?? DEFAULT_LOCK_DIR,
          workspace: process.cwd(),
          pid: process.pid,
          maxWaitMs: numberFromEnv("MOEBIUS_FULL_TEST_LOCK_WAIT_MS", DEFAULT_MAX_WAIT_MS),
          staleAfterMs: numberFromEnv("MOEBIUS_FULL_TEST_LOCK_STALE_MS", DEFAULT_STALE_AFTER_MS),
          pollMs: numberFromEnv("MOEBIUS_FULL_TEST_LOCK_POLL_MS", DEFAULT_POLL_MS),
        },
        deps,
      );
      deps.log("[full-test-lock] 已取得锁，开始完整闸门。");
    } catch (error) {
      if (error instanceof LockWaitTimeoutError) {
        // 排队超时不是测试失败——用单独的退出码，避免被误读成「测试红了」。
        console.error(`[full-test-lock] ${error.message}`);
        console.error("[full-test-lock] 未运行任何测试。确认机器空闲后重试，或设 MOEBIUS_FULL_TEST_LOCK=0 跳过互斥。");
        return 75;
      }
      throw error;
    }
  }

  // 无论正常结束、异常还是被信号打断，锁都必须释放，否则会把后来者堵到 stale 超时。
  const release = (): void => {
    lock?.release();
    lock = null;
  };
  process.on("exit", release);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      release();
      process.exit(130);
    });
  }

  // scope 模式先探测，避免「三个 workspace 都没命中」时静默返回成功。
  let commands = plan.commands;
  if (plan.mode === "scope") {
    const counts = plan.commands.map(probe);
    const outcome = scopeOutcome(counts, plan.baseLabel ?? "未提交改动");
    console.log(outcome.message);
    if (outcome.failed) {
      release();
      return 76;
    }
    commands = plan.commands.filter((_, index) => counts[index] > 0);
  }

  try {
    for (const command of commands) {
      const status = await run(command);
      if (status !== 0) return status;
    }
  } finally {
    release();
  }

  if (plan.footer) console.log(plan.footer);
  return 0;
}

main().then(
  (code) => {
    process.exit(code);
  },
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
