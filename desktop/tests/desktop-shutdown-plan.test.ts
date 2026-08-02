import { describe, expect, it } from "vitest";

import {
  planBeforeQuit,
  planDesktopShutdownRequest,
  planInstallerAccess,
  planInstallerShutdownApproval,
  planLastWindowClosed,
} from "../src/desktop-shutdown-plan.js";

describe("desktop shutdown plan", () => {
  it("prioritizes existing shutdown and coordination work", () => {
    expect(planDesktopShutdownRequest({
      shutdownComplete: true,
      shutdownPending: true,
      coordinationPending: true,
      hasRunningInstallers: true,
    })).toBe("await-shutdown");
    expect(planDesktopShutdownRequest({
      shutdownComplete: false,
      shutdownPending: false,
      coordinationPending: true,
      hasRunningInstallers: true,
    })).toBe("await-coordination");
  });

  it("coordinates active installers and otherwise shuts down directly", () => {
    expect(planDesktopShutdownRequest({
      shutdownComplete: false,
      shutdownPending: false,
      coordinationPending: false,
      hasRunningInstallers: true,
    })).toBe("coordinate-installers");
    expect(planDesktopShutdownRequest({
      shutdownComplete: false,
      shutdownPending: false,
      coordinationPending: false,
      hasRunningInstallers: false,
    })).toBe("shutdown");
  });

  it("maps user approval and lifecycle state to observable shutdown actions", () => {
    expect(planInstallerShutdownApproval(false)).toBe("stay-open");
    expect(planInstallerShutdownApproval(true)).toBe("cancel-installers");
    expect(planInstallerAccess(false)).toBe("unavailable");
    expect(planInstallerAccess(true)).toBe("available");
    expect(planBeforeQuit(false)).toBe("coordinate");
    expect(planBeforeQuit(true)).toBe("allow");
    expect(planLastWindowClosed(false)).toBe("coordinate");
    expect(planLastWindowClosed(true)).toBe("ignore");
  });
});
