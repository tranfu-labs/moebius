import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readLocalFileReferenceWindow } from "../src/local-console/file-read.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("local console file reference reader", () => {
  it("reads a bounded window with real line numbers from an arbitrary local path", async () => {
    const root = await temporaryRoot();
    const sessionsRoot = path.join(root, "codex", "sessions");
    const rollout = path.join(sessionsRoot, "2026", "07", "27", "rollout.jsonl");
    await fs.mkdir(path.dirname(rollout), { recursive: true });
    const lines = Array.from({ length: 420 }, (_value, index) => `line ${String(index + 1)}`);
    await fs.writeFile(rollout, `${lines.join("\n")}\n${"x".repeat(2 * 1024 * 1024)}\n`, "utf8");

    const result = await readLocalFileReferenceWindow({
      filePath: rollout,
      line: 292,
      column: 7,
      contextLines: 2,
    });

    expect(result).toMatchObject({
      available: true,
      path: await fs.realpath(rollout),
      targetLine: 292,
      targetColumn: 7,
      truncatedBefore: true,
      truncatedAfter: true,
    });
    expect(result.lines).toEqual([
      { lineNumber: 290, text: "line 290" },
      { lineNumber: 291, text: "line 291" },
      { lineNumber: 292, text: "line 292" },
      { lineNumber: 293, text: "line 293" },
      { lineNumber: 294, text: "line 294" },
    ]);
  });

  it("reads a symlink whose real target is outside its containing directory", async () => {
    const root = await temporaryRoot();
    const workspace = path.join(root, "workspace");
    const outside = path.join(root, "outside.txt");
    const link = path.join(workspace, "linked.txt");
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(outside, "secret\n", "utf8");
    await fs.symlink(outside, link);

    await expect(readLocalFileReferenceWindow({
      filePath: link,
      line: 1,
      column: null,
    })).resolves.toEqual({
      available: true,
      path: await fs.realpath(outside),
      lines: [{ lineNumber: 1, text: "secret" }],
      reason: null,
      targetLine: 1,
      targetColumn: null,
      truncatedBefore: false,
      truncatedAfter: false,
    });
  });

  it("rejects an oversized target line without returning its full or partial content", async () => {
    const root = await temporaryRoot();
    const workspace = path.join(root, "workspace");
    const target = path.join(workspace, "one-line.txt");
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(target, "x".repeat(3 * 1024 * 1024), "utf8");

    const result = await readLocalFileReferenceWindow({
      filePath: target,
      line: 1,
      column: null,
    });

    expect(result).toEqual({
      available: false,
      path: await fs.realpath(target),
      lines: [],
      reason: "line-too-large",
      targetLine: 1,
      targetColumn: null,
    });
  });

  it("returns the canonical path when an in-root alias has an unavailable target line", async () => {
    const root = await temporaryRoot();
    const workspace = path.join(root, "workspace");
    const target = path.join(workspace, "canonical.txt");
    const alias = path.join(workspace, "alias.txt");
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(target, "x".repeat(3 * 1024 * 1024), "utf8");
    await fs.symlink(target, alias);

    const result = await readLocalFileReferenceWindow({
      filePath: alias,
      line: 1,
      column: null,
    });

    expect(result).toEqual({
      available: false,
      path: await fs.realpath(target),
      lines: [],
      reason: "line-too-large",
      targetLine: 1,
      targetColumn: null,
    });
  });

  it("returns one canonical path for a NUL binary file and its in-root symlink", async () => {
    const root = await temporaryRoot();
    const workspace = path.join(root, "workspace");
    const target = path.join(workspace, "canonical.bin");
    const alias = path.join(workspace, "alias.bin");
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(target, Buffer.from([0x66, 0x6f, 0x00, 0x6f]));
    await fs.symlink(target, alias);

    const [directResult, aliasResult] = await Promise.all([target, alias].map((filePath) =>
      readLocalFileReferenceWindow({
        filePath,
        line: 1,
        column: null,
      })));
    const expected = {
      available: false,
      path: await fs.realpath(target),
      lines: [],
      reason: "binary-file",
      targetLine: 1,
      targetColumn: null,
    };

    expect(directResult).toEqual(expected);
    expect(aliasResult).toEqual(expected);
  });

  it("rejects a target window whose aggregate text exceeds the response budget", async () => {
    const root = await temporaryRoot();
    const workspace = path.join(root, "workspace");
    const target = path.join(workspace, "window.txt");
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(target, Array.from({ length: 5 }, () => "x".repeat(100)).join("\n"), "utf8");

    const result = await readLocalFileReferenceWindow({
      filePath: target,
      line: 3,
      column: null,
      contextLines: 2,
      maxLineBytes: 200,
      maxResponseBytes: 250,
    });

    expect(result).toEqual({
      available: false,
      path: await fs.realpath(target),
      lines: [],
      reason: "response-too-large",
      targetLine: 3,
      targetColumn: null,
    });
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-file-reference-"));
  roots.push(root);
  return root;
}
