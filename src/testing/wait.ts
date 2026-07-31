/**
 * 测试用的统一等待原语。
 *
 * 仓库里原本有 27 处各自复制的轮询实现，deadline 从 2 秒到 20 秒不等，超时只报
 * "timed out waiting for condition"——负载高时随机变红且无从诊断。这里收敛成唯一实现，
 * 并把两类等待显式分开：
 *
 * - `logic`：等纯内存时序（mock 被调用、状态翻转）。它只受本进程调度影响，deadline 短。
 * - `io`：等另一个真实进程的副作用（HTTP 响应、SQLite 落行）。真实等待的性质改不掉，
 *   只能给更宽的 deadline，并靠全量测试锁保证机器独占来让它可预测。
 *
 * 超时信息必须能回答「等的是什么、等了多久、最后看到的状态是什么」，否则 flaky 只是
 * 从随机变红升级成随机变红且查不动。
 */

/** 等待档位。决定默认 deadline。 */
export type WaitKind = "logic" | "io";

/** predicate 抛错时的处置：继续轮询，还是直接上抛。 */
export type WaitErrorAction = "retry" | "throw";

export interface WaitOptions {
  /** 等待目标的人话描述，进超时信息。NEVER 省略——省了就等于回到旧的无诊断状态。 */
  describe: string;
  /** 显式 deadline（毫秒）。不传则按 `kind` 取默认值。 */
  timeoutMs?: number;
  /** 档位，默认 `logic`。 */
  kind?: WaitKind;
  /** 轮询间隔（毫秒），默认 20。 */
  pollMs?: number;
  /**
   * 每轮的等待方式。默认 `setTimeout`；React 测试传入 `act()` 包装版本，
   * 这样一份实现能同时服务 node 与 jsdom 环境。
   */
  tick?: (ms: number) => Promise<void>;
  /** 超时时附加的诊断快照。取值本身抛错不会掩盖原超时。 */
  snapshot?: () => unknown;
  /** predicate 抛错时怎么办，默认 `throw`。 */
  onError?: (error: unknown) => WaitErrorAction;
}

/**
 * 两档默认 deadline。
 *
 * 上限不是「越宽越稳」——它 MUST 小于用例自己的 vitest `testTimeout`（全局 20 秒，
 * 部分用例声明得更短）。一旦超过，vitest 会先判用例超时，报出无信息的
 * "Test timed out"，这里准备的诊断信息就永远出不来，等于白做。
 */
const DEFAULT_TIMEOUT_MS: Record<WaitKind, number> = {
  logic: 5_000,
  io: 10_000,
};

const DEFAULT_POLL_MS = 20;

/**
 * 全局倍数旋钮，给锁覆盖不到的高负载场景留的逃逸口（例如别人的 CI 容器里同机跑多套）。
 * 默认 1——放宽 deadline 是应急手段，NEVER 当成常态来掩盖真实的时序问题。
 */
export function waitScale(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.MOEBIUS_TEST_WAIT_SCALE;
  if (raw === undefined || raw.trim() === "") return 1;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return parsed;
}

/** 解析实际生效的 deadline（已乘上 scale）。 */
export function resolveWaitTimeout(
  options: Pick<WaitOptions, "timeoutMs" | "kind">,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const base = options.timeoutMs ?? DEFAULT_TIMEOUT_MS[options.kind ?? "logic"];
  return Math.round(base * waitScale(env));
}

function defaultTick(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeSnapshot(snapshot: WaitOptions["snapshot"]): string {
  if (!snapshot) return "";
  try {
    const value = snapshot();
    if (value === undefined) return "";
    return `\nlast snapshot: ${JSON.stringify(value)}`;
  } catch (error) {
    // 快照取值失败不能掩盖真正的超时，降级成一行说明。
    return `\nlast snapshot: <unavailable: ${error instanceof Error ? error.message : String(error)}>`;
  }
}

function timeoutError(options: WaitOptions, elapsedMs: number, limitMs: number): Error {
  const kind = options.kind ?? "logic";
  const scale = waitScale();
  const scaleNote = scale === 1 ? "" : `, scale=${String(scale)}`;
  return new Error(
    `timed out waiting for ${options.describe} after ${String(elapsedMs)}ms ` +
      `(limit ${String(limitMs)}ms, kind=${kind}${scaleNote})` +
      describeSnapshot(options.snapshot),
  );
}

/**
 * 轮询直到 `produce` 返回非 undefined 的值，返回该值。
 * 需要拿到等待结果（状态快照、数据库行）时用这个。
 */
export async function waitForValue<T>(
  produce: () => T | undefined | Promise<T | undefined>,
  options: WaitOptions,
): Promise<T> {
  const limitMs = resolveWaitTimeout(options);
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const tick = options.tick ?? defaultTick;
  const startedAt = Date.now();
  const deadline = startedAt + limitMs;

  // 用 do/while 保证至少求值一次：limitMs 极小时也不该直接判超时而不看一眼条件。
  do {
    try {
      const value = await produce();
      if (value !== undefined) return value;
    } catch (error) {
      const action = options.onError?.(error) ?? "throw";
      if (action === "throw") throw error;
    }
    await tick(pollMs);
  } while (Date.now() < deadline);

  throw timeoutError(options, Date.now() - startedAt, limitMs);
}

/**
 * 轮询直到 `predicate` 为真。只关心「到了没」、不关心结果时用这个。
 */
export async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  options: WaitOptions,
): Promise<void> {
  await waitForValue(async () => ((await predicate()) ? true : undefined), options);
}
