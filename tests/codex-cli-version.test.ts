import { describe, expect, it } from "vitest";

import {
  isSupportedCodexCliVersion,
  MINIMUM_CODEX_CLI_VERSION,
  parseCodexCliVersion,
} from "../src/codex-cli-version.js";

describe("Codex CLI version compatibility", () => {
  it("accepts the minimum stable version and newer versions", () => {
    expect(MINIMUM_CODEX_CLI_VERSION).toBe("0.145.0");
    expect(isSupportedCodexCliVersion("codex-cli 0.145.0")).toBe(true);
    expect(isSupportedCodexCliVersion("codex-cli 0.145.1")).toBe(true);
    expect(isSupportedCodexCliVersion("codex-cli 1.0.0")).toBe(true);
    expect(isSupportedCodexCliVersion("codex-cli 0.146.0-alpha.14")).toBe(true);
  });

  it("rejects old, same-version prerelease, and malformed output", () => {
    expect(isSupportedCodexCliVersion("codex-cli 0.144.1")).toBe(false);
    expect(isSupportedCodexCliVersion("codex-cli 0.145.0-alpha.1")).toBe(false);
    expect(isSupportedCodexCliVersion("codex-cli unknown")).toBe(false);
    expect(isSupportedCodexCliVersion("")).toBe(false);
  });

  it("extracts a strict three-part version from the CLI output", () => {
    expect(parseCodexCliVersion("codex-cli 0.145.0")).toEqual({
      major: 0,
      minor: 145,
      patch: 0,
      prerelease: null,
    });
    expect(parseCodexCliVersion("codex-cli 0.145")).toBeNull();
  });
});
