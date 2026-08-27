import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  installMoebiusSkillRegistry,
  resolveMoebiusSkillProjectionHomeDir,
} from "../src/local-console/moebius-skill-registry.js";

describe("Moebius Skill registry", () => {
  it("materializes source Skills and projects them into Claude and Codex standard roots", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-skill-registry-"));
    const sourceRoot = path.join(root, "source-skills");
    const dataRoot = path.join(root, "data");
    const homeDir = path.join(root, "home");
    const sourceSkill = path.join(sourceRoot, "completion-handoff");
    await fs.mkdir(path.join(sourceSkill, "references"), { recursive: true });
    await fs.writeFile(
      path.join(sourceSkill, "SKILL.md"),
      [
        "---",
        "name: completion-handoff",
        "description: Evidence-based closeout choices",
        "---",
        "",
        "# Completion Handoff",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(path.join(sourceSkill, "references", "guide.md"), "supporting material\n", "utf8");

    const result = await installMoebiusSkillRegistry({ dataRoot, sourceRoot, projectionHomeDir: homeDir });

    expect(result.diagnostics).toEqual([]);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]).toMatchObject({
      directoryName: "completion-handoff",
      name: "completion-handoff",
      providerLinkName: "moebius-completion-handoff",
    });
    await expect(fs.readFile(
      path.join(dataRoot, "skills", "moebius", "completion-handoff", "references", "guide.md"),
      "utf8",
    )).resolves.toBe("supporting material\n");

    expect(result.projections.map((projection) => projection.provider)).toEqual(["claude", "codex"]);
    for (const projection of result.projections) {
      expect(projection.links).toEqual([expect.objectContaining({ status: "created" })]);
      await expect(fs.readlink(projection.links[0]!.path)).resolves.toBe(
        path.join(dataRoot, "skills", "moebius", "completion-handoff"),
      );
    }

    const second = await installMoebiusSkillRegistry({ dataRoot, sourceRoot, projectionHomeDir: homeDir });
    expect(second.projections.every((projection) => projection.links[0]?.status === "existing")).toBe(true);
  });

  it("preserves provider entries on conflicts and reports malformed source Skills", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-skill-registry-"));
    const sourceRoot = path.join(root, "source-skills");
    const dataRoot = path.join(root, "data");
    const homeDir = path.join(root, "home");
    await fs.mkdir(path.join(sourceRoot, "valid-skill"), { recursive: true });
    await fs.writeFile(
      path.join(sourceRoot, "valid-skill", "SKILL.md"),
      ["---", "name: valid-skill", "description: Valid skill", "---", "body", ""].join("\n"),
      "utf8",
    );
    await fs.mkdir(path.join(sourceRoot, "broken-skill"), { recursive: true });
    await fs.writeFile(path.join(sourceRoot, "broken-skill", "SKILL.md"), "# missing frontmatter\n", "utf8");

    const conflictingPath = path.join(homeDir, ".claude", "skills", "moebius-valid-skill");
    await fs.mkdir(conflictingPath, { recursive: true });
    await fs.writeFile(path.join(conflictingPath, "keep.txt"), "keep\n", "utf8");

    const result = await installMoebiusSkillRegistry({ dataRoot, sourceRoot, projectionHomeDir: homeDir });

    expect(result.skills.map((skill) => skill.directoryName)).toEqual(["valid-skill"]);
    expect(result.projections.find((projection) => projection.provider === "claude")?.links[0]).toMatchObject({
      status: "conflict",
    });
    expect(result.projections.find((projection) => projection.provider === "codex")?.links[0]).toMatchObject({
      status: "created",
    });
    await expect(fs.readFile(path.join(conflictingPath, "keep.txt"), "utf8")).resolves.toBe("keep\n");
    expect(result.diagnostics.some((diagnostic) => diagnostic.includes("broken-skill"))).toBe(true);
  });

  it("handles empty and invalid sources, then recovers on a later startup", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-skill-registry-"));
    const sourceRoot = path.join(root, "source-skills");
    const dataRoot = path.join(root, "data");
    const homeDir = path.join(root, "home");

    const missing = await installMoebiusSkillRegistry({
      dataRoot,
      sourceRoot: path.join(root, "missing-source-skills"),
      projectionHomeDir: homeDir,
    });
    expect(missing.skills).toEqual([]);
    expect(missing.diagnostics.some((diagnostic) => diagnostic.includes("无法读取 Moebius Skill 源目录"))).toBe(true);

    await fs.mkdir(sourceRoot, { recursive: true });
    const empty = await installMoebiusSkillRegistry({ dataRoot, sourceRoot, projectionHomeDir: homeDir });
    expect(empty.skills).toEqual([]);
    expect(empty.diagnostics).toEqual([]);

    const invalidSource = path.join(sourceRoot, "Invalid Skill");
    await fs.mkdir(invalidSource, { recursive: true });
    await fs.writeFile(
      path.join(invalidSource, "SKILL.md"),
      ["---", "name: invalid-skill", "description: Invalid directory", "---", "body", ""].join("\n"),
      "utf8",
    );
    const invalid = await installMoebiusSkillRegistry({ dataRoot, sourceRoot, projectionHomeDir: homeDir });
    expect(invalid.skills).toEqual([]);
    expect(invalid.diagnostics.some((diagnostic) => diagnostic.includes("Invalid Skill"))).toBe(true);

    const recoveredSource = path.join(sourceRoot, "recovered-skill");
    await fs.mkdir(recoveredSource, { recursive: true });
    await fs.writeFile(
      path.join(recoveredSource, "SKILL.md"),
      ["---", "name: recovered-skill", "description: Recovered skill", "---", "body", ""].join("\n"),
      "utf8",
    );
    const recovered = await installMoebiusSkillRegistry({ dataRoot, sourceRoot, projectionHomeDir: homeDir });
    expect(recovered.skills.map((skill) => skill.directoryName)).toEqual(["recovered-skill"]);
    expect(recovered.diagnostics).toHaveLength(1);
    expect(recovered.diagnostics[0]).toContain("Invalid Skill");
  });

  it("reports an unavailable provider projection root and recovers after it is released", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-skill-registry-"));
    const sourceRoot = path.join(root, "source-skills");
    const dataRoot = path.join(root, "data");
    const homeDir = path.join(root, "home");
    const skillPath = path.join(sourceRoot, "recoverable-skill");
    await fs.mkdir(skillPath, { recursive: true });
    await fs.writeFile(
      path.join(skillPath, "SKILL.md"),
      ["---", "name: recoverable-skill", "description: Recoverable skill", "---", "body", ""].join("\n"),
      "utf8",
    );
    const occupiedProjectionRoot = path.join(homeDir, ".claude", "skills");
    await fs.mkdir(path.dirname(occupiedProjectionRoot), { recursive: true });
    await fs.writeFile(occupiedProjectionRoot, "occupied\n", "utf8");

    const failed = await installMoebiusSkillRegistry({ dataRoot, sourceRoot, projectionHomeDir: homeDir });
    expect(failed.projections.find((projection) => projection.provider === "claude")?.links[0]).toMatchObject({
      status: "failed",
    });
    expect(failed.diagnostics.some((diagnostic) => diagnostic.includes("claude Skill 投影目录"))).toBe(true);

    await fs.unlink(occupiedProjectionRoot);
    const recovered = await installMoebiusSkillRegistry({ dataRoot, sourceRoot, projectionHomeDir: homeDir });
    expect(recovered.projections.find((projection) => projection.provider === "claude")?.links[0]).toMatchObject({
      status: "created",
    });
    expect(recovered.projections.find((projection) => projection.provider === "codex")?.links[0]).toMatchObject({
      status: "existing",
    });
  });

  it("keeps concurrent startup calls idempotent", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-skill-registry-"));
    const sourceRoot = path.join(root, "source-skills");
    const dataRoot = path.join(root, "data");
    const homeDir = path.join(root, "home");
    const skillPath = path.join(sourceRoot, "concurrent-skill");
    await fs.mkdir(skillPath, { recursive: true });
    await fs.writeFile(
      path.join(skillPath, "SKILL.md"),
      ["---", "name: concurrent-skill", "description: Concurrent skill", "---", "body", ""].join("\n"),
      "utf8",
    );

    const [first, second] = await Promise.all([
      installMoebiusSkillRegistry({ dataRoot, sourceRoot, projectionHomeDir: homeDir }),
      installMoebiusSkillRegistry({ dataRoot, sourceRoot, projectionHomeDir: homeDir }),
    ]);
    expect(first.diagnostics).toEqual([]);
    expect(second.diagnostics).toEqual([]);
    for (const provider of ["claude", "codex"] as const) {
      const statuses = [
        first.projections.find((projection) => projection.provider === provider)?.links[0]?.status,
        second.projections.find((projection) => projection.provider === provider)?.links[0]?.status,
      ].sort();
      expect(statuses).toEqual(["created", "existing"]);
    }
  });

  it("uses the explicit projection-home override before the fallback home", () => {
    expect(resolveMoebiusSkillProjectionHomeDir(
      { MOEBIUS_SKILL_PROJECTION_HOME: "/tmp/moebius-skill-home" },
      "/tmp/fallback",
    )).toBe("/tmp/moebius-skill-home");
    expect(resolveMoebiusSkillProjectionHomeDir({}, "/tmp/fallback")).toBe("/tmp/fallback");
  });
});
