import { describe, expect, it } from "vitest";

import { parseAgentFormMessage } from "./agent-form-protocol";

const fallback = { memberName: "开发", memberSlug: "dev" };

describe("agent form response protocol", () => {
  it("extracts a valid fenced form and leaves the surrounding Agent prose", () => {
    const result = parseAgentFormMessage([
      "收尾前想确认一件事。",
      "",
      "```moebius-form",
      JSON.stringify({
        id: "wrap-up",
        questions: [{
          id: "choice",
          kind: "single",
          title: "这次怎么收尾",
          options: [{ id: "merge", title: "合并" }],
        }],
      }),
      "```",
      "",
      "选完我再继续。",
    ].join("\n"), fallback);

    expect(result.spec).toMatchObject({
      id: "wrap-up",
      memberName: "开发",
      memberSlug: "dev",
    });
    expect(result.body).toBe("收尾前想确认一件事。\n\n选完我再继续。");
  });

  it("keeps an invalid or oversized form visible as ordinary Agent prose", () => {
    const body = [
      "请看下面的决定。",
      "```moebius-form",
      JSON.stringify({
        id: "too-large",
        questions: [1, 2, 3, 4, 5].map((index) => ({
          id: `q${index}`,
          kind: "text",
          title: `问题 ${index}`,
        })),
      }),
      "```",
    ].join("\n");

    expect(parseAgentFormMessage(body, fallback)).toEqual({ body, spec: null });
  });

  it("uses the last valid form and removes only its protocol block", () => {
    const first = JSON.stringify({
      id: "old",
      questions: [{ id: "q", kind: "text", title: "旧问题" }],
    });
    const second = JSON.stringify({
      id: "new",
      questions: [{ id: "q", kind: "text", title: "新问题" }],
    });
    const result = parseAgentFormMessage(
      `前言\n\n\`\`\`moebius-form\n${first}\n\`\`\`\n\n\`\`\`moebius-form\n${second}\n\`\`\``,
      fallback,
    );

    expect(result.spec?.id).toBe("new");
    expect(result.body).toContain(first);
    expect(result.body).not.toContain(second);
  });
});
