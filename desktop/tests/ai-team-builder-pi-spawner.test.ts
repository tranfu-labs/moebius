import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AiTeamBuilderPiSpawner } from "../src/ai-team-builder/pi-spawner.js";

const profile = {
  cli: "pi" as const,
  providerId: "deepseek" as const,
  providerProfileId: "deepseek-work",
  model: "deepseek-v4-pro",
  effort: "high",
};
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => await fs.rm(root, { recursive: true, force: true })));
});

async function dataRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-pi-builder-"));
  roots.push(root);
  return root;
}

describe("AiTeamBuilderPiSpawner", () => {
  it("freezes the Pi profile and resumes the observed native session", async () => {
    const root = await dataRoot();
    const runPi = vi.fn(async (input) => {
      await input.onSessionStarted?.({ engine: "pi", externalSessionId: "pi-session.jsonl" });
      return {
        ok: true as const,
        finalText: "{\"phase\":\"clarifying\",\"question\":\"目标？\"}",
        threadId: "pi-session.jsonl",
        cachedInputTokens: null,
        runDir: input.runDir,
        stdoutPath: `${input.runDir}/stdout`,
        stderrPath: `${input.runDir}/stderr`,
        terminal: { kind: "completed" as const, externalSessionId: "pi-session.jsonl", finalText: "done" },
      };
    });
    const onExternalSessionStarted = vi.fn(async () => undefined);
    const spawner = new AiTeamBuilderPiSpawner(runPi);

    await expect(spawner.execute({
      dataRoot: root,
      draftId: "draft",
      prompt: "build",
      profile,
      externalSessionId: "pi-session.jsonl",
      onExternalSessionStarted,
    })).resolves.toMatchObject({ ok: true, externalSessionId: "pi-session.jsonl" });

    expect(runPi).toHaveBeenCalledWith(expect.objectContaining({
      profile,
      mode: { kind: "resume", externalSessionId: "pi-session.jsonl" },
    }));
    expect(onExternalSessionStarted).toHaveBeenCalledWith("pi-session.jsonl");
  });

  it("reports a failed Pi resume without crossing to another engine", async () => {
    const root = await dataRoot();
    const runPi = vi.fn(async (input) => ({
      ok: false as const,
      reason: "provider unavailable",
      runDir: input.runDir,
      stdoutPath: `${input.runDir}/stdout`,
      stderrPath: `${input.runDir}/stderr`,
    }));
    const spawner = new AiTeamBuilderPiSpawner(runPi);

    await expect(spawner.execute({
      dataRoot: root,
      draftId: "draft",
      prompt: "build",
      profile,
      externalSessionId: "pi-session.jsonl",
    })).resolves.toEqual({
      ok: false,
      reason: "provider unavailable",
      resumeFailed: true,
      externalSessionId: "pi-session.jsonl",
    });
  });
});
