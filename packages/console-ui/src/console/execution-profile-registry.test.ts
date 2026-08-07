import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXECUTION_PROFILES,
  EXECUTION_MODEL_REGISTRY,
  PI_EXECUTION_MODELS,
  resolveProfileForCli,
  resolveProfileForModel,
} from "./execution-profile-registry";

describe("Agent Team execution profile registry", () => {
  it("publishes the approved Codex models with model-specific efforts", () => {
    expect(EXECUTION_MODEL_REGISTRY.codex.map((model) => [model.value, model.efforts])).toEqual([
      ["gpt-5.6-sol", ["low", "medium", "high", "xhigh", "max"]],
      ["gpt-5.6-terra", ["low", "medium", "high", "xhigh", "max"]],
      ["gpt-5.6-luna", ["low", "medium", "high", "xhigh", "max"]],
      ["gpt-5.5", ["low", "medium", "high", "xhigh"]],
      ["gpt-5.4", ["low", "medium", "high", "xhigh"]],
      ["gpt-5.4-mini", ["low", "medium", "high", "xhigh"]],
    ]);
    expect(JSON.stringify(EXECUTION_MODEL_REGISTRY.codex)).not.toContain("ultra");
    expect(JSON.stringify(EXECUTION_MODEL_REGISTRY.codex)).not.toContain("gpt-5.3-codex-spark");
  });

  it("publishes exact Kimi CLI aliases and marks restricted choices", () => {
    expect(EXECUTION_MODEL_REGISTRY.kimi.map((model) => [
      model.value,
      model.efforts,
      model.membershipRestricted,
    ])).toEqual([
      ["kimi-code/kimi-for-coding", ["on"], false],
      ["kimi-code/k3", ["low", "high", "max"], true],
      ["kimi-code/k3-256k", ["low", "high", "max"], true],
      ["kimi-code/kimi-for-coding-highspeed", ["on"], true],
    ]);
  });

  it("publishes Claude aliases with their exact effort matrices", () => {
    expect(EXECUTION_MODEL_REGISTRY.claude.map((model) => [
      model.value,
      model.efforts,
      model.defaultEffort,
    ])).toEqual([
      ["fable", ["low", "medium", "high", "xhigh", "max"], "high"],
      ["sonnet", ["low", "medium", "high", "max"], "high"],
      ["opus", ["low", "medium", "high", "max"], "high"],
    ]);
  });

  it("publishes only the DeepSeek V4 reasoning levels the API actually distinguishes", () => {
    expect(PI_EXECUTION_MODELS.map((model) => [model.value, model.efforts, model.defaultEffort])).toEqual([
      ["deepseek-v4-flash", ["high", "max"], "high"],
      ["deepseek-v4-pro", ["high", "max"], "high"],
    ]);
  });

  it("uses compatibility defaults and keeps a supported effort across model changes", () => {
    expect(DEFAULT_EXECUTION_PROFILES).toEqual({
      codex: { cli: "codex", model: "gpt-5.6-sol", effort: "high" },
      claude: { cli: "claude", model: "sonnet", effort: "high" },
      kimi: { cli: "kimi", model: "kimi-code/kimi-for-coding", effort: "on" },
    });
    expect(resolveProfileForCli("claude")).toEqual(DEFAULT_EXECUTION_PROFILES.claude);
    expect(resolveProfileForCli("kimi")).toEqual(DEFAULT_EXECUTION_PROFILES.kimi);
    expect(resolveProfileForModel(
      { cli: "codex", model: "gpt-5.6-sol", effort: "xhigh" },
      "gpt-5.4-mini",
    )).toEqual({ cli: "codex", model: "gpt-5.4-mini", effort: "xhigh" });
    expect(resolveProfileForModel(
      { cli: "codex", model: "gpt-5.6-sol", effort: "max" },
      "gpt-5.4-mini",
    )).toEqual({ cli: "codex", model: "gpt-5.4-mini", effort: "high" });
  });
});
