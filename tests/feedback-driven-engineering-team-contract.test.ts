import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const teamRoot = path.resolve("seeds", "teams", "feedback-driven-engineering");

async function readMember(slug: string): Promise<string> {
  return fs.readFile(path.join(teamRoot, "members", slug, "AGENT.md"), "utf8");
}

describe("feedback-driven engineering team contracts", () => {
  it("takes clear authorized implementation to merge-ready without another user cue", async () => {
    const [lead, implementer, reviewer] = await Promise.all([
      readMember("delivery-lead"),
      readMember("implementer"),
      readMember("delivery-reviewer"),
    ]);

    expect(lead).toContain("默认使用 `merge-ready`");
    expect(lead).toContain("无需用户再次说“审查”“收尾”或“继续”");
    expect(implementer).toContain("供其无需再次询问用户就启动独立审查");
    expect(implementer).toContain("不得仅因实现者已经完成就暂停等待用户");
    expect(reviewer).toContain("无需用户再次要求“审查”或“完整收尾”即可启用");
  });

  it("keeps merge-ready separate from Git authorization and reuses valid evidence", async () => {
    const [lead, reviewer] = await Promise.all([
      readMember("delivery-lead"),
      readMember("delivery-reviewer"),
    ]);

    expect(lead).toContain("覆盖 tracked 与未跟踪交付文件的变更指纹");
    expect(lead).toContain("不再调用审查者或机械重跑测试");
    expect(lead).toContain("不得把 Git 授权扩张为新一轮实现授权");
    expect(reviewer).toContain("无关变化继续引用原结论");
    expect(reviewer).toContain("不执行 commit、merge、push、发布或部署");
  });

  it("publishes the workflow as official version 2 and ends onboarding at merge-ready", async () => {
    const [team, official, orchestration] = await Promise.all([
      fs.readFile(path.join(teamRoot, "team.json"), "utf8").then(JSON.parse),
      fs.readFile(path.join(teamRoot, "official.json"), "utf8").then(JSON.parse),
      fs.readFile(path.join(teamRoot, "onboarding-orchestration.json"), "utf8").then(JSON.parse),
    ]);

    expect(team.description).toContain("明确实现默认自动经过独立审查形成 merge-ready");
    expect(official.officialVersion).toBe("2");
    expect(orchestration.relayBeats.at(-1)).toMatchObject({
      speakerSlug: "delivery-lead",
    });
    expect(orchestration.relayBeats.at(-1)?.message).toContain("当前状态为 merge-ready");
    expect(orchestration.relayBeats.at(-1)?.message).toContain("等待其单独授权 commit、squash merge");
  });
});
