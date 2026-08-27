import { describe, expect, it } from "vitest";

import { runDesktopStartup } from "../src/desktop-startup-runtime.js";

describe("desktop startup runtime", () => {
  it("starts the local console after seeding without legacy sync stages", async () => {
    const calls: string[] = [];
    const input = {
      status: {
        appVersion: "test",
        dataRoot: "/tmp/moebius-startup-test",
        localConsole: { status: "starting" },
        doctor: null,
        shellPath: null,
        seed: { status: "pending", copied: 0, skipped: 0 },
        update: null,
      },
      platform: "linux",
      isPackaged: false,
      readLocale: async () => "zh-CN",
      setLocale: () => undefined,
      registerLanguage: () => undefined,
      createShellPathGate: () => ({
        ready: Promise.resolve(),
        start: () => calls.push("shell"),
        afterReady: async <T>(operation: () => Promise<T>) => operation(),
      }),
      createReadiness: () => ({}),
      createBuilder: () => ({}),
      createInstaller: () => ({}),
      setInstaller: () => undefined,
      observeInstaller: () => undefined,
      registerBuilder: () => undefined,
      registerOnboarding: () => undefined,
      setDockIcon: () => undefined,
      createWindow: () => calls.push("window"),
      publishStatus: () => undefined,
      buildSeedPlan: async () => ({ operations: [], skippedDestinations: [] }),
      executeSeedPlan: async () => undefined,
      seedTeams: async () => {
        calls.push("seed");
        return { status: "skipped" as const };
      },
      startLocalConsole: async () => { calls.push("console"); },
      startUpdates: async () => { calls.push("updates"); },
      formatError: (error: unknown) => String(error),
    } as unknown as Parameters<typeof runDesktopStartup>[0];

    await runDesktopStartup(input);

    expect(calls).toEqual(["window", "shell", "seed", "console", "updates"]);
  });
});
