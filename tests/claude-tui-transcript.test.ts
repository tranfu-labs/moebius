import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  captureClaudeTuiTranscriptRecordCount,
  resolveClaudeTuiTranscriptFile,
  resolveClaudeTuiTranscriptFinal,
  resolveClaudeTuiTranscriptFollowerSource,
} from "../src/claude-tui-transcript.js";

const roots: string[] = [];
const sessionId = "11111111-1111-4111-8111-111111111111";

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => await fs.rm(root, { recursive: true, force: true })));
});

describe("Claude TUI transcript final resolver", () => {
  it("reads only the final assistant text and usage from the exact trusted transcript", async () => {
    const fixture = await createFixture();
    await writeTranscript(fixture.transcript, [
      record(fixture.cwd, "user", [{ type: "text", text: "first prompt" }]),
      record(fixture.cwd, "assistant", [{ type: "text", text: "OLD_FINAL" }]),
      record(fixture.cwd, "assistant", [
        { type: "thinking", thinking: "not public body" },
        { type: "text", text: "FINAL_BODY" },
      ], { cache_read_input_tokens: 42, output_tokens: 7 }),
    ]);

    const final = await resolveClaudeTuiTranscriptFinal({
      sessionId,
      cwd: fixture.cwd,
      claudeProjectsRoot: fixture.projectsRoot,
    });
    expect(final).toEqual({
      status: "available",
      finalText: "FINAL_BODY",
      cachedInputTokens: 42,
      usage: { cache_read_input_tokens: 42, output_tokens: 7 },
      filePath: await fs.realpath(fixture.transcript),
    });
  });

  it("fails closed when the session transcript is duplicated or bound to another workspace", async () => {
    const fixture = await createFixture();
    await writeTranscript(fixture.transcript, [
      record(path.join(fixture.root, "wrong-workspace"), "assistant", [{ type: "text", text: "wrong" }]),
    ]);
    await expect(resolveClaudeTuiTranscriptFile({
      sessionId,
      cwd: fixture.cwd,
      claudeProjectsRoot: fixture.projectsRoot,
    })).resolves.toEqual({ status: "unavailable", reason: "context-mismatch" });

    const duplicate = path.join(fixture.projectsRoot, "another", `${sessionId}.jsonl`);
    await fs.mkdir(path.dirname(duplicate), { recursive: true });
    await writeTranscript(duplicate, [record(fixture.cwd, "assistant", [{ type: "text", text: "duplicate" }])]);
    await expect(resolveClaudeTuiTranscriptFile({
      sessionId,
      cwd: fixture.cwd,
      claudeProjectsRoot: fixture.projectsRoot,
    })).resolves.toEqual({ status: "unavailable", reason: "duplicate" });
  });

  it("returns only an assistant record appended after the per-turn transcript boundary", async () => {
    const fixture = await createFixture();
    const records = [
      record(fixture.cwd, "user", [{ type: "text", text: "first prompt" }]),
      record(fixture.cwd, "assistant", [{ type: "text", text: "OLD_FINAL" }]),
      record(fixture.cwd, "user", [{ type: "text", text: "second prompt" }]),
      record(fixture.cwd, "assistant", [{ type: "text", text: "NEW_FINAL" }], { cache_read_input_tokens: 99 }),
    ];
    await writeTranscript(fixture.transcript, records);

    expect(await captureClaudeTuiTranscriptRecordCount({
      sessionId,
      cwd: fixture.cwd,
      claudeProjectsRoot: fixture.projectsRoot,
    })).toBe(4);
    await expect(resolveClaudeTuiTranscriptFollowerSource({
      sessionId,
      cwd: fixture.cwd,
      afterRecordCount: 2,
      claudeProjectsRoot: fixture.projectsRoot,
    })).resolves.toMatchObject({
      status: "available",
      startOffset: Buffer.byteLength(
        `${JSON.stringify(records[0])}\n${JSON.stringify(records[1])}\n`,
        "utf8",
      ),
    });
    await expect(resolveClaudeTuiTranscriptFinal({
      sessionId,
      cwd: fixture.cwd,
      afterRecordCount: 2,
      claudeProjectsRoot: fixture.projectsRoot,
    })).resolves.toMatchObject({
      status: "available",
      finalText: "NEW_FINAL",
      cachedInputTokens: 99,
    });
  });

  it("does not fall back to a prior assistant record when no new final exists after the boundary", async () => {
    const fixture = await createFixture();
    await writeTranscript(fixture.transcript, [
      record(fixture.cwd, "user", [{ type: "text", text: "first prompt" }]),
      record(fixture.cwd, "assistant", [{ type: "text", text: "OLD_FINAL" }]),
      record(fixture.cwd, "user", [{ type: "text", text: "second prompt" }]),
    ]);

    await expect(resolveClaudeTuiTranscriptFinal({
      sessionId,
      cwd: fixture.cwd,
      afterRecordCount: 2,
      claudeProjectsRoot: fixture.projectsRoot,
    })).resolves.toEqual({ status: "unavailable", reason: "no-final-assistant-message" });
  });
});

async function createFixture(): Promise<{
  root: string;
  cwd: string;
  projectsRoot: string;
  transcript: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-claude-tui-transcript-"));
  roots.push(root);
  const cwd = path.join(root, "workspace");
  const projectsRoot = path.join(root, "projects");
  const transcript = path.join(projectsRoot, "project", `${sessionId}.jsonl`);
  await fs.mkdir(cwd, { recursive: true });
  await fs.mkdir(path.dirname(transcript), { recursive: true });
  return { root, cwd, projectsRoot, transcript };
}

async function writeTranscript(file: string, records: unknown[]): Promise<void> {
  await fs.writeFile(file, `${records.map((value) => JSON.stringify(value)).join("\n")}\n`, "utf8");
}

function record(
  cwd: string,
  role: "user" | "assistant",
  content: unknown[],
  usage?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: role,
    sessionId,
    cwd: path.resolve(cwd),
    isSidechain: false,
    message: {
      role,
      content,
      ...(usage === undefined ? {} : { usage }),
    },
  };
}
