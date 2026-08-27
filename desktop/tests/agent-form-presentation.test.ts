import { describe, expect, it } from "vitest";
import type { OperatorMemberIdentity, OperatorMessage } from "@moebius/console-ui";

import { projectAgentFormMessages } from "../src/console-page/agent-form-presentation.js";

const t = ((key: string) => key) as never;
const identities: OperatorMemberIdentity[] = [{
  slug: "dev",
  displayName: "开发",
  portraitId: "portrait-a",
  engine: { cli: "codex" },
}];

describe("agent form message presentation", () => {
  it("hides a valid form fence, removes a form-only timeline row, and uses member identity fallbacks", () => {
    const result = projectAgentFormMessages([
      message("请先回答：", 1),
      message(formBody(), 2, { body: formBody() }),
    ], identities, t);

    expect(result.agentForm).toMatchObject({
      sourceMessageId: 2,
      spec: {
        id: "decision",
        memberName: "开发",
        memberSlug: "dev",
        portraitId: "portrait-a",
        engine: { cli: "codex" },
      },
    });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.body).toBe("请先回答：");
  });

  it("keeps an invalid form as ordinary prose and lets a later valid form replace it", () => {
    const invalid = "```moebius-form\n{not json}\n```";
    const result = projectAgentFormMessages([
      message(invalid, 1),
      message(`说明\n\n${formBody("decision-new")}`, 2),
    ], [], t);

    expect(result.messages[0]?.body).toBe(invalid);
    expect(result.agentForm?.spec.id).toBe("decision-new");
    expect(result.messages[1]?.body).toBe("说明");
  });
});

function formBody(id = "decision"): string {
  return [
    "```moebius-form",
    JSON.stringify({
      id,
      questions: [{
        id: "choice",
        kind: "single",
        title: "下一步怎么做？",
        options: [{ id: "keep", title: "保留" }],
      }],
    }),
    "```",
  ].join("\n");
}

function message(body: string, id: number, overrides: Partial<OperatorMessage> = {}): OperatorMessage {
  return {
    id,
    sessionId: "session-a",
    speaker: "agent",
    role: "dev",
    body,
    status: "completed",
    runId: null,
    runDir: null,
    error: null,
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    ...overrides,
  };
}
