import { describe, expect, it } from "vitest";

import {
  LAYER_TOKEN_REGISTRY,
  findZIndexViolations,
  validateLayerTokenDeclarations,
} from "../scripts/check-z-index-contract.js";

describe("z-index contract", () => {
  it("accepts semantic classes, tokens, and auto stacking", () => {
    const contents = [
      "<div class=\"z-layer-floating\"></div>",
      ".popover { z-index: var(--layer-floating); }",
      ".layout { z-index: auto; }",
    ].join("\n");

    expect(findZIndexViolations("fixture.css", contents)).toEqual([]);
  });

  it("rejects numeric and arbitrary layer declarations", () => {
    const numericClass = ["z", "-", "50"].join("");
    const arbitraryClass = ["z", "-", "[", "50", "]"].join("");
    const numericCss = ["z", "-index: ", "50"].join("");
    const numericJs = ["z", "Index: ", "50"].join("");

    expect(findZIndexViolations("fixture.css", [numericClass, arbitraryClass, numericCss, numericJs].join("\n"))).toHaveLength(4);
  });

  it("does not treat JavaScript arithmetic as a Tailwind layer class", () => {
    expect(findZIndexViolations("bundle.js", "function midpoint(z) { return (z-1) >>> 1; }")).toEqual([]);
  });

  it("requires the production token registry to be complete and exact", () => {
    const contents = Object.entries(LAYER_TOKEN_REGISTRY)
      .map(([token, value]) => `--${token}: ${value};`)
      .join("\n");

    expect(validateLayerTokenDeclarations("tokens.css", contents)).toEqual([]);
    expect(validateLayerTokenDeclarations("tokens.css", contents.replace("--layer-rail: 20", "--layer-rail: 21"))).toHaveLength(1);
  });

  it("accepts minified mirrors without the final declaration semicolon", () => {
    const contents = Object.entries(LAYER_TOKEN_REGISTRY)
      .map(([token, value]) => `--${token}:${value};`)
      .join("")
      .replace(/;$/, "");

    expect(validateLayerTokenDeclarations("prototype.html", `:root{${contents}}`)).toEqual([]);
  });
});
