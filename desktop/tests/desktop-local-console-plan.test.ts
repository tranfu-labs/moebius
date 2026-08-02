import { describe, expect, it } from "vitest";

import {
  decideLocalConsoleUrl,
  planLocalConsoleServerAccess,
} from "../src/desktop-local-console-plan.js";

describe("desktop local console plan", () => {
  it("distinguishes an available server from an unstarted server", () => {
    expect(planLocalConsoleServerAccess(true)).toBe("available");
    expect(planLocalConsoleServerAccess(false)).toBe("unavailable");
  });

  it("exposes a URL only for a running console", () => {
    expect(decideLocalConsoleUrl({ status: "starting" })).toBeNull();
    expect(decideLocalConsoleUrl({
      status: "running",
      url: "http://127.0.0.1:1234/",
      sqlitePath: "/tmp/console.sqlite",
    })).toBe("http://127.0.0.1:1234/");
  });
});
