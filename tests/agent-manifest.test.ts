import { describe, expect, it } from "vitest";

import { parseAgentManifest } from "../src/agent-manifest.js";

describe("agent manifest", () => {
  it("returns the persona body without exposing retired runner metadata", () => {
    expect(parseAgentManifest(`---
workspace_access: write
pre_script: src/agent-prescripts/legacy.ts
---

# Dev

body`)).toEqual({ body: "# Dev\n\nbody" });
  });

  it("treats markdown without frontmatter as persona body", () => {
    expect(parseAgentManifest("# PM\n\nbody")).toEqual({ body: "# PM\n\nbody" });
  });
});
