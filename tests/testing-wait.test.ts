import { describe, expect, it } from "vitest";

import {
  resolveWaitTimeout,
  waitForCondition,
  waitForValue,
  waitScale,
} from "../src/testing/wait.js";

/** 注入用的即时 tick，避免单测自己去等真实时间。 */
function instantTick(record?: number[]): (ms: number) => Promise<void> {
  return (ms) => {
    record?.push(ms);
    return Promise.resolve();
  };
}

describe("waitScale", () => {
  it("默认为 1", () => {
    expect(waitScale({})).toBe(1);
    expect(waitScale({ MOEBIUS_TEST_WAIT_SCALE: "" })).toBe(1);
  });

  it("读取正数倍数", () => {
    expect(waitScale({ MOEBIUS_TEST_WAIT_SCALE: "2.5" })).toBe(2.5);
  });

  it("非法值回落到 1，NEVER 让坏配置把 deadline 变成 0", () => {
    expect(waitScale({ MOEBIUS_TEST_WAIT_SCALE: "abc" })).toBe(1);
    expect(waitScale({ MOEBIUS_TEST_WAIT_SCALE: "0" })).toBe(1);
    expect(waitScale({ MOEBIUS_TEST_WAIT_SCALE: "-3" })).toBe(1);
  });
});

describe("resolveWaitTimeout", () => {
  it("两个档位有不同的默认 deadline", () => {
    expect(resolveWaitTimeout({ kind: "logic" }, {})).toBe(5_000);
    expect(resolveWaitTimeout({ kind: "io" }, {})).toBe(10_000);
  });

  it("默认 deadline 必须留在 vitest testTimeout 之内，否则诊断信息永远出不来", () => {
    // vitest.config.ts 的全局 testTimeout 是 20 秒，个别用例声明得更短（如 15 秒）。
    const shortestDeclaredTestTimeout = 15_000;
    for (const kind of ["logic", "io"] as const) {
      expect(resolveWaitTimeout({ kind }, {})).toBeLessThan(shortestDeclaredTestTimeout);
    }
  });

  it("默认档位是 logic", () => {
    expect(resolveWaitTimeout({}, {})).toBe(5_000);
  });

  it("显式 timeoutMs 覆盖档位默认值", () => {
    expect(resolveWaitTimeout({ timeoutMs: 1_234, kind: "io" }, {})).toBe(1_234);
  });

  it("scale 作用在最终 deadline 上", () => {
    expect(resolveWaitTimeout({ kind: "io" }, { MOEBIUS_TEST_WAIT_SCALE: "2" })).toBe(20_000);
    expect(
      resolveWaitTimeout({ timeoutMs: 1_000 }, { MOEBIUS_TEST_WAIT_SCALE: "1.5" }),
    ).toBe(1_500);
  });
});

describe("waitForValue", () => {
  it("返回第一个非 undefined 的值", async () => {
    let calls = 0;
    const value = await waitForValue(
      () => {
        calls += 1;
        return calls >= 3 ? `ready-${String(calls)}` : undefined;
      },
      { describe: "值就绪", timeoutMs: 1_000, tick: instantTick() },
    );
    expect(value).toBe("ready-3");
    expect(calls).toBe(3);
  });

  it("至少求值一次，即使 deadline 为 0", async () => {
    let calls = 0;
    const value = await waitForValue(
      () => {
        calls += 1;
        return "immediate";
      },
      { describe: "立即可得", timeoutMs: 0, tick: instantTick() },
    );
    expect(value).toBe("immediate");
    expect(calls).toBe(1);
  });

  it("超时信息包含等待目标、耗时与上限——这是 flaky 可诊断的前提", async () => {
    await expect(
      waitForValue(() => undefined, {
        describe: "永远不会就绪的东西",
        timeoutMs: 5,
        kind: "io",
        tick: instantTick(),
      }),
    ).rejects.toThrow(/timed out waiting for 永远不会就绪的东西 after \d+ms \(limit 5ms, kind=io\)/);
  });

  it("超时信息带上最后一次诊断快照", async () => {
    await expect(
      waitForValue(() => undefined, {
        describe: "带快照的等待",
        timeoutMs: 5,
        tick: instantTick(),
        snapshot: () => ({ pending: 2, done: 0 }),
      }),
    ).rejects.toThrow(/last snapshot: \{"pending":2,"done":0\}/);
  });

  it("快照取值失败不掩盖原超时", async () => {
    await expect(
      waitForValue(() => undefined, {
        describe: "快照会炸的等待",
        timeoutMs: 5,
        tick: instantTick(),
        snapshot: () => {
          throw new Error("snapshot boom");
        },
      }),
    ).rejects.toThrow(/timed out waiting for 快照会炸的等待[\s\S]*snapshot boom/);
  });

  it("默认把 predicate 的异常直接上抛", async () => {
    await expect(
      waitForValue(
        () => {
          throw new Error("boom");
        },
        { describe: "会抛错的等待", timeoutMs: 100, tick: instantTick() },
      ),
    ).rejects.toThrow("boom");
  });

  it("onError 返回 retry 时继续轮询", async () => {
    let calls = 0;
    const value = await waitForValue(
      () => {
        calls += 1;
        if (calls < 3) throw new Error("database is locked");
        return "row";
      },
      {
        describe: "等数据库落行",
        timeoutMs: 1_000,
        tick: instantTick(),
        onError: (error) =>
          error instanceof Error && error.message.includes("locked") ? "retry" : "throw",
      },
    );
    expect(value).toBe("row");
    expect(calls).toBe(3);
  });

  it("onError 返回 throw 时立即上抛", async () => {
    await expect(
      waitForValue(
        () => {
          throw new Error("fatal");
        },
        {
          describe: "致命错误",
          timeoutMs: 1_000,
          tick: instantTick(),
          onError: (error) =>
            error instanceof Error && error.message.includes("locked") ? "retry" : "throw",
        },
      ),
    ).rejects.toThrow("fatal");
  });

  it("使用注入的 tick 与轮询间隔——React 测试靠这个塞进 act()", async () => {
    const ticks: number[] = [];
    let calls = 0;
    await waitForValue(
      () => {
        calls += 1;
        return calls >= 3 ? "ok" : undefined;
      },
      { describe: "注入 tick", timeoutMs: 1_000, pollMs: 7, tick: instantTick(ticks) },
    );
    expect(ticks).toEqual([7, 7]);
  });
});

describe("waitForCondition", () => {
  it("条件为真时返回", async () => {
    let calls = 0;
    await expect(
      waitForCondition(
        () => {
          calls += 1;
          return calls >= 2;
        },
        { describe: "条件成立", timeoutMs: 1_000, tick: instantTick() },
      ),
    ).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });

  it("条件始终为假时按统一格式超时", async () => {
    await expect(
      waitForCondition(() => false, {
        describe: "永假条件",
        timeoutMs: 5,
        tick: instantTick(),
      }),
    ).rejects.toThrow(/timed out waiting for 永假条件/);
  });
});
