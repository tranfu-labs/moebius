import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodexRunOptions, CodexRunResult } from "../src/codex.js";
import { startLocalConsoleServer } from "../src/local-console/start.js";
import { readLocalAgentImageSource } from "../src/local-console/agent-image-source.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const PNG = pngHeader(40, 20);
const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>', "utf8");
const ICO = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10, 0x00, 0x00, 0x01, 0x00, 0x20, 0x00]);

describe("readLocalAgentImageSource", () => {
  it("returns a restricted PNG source for a workspace-internal absolute path", async () => {
    const fixture = await createImageFixture();
    const result = await readLocalAgentImageSource({
      workspacePath: fixture.workspace,
      filePath: path.join(fixture.workspace, "diagram.png"),
    });
    expect(result).toEqual({ available: true, mediaType: "image/png", bytes: PNG });
  });

  it("returns a restricted SVG source for an external absolute path", async () => {
    const fixture = await createImageFixture();
    const result = await readLocalAgentImageSource({
      workspacePath: fixture.workspace,
      filePath: path.join(fixture.external, "external.svg"),
    });
    expect(result).toEqual({ available: true, mediaType: "image/svg+xml", bytes: SVG });
  });

  it("returns restricted ICO, BMP and AVIF sources as file-class preview candidates", async () => {
    const fixture = await createImageFixture();
    await fs.writeFile(path.join(fixture.workspace, "favicon.ico"), ICO);
    await fs.writeFile(path.join(fixture.workspace, "wallpaper.bmp"), Buffer.from([0x42, 0x4d, 0x3a, 0x00, 0x00, 0x00, 0x00, 0x00]));
    await fs.writeFile(path.join(fixture.workspace, "photo.avif"), Buffer.from("\x00\x00\x00\x20ftypavif\x00\x00\x00\x00", "binary"));
    expect(await readLocalAgentImageSource({
      workspacePath: fixture.workspace,
      filePath: path.join(fixture.workspace, "favicon.ico"),
    })).toEqual({ available: true, mediaType: "image/x-icon", bytes: ICO });
    expect(await readLocalAgentImageSource({
      workspacePath: fixture.workspace,
      filePath: path.join(fixture.workspace, "wallpaper.bmp"),
    })).toEqual({ available: true, mediaType: "image/bmp", bytes: Buffer.from([0x42, 0x4d, 0x3a, 0x00, 0x00, 0x00, 0x00, 0x00]) });
    expect(await readLocalAgentImageSource({
      workspacePath: fixture.workspace,
      filePath: path.join(fixture.workspace, "photo.avif"),
    })).toEqual({ available: true, mediaType: "image/avif", bytes: Buffer.from("\x00\x00\x00\x20ftypavif\x00\x00\x00\x00", "binary") });
  });

  it("rejects disguised extensions, directories, missing files, and non-absolute references", async () => {
    const fixture = await createImageFixture();
    await fs.writeFile(path.join(fixture.workspace, "fake.png"), "<html><body>not an image</body></html>", "utf8");
    expect(await readLocalAgentImageSource({
      workspacePath: fixture.workspace,
      filePath: path.join(fixture.workspace, "fake.png"),
    })).toEqual({ available: false, reason: "not-image" });
    expect(await readLocalAgentImageSource({
      workspacePath: fixture.workspace,
      filePath: fixture.workspace,
    })).toEqual({ available: false, reason: "not-file" });
    expect(await readLocalAgentImageSource({
      workspacePath: fixture.workspace,
      filePath: path.join(fixture.workspace, "missing.png"),
    })).toEqual({ available: false, reason: "not-found" });
    expect(await readLocalAgentImageSource({
      workspacePath: fixture.workspace,
      filePath: "relative/diagram.png",
    })).toEqual({ available: false, reason: "invalid-path" });
    expect(await readLocalAgentImageSource({
      workspacePath: fixture.workspace,
      filePath: "file:///etc/hosts",
    })).toEqual({ available: false, reason: "invalid-path" });
    expect(await readLocalAgentImageSource({
      workspacePath: fixture.workspace,
      filePath: "https://example.com/remote.png",
    })).toEqual({ available: false, reason: "invalid-path" });
    expect(await readLocalAgentImageSource({
      workspacePath: fixture.workspace,
      filePath: "00000000-0000-4000-8000-000000000000/content",
    })).toEqual({ available: false, reason: "invalid-path" });
  });

  it("rejects sources beyond the configured byte ceiling", async () => {
    const fixture = await createImageFixture();
    await fs.writeFile(path.join(fixture.workspace, "big.png"), Buffer.concat([PNG, Buffer.alloc(4096)]));
    expect(await readLocalAgentImageSource({
      workspacePath: fixture.workspace,
      filePath: path.join(fixture.workspace, "big.png"),
      maxBytes: 1024,
    })).toEqual({ available: false, reason: "file-too-large" });
  });
});

