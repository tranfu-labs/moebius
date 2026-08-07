import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createReadyProviderProfile,
  formatProviderSessionReferenceOwner,
  formatProviderTeamReferenceOwner,
  type ProviderReference,
} from "../../src/provider-profile.js";
import { createProviderReferenceMutationPort } from "../src/provider-reference-mutation.js";
import type { AgentTeamService } from "../src/team-ipc.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function targetProfile() {
  return createReadyProviderProfile({
    id: "target-profile",
    providerId: "deepseek",
    displayName: "目标档案",
    credentialRef: "credential:target",
    keySuffix: "5678",
    defaultModel: "deepseek-v4-pro",
    verifiedModels: ["deepseek-v4-pro"],
    now: "2026-08-05T00:00:00.000Z",
  });
}

describe("provider reference mutation", () => {
  it("migrates selected members from one team as one atomic team write", async () => {
    const replace = vi.fn(async () => ({
      teamId: "team-1",
      ownership: "user" as const,
      memberSlugs: ["lead", "dev"],
      profile: {},
    }));
    const committed = vi.fn(async () => undefined);
    const references: ProviderReference[] = [
      teamReference("lead"),
      teamReference("dev"),
    ];
    const port = createProviderReferenceMutationPort({
      dataRoot: "/unused",
      agentTeamService: { replaceUnavailableAgentTeamExecutionProfiles: replace } as unknown as AgentTeamService,
      getSessionRuntime: () => null,
      list: async () => references,
    });

    await port.migrate({
      references,
      targetProfile: targetProfile(),
      targetModel: "deepseek-v4-pro",
      onCommitted: committed,
    });

    expect(replace).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("/unused", expect.objectContaining({
      teamId: "team-1",
      ownership: "user",
      memberSlugs: ["lead", "dev"],
      profile: expect.objectContaining({
        cli: "pi",
        providerProfileId: "target-profile",
        model: "deepseek-v4-pro",
      }),
    }));
    expect(committed).toHaveBeenCalledWith([
      formatProviderTeamReferenceOwner({ ownership: "user", teamId: "team-1", memberSlug: "lead" }),
      formatProviderTeamReferenceOwner({ ownership: "user", teamId: "team-1", memberSlug: "dev" }),
    ]);
  });

  it("preserves a draft while rebuilding its Pi context and can end it as read-only", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-provider-reference-"));
    temporaryRoots.push(root);
    const draftRoot = path.join(root, ".state", "ai-team-builder-drafts");
    await fs.mkdir(draftRoot, { recursive: true });
    await fs.writeFile(path.join(draftRoot, "draft-1.json"), JSON.stringify({
      version: 3,
      draftId: "draft-1",
      phase: "clarifying",
      messages: [{ role: "user", text: "保留我" }],
      executionProfile: {
        cli: "pi",
        providerId: "deepseek",
        providerProfileId: "source-profile",
        model: "deepseek-v4-flash",
        effort: "high",
      },
      externalSessionId: "pi-session-old",
    }), "utf8");
    const reference: ProviderReference = {
      kind: "team-builder-draft",
      ownerId: "draft-1",
      label: "草稿",
      profileId: "source-profile",
      model: "deepseek-v4-flash",
    };
    const port = createProviderReferenceMutationPort({
      dataRoot: root,
      agentTeamService: {} as AgentTeamService,
      getSessionRuntime: () => null,
      list: async () => [reference],
    });

    await port.migrate({
      references: [reference],
      targetProfile: targetProfile(),
      targetModel: "deepseek-v4-pro",
      onCommitted: async () => undefined,
    });
    const migrated = JSON.parse(await fs.readFile(path.join(draftRoot, "draft-1.json"), "utf8"));
    expect(migrated.messages[0].text).toBe("保留我");
    expect(migrated.executionProfile.providerProfileId).toBe("target-profile");
    expect(migrated.externalSessionId).toBeNull();
    expect(migrated.continuationEnded).toBe(false);

    await port.end({ references: [reference], onCommitted: async () => undefined });
    const ended = JSON.parse(await fs.readFile(path.join(draftRoot, "draft-1.json"), "utf8"));
    expect(ended.continuationEnded).toBe(true);
    expect(ended.messages.at(-1).text).toContain("只读历史");
  });

  it("routes resumable session migration and ending through the local-console runtime", async () => {
    const updateSessionMemberExecution = vi.fn(async () => ({}));
    const reference: ProviderReference = {
      kind: "resumable-session",
      ownerId: formatProviderSessionReferenceOwner({
        sessionId: "local:session-1",
        slot: "effective",
        memberName: "@developer",
      }),
      label: "会话",
      profileId: "source-profile",
      model: "deepseek-v4-flash",
    };
    const port = createProviderReferenceMutationPort({
      dataRoot: "/unused",
      agentTeamService: {} as AgentTeamService,
      getSessionRuntime: () => ({ updateSessionMemberExecution }),
      list: async () => [reference],
    });

    await port.migrate({
      references: [reference],
      targetProfile: targetProfile(),
      targetModel: "deepseek-v4-pro",
      onCommitted: async () => undefined,
    });
    await port.end({ references: [reference], onCommitted: async () => undefined });

    expect(updateSessionMemberExecution).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sessionId: "local:session-1",
      memberName: "@developer",
      action: "migrate",
      executionProfile: expect.objectContaining({ providerProfileId: "target-profile" }),
    }));
    expect(updateSessionMemberExecution).toHaveBeenNthCalledWith(2, {
      sessionId: "local:session-1",
      memberName: "@developer",
      action: "end",
    });
  });
});

function teamReference(memberSlug: string): ProviderReference {
  return {
    kind: "team-member",
    ownerId: formatProviderTeamReferenceOwner({ ownership: "user", teamId: "team-1", memberSlug }),
    label: memberSlug,
    profileId: "source-profile",
    model: "deepseek-v4-flash",
  };
}
