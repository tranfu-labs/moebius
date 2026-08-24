import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ClaudeTuiTranscriptFollower,
  type ClaudeTuiTranscriptFollowerRecord,
} from "../src/claude-tui-transcript-follower.js";
import { inspectTrustedJsonlCandidate } from "../src/trusted-jsonl.js";
import { waitForValue } from "../src/testing/wait.js";

const roots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Claude TUI transcript follower", () => {
  it("follows complete appended records and leaves a partial line for the next poll", async () => {
    const fixture = await createFixture([record("before")]);
    const initial = await inspectTrustedJsonlCandidate(fixture.root, fixture.file);
    expect(initial.status).toBe("available");
    if (initial.status !== "available") return;

    const records: ClaudeTuiTranscriptFollowerRecord[] = [];
    const follower = new ClaudeTuiTranscriptFollower({
      file: initial.file,
      startOffset: initial.file.identity.size,
      intervalMs: 10,
      onRecord: (record) => records.push(record),
    });
    follower.start();
    await appendRaw(fixture.file, `${JSON.stringify(record("partial"))}`);
    await waitForValue(() => records.length === 0 ? records : undefined, {
      describe: "follower ignores an incomplete JSONL record",
      kind: "logic",
      timeoutMs: 1_000,
      snapshot: () => ({ records: records.length, offset: follower.currentOffset }),
    });

    await appendRaw(fixture.file, "\n");
    await waitForValue(() => records.length === 1 ? records : undefined, {
      describe: "follower emits the completed JSONL record",
      kind: "io",
      timeoutMs: 2_000,
      snapshot: () => ({ records: records.length, offset: follower.currentOffset }),
    });
    await follower.stop();

    expect(records[0]?.value).toEqual(record("partial"));
    expect(records[0]?.lineOffset).toBe(initial.file.identity.size);
  });

  it("does not emit records appended after stop", async () => {
    const fixture = await createFixture([]);
    const initial = await inspectTrustedJsonlCandidate(fixture.root, fixture.file);
    expect(initial.status).toBe("available");
    if (initial.status !== "available") return;

    const records: ClaudeTuiTranscriptFollowerRecord[] = [];
    const follower = new ClaudeTuiTranscriptFollower({
      file: initial.file,
      startOffset: initial.file.identity.size,
      intervalMs: 10,
      onRecord: (record) => records.push(record),
    });
    follower.start();
    await follower.stop();
    await appendRaw(fixture.file, `${JSON.stringify(record("after-stop"))}\n`);
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(records).toEqual([]);
    expect(follower.isRunning).toBe(false);
  });

  it("stops silently on a replacement file and does not switch identities", async () => {
    const fixture = await createFixture([]);
    const initial = await inspectTrustedJsonlCandidate(fixture.root, fixture.file);
    expect(initial.status).toBe("available");
    if (initial.status !== "available") return;

    const failures: unknown[] = [];
    const records: ClaudeTuiTranscriptFollowerRecord[] = [];
    const follower = new ClaudeTuiTranscriptFollower({
      file: initial.file,
      startOffset: initial.file.identity.size,
      intervalMs: 10,
      onRecord: (record) => records.push(record),
      onFailure: (error) => failures.push(error),
    });
    follower.start();
    await fs.rename(fixture.file, `${fixture.file}.rotated`);
    await fs.writeFile(fixture.file, `${JSON.stringify(record("replacement"))}\n`, "utf8");

    await waitForValue(() => follower.isRunning === false ? true : undefined, {
      describe: "follower stops after transcript identity replacement",
      kind: "io",
      timeoutMs: 2_000,
      snapshot: () => ({ running: follower.isRunning, records: records.length, failures: failures.length }),
    });
    expect(records).toEqual([]);
    expect(failures).toHaveLength(1);
  });

  it("allows only one in-flight read and reports malformed complete lines as a follower failure", async () => {
    const fixture = await createFixture([]);
    const initial = await inspectTrustedJsonlCandidate(fixture.root, fixture.file);
    expect(initial.status).toBe("available");
    if (initial.status !== "available") return;

    const failures: unknown[] = [];
    const follower = new ClaudeTuiTranscriptFollower({
      file: initial.file,
      startOffset: initial.file.identity.size,
      intervalMs: 10,
      onRecord: () => undefined,
      onFailure: (error) => failures.push(error),
    });
    follower.start();
    await appendRaw(fixture.file, "not-json\n");
    await waitForValue(() => follower.isRunning === false ? true : undefined, {
      describe: "follower stops on a malformed complete transcript line",
      kind: "io",
      timeoutMs: 2_000,
      snapshot: () => ({ running: follower.isRunning, failures: failures.length }),
    });
    expect(failures).toHaveLength(1);
  });
});

async function createFixture(records: unknown[]): Promise<{ root: string; file: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-claude-tui-follower-"));
  roots.push(root);
  const file = path.join(root, "session.jsonl");
  await fs.writeFile(
    file,
    records.length === 0 ? "" : `${records.map((value) => JSON.stringify(value)).join("\n")}\n`,
    "utf8",
  );
  return { root: await fs.realpath(root), file };
}

async function appendRaw(file: string, value: string): Promise<void> {
  await fs.appendFile(file, value, "utf8");
}

function record(value: string): Record<string, unknown> {
  return { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: value }] } };
}