describe("local agent image source HTTP boundary", () => {
  it("requires the attachment capability and returns structured unavailability for disguised content", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-agent-image-"));
    temporaryRoots.push(root);
    await fs.mkdir(path.join(root, "agents"), { recursive: true });
    await fs.writeFile(path.join(root, "agents", "dev.md"), "# Dev\n\nReply briefly.\n");
    await fs.writeFile(path.join(root, "diagram.png"), PNG);
    await fs.writeFile(path.join(root, "fake.png"), "<html><body>not an image</body></html>", "utf8");
    const capability = "test-agent-image-capability";
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => ({
      ok: true,
      finalText: "done",
      threadId: null,
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      attachmentCapability: capability,
      listAgentFiles: async () => [],
      loadAgentTeamSnapshot: async () => ({
        members: [{ name: "dev", agentMarkdown: "# Dev\n\nROLE:dev" }],
      }),
      runCodex,
      storeTimeoutMs: 10_000,
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
    });
    try {
      const createResponse = await fetch(new URL("api/local-console/sessions", started.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "local", agentTeamOwnership: "system", agentTeamId: "development" }),
      });
      const created = await createResponse.json() as { session: { sessionId: string } };
      expect(createResponse.status).toBe(201);
      const sessionId = created.session.sessionId;

      const pngUrl = new URL(`api/local-console/sessions/${encodeURIComponent(sessionId)}/agent-image-source`, started.url);
      pngUrl.searchParams.set("path", path.join(root, "diagram.png"));
      const forbidden = await fetch(pngUrl);
      expect(forbidden.status).toBe(403);

      const png = await fetch(pngUrl, { headers: { "x-moebius-attachment-capability": capability } });
      expect(png.status).toBe(200);
      expect(png.headers.get("content-type")).toBe("image/png");
      expect(Buffer.from(await png.arrayBuffer())).toEqual(PNG);

      const fakeUrl = new URL(`api/local-console/sessions/${encodeURIComponent(sessionId)}/agent-image-source`, started.url);
      fakeUrl.searchParams.set("path", path.join(root, "fake.png"));
      const fake = await fetch(fakeUrl, { headers: { "x-moebius-attachment-capability": capability } });
      expect(fake.status).toBe(404);
      const fakeBody = await fake.json() as { code: string; reason: string };
      expect(fakeBody).toMatchObject({ code: "agent-image-source-unavailable", reason: "not-image" });
      expect(JSON.stringify(fakeBody)).not.toContain("<html>");

      const missingUrl = new URL(`api/local-console/sessions/${encodeURIComponent(sessionId)}/agent-image-source`, started.url);
      missingUrl.searchParams.set("path", path.join(root, "missing.png"));
      const missing = await fetch(missingUrl, { headers: { "x-moebius-attachment-capability": capability } });
      expect(missing.status).toBe(404);
      expect((await missing.json() as { reason: string }).reason).toBe("not-found");
    } finally {
      await started.close();
    }
  }, 15_000);
});

async function createImageFixture() {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-agent-image-workspace-"));
  const external = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-agent-image-external-"));
  temporaryRoots.push(workspace, external);
  await fs.writeFile(path.join(workspace, "diagram.png"), PNG);
  await fs.writeFile(path.join(external, "external.svg"), SVG);
  return { workspace, external };
}

function pngHeader(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
