import { describe, expect, it, vi } from "vitest";

import { createPreflightCache } from "../src/local-console/managed-process-mcp-preflight.js";

describe("managed-process preflight cache", () => {
  it("verifies once and short-circuits subsequent runs in the same application lifetime", async () => {
    const runPreflight = createPreflightCache();
    const verify = vi.fn(async () => undefined);
    await runPreflight(verify);
    await runPreflight(verify);
    await runPreflight(verify);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("never caches failures so every run still surfaces the setup failure", async () => {
    const runPreflight = createPreflightCache();
    const verify = vi.fn(async () => { throw new Error("bridge could not start"); });
    await expect(runPreflight(verify)).rejects.toThrow("bridge could not start");
    await expect(runPreflight(verify)).rejects.toThrow("bridge could not start");
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it("recovers after a failure once verification succeeds", async () => {
    const runPreflight = createPreflightCache();
    const verify = vi.fn(async () => {
      if (verify.mock.calls.length === 1) throw new Error("transient failure");
    });
    await expect(runPreflight(verify)).rejects.toThrow("transient failure");
    await runPreflight(verify);
    await runPreflight(verify);
    expect(verify).toHaveBeenCalledTimes(2);
  });
});
