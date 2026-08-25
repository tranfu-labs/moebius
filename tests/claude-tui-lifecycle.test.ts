import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ClaudeTuiLifecycleReceiver,
  type ClaudeTuiLifecycleEvent,
} from "../src/claude-tui-lifecycle.js";

const servers: Server[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  }));
  await Promise.all(roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })));
});

describe("ClaudeTuiLifecycleReceiver", () => {
  it("writes only capability-protected HTTP lifecycle hooks and discards hook payload content", async () => {
    const fixture = await createFixture();
    const runDir = await createRunDir();
    const events: ClaudeTuiLifecycleEvent[] = [];
    const lifecycle = fixture.receiver.createSession({
      sessionId: "canonical-session",
      runDir,
      onEvent: (event) => events.push(event),
    });

    await lifecycle.writeSettings();
    const settings = JSON.parse(await readFile(lifecycle.settingsPath, "utf8")) as {
      hooks: Record<string, Array<{ hooks: Array<{ headers: Record<string, string>; url: string; timeout: number }> }>>;
    };
    const encoded = JSON.stringify(settings);
    const capability = settings.hooks.UserPromptSubmit[0]?.hooks[0]?.headers["X-Moebius-Claude-Lifecycle-Capability"];

    expect(Object.keys(settings.hooks)).toEqual(["UserPromptSubmit", "Stop", "SessionEnd"]);
    expect(settings.hooks.UserPromptSubmit[0]?.hooks[0]).toMatchObject({
      type: "http",
      url: `${fixture.origin}api/local-console/internal/claude-tui-lifecycle`,
      timeout: 2,
    });
    expect(encoded).not.toContain("SessionStart");
    expect(encoded).not.toContain("prompt");
    expect(encoded).not.toContain("transcript_path");
    expect(typeof capability).toBe("string");
    expect((await stat(lifecycle.settingsPath)).mode & 0o777).toBe(0o600);

    lifecycle.markSessionStarted();
    expect(await postHook(fixture.origin, capability!, {
      session_id: "canonical-session",
      hook_event_name: "UserPromptSubmit",
      prompt: "private human input that must not leave the receiver",
    })).toBe(204);
    expect(await postHook(fixture.origin, capability!, {
      session_id: "canonical-session",
      hook_event_name: "Stop",
      last_assistant_message: "private assistant content that must not leave the receiver",
    })).toBe(204);
    expect(await postHook(fixture.origin, capability!, {
      session_id: "canonical-session",
      hook_event_name: "SessionEnd",
      transcript_path: "/private/transcript.jsonl",
    })).toBe(204);

    expect(events).toEqual([
      { type: "session-started", sessionId: "canonical-session" },
      { type: "turn-submitted", sessionId: "canonical-session" },
      { type: "turn-stopped", sessionId: "canonical-session" },
      { type: "session-ended", sessionId: "canonical-session" },
    ]);
    await expect(stat(lifecycle.settingsPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await postHook(fixture.origin, capability!, {
      session_id: "canonical-session",
      hook_event_name: "Stop",
    })).toBe(403);
  });

  it("rejects unauthenticated, malformed, and oversized hook input without changing lifecycle", async () => {
    const fixture = await createFixture({ maxBodyBytes: 256 });
    const runDir = await createRunDir();
    const events: ClaudeTuiLifecycleEvent[] = [];
    const lifecycle = fixture.receiver.createSession({
      sessionId: "canonical-session",
      runDir,
      onEvent: (event) => events.push(event),
    });
    await lifecycle.writeSettings();
    lifecycle.markSessionStarted();
    const capability = await readCapability(lifecycle.settingsPath);

    expect(await postHook(fixture.origin, "not-the-capability", {
      session_id: "canonical-session",
      hook_event_name: "UserPromptSubmit",
    })).toBe(403);
    expect(await postHook(fixture.origin, capability, {
      session_id: "other-session",
      hook_event_name: "UserPromptSubmit",
    })).toBe(400);
    expect(await postHook(fixture.origin, capability, {
      session_id: "canonical-session",
      hook_event_name: "PreToolUse",
    })).toBe(400);
    expect(await fetch(`${fixture.origin}api/local-console/internal/claude-tui-lifecycle`, {
      method: "POST",
      headers: { "content-type": "text/plain", "x-moebius-claude-lifecycle-capability": capability },
      body: "not-json",
    }).then((response) => response.status)).toBe(415);
    expect(await postHook(fixture.origin, capability, {
      session_id: "canonical-session",
      hook_event_name: "UserPromptSubmit",
      prompt: "x".repeat(300),
    })).toBe(413);

    expect(events).toEqual([{ type: "session-started", sessionId: "canonical-session" }]);
  });

  it("requires the PTY owner to establish session start and makes HTTP retries idempotent", async () => {
    const fixture = await createFixture();
    const runDir = await createRunDir();
    const events: ClaudeTuiLifecycleEvent[] = [];
    const lifecycle = fixture.receiver.createSession({
      sessionId: "canonical-session",
      runDir,
      onEvent: (event) => events.push(event),
    });
    await lifecycle.writeSettings();
    const capability = await readCapability(lifecycle.settingsPath);

    expect(await postHook(fixture.origin, capability, {
      session_id: "canonical-session",
      hook_event_name: "UserPromptSubmit",
    })).toBe(409);
    expect(await postHook(fixture.origin, capability, {
      session_id: "canonical-session",
      hook_event_name: "SessionEnd",
    })).toBe(409);
    lifecycle.markSessionStarted();
    expect(await postHook(fixture.origin, capability, {
      session_id: "canonical-session",
      hook_event_name: "Stop",
    })).toBe(409);
    expect(await postHook(fixture.origin, capability, {
      session_id: "canonical-session",
      hook_event_name: "UserPromptSubmit",
    })).toBe(204);
    expect(await postHook(fixture.origin, capability, {
      session_id: "canonical-session",
      hook_event_name: "UserPromptSubmit",
    })).toBe(204);
    expect(await postHook(fixture.origin, capability, {
      session_id: "canonical-session",
      hook_event_name: "Stop",
    })).toBe(204);
    expect(await postHook(fixture.origin, capability, {
      session_id: "canonical-session",
      hook_event_name: "Stop",
    })).toBe(204);

    expect(events).toEqual([
      { type: "session-started", sessionId: "canonical-session" },
      { type: "turn-submitted", sessionId: "canonical-session" },
      { type: "turn-stopped", sessionId: "canonical-session" },
    ]);
  });

});

async function createFixture(options: ConstructorParameters<typeof ClaudeTuiLifecycleReceiver>[0] = {}) {
  const receiver = new ClaudeTuiLifecycleReceiver(options);
  const server = createServer((request, response) => {
    void receiver.handle(request, response).then((handled) => {
      if (!handled && !response.writableEnded) {
        response.writeHead(404);
        response.end();
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected TCP listener");
  const origin = `http://127.0.0.1:${String(address.port)}/`;
  receiver.setLoopbackOrigin(origin);
  return { receiver, origin };
}

async function createRunDir(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "moebius-claude-tui-lifecycle-"));
  roots.push(root);
  return path.join(root, "run");
}

async function readCapability(settingsPath: string): Promise<string> {
  const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
    hooks: { UserPromptSubmit: Array<{ hooks: Array<{ headers: Record<string, string> }> }> };
  };
  const capability = settings.hooks.UserPromptSubmit[0]?.hooks[0]?.headers["X-Moebius-Claude-Lifecycle-Capability"];
  if (typeof capability !== "string") throw new Error("missing lifecycle capability");
  return capability;
}

async function postHook(origin: string, capability: string, payload: unknown): Promise<number> {
  return await fetch(`${origin}api/local-console/internal/claude-tui-lifecycle`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-moebius-claude-lifecycle-capability": capability,
    },
    body: JSON.stringify(payload),
  }).then((response) => response.status);
}
