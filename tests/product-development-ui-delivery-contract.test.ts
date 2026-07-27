import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const teamRoot = path.resolve("seeds/teams/product-development");

describe("product-development UI delivery contract", () => {
  it("routes mature pages through production Page Stories and isolates exploration prototypes", async () => {
    const lead = await readMember("product-delivery-lead");
    const prototyper = await readMember("ui-prototyper");
    const implementer = await readMember("implementation-lead");
    const functionalQa = await readMember("functional-qa");
    const visualQa = await readMember("visual-qa");

    expect(lead).toContain("成熟页面");
    expect(lead).toContain("Page Story");
    expect(lead).toContain("无法由 production Component / Block / Page Story 回答");
    expect(prototyper).toContain("明确的待验证问题");
    expect(prototyper).toContain("production Page Story");
    expect(implementer).toContain("packages/console-ui/AGENTS.md");
    expect(implementer).toContain("确定性 fixture、fullscreen 和真实生产导出");
    expect(functionalQa).toContain("不能用 Storybook 代替");
    expect(functionalQa).toContain("仓库 `artifacts/` 不得作为证据落点");
    expect(visualQa).toContain("批准的 Page Story");
    expect(visualQa).toContain("只有探索型任务");
  });

  it("publishes the updated official seed metadata and valid orchestration JSON", async () => {
    const official = JSON.parse(
      await fs.readFile(path.join(teamRoot, "official.json"), "utf8"),
    ) as { officialVersion: string };
    const team = JSON.parse(
      await fs.readFile(path.join(teamRoot, "team.json"), "utf8"),
    ) as { description: string };
    const onboarding = JSON.parse(
      await fs.readFile(path.join(teamRoot, "onboarding-orchestration.json"), "utf8"),
    ) as { relayBeats: Array<{ message: string }> };

    expect(official.officialVersion).toBe("2");
    expect(team.description).toContain("production Page Story");
    expect(onboarding.relayBeats.some((beat) => beat.message.includes("fullscreen Page Story"))).toBe(true);
  });
});

async function readMember(slug: string): Promise<string> {
  return fs.readFile(path.join(teamRoot, "members", slug, "AGENT.md"), "utf8");
}
