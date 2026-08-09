import { describe, expect, it } from "vitest";

import { splitAgentMarkdown, withAgentMarkdownBody } from "./agent-markdown-body";

const WITH_FRONTMATTER = `---
display_name: 开发经理
description: 负责技术决策与任务拆分
---

# 职责

推进方案落地。
`;

describe("splitAgentMarkdown", () => {
  it("keeps the metadata block out of the body, so rendering cannot turn it into a heading", () => {
    const { frontmatter, body } = splitAgentMarkdown(WITH_FRONTMATTER);

    expect(frontmatter).toBe("display_name: 开发经理\ndescription: 负责技术决策与任务拆分");
    expect(body).toBe("# 职责\n\n推进方案落地。\n");
    // `display_name: X` followed by `---` is a setext heading in markdown; that is the bug.
    expect(body).not.toContain("display_name");
    expect(body.startsWith("---")).toBe(false);
  });

  it("treats a file without frontmatter as all body", () => {
    expect(splitAgentMarkdown("# 只有正文\n")).toEqual({ frontmatter: null, body: "# 只有正文\n" });
  });

  it("does not mistake a horizontal rule further down for a metadata block", () => {
    const source = "# 标题\n\n正文\n\n---\n\n更多正文\n";
    expect(splitAgentMarkdown(source)).toEqual({ frontmatter: null, body: source });
  });

  it("round-trips: editing the body never drops or reshapes the identity block", () => {
    const edited = withAgentMarkdownBody(WITH_FRONTMATTER, "# 新职责\n\n换了内容。\n");

    expect(splitAgentMarkdown(edited).frontmatter).toBe(splitAgentMarkdown(WITH_FRONTMATTER).frontmatter);
    expect(splitAgentMarkdown(edited).body).toBe("# 新职责\n\n换了内容。\n");
  });

  it("leaves a frontmatter-less file frontmatter-less rather than inventing one", () => {
    expect(withAgentMarkdownBody("# 只有正文\n", "# 改过\n")).toBe("# 改过\n");
  });
});
