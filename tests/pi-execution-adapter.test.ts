import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPiExecutionAdapter,
  PiProviderProfileUnavailableError,
} from "../src/pi-execution-adapter.js";
import type { PiHostClient } from "../src/pi-host-client.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Pi execution adapter provider preflight", () => {
  it("fails before invoking the Pi Host when the frozen profile is disabled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moebius-pi-adapter-"));
    temporaryRoots.push(root);
    const runDir = path.join(root, "run");
    const invoke = vi.fn();
    const adapter = createPiExecutionAdapter({
      dataRoot: root,
      hostEntryPath: path.join(root, "pi-host.js"),
      readCredential: async () => {
        throw new PiProviderProfileUnavailableError(
          "disabled",
          "当前 Pi API 档案已停用。请重新启用后重试，或仅本次换执行配置重跑。",
        );
      },
      client: { invoke } as unknown as PiHostClient,
    });

    const result = await adapter({
      prompt: "读取 README",
      runDir,
      cwd: root,
      profile: {
        cli: "pi",
        providerId: "deepseek",
        providerProfileId: "profile-disabled",
        model: "deepseek-v4-pro",
        effort: "high",
      },
      mode: { kind: "full" },
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      reason: "pi-provider-disabled",
      failure: {
        code: "pi-provider-disabled",
        message: "当前 Pi API 档案已停用。请重新启用后重试，或仅本次换执行配置重跑。",
      },
      terminal: {
        kind: "crashed",
        safeCode: "pi-provider-disabled",
      },
    });
    expect(await readFile(path.join(runDir, "pi-error.txt"), "utf8")).not.toContain("PiHost");
  });
});
