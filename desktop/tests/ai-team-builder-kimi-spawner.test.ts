import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { KimiAcpRunOptions } from "../../src/kimi.js";
import { AiTeamBuilderKimiSpawner } from "../src/ai-team-builder/kimi-spawner.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })));
});

describe("AiTeamBuilderKimiSpawner", () => {
  it("keeps the user prompt separate, freezes Kimi profile, and resumes read-only", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-team-builder-kimi-"));
    temporaryRoots.push(dataRoot);
    const calls: KimiAcpRunOptions[] = [];
    const run = vi.fn(async (options: KimiAcpRunOptions) => {
      calls.push(options);
      return {
        ok: true as const,
        finalText: JSON.stringify({ phase: "clarifying", question: "面向谁？" }),
        threadId: options.mode.kind === "resume"
          ? options.mode.externalSessionId
          : "kimi-session-1",
        cachedInputTokens: null,
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "stdout.jsonl"),
        stderrPath: path.join(options.runDir, "stderr.log"),
      };
    });
    const spawner = new AiTeamBuilderKimiSpawner({ run });
    const profile = { cli: "kimi", model: "kimi-for-coding", effort: "high" } as const;

    await expect(spawner.execute({
      dataRoot,
      draftId: "draft",
      prompt: "用户原始目标",
      profile,
      externalSessionId: null,
    })).resolves.toMatchObject({ ok: true, externalSessionId: "kimi-session-1" });
    await expect(spawner.execute({
      dataRoot,
      draftId: "draft",
      prompt: "继续调整",
      profile,
      externalSessionId: "kimi-session-1",
    })).resolves.toMatchObject({ ok: true, externalSessionId: "kimi-session-1" });

    expect(calls[0]).toMatchObject({
      prompt: "用户原始目标",
      profile,
      mode: { kind: "full" },
      workspaceAccess: "read-only",
      permissionMode: "default",
    });
    expect(calls[1]).toMatchObject({
      prompt: "继续调整",
      profile,
      mode: { kind: "resume", externalSessionId: "kimi-session-1" },
      workspaceAccess: "read-only",
      permissionMode: "default",
    });
    expect(calls[0]?.cwd).toBe(calls[1]?.cwd);
    const instructions = await fs.readFile(path.join(calls[0]!.cwd, "AGENTS.md"), "utf8");
    expect(instructions).toContain("只负责把用户目标转成团队方案");
    expect(instructions).not.toContain("用户原始目标");
  });
});
