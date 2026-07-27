import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("Storybook catalog contract", () => {
  it("classifies the production catalog and keeps page frames unpadded", async () => {
    const result = runChecker("packages/console-ui/src");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Component=\d+, Block=\d+, Page=\d+/u);

    const preview = await fs.readFile("packages/console-ui/.storybook/preview.tsx", "utf8");
    expect(preview).toContain('context.title.startsWith("Page/")');
    expect(preview).toContain('context.parameters.layout === "fullscreen"');
    expect(preview).toContain('fullscreen ? "" : " p-6"');
  });

  it("builds both Storybook commands into a task-scoped system temporary directory", async () => {
    const packageJson = JSON.parse(
      await fs.readFile("packages/console-ui/package.json", "utf8"),
    ) as { scripts: Record<string, string> };
    const wrapper = await fs.readFile(
      "packages/console-ui/scripts/build-storybook-temp.mjs",
      "utf8",
    );

    expect(packageJson.scripts["build-storybook"]).toBe(
      "node scripts/build-storybook-temp.mjs",
    );
    expect(packageJson.scripts["check:storybook"]).toContain(
      "node scripts/build-storybook-temp.mjs",
    );
    expect(packageJson.scripts["check:storybook"]).not.toContain("storybook build");
    expect(wrapper).toContain("os.tmpdir()");
    expect(wrapper).toContain("fs.mkdtemp(");
    expect(wrapper).toContain('"--output-dir", outputDirectory');
    expect(wrapper).toContain("shell: false");
    expect(wrapper).not.toContain("storybook-static");
  });

  it("rejects an unclassified story and a Page story without fullscreen layout", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-story-catalog-"));
    temporaryRoots.push(fixtureRoot);
    await fs.writeFile(
      path.join(fixtureRoot, "component.stories.tsx"),
      'const meta = { title: "Component/UI/Button" }; export default meta;\n',
    );
    await fs.writeFile(
      path.join(fixtureRoot, "block.stories.tsx"),
      'const meta = { title: "Block/Console/Sidebar" }; export default meta;\n',
    );
    await fs.writeFile(
      path.join(fixtureRoot, "page.stories.tsx"),
      'const meta = { title: "Page/Console/Main" }; export default meta;\n',
    );
    await fs.writeFile(
      path.join(fixtureRoot, "legacy.stories.tsx"),
      'const meta = { title: "Console/Legacy" }; export default meta;\n',
    );

    const result = runChecker(fixtureRoot);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("expected exactly one Meta.title");
    expect(result.stderr).toContain('Page stories must set meta parameters.layout to "fullscreen"');
  });
});

function runChecker(storyRoot: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["scripts/check-story-catalog.mjs", storyRoot], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}
