import { describe, expect, it } from "vitest";
import {
  PiProviderValidationError,
  classifyPiProviderValidationError,
  toPiModel,
} from "../src/pi-provider-validator.js";
import { getProviderCatalogModel } from "../src/provider-profile.js";

describe("Pi provider validation errors", () => {
  it.each([
    ["HTTP 401 invalid API key sk-sensitive", "auth"],
    ["HTTP 429 too many requests", "rate-limited"],
    ["insufficient balance quota", "quota"],
    ["model deepseek-v4-pro not found", "model-unavailable"],
    ["fetch failed ECONNRESET", "network"],
    ["unexpected provider body sk-sensitive", "provider-unavailable"],
  ] as const)("maps raw failure to a safe reason: %s", (raw, code) => {
    const result = classifyPiProviderValidationError(new Error(raw));
    expect(result.code).toBe(code);
    expect(result.message).not.toContain("sk-sensitive");
    expect(result).toBeInstanceOf(PiProviderValidationError);
  });

  it("keeps cancellation distinct", () => {
    expect(classifyPiProviderValidationError(new Error("anything"), true)).toMatchObject({
      code: "cancelled",
    });
  });

  it("matches the locked DeepSeek V4 text and reasoning contract", () => {
    const catalogModel = getProviderCatalogModel("deepseek", "deepseek-v4-pro");
    expect(catalogModel).not.toBeNull();
    expect(toPiModel(catalogModel!)).toMatchObject({
      api: "openai-completions",
      input: ["text"],
      contextWindow: 1_000_000,
      maxTokens: 384_000,
      thinkingLevelMap: { low: null, medium: null, high: "high", max: "max" },
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        requiresReasoningContentOnAssistantMessages: true,
        thinkingFormat: "deepseek",
      },
    });
  });
});
