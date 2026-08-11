import { describe, expect, it } from "vitest";

import {
  applyAgentTeamMemberExternalChange,
  applyAgentTeamMemberRestored,
  finishAgentTeamMemberLoad,
  getAgentTeamMemberDraft,
  type AgentTeamDraftState,
} from "./team-state.js";

const EMPTY: AgentTeamDraftState = { membersByKey: {} };

function readyMember(teamKey: string, memberSlug: string, markdown: string): AgentTeamDraftState {
  return finishAgentTeamMemberLoad(EMPTY, teamKey, memberSlug, markdown);
}

describe("applyAgentTeamMemberRestored", () => {
  it("moves BOTH the saved baseline and the draft to the restored content", () => {
    const state = readyMember("system:development", "dev-manager", "# 开发经理\n\n第一版\n");
    const next = applyAgentTeamMemberRestored(state, "system:development", "dev-manager", "# 开发经理\n\n旧版\n");
    const member = getAgentTeamMemberDraft(next, "system:development", "dev-manager")!;
    expect(member.savedMarkdown).toBe("# 开发经理\n\n旧版\n");
    expect(member.draftMarkdown).toBe("# 开发经理\n\n旧版\n");
    expect(member.externalChangeStatus).toBe("none");
    expect(member.externalMarkdown).toBeNull();
    // Not dirty: the restored content IS the on-disk content, so an external
    // check must NOT treat it as a foreign change (the revision-loop bug).
    expect(member.savedMarkdown === member.draftMarkdown).toBe(true);
  });

  it("leaves an unloaded member untouched", () => {
    const next = applyAgentTeamMemberRestored(EMPTY, "system:development", "dev-manager", "# 开发经理\n");
    expect(next).toBe(EMPTY);
  });
});

describe("applyAgentTeamMemberExternalChange", () => {
  it("applies a clean external change to both baseline and draft", () => {
    const state = readyMember("system:development", "dev-manager", "# 开发经理\n");
    const next = applyAgentTeamMemberExternalChange(state, "system:development", "dev-manager", "# 开发经理\n\n外部版\n");
    const member = getAgentTeamMemberDraft(next, "system:development", "dev-manager")!;
    expect(member.savedMarkdown).toBe("# 开发经理\n\n外部版\n");
    expect(member.externalChangeStatus).toBe("reloaded");
  });

  it("returns the SAME state for an identical repeated conflict (no re-check loop)", () => {
    const state = readyMember("system:development", "dev-manager", "# 开发经理\n");
    // Make the member dirty first so the external change lands in the conflict branch.
    const dirty: AgentTeamDraftState = {
      membersByKey: {
        "system:development\u0000dev-manager": {
          ...getAgentTeamMemberDraft(state, "system:development", "dev-manager")!,
          draftMarkdown: "# 开发经理\n\n本地未保存修改\n",
        },
      },
    };
    const first = applyAgentTeamMemberExternalChange(dirty, "system:development", "dev-manager", "# 开发经理\n\n外部版\n");
    expect(getAgentTeamMemberDraft(first, "system:development", "dev-manager")?.externalChangeStatus).toBe("conflict");
    // Second identical check result must not create fresh state; a new object
    // would re-run the external-check effect and record revisions forever.
    const second = applyAgentTeamMemberExternalChange(first, "system:development", "dev-manager", "# 开发经理\n\n外部版\n");
    expect(second).toBe(first);
  });
});
