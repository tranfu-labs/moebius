import { describe, expect, it, vi } from "vitest";

import {
  CapabilityProbeError,
  parseCodexModelList,
  parseKimiProviderList,
  probeCodexCapabilities,
  probeKimiCapabilities,
  type SafeCommandRunner,
} from "../desktop/src/execution-capabilities.js";

describe("execution capability discovery", () => {
  it("parses Codex model/list reasoning capabilities", () => {
    expect(parseCodexModelList({
      result: {
        data: [{
          id: "gpt-5.6-sol",
          displayName: "GPT 5.6",
          defaultReasoningEffort: "high",
          supportedReasoningEfforts: [
            { reasoningEffort: "medium" },
            { reasoningEffort: "high" },
          ],
        }],
      },
    })).toEqual([{
      id: "gpt-5.6-sol",
      displayName: "GPT 5.6",
      efforts: ["medium", "high"],
      defaultEffort: "high",
    }]);
  });

  it("parses nested Kimi provider models and off effort", () => {
    expect(parseKimiProviderList({
      providers: [{
        id: "moonshot",
        models: [{
          alias: "kimi-for-coding",
          display_name: "Kimi for Coding",
          support_efforts: ["low", "high"],
          default_effort: "high",
          off_effort: "off",
        }],
      }],
    })).toEqual([{
      id: "kimi-for-coding",
      displayName: "Kimi for Coding",
      efforts: ["low", "high", "off"],
      defaultEffort: "high",
    }]);
  });

  it("parses the raw Kimi models table and keeps its alias instead of the upstream model id", () => {
    const result = parseKimiProviderList({
      providers: {
        moonshot: {
          type: "kimi",
          apiKey: "secret-provider-token",
        },
      },
      models: {
        "moonshot/my-kimi": {
          provider: "moonshot",
          model: "kimi-for-coding",
          displayName: "My Kimi",
          supportEfforts: ["low", "high"],
          defaultEffort: "high",
        },
      },
    });

    expect(result).toEqual([{
      id: "moonshot/my-kimi",
      displayName: "My Kimi",
      efforts: ["low", "high"],
      defaultEffort: "high",
    }]);
    expect(JSON.stringify(result)).not.toContain("secret-provider-token");
  });

  it("maps a boolean Kimi thinking model without effort metadata to off and on", () => {
    expect(parseKimiProviderList({
      providers: {},
      models: {
        "moonshot/thinking-model": {
          provider: "moonshot",
          model: "custom-upstream-id",
          capabilities: ["thinking"],
        },
      },
    })).toEqual([{
      id: "moonshot/thinking-model",
      displayName: "moonshot/thinking-model",
      efforts: ["off", "on"],
      defaultEffort: "on",
    }]);
  });

  it("returns unavailable instead of a hard-coded Codex fallback", async () => {
    const result = await probeCodexCapabilities({
      now: () => new Date("2026-07-25T00:00:00.000Z"),
      runCommand: vi.fn<SafeCommandRunner>().mockResolvedValue({ stdout: "codex 0.145.0" }),
      requestCodexModels: async () => ({ result: { data: [] } }),
    });
    expect(result).toMatchObject({
      cli: "codex",
      status: "unavailable",
      models: [],
      reason: "Codex 没有返回可用模型。",
    });
  });

  it("rejects Codex below 0.145.0 before starting the model capability protocol", async () => {
    const requestCodexModels = vi.fn();
    const result = await probeCodexCapabilities({
      now: () => new Date("2026-07-25T00:00:00.000Z"),
      runCommand: vi.fn<SafeCommandRunner>().mockResolvedValue({
        stdout: "codex-cli 0.144.1\n",
      }),
      requestCodexModels,
    });

    expect(result).toMatchObject({
      cli: "codex",
      cliVersion: "codex-cli 0.144.1",
      status: "unavailable",
      failureCode: "CLI_VERSION_UNSUPPORTED",
      reason: "Codex CLI 版本过旧，需要 0.145.0 或更高版本。",
    });
    expect(requestCodexModels).not.toHaveBeenCalled();
  });

  it("distinguishes a missing Kimi CLI without exposing stderr", async () => {
    const run = vi.fn<SafeCommandRunner>().mockRejectedValue(
      new CapabilityProbeError("CLI_MISSING", "本机没有找到这套 CLI。"),
    );
    const result = await probeKimiCapabilities({ runCommand: run });
    expect(result.status).toBe("missing");
    expect(result.reason).not.toContain("secret");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("uses both Kimi commands and returns a stable snapshot", async () => {
    const run = vi.fn<SafeCommandRunner>()
      .mockResolvedValueOnce({ stdout: "kimi 1.2.3\n" })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          providers: [{
            models: [{
              alias: "kimi-for-coding",
              support_efforts: ["high"],
              default_effort: "high",
            }],
          }],
        }),
      });
    const result = await probeKimiCapabilities({
      runCommand: run,
      now: () => new Date("2026-07-25T00:00:00.000Z"),
    });
    expect(result).toMatchObject({
      cli: "kimi",
      cliVersion: "kimi 1.2.3",
      status: "available",
      checkedAt: "2026-07-25T00:00:00.000Z",
    });
    expect(result.snapshotId).toHaveLength(64);
    expect(run.mock.calls).toEqual([
      ["kimi", ["--version"], 5_000],
      ["kimi", ["provider", "list", "--json"], 5_000],
    ]);
  });

  it("reuses a prechecked Kimi version instead of running the version command twice", async () => {
    const run = vi.fn<SafeCommandRunner>().mockResolvedValue({
      stdout: JSON.stringify({
        providers: [{
          models: [{
            alias: "kimi-for-coding",
            support_efforts: ["high"],
            default_effort: "high",
          }],
        }],
      }),
    });
    const result = await probeKimiCapabilities({
      knownCliVersion: "kimi 1.2.3",
      runCommand: run,
    });
    expect(result).toMatchObject({
      status: "available",
      cliVersion: "kimi 1.2.3",
    });
    expect(run).toHaveBeenCalledExactlyOnceWith(
      "kimi",
      ["provider", "list", "--json"],
      5_000,
    );
  });

  it("classifies an explicitly empty Kimi provider list as authentication required", async () => {
    const run = vi.fn<SafeCommandRunner>()
      .mockResolvedValueOnce({ stdout: "kimi 1.2.3\n" })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ providers: {}, models: {} }) });
    const result = await probeKimiCapabilities({ runCommand: run });
    expect(result).toMatchObject({
      status: "unavailable",
      failureCode: "AUTHENTICATION_REQUIRED",
      models: [],
    });
    expect(result.reason).not.toContain("provider-token");
  });
});
