import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PiHostClient } from "../src/pi-host-client.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Pi Host client process contract", () => {
  it("delivers the credential only in the framed stdin payload", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-pi-client-"));
    roots.push(root);
    const observedPath = path.join(root, "observed.json");
    const hostPath = path.join(root, "host.mjs");
    await fs.writeFile(hostPath, hostScript(observedPath), "utf8");
    const client = new PiHostClient({ hostEntryPath: hostPath });

    const previousEnvironmentSecret = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "sk-only-on-stdin";
    await expect(client.invoke({ frame: validationFrame("sk-only-on-stdin") }).finally(() => {
      if (previousEnvironmentSecret === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previousEnvironmentSecret;
    })).resolves.toMatchObject({ terminal: { type: "validated", replied: true, toolCalled: true } });
    await expect(fs.readFile(observedPath, "utf8").then((text) => JSON.parse(text))).resolves.toEqual({
      argvContainsSecret: false,
      envContainsSecret: false,
      credentialReceived: true,
    });
  });

  it("force-terminates a host that ignores cancellation and SIGTERM", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-pi-client-cancel-"));
    roots.push(root);
    const hostPath = path.join(root, "host.mjs");
    await fs.writeFile(hostPath, ignoringHostScript(), "utf8");
    const client = new PiHostClient({ hostEntryPath: hostPath, terminateGraceMs: 20 });
    const controller = new AbortController();
    const invocation = client.invoke({ frame: validationFrame("sk-only-on-stdin"), signal: controller.signal });
    setTimeout(() => controller.abort(), 30);

    await expect(invocation).rejects.toMatchObject({ code: "crashed" });
  });
});

function validationFrame(apiKey: string) {
  return {
    version: 1 as const,
    type: "start" as const,
    credential: { apiKey },
    invocation: {
      kind: "validate" as const,
      providerId: "deepseek" as const,
      model: "deepseek-v4-pro" as const,
      effort: "high" as const,
      cwd: "/tmp/workspace",
      agentDir: "/tmp/agent",
    },
  };
}

function hostScript(observedPath: string): string {
  return `
import fs from "node:fs";
const frame = (value) => { const body = Buffer.from(JSON.stringify(value)); const out = Buffer.alloc(4 + body.length); out.writeUInt32BE(body.length, 0); body.copy(out, 4); return out; };
process.stdout.write(frame({ version: 1, type: "ready" }));
let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  if (buffer.length < 4 || buffer.length < 4 + buffer.readUInt32BE(0)) return;
  const value = JSON.parse(buffer.subarray(4, 4 + buffer.readUInt32BE(0)).toString("utf8"));
  fs.writeFileSync(${JSON.stringify(observedPath)}, JSON.stringify({
    argvContainsSecret: process.argv.some((value) => value.includes("sk-only-on-stdin")),
    envContainsSecret: Object.values(process.env).some((value) => value?.includes("sk-only-on-stdin")),
    credentialReceived: value.credential?.apiKey === "sk-only-on-stdin",
  }));
  process.stdin.removeAllListeners();
  process.stdin.pause();
  process.stdout.write(frame({ version: 1, type: "validated", replied: true, toolCalled: true }), () => process.exit(0));
});
`;
}

function ignoringHostScript(): string {
  return `
const body = Buffer.from(JSON.stringify({ version: 1, type: "ready" }));
const frame = Buffer.alloc(4 + body.length); frame.writeUInt32BE(body.length, 0); body.copy(frame, 4);
process.stdout.write(frame);
process.on("SIGTERM", () => undefined);
setInterval(() => undefined, 1000);
`;
}
