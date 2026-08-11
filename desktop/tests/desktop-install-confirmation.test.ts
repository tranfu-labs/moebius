import { describe, expect, it } from "vitest";

import { DesktopInstallConfirmationBroker } from "../src/desktop-install-confirmation.js";

describe("desktop install confirmation broker", () => {
  it("publishes the current task snapshot and resolves only the matching response", async () => {
    const published: Array<{ requestId: number; version: string; runningTaskCount: number }> = [];
    const broker = new DesktopInstallConfirmationBroker((request) => published.push(request));

    const first = broker.request({ version: "0.5.0", runningTaskCount: 3 });
    const second = broker.request({ version: "0.5.0", runningTaskCount: 0 });

    expect(published).toEqual([
      { requestId: 1, version: "0.5.0", runningTaskCount: 3 },
      { requestId: 2, version: "0.5.0", runningTaskCount: 0 },
    ]);
    expect(broker.respond(999, true)).toBe(false);
    expect(broker.respond(1, false)).toBe(true);
    await expect(first).resolves.toBe(false);
    expect(broker.pendingCount).toBe(1);

    broker.cancelAll();
    await expect(second).resolves.toBe(false);
    expect(broker.pendingCount).toBe(0);
  });
});
