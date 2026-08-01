import { describe, expect, it, vi } from "vitest";
import {
  applyAgentTeamMemberExternalChange,
  clearAgentTeamMemberExternalChange,
  EMPTY_AGENT_TEAM_DRAFT_STATE,
  failAgentTeamMemberSave,
  finishAgentTeamMemberLoad,
  finishAgentTeamMemberSave,
  getAgentTeamMemberDraft,
  getDirtyAgentTeamMemberSlugs,
  isAgentTeamMemberDirty,
  loadAgentTeamMemberExternalVersion,
  startAgentTeamMemberSave,
  startAgentTeamMemberExternalOverwrite,
  updateAgentTeamMemberDraft,
} from "../src/console-page/team-state.js";
import { saveAllAgentTeamDrafts } from "../src/console-page/team-save-controller.js";

const teamKey = "user:development";

describe("Agent team per-member draft state", () => {
  it("keeps independent drafts for multiple members while the selection changes elsewhere", () => {
    let state = loadMember(EMPTY_AGENT_TEAM_DRAFT_STATE, "manager", "# 经理\n\n负责推进\n");
    state = loadMember(state, "dev", "# 开发\n\n负责实现\n");
    state = updateAgentTeamMemberDraft(state, teamKey, "manager", "# 经理\n\n负责方案与推进\n");
    state = updateAgentTeamMemberDraft(state, teamKey, "dev", "# 开发\n\n负责实现与自测\n");

    expect(getAgentTeamMemberDraft(state, teamKey, "manager")?.draftMarkdown).toContain("方案与推进");
    expect(getAgentTeamMemberDraft(state, teamKey, "dev")?.draftMarkdown).toContain("实现与自测");
    expect(getDirtyAgentTeamMemberSlugs(state, teamKey)).toEqual(["manager", "dev"]);
  });

  it("clears only the saved member and retains content plus the reason when another save fails", () => {
    let state = loadDirtyMembers();
    state = startAgentTeamMemberSave(state, teamKey, "manager");
    state = finishAgentTeamMemberSave(state, teamKey, "manager", "# 经理\n\n新职责\n");
    state = startAgentTeamMemberSave(state, teamKey, "dev");
    state = failAgentTeamMemberSave(state, teamKey, "dev", "磁盘空间不足");

    expect(isAgentTeamMemberDirty(getAgentTeamMemberDraft(state, teamKey, "manager"))).toBe(false);
    expect(getAgentTeamMemberDraft(state, teamKey, "dev")).toMatchObject({
      draftMarkdown: "# 开发\n\n新职责\n",
      saveStatus: "failed",
      saveError: "磁盘空间不足",
    });
  });

  it("saves all drafts sequentially and commits successes when a later member fails", async () => {
    const transitions: string[][] = [];
    const saveMember = vi.fn(async (memberSlug: string, markdown: string) => {
      if (memberSlug === "dev") {
        throw new Error("文件被占用");
      }
      return markdown;
    });

    const result = await saveAllAgentTeamDrafts({
      state: loadDirtyMembers(),
      teamKey,
      saveMember,
      onTransition: (state) => transitions.push(getDirtyAgentTeamMemberSlugs(state, teamKey)),
    });

    expect(saveMember.mock.calls.map(([memberSlug]) => memberSlug)).toEqual(["manager", "dev"]);
    expect(result.failures).toEqual([{ memberSlug: "dev", reason: "文件被占用" }]);
    expect(isAgentTeamMemberDirty(getAgentTeamMemberDraft(result.state, teamKey, "manager"))).toBe(false);
    expect(getAgentTeamMemberDraft(result.state, teamKey, "dev")).toMatchObject({
      draftMarkdown: "# 开发\n\n新职责\n",
      saveStatus: "failed",
      saveError: "文件被占用",
    });
    expect(transitions.at(-1)).toEqual(["dev"]);
  });

  it("preserves edits made after a save began instead of clearing the newer draft", () => {
    let state = loadMember(EMPTY_AGENT_TEAM_DRAFT_STATE, "manager", "# 经理\n\n旧职责\n");
    state = updateAgentTeamMemberDraft(state, teamKey, "manager", "# 经理\n\n准备保存\n");
    state = startAgentTeamMemberSave(state, teamKey, "manager");
    state = updateAgentTeamMemberDraft(state, teamKey, "manager", "# 经理\n\n保存期间继续编辑\n");
    state = finishAgentTeamMemberSave(state, teamKey, "manager", "# 经理\n\n准备保存\n");

    const member = getAgentTeamMemberDraft(state, teamKey, "manager");
    expect(member?.draftMarkdown).toContain("保存期间继续编辑");
    expect(isAgentTeamMemberDirty(member)).toBe(true);
  });

  it("does not issue a duplicate write for a member that is already saving", async () => {
    let state = loadDirtyMembers();
    state = startAgentTeamMemberSave(state, teamKey, "manager");
    const saveMember = vi.fn(async (_memberSlug: string, markdown: string) => markdown);

    const result = await saveAllAgentTeamDrafts({ state, teamKey, saveMember });

    expect(saveMember.mock.calls.map(([memberSlug]) => memberSlug)).toEqual(["dev"]);
    expect(result.failures).toContainEqual({
      memberSlug: "manager",
      reason: "该成员仍在保存，请稍后重试。",
    });
  });

  it("reloads an external version when the member has no unsaved draft", () => {
    const state = applyAgentTeamMemberExternalChange(
      loadMember(EMPTY_AGENT_TEAM_DRAFT_STATE, "manager", "# 经理\n\n旧职责\n"),
      teamKey,
      "manager",
      "# 新经理\n\n外部职责\n",
    );

    expect(getAgentTeamMemberDraft(state, teamKey, "manager")).toMatchObject({
      savedMarkdown: "# 新经理\n\n外部职责\n",
      draftMarkdown: "# 新经理\n\n外部职责\n",
      externalChangeStatus: "reloaded",
      externalMarkdown: null,
    });
    expect(isAgentTeamMemberDirty(getAgentTeamMemberDraft(state, teamKey, "manager"))).toBe(false);
  });

  it("preserves a draft until the user loads the external version", () => {
    let state = loadMember(EMPTY_AGENT_TEAM_DRAFT_STATE, "manager", "# 经理\n\n旧职责\n");
    state = updateAgentTeamMemberDraft(state, teamKey, "manager", "# 经理\n\n软件内草稿\n");
    state = applyAgentTeamMemberExternalChange(state, teamKey, "manager", "# 经理\n\n外部职责\n");

    expect(getAgentTeamMemberDraft(state, teamKey, "manager")).toMatchObject({
      savedMarkdown: "# 经理\n\n旧职责\n",
      draftMarkdown: "# 经理\n\n软件内草稿\n",
      externalChangeStatus: "conflict",
      externalMarkdown: "# 经理\n\n外部职责\n",
    });

    state = loadAgentTeamMemberExternalVersion(state, teamKey, "manager");
    expect(getAgentTeamMemberDraft(state, teamKey, "manager")).toMatchObject({
      savedMarkdown: "# 经理\n\n外部职责\n",
      draftMarkdown: "# 经理\n\n外部职责\n",
      externalChangeStatus: "reloaded",
      externalMarkdown: null,
    });
  });

  it("overwrites with the exact current draft only after the explicit choice", () => {
    let state = loadMember(EMPTY_AGENT_TEAM_DRAFT_STATE, "manager", "# 经理\n\n旧职责\n");
    state = updateAgentTeamMemberDraft(state, teamKey, "manager", "# 经理\n\n软件内草稿\n");
    state = applyAgentTeamMemberExternalChange(state, teamKey, "manager", "# 经理\n\n外部职责\n");
    state = startAgentTeamMemberExternalOverwrite(state, teamKey, "manager");

    expect(getAgentTeamMemberDraft(state, teamKey, "manager")).toMatchObject({
      saveStatus: "saving",
      saveRequestedMarkdown: "# 经理\n\n软件内草稿\n",
      externalChangeStatus: "conflict",
    });

    state = finishAgentTeamMemberSave(state, teamKey, "manager", "# 经理\n\n软件内草稿\n");
    expect(getAgentTeamMemberDraft(state, teamKey, "manager")).toMatchObject({
      savedMarkdown: "# 经理\n\n软件内草稿\n",
      draftMarkdown: "# 经理\n\n软件内草稿\n",
      saveStatus: "idle",
      externalChangeStatus: "none",
      externalMarkdown: null,
    });
  });

  it("clears a conflict if the external file returns to the saved version", () => {
    let state = loadMember(EMPTY_AGENT_TEAM_DRAFT_STATE, "manager", "# 经理\n\n旧职责\n");
    state = updateAgentTeamMemberDraft(state, teamKey, "manager", "# 经理\n\n软件内草稿\n");
    state = applyAgentTeamMemberExternalChange(state, teamKey, "manager", "# 经理\n\n外部职责\n");
    state = clearAgentTeamMemberExternalChange(state, teamKey, "manager");

    expect(getAgentTeamMemberDraft(state, teamKey, "manager")).toMatchObject({
      draftMarkdown: "# 经理\n\n软件内草稿\n",
      externalChangeStatus: "none",
      externalMarkdown: null,
    });
  });
});

function loadMember(
  state: typeof EMPTY_AGENT_TEAM_DRAFT_STATE,
  memberSlug: string,
  markdown: string,
): typeof EMPTY_AGENT_TEAM_DRAFT_STATE {
  return finishAgentTeamMemberLoad(state, teamKey, memberSlug, markdown);
}

function loadDirtyMembers(): typeof EMPTY_AGENT_TEAM_DRAFT_STATE {
  let state = loadMember(EMPTY_AGENT_TEAM_DRAFT_STATE, "manager", "# 经理\n\n旧职责\n");
  state = loadMember(state, "dev", "# 开发\n\n旧职责\n");
  state = updateAgentTeamMemberDraft(state, teamKey, "manager", "# 经理\n\n新职责\n");
  return updateAgentTeamMemberDraft(state, teamKey, "dev", "# 开发\n\n新职责\n");
}
