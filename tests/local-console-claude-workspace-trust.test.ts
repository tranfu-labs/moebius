import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startLocalConsoleServer, type StartedLocalConsoleServer } from "../src/local-console/start.js";

const roots: string[] = [];
const servers: StartedLocalConsoleServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => await server.close()));
  await Promise.all(roots.splice(0).map(async (root) => await fs.rm(root, { recursive: true, force: true })));
});

describe("Claude workspace trust HTTP boundary", () => {
  it("does not expose the retired manual trust-decision endpoint", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-claude-workspace-trust-"));
    roots.push(root);
    const server = await startLocalConsoleServer({
      host: "127.0.0.1",
      port: 0,
      projectRoot: root,
      enableSessionTitleGeneration: false,
    });
    servers.push(server);

    const response = await fetch(new URL("/api/local-console/sessions/default/claude-workspace-trust", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "retired", decision: "trust" }),
    });

    expect(response.status).toBe(404);
  });
});
